use crate::menu;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, Runtime};

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Eq, PartialEq)]
enum ApplicationQuitAction {
    ExitThroughRuntime,
    Cancel,
    NotifyFrontend,
}

struct QuitGuardState {
    frontend: Mutex<FrontendSessionState>,
    quit_request_pending: AtomicBool,
}

#[derive(Debug)]
struct FrontendSessionState {
    id: u64,
    ready: SequencedBool,
    has_unsaved_changes: SequencedBool,
}

#[derive(Debug, Default)]
struct SequencedBool {
    sequence: u64,
    value: bool,
}

impl QuitGuardState {
    const fn new() -> Self {
        Self {
            frontend: Mutex::new(FrontendSessionState {
                id: 1,
                ready: SequencedBool {
                    sequence: 0,
                    value: false,
                },
                has_unsaved_changes: SequencedBool {
                    sequence: 0,
                    value: false,
                },
            }),
            quit_request_pending: AtomicBool::new(false),
        }
    }

    fn frontend_session(&self) -> u64 {
        self.lock_frontend().id
    }

    fn set_frontend_ready(
        &self,
        session: u64,
        sequence: u64,
        ready: bool,
    ) -> Result<bool, &'static str> {
        let mut frontend = self.lock_frontend();
        if frontend.id != session {
            return Err("Viva's native quit protection session changed");
        }
        Ok(Self::set_sequenced_bool(
            &mut frontend.ready,
            sequence,
            ready,
        ))
    }

    fn start_new_frontend_session(&self) -> u64 {
        let mut frontend = self.lock_frontend();
        frontend.id = frontend.id.checked_add(1).unwrap_or(1);
        frontend.ready = SequencedBool::default();
        frontend.has_unsaved_changes = SequencedBool::default();
        self.finish_quit_request();
        frontend.id
    }

    fn frontend_is_ready(&self) -> bool {
        self.lock_frontend().ready.value
    }

    fn try_begin_quit_request(&self) -> bool {
        self.frontend_is_ready() && !self.quit_request_pending.swap(true, Ordering::AcqRel)
    }

    fn finish_quit_request(&self) -> bool {
        self.quit_request_pending.swap(false, Ordering::AcqRel)
    }

    fn set_has_unsaved_changes(
        &self,
        session: u64,
        sequence: u64,
        dirty: bool,
    ) -> Result<bool, &'static str> {
        let mut frontend = self.lock_frontend();
        if frontend.id != session {
            return Err("Viva's native quit protection session changed");
        }
        Ok(Self::set_sequenced_bool(
            &mut frontend.has_unsaved_changes,
            sequence,
            dirty,
        ))
    }

    #[cfg(any(target_os = "windows", test))]
    fn should_block_windows_session_end(&self) -> bool {
        self.lock_frontend().has_unsaved_changes.value
    }

    #[cfg(any(target_os = "macos", test))]
    fn take_application_quit_action(&self, has_main_window: bool) -> ApplicationQuitAction {
        if !has_main_window {
            ApplicationQuitAction::ExitThroughRuntime
        } else if self.try_begin_quit_request() {
            ApplicationQuitAction::NotifyFrontend
        } else {
            ApplicationQuitAction::Cancel
        }
    }

    fn lock_frontend(&self) -> std::sync::MutexGuard<'_, FrontendSessionState> {
        self.frontend
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set_sequenced_bool(state: &mut SequencedBool, sequence: u64, value: bool) -> bool {
        if sequence <= state.sequence {
            return false;
        }
        state.sequence = sequence;
        state.value = value;
        true
    }
}

static QUIT_GUARD_STATE: QuitGuardState = QuitGuardState::new();

#[tauri::command]
pub fn get_quit_guard_session() -> u64 {
    QUIT_GUARD_STATE.frontend_session()
}

#[tauri::command]
pub fn set_quit_guard_ready(
    app: tauri::AppHandle,
    ready: bool,
    session: u64,
    sequence: u64,
) -> Result<bool, String> {
    let applied = QUIT_GUARD_STATE
        .set_frontend_ready(session, sequence, ready)
        .map_err(str::to_owned)?;
    if applied && !ready {
        cancel_application_quit_inner(&app).map_err(|error| error.to_string())?;
    }
    Ok(applied)
}

pub fn reset_frontend_session<R: Runtime>(app: &tauri::AppHandle<R>) {
    let session = QUIT_GUARD_STATE.start_new_frontend_session();
    crate::media::reset_frontend_image_session(session);
    let _ = cancel_application_quit_inner(app);
}

#[tauri::command]
pub fn set_has_unsaved_changes(dirty: bool, session: u64, sequence: u64) -> Result<bool, String> {
    QUIT_GUARD_STATE
        .set_has_unsaved_changes(session, sequence, dirty)
        .map_err(str::to_owned)
}

fn notify_frontend_of_quit<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    QUIT_GUARD_STATE.frontend_is_ready()
        && app
            .emit_to("main", menu::MENU_EVENT, menu::APP_QUIT)
            .is_ok()
}

