use std::fmt::Write as _;
use std::io;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct StableFileIdentity {
    pub(crate) volume: u64,
    pub(crate) file: u64,
}

pub(crate) fn random_component(prefix: &str, suffix: &str) -> io::Result<String> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random)
        .map_err(|error| io::Error::other(format!("system random source failed: {error}")))?;
    let mut name = String::with_capacity(prefix.len() + random.len() * 2 + suffix.len());
    name.push_str(prefix);
    for byte in random {
        write!(&mut name, "{byte:02x}").expect("writing to a String cannot fail");
    }
    name.push_str(suffix);
    Ok(name)
}

#[cfg(unix)]
pub(crate) fn stable_handle_identity<H>(handle: &H) -> io::Result<StableFileIdentity>
where
    H: std::os::fd::AsFd,
{
    let metadata = rustix::fs::fstat(handle)
        .map_err(|error| io::Error::from_raw_os_error(error.raw_os_error()))?;
    Ok(StableFileIdentity {
        volume: metadata.st_dev as u64,
        file: metadata.st_ino as u64,
    })
}

#[cfg(target_os = "windows")]
pub(crate) fn stable_handle_identity<H>(handle: &H) -> io::Result<StableFileIdentity>
where
    H: std::os::windows::io::AsRawHandle,
{
    use std::mem::MaybeUninit;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    let mut information = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    // SAFETY: `handle` supplies a live kernel handle and the output pointer is writable.
    let succeeded = unsafe {
        GetFileInformationByHandle(handle.as_raw_handle() as _, information.as_mut_ptr())
    };
    if succeeded == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: GetFileInformationByHandle initialized the structure on success.
    let information = unsafe { information.assume_init() };
    Ok(StableFileIdentity {
        volume: u64::from(information.dwVolumeSerialNumber),
        file: (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
    })
}

#[cfg(target_os = "windows")]
pub(crate) fn rename_open_handle_noclobber<H, D>(
    source: &H,
    destination_directory: &D,
    destination_name: &std::ffi::OsStr,
) -> io::Result<()>
where
    H: std::os::windows::io::AsRawHandle,
    D: std::os::windows::io::AsRawHandle,
{
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::{Component, Path};
    use windows_sys::Wdk::Storage::FileSystem::{
        FILE_RENAME_INFORMATION, FileRenameInformation, NtSetInformationFile,
    };
    use windows_sys::Win32::Foundation::{INVALID_HANDLE_VALUE, RtlNtStatusToDosError};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
        FILE_TRAVERSE, ReOpenFile,
    };
    use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

    let destination_path = Path::new(destination_name);
    let mut components = destination_path.components();
    let is_single_leaf = matches!(components.next(), Some(Component::Normal(name)) if name == destination_name)
        && components.next().is_none();
    if !is_single_leaf {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the destination name must be one non-empty path component",
        ));
    }

    let wide_name: Vec<u16> = destination_name.encode_wide().collect();
    if wide_name.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the destination name contains a null character",
        ));
    }
    let name_bytes = wide_name
        .len()
        .checked_mul(size_of::<u16>())
        .ok_or_else(|| io::Error::other("destination name length overflow"))?;
    let file_name_length = u32::try_from(name_bytes)
        .map_err(|_| io::Error::other("destination name length overflow"))?;
    // NtSetInformationFile requires the complete fixed-size structure plus
    // the variable UTF-16 name. The extra fixed-size FileName element and
    // trailing padding are deliberately retained, as required by the Windows
    // driver contract.
    let buffer_bytes = size_of::<FILE_RENAME_INFORMATION>()
        .checked_add(name_bytes)
        .ok_or_else(|| io::Error::other("rename buffer length overflow"))?;
    let buffer_length = u32::try_from(buffer_bytes)
        .map_err(|_| io::Error::other("rename buffer length overflow"))?;
    let word_bytes = size_of::<usize>();
    let buffer_words = buffer_bytes
        .checked_add(word_bytes - 1)
        .ok_or_else(|| io::Error::other("rename buffer length overflow"))?
        / word_bytes;
    let mut buffer = vec![0_usize; buffer_words];
    let information = buffer.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();

    // cap-std intentionally pins directories against renames, but its normal
    // read handle does not request FILE_TRAVERSE. Reopen the same kernel file
    // object with the exact RootDirectory rights recommended by Microsoft;
    // this does not resolve or trust an ambient path.
    let root_handle = unsafe {
        ReOpenFile(
            destination_directory.as_raw_handle() as _,
            FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_FLAG_BACKUP_SEMANTICS,
        )
    };
    if root_handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: ReOpenFile returned a new owned kernel handle on success.
    let root_handle = unsafe { OwnedHandle::from_raw_handle(root_handle as _) };

    // SAFETY: the usize-backed buffer is aligned and large enough for the
    // fixed header plus the complete UTF-16 destination name.
    unsafe {
        (*information).Anonymous.ReplaceIfExists = false;
        (*information).RootDirectory = root_handle.as_raw_handle() as _;
        (*information).FileNameLength = file_name_length;
        std::ptr::copy_nonoverlapping(
            wide_name.as_ptr(),
            (*information).FileName.as_mut_ptr(),
            wide_name.len(),
        );
    }

    let mut io_status = IO_STATUS_BLOCK::default();
    // SAFETY: both handles stay live for the synchronous call and
    // `information` points to the initialized, aligned buffer described by
    // `buffer_bytes`. FileRenameInformation accepts a destination path
    // relative to RootDirectory and honors ReplaceIfExists=false atomically.
    let status = unsafe {
        NtSetInformationFile(
            source.as_raw_handle() as _,
            &mut io_status,
            information.cast(),
            buffer_length,
            FileRenameInformation,
        )
    };
    if status < 0 {
        // SAFETY: every NTSTATUS returned by NtSetInformationFile is a valid
        // input to the system's NTSTATUS-to-Win32 error mapper.
        let error = unsafe { RtlNtStatusToDosError(status) };
        Err(io::Error::from_raw_os_error(error as i32))
    } else {
        Ok(())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_rename_diagnostic {
    use super::rename_open_handle_noclobber;
    use cap_std::ambient_authority;
    use cap_std::fs::{Dir, OpenOptions, OpenOptionsExt};
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_RENAME_INFO,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE, FileRenameInfo,
        ReOpenFile, SYNCHRONIZE, SetFileInformationByHandle,
    };

    fn attempt(dir: &Dir, source_name: &str, destination_name: &str, share: u32) -> String {
        dir.write(source_name, b"diagnostic").unwrap();
        let mut options = OpenOptions::new();
        options
            .read(true)
            .access_mode(DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE)
            .share_mode(share)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
        let source = dir.open_with(source_name, &options).unwrap();
        format!(
            "{:?}",
            rename_open_handle_noclobber(&source, dir, std::ffi::OsStr::new(destination_name),)
        )
    }

    fn attempt_same_parent(
        dir: &Dir,
        source_name: &str,
        destination_name: &str,
        share: u32,
    ) -> String {
        dir.write(source_name, b"diagnostic").unwrap();
        let mut options = OpenOptions::new();
        options
            .read(true)
            .access_mode(DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE)
            .share_mode(share)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
        let source = dir.open_with(source_name, &options).unwrap();
        let wide_name: Vec<u16> = std::ffi::OsStr::new(destination_name)
            .encode_wide()
            .collect();
        let name_bytes = wide_name.len() * size_of::<u16>();
        let buffer_bytes = size_of::<FILE_RENAME_INFO>() + name_bytes;
        let mut buffer = vec![0_usize; buffer_bytes.div_ceil(size_of::<usize>())];
        let information = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        unsafe {
            (*information).Anonymous.ReplaceIfExists = false;
            (*information).RootDirectory = std::ptr::null_mut();
            (*information).FileNameLength = name_bytes as u32;
            std::ptr::copy_nonoverlapping(
                wide_name.as_ptr(),
                (*information).FileName.as_mut_ptr(),
                wide_name.len(),
            );
        }
        let succeeded = unsafe {
            SetFileInformationByHandle(
                source.as_raw_handle() as _,
                FileRenameInfo,
                information.cast(),
                buffer_bytes as u32,
            )
        };
        if succeeded == 0 {
            format!("Err({:?})", std::io::Error::last_os_error())
        } else {
            "Ok".to_owned()
        }
    }

    #[test]
    fn reports_root_reopen_and_source_share_requirements() {
        let temp = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();

        let reopened = unsafe {
            ReOpenFile(
                std::os::windows::io::AsRawHandle::as_raw_handle(&dir) as _,
                FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                FILE_FLAG_BACKUP_SEMANTICS,
            )
        };
        let root_result = if reopened == INVALID_HANDLE_VALUE {
            format!("Err({:?})", std::io::Error::last_os_error())
        } else {
            let _owned = unsafe { OwnedHandle::from_raw_handle(reopened as _) };
            "Ok".to_owned()
        };

        let without_delete_share = attempt(
            &dir,
            "without-delete-share.md",
            "without-delete-share-renamed.md",
            FILE_SHARE_READ | FILE_SHARE_WRITE,
        );
        let with_delete_share = attempt(
            &dir,
            "with-delete-share.md",
            "with-delete-share-renamed.md",
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        );
        let same_parent_without_delete_share = attempt_same_parent(
            &dir,
            "same-parent-without-delete-share.md",
            "same-parent-without-delete-share-renamed.md",
            FILE_SHARE_READ | FILE_SHARE_WRITE,
        );
        let same_parent_with_delete_share = attempt_same_parent(
            &dir,
            "same-parent-with-delete-share.md",
            "same-parent-with-delete-share-renamed.md",
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        );

        panic!(
            "Windows rename diagnostic: root_reopen={root_result}; relative_without_delete_share={without_delete_share}; relative_with_delete_share={with_delete_share}; same_parent_without_delete_share={same_parent_without_delete_share}; same_parent_with_delete_share={same_parent_with_delete_share}"
        );
    }
}

#[cfg(all(not(unix), not(target_os = "windows")))]
pub(crate) fn stable_handle_identity<H>(_handle: &H) -> io::Result<StableFileIdentity> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "stable filesystem identities are unavailable on this platform",
    ))
}
