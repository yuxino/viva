use crate::models::{CommandError, CommandResult, ErrorCode};
use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct CrossProcessLock {
    file: File,
}

impl CrossProcessLock {
    pub(crate) fn acquire(path: &Path, description: &str) -> CommandResult<Self> {
        let file = validated_lock_file(path, description)?;
        FileExt::lock_exclusive(&file)
            .map_err(|error| lock_io_error(description, "acquire its lock", error))?;
        Ok(Self { file })
    }

    pub(crate) fn try_acquire(path: &Path, description: &str) -> CommandResult<Option<Self>> {
        let file = validated_lock_file(path, description)?;
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => Ok(Some(Self { file })),
            Err(error) if is_lock_contended(&error) => Ok(None),
            Err(error) => Err(lock_io_error(description, "acquire its lock", error)),
        }
    }
}

fn is_lock_contended(error: &std::io::Error) -> bool {
    let expected = fs2::lock_contended_error();
    match (error.raw_os_error(), expected.raw_os_error()) {
        (Some(actual), Some(expected)) => actual == expected,
        _ => error.kind() == expected.kind(),
    }
}

fn validated_lock_file(path: &Path, description: &str) -> CommandResult<File> {
    let parent = ensure_private_lock_directory(path, description)?;
    let file = open_lock_file(path, description)?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| lock_io_error(description, "inspect its lock file", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(invalid_lock_error(description));
    }

    let canonical = fs::canonicalize(path)
        .map_err(|error| lock_io_error(description, "open its lock file", error))?;
    if canonical.parent() != Some(parent.as_path()) {
        return Err(invalid_lock_error(description));
    }
    Ok(file)
}

impl Drop for CrossProcessLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

fn ensure_private_lock_directory(path: &Path, description: &str) -> CommandResult<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid_lock_error(description))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder
            .create(parent)
            .map_err(|error| lock_io_error(description, "create its lock folder", error))?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(parent)
        .map_err(|error| lock_io_error(description, "create its lock folder", error))?;

    let metadata = fs::symlink_metadata(parent)
        .map_err(|error| lock_io_error(description, "inspect its lock folder", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_lock_error(description));
    }
    fs::canonicalize(parent)
        .map_err(|error| lock_io_error(description, "open its lock folder", error))
}

fn open_lock_file(path: &Path, description: &str) -> CommandResult<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|error| lock_io_error(description, "open its lock file", error))
}

fn invalid_lock_error(description: &str) -> CommandError {
    CommandError::new(
        ErrorCode::Io,
        format!("Viva could not safely use the process lock for {description}."),
    )
}

fn lock_io_error(description: &str, action: &str, error: std::io::Error) -> CommandError {
    CommandError::new(
        ErrorCode::Io,
        format!("Viva could not {action} for {description}: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};
    use tempfile::tempdir;

    const CHILD_ENV: &str = "VIVA_LOCK_TEST_CHILD";
    const LOCK_PATH_ENV: &str = "VIVA_LOCK_TEST_PATH";
    const ATTEMPT_PATH_ENV: &str = "VIVA_LOCK_TEST_ATTEMPT_PATH";
    const ACQUIRED_PATH_ENV: &str = "VIVA_LOCK_TEST_ACQUIRED_PATH";

    #[test]
    fn cross_process_lock_child() {
        if std::env::var_os(CHILD_ENV).is_none() {
            return;
        }
        let lock_path = PathBuf::from(std::env::var_os(LOCK_PATH_ENV).unwrap());
        let attempt_path = PathBuf::from(std::env::var_os(ATTEMPT_PATH_ENV).unwrap());
        let acquired_path = PathBuf::from(std::env::var_os(ACQUIRED_PATH_ENV).unwrap());
        fs::write(attempt_path, b"attempting").unwrap();
        let _guard = CrossProcessLock::acquire(&lock_path, "the test resource").unwrap();
        fs::write(acquired_path, b"acquired").unwrap();
    }

    #[test]
    fn serializes_a_separate_process_until_the_guard_is_released() {
        let directory = tempdir().unwrap();
        let lock_path = directory.path().join("locks/document.lock");
        let attempt_path = directory.path().join("child-attempting");
        let acquired_path = directory.path().join("child-acquired");
        let guard = CrossProcessLock::acquire(&lock_path, "the test resource").unwrap();

        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("locking::tests::cross_process_lock_child")
            .arg("--nocapture")
            .env(CHILD_ENV, "1")
            .env(LOCK_PATH_ENV, &lock_path)
            .env(ATTEMPT_PATH_ENV, &attempt_path)
            .env(ACQUIRED_PATH_ENV, &acquired_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        wait_for_path(&attempt_path, Duration::from_secs(5));
        assert!(!acquired_path.exists());
        assert!(child.try_wait().unwrap().is_none());

        drop(guard);
        wait_for_path(&acquired_path, Duration::from_secs(5));
        assert!(child.wait().unwrap().success());
    }

    #[test]
    fn try_lock_reports_a_busy_process_lock_without_waiting() {
        let directory = tempdir().unwrap();
        let lock_path = directory.path().join("locks/document.lock");
        let guard = CrossProcessLock::acquire(&lock_path, "the test resource").unwrap();

        assert!(
            CrossProcessLock::try_acquire(&lock_path, "the test resource")
                .unwrap()
                .is_none()
        );

        drop(guard);
        assert!(
            CrossProcessLock::try_acquire(&lock_path, "the test resource")
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn recognizes_the_platform_lock_contention_error() {
        assert!(is_lock_contended(&fs2::lock_contended_error()));
    }

    fn wait_for_path(path: &Path, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while !path.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(path.exists(), "{} was not created in time", path.display());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_lock_file() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let lock_directory = directory.path().join("locks");
        fs::create_dir(&lock_directory).unwrap();
        let target = directory.path().join("target");
        fs::write(&target, b"").unwrap();
        let lock_path = lock_directory.join("document.lock");
        symlink(target, &lock_path).unwrap();

        let error = CrossProcessLock::acquire(&lock_path, "the test resource").unwrap_err();
        assert_eq!(error.code, ErrorCode::Io);
    }
}