fn deliver_frontend_quit_request<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    let delivered = notify_frontend_of_quit(app);
    if !delivered {
        QUIT_GUARD_STATE.finish_quit_request();
    }
    delivered
}

fn request_frontend_quit<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    QUIT_GUARD_STATE.try_begin_quit_request() && deliver_frontend_quit_request(app)
}

pub fn handle_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if !should_intercept_window_close(window.label()) {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = request_frontend_quit(window.app_handle());
    }
}

fn should_intercept_window_close(label: &str) -> bool {
    label == "main"
}

#[tauri::command]
pub fn confirm_application_quit(app: tauri::AppHandle) -> Result<(), String> {
    confirm_application_quit_inner(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cancel_application_quit(app: tauri::AppHandle) -> Result<(), String> {
    cancel_application_quit_inner(&app).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn confirm_application_quit_inner<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    QUIT_GUARD_STATE.finish_quit_request();
    if let Some(window) = app.get_webview_window("main") {
        window.destroy()?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn cancel_application_quit_inner<R: Runtime>(_app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    QUIT_GUARD_STATE.finish_quit_request();
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{ApplicationQuitAction, QUIT_GUARD_STATE, deliver_frontend_quit_request};
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, ProtocolObject, Sel};
    use objc2::{MainThreadMarker, sel};
    use objc2_app_kit::{NSApplication, NSApplicationDelegate, NSApplicationTerminateReply};
    use std::error::Error;
    use std::io;
    use std::sync::OnceLock;
    use tauri::{AppHandle, Manager, Runtime};

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

    extern "C-unwind" fn application_should_terminate(
        _delegate: &AnyObject,
        _selector: Sel,
        _application: &NSApplication,
    ) -> NSApplicationTerminateReply {
        let app = APP_HANDLE.get();
        let has_main_window = app.and_then(|app| app.get_webview_window("main")).is_some();
        match QUIT_GUARD_STATE.take_application_quit_action(has_main_window) {
            ApplicationQuitAction::ExitThroughRuntime => {
                if let Some(app) = app {
                    app.exit(0);
                }
            }
            ApplicationQuitAction::NotifyFrontend => {
                if let Some(app) = app {
                    let _ = deliver_frontend_quit_request(app);
                } else {
                    QUIT_GUARD_STATE.finish_quit_request();
                }
            }
            ApplicationQuitAction::Cancel => {}
        }
        // Never let AppKit enter its nested `NSTerminateLater` event loop.
        // Confirmed quits are sent through Tauri so Tao can release its event
        // callback lock before stopping NSApplication's outer run loop.
        NSApplicationTerminateReply::TerminateCancel
    }

    pub fn request_application_quit<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
        let _ = super::request_frontend_quit(app);
        Ok(())
    }

    pub fn confirm_application_quit<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
        QUIT_GUARD_STATE.finish_quit_request();
        app.exit(0);
        Ok(())
    }

    pub fn cancel_application_quit<R: Runtime>(_app: &AppHandle<R>) -> tauri::Result<()> {
        QUIT_GUARD_STATE.finish_quit_request();
        Ok(())
    }

    pub fn install(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
        APP_HANDLE.set(app.handle().clone()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::AlreadyExists,
                "Viva's application handle was already installed",
            )
        })?;

        let main_thread = MainThreadMarker::new().ok_or_else(|| {
            io::Error::other("Viva's macOS quit guard must be installed on the main thread")
        })?;
        let application = NSApplication::sharedApplication(main_thread);
        let delegate = application
            .delegate()
            .ok_or_else(|| io::Error::other("macOS did not provide an application delegate"))?;
        let delegate_protocol: &ProtocolObject<dyn NSApplicationDelegate> = &delegate;
        let delegate_object: &AnyObject = delegate_protocol.as_ref();
        let original_class = delegate_object.class();

        let mut subclass = ClassBuilder::new(c"VivaTaoAppDelegate", original_class)
            .ok_or_else(|| io::Error::other("Viva's macOS quit guard class already exists"))?;
        // SAFETY: The selector and function use AppKit's exact
        // `applicationShouldTerminate:` signature. The subclass adds no ivars.
        unsafe {
            let implementation: extern "C-unwind" fn(_, _, _) -> _ = application_should_terminate;
            subclass.add_method(sel!(applicationShouldTerminate:), implementation);
        }
        let subclass: &'static AnyClass = subclass.register();

        // SAFETY: `subclass` directly extends the current delegate class, adds
        // no ivars, and the only override has a verified Objective-C ABI.
        let replaced_class = unsafe { AnyObject::set_class(delegate_object, subclass) };
        if replaced_class != original_class {
            return Err(io::Error::other(
                "macOS changed Viva's application delegate while installing quit protection",
            )
            .into());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(target_os = "macos")]
pub use macos::request_application_quit;

#[cfg(target_os = "macos")]
fn confirm_application_quit_inner<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    macos::confirm_application_quit(app)
}

#[cfg(target_os = "macos")]
fn cancel_application_quit_inner<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    macos::cancel_application_quit(app)
}

