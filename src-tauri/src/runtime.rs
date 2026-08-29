use crate::models::{CommandError, CommandResult, ErrorCode};
use std::ffi::OsStr;
#[cfg(any(target_os = "macos", test))]
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub(crate) async fn run_blocking<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| blocking_task_error())?
}

fn blocking_task_error() -> CommandError {
    CommandError::new(ErrorCode::Io, "The local operation could not be completed.")
}

#[tauri::command]
pub async fn open_new_window() -> CommandResult<()> {
    run_blocking(open_new_window_core).await
}

#[tauri::command]
pub fn is_fresh_window() -> bool {
    arguments_request_fresh_window(std::env::args_os())
}

pub(crate) fn should_restore_window_state() -> bool {
    !is_fresh_window()
}

fn arguments_request_fresh_window<I, S>(arguments: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    arguments
        .into_iter()
        .any(|argument| argument.as_ref() == OsStr::new("--new-window"))
}

fn open_new_window_core() -> CommandResult<()> {
    let executable = std::env::current_exe().map_err(|error| {
        CommandError::new(
            ErrorCode::Io,
            format!("Viva could not locate its application executable: {error}"),
        )
    })?;

    #[cfg(target_os = "macos")]
    if let Some(bundle) = application_bundle_for(&executable) {
        let status = Command::new("/usr/bin/open")
            .arg("-n")
            .arg(bundle)
            .arg("--args")
            .arg("--new-window")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| {
                CommandError::new(
                    ErrorCode::Io,
                    format!("Viva could not open a new window: {error}"),
                )
            })?;
        if status.success() {
            return Ok(());
        }
        return Err(CommandError::new(
            ErrorCode::Io,
            "macOS could not open another Viva window.",
        ));
    }

    let mut command = Command::new(executable);
    command
        .arg("--new-window")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
    command.spawn().map_err(|error| {
        CommandError::new(
            ErrorCode::Io,
            format!("Viva could not open a new window: {error}"),
        )
    })?;
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn application_bundle_for(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .find(|ancestor| {
            ancestor
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        })
        .map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_join_failures_to_a_stable_non_sensitive_error() {
        let result = tauri::async_runtime::block_on(run_blocking(|| -> CommandResult<()> {
            panic!("worker failed")
        }));
        let error = result.unwrap_err();

        assert_eq!(error.code, ErrorCode::Io);
        assert_eq!(error.message, "The local operation could not be completed.");
    }

    #[test]
    fn preserves_core_command_errors() {
        let result = tauri::async_runtime::block_on(run_blocking(|| -> CommandResult<()> {
            Err(CommandError::new(ErrorCode::Conflict, "stable conflict"))
        }));
        let error = result.unwrap_err();

        assert_eq!(error.code, ErrorCode::Conflict);
        assert_eq!(error.message, "stable conflict");
    }

    #[test]
    fn runs_blocking_operations_on_a_worker_thread() {
        let caller = std::thread::current().id();
        let worker =
            tauri::async_runtime::block_on(run_blocking(|| Ok(std::thread::current().id())))
                .unwrap();

        assert_ne!(worker, caller);
    }

    #[test]
    fn finds_the_enclosing_macos_application_bundle() {
        assert_eq!(
            application_bundle_for(Path::new("/Applications/Viva.app/Contents/MacOS/Viva")),
            Some(PathBuf::from("/Applications/Viva.app"))
        );
        assert_eq!(
            application_bundle_for(Path::new("/workspace/target/debug/viva")),
            None
        );
    }

    #[test]
    fn fresh_window_flag_is_the_window_state_isolation_boundary() {
        assert!(arguments_request_fresh_window(["viva", "--new-window"]));
        assert!(!arguments_request_fresh_window(["viva", "document.md"]));
        assert_eq!(should_restore_window_state(), !is_fresh_window());
    }
}
