mod filesystem;
mod history;
mod locking;
mod media;
mod menu;
mod models;
mod quit_guard;
mod runtime;

pub use models::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    let builder = if runtime::should_restore_window_state() {
        builder.plugin(tauri_plugin_window_state::Builder::default().build())
    } else {
        builder
    };
    let builder = builder
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                quit_guard::reset_frontend_session(webview.app_handle());
            }
        })
        .on_window_event(quit_guard::handle_window_event);

    #[cfg(target_os = "macos")]
    let builder = builder.on_web_content_process_terminate(|webview| {
        quit_guard::reset_frontend_session(webview.app_handle());
    });

    builder
        .setup(|app| {
            quit_guard::install(app)?;
            Ok(())
        })
        .menu(menu::build)
        .on_menu_event(menu::forward_event)
        .invoke_handler(tauri::generate_handler![
            filesystem::open_workspace,
            filesystem::read_document,
            filesystem::write_document,
            filesystem::create_document,
            filesystem::inspect_save_destination,
            filesystem::save_document_as,
            filesystem::search_workspace,
            media::read_workspace_image,
            menu::set_menu_language,
            quit_guard::get_quit_guard_session,
            quit_guard::set_quit_guard_ready,
            quit_guard::set_has_unsaved_changes,
            quit_guard::confirm_application_quit,
            quit_guard::cancel_application_quit,
            runtime::open_new_window,
            runtime::is_fresh_window,
            history::list_document_history,
            history::read_document_history,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Viva");
}