#[cfg(target_os = "windows")]
mod windows {
    use super::QUIT_GUARD_STATE;
    use std::error::Error;
    use std::io;
    use tauri::Manager;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{WM_NCDESTROY, WM_QUERYENDSESSION};

    const VIVA_SESSION_END_SUBCLASS_ID: usize = 0x5649_5641;

    unsafe extern "system" fn session_end_subclass_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        _reference_data: usize,
    ) -> LRESULT {
        if message == WM_QUERYENDSESSION && QUIT_GUARD_STATE.should_block_windows_session_end() {
            return 0;
        }
        if message == WM_NCDESTROY {
            // SAFETY: This removes the exact callback and ID installed below
            // while Windows is destroying that same HWND.
            unsafe {
                RemoveWindowSubclass(
                    hwnd,
                    Some(session_end_subclass_proc),
                    VIVA_SESSION_END_SUBCLASS_ID,
                );
            }
        }
        // SAFETY: Unhandled messages must continue through the existing Tao
        // subclass chain with the original ABI values.
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn install(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| io::Error::other("Viva's main window is unavailable"))?;
        let hwnd = window.hwnd()?.0 as HWND;
        // SAFETY: setup runs on the window thread, the callback is static, and
        // it stores no borrowed data in the subclass reference slot.
        let installed = unsafe {
            SetWindowSubclass(
                hwnd,
                Some(session_end_subclass_proc),
                VIVA_SESSION_END_SUBCLASS_ID,
                0,
            )
        };
        if installed == 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub use windows::install;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn install(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn application_quit_requests_the_frontend_once_until_the_request_finishes() {
        let state = QuitGuardState::new();
        assert!(state.set_frontend_ready(1, 1, true).unwrap());

        assert_eq!(
            state.take_application_quit_action(true),
            ApplicationQuitAction::NotifyFrontend
        );
        assert_eq!(
            state.take_application_quit_action(true),
            ApplicationQuitAction::Cancel
        );
        assert!(state.finish_quit_request());

        assert_eq!(
            state.take_application_quit_action(true),
            ApplicationQuitAction::NotifyFrontend
        );
    }

    #[test]
    fn unavailable_frontend_fails_closed_and_session_reset_clears_pending_requests() {
        let state = QuitGuardState::new();
        assert_eq!(
            state.take_application_quit_action(true),
            ApplicationQuitAction::Cancel
        );

        assert!(state.set_frontend_ready(1, 1, true).unwrap());
        assert_eq!(
            state.take_application_quit_action(true),
            ApplicationQuitAction::NotifyFrontend
        );
        state.start_new_frontend_session();
        assert!(!state.finish_quit_request());
        assert_eq!(
            state.take_application_quit_action(true),
            ApplicationQuitAction::Cancel
        );
    }

    #[test]
    fn cancelled_frontend_quit_request_can_be_retried() {
        let state = QuitGuardState::new();
        assert!(state.set_frontend_ready(1, 1, true).unwrap());
        assert!(state.try_begin_quit_request());
        assert!(!state.try_begin_quit_request());
        assert!(state.finish_quit_request());
        assert!(state.try_begin_quit_request());
    }

    #[test]
    fn application_exits_through_tao_after_the_main_window_is_gone() {
        let state = QuitGuardState::new();
        assert_eq!(
            state.take_application_quit_action(false),
            ApplicationQuitAction::ExitThroughRuntime
        );
    }

    #[test]
    fn only_the_main_window_uses_the_shared_close_guard() {
        assert!(should_intercept_window_close("main"));
        assert!(!should_intercept_window_close("preferences"));
    }

    #[test]
    fn windows_session_end_is_blocked_only_for_unsaved_changes() {
        let state = QuitGuardState::new();
        assert!(!state.should_block_windows_session_end());
        assert!(state.set_has_unsaved_changes(1, 2, true).unwrap());
        assert!(state.should_block_windows_session_end());
        assert!(!state.set_has_unsaved_changes(1, 1, false).unwrap());
        assert!(state.should_block_windows_session_end());
        assert!(state.set_has_unsaved_changes(1, 3, false).unwrap());
        assert!(!state.should_block_windows_session_end());
    }

    #[test]
    fn renderer_reload_rejects_late_state_from_the_previous_session() {
        let state = QuitGuardState::new();
        assert!(state.set_frontend_ready(1, 1, true).unwrap());
        assert!(state.set_has_unsaved_changes(1, 2, true).unwrap());

        let next_session = state.start_new_frontend_session();
        assert_eq!(next_session, 2);
        assert!(!state.frontend_is_ready());
        assert!(!state.should_block_windows_session_end());
        assert!(state.set_frontend_ready(1, 3, true).is_err());
        assert!(state.set_has_unsaved_changes(1, 4, true).is_err());
        assert!(!state.frontend_is_ready());
        assert!(!state.should_block_windows_session_end());

        assert!(state.set_frontend_ready(2, 1, true).unwrap());
        assert!(state.set_has_unsaved_changes(2, 2, true).unwrap());
        assert!(state.frontend_is_ready());
        assert!(state.should_block_windows_session_end());
    }
}
