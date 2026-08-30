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
    use std::mem::{offset_of, size_of};
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_RENAME_INFO, FileRenameInfo, SetFileInformationByHandle,
    };

    let wide_name: Vec<u16> = destination_name.encode_wide().collect();
    if wide_name.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the destination name is empty",
        ));
    }
    let name_bytes = wide_name
        .len()
        .checked_mul(size_of::<u16>())
        .ok_or_else(|| io::Error::other("destination name length overflow"))?;
    let buffer_bytes = offset_of!(FILE_RENAME_INFO, FileName)
        .checked_add(name_bytes)
        .ok_or_else(|| io::Error::other("rename buffer length overflow"))?;
    let word_bytes = size_of::<usize>();
    let buffer_words = buffer_bytes
        .checked_add(word_bytes - 1)
        .ok_or_else(|| io::Error::other("rename buffer length overflow"))?
        / word_bytes;
    let mut buffer = vec![0_usize; buffer_words];
    let information = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();

    // SAFETY: the usize-backed buffer is aligned and large enough for the
    // fixed header plus the complete UTF-16 destination name.
    unsafe {
        (*information).Anonymous.ReplaceIfExists = false;
        (*information).RootDirectory = destination_directory.as_raw_handle() as _;
        (*information).FileNameLength = name_bytes as u32;
        std::ptr::copy_nonoverlapping(
            wide_name.as_ptr(),
            (*information).FileName.as_mut_ptr(),
            wide_name.len(),
        );
    }

    // SAFETY: both handles stay live for the call and `information` points to
    // the initialized buffer described by `buffer_bytes`.
    let succeeded = unsafe {
        SetFileInformationByHandle(
            source.as_raw_handle() as _,
            FileRenameInfo,
            information.cast(),
            buffer_bytes as u32,
        )
    };
    if succeeded == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(all(not(unix), not(target_os = "windows")))]
pub(crate) fn stable_handle_identity<H>(_handle: &H) -> io::Result<StableFileIdentity> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "stable filesystem identities are unavailable on this platform",
    ))
}
