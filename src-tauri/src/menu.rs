use tauri::menu::{
    AboutMetadata, HELP_SUBMENU_ID, Menu, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder,
    WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Runtime};

pub const MENU_EVENT: &str = "viva://menu";

pub const FILE_NEW: &str = "file.new";
pub const FILE_NEW_WINDOW: &str = "file.newWindow";
pub const FILE_OPEN: &str = "file.open";
pub const FILE_SAVE: &str = "file.save";
pub const FILE_SAVE_AS: &str = "file.saveAs";
pub const FILE_CLOSE_TAB: &str = "file.closeTab";
pub const EDIT_UNDO: &str = "edit.undo";
pub const EDIT_REDO: &str = "edit.redo";
pub const EDIT_FIND: &str = "edit.find";
pub const EDIT_REPLACE: &str = "edit.replace";
pub const VIEW_TOGGLE_SIDEBAR: &str = "view.toggleSidebar";
pub const VIEW_TOGGLE_FOCUS: &str = "view.toggleFocus";
pub const VIEW_LIVE: &str = "view.live";
pub const VIEW_EDIT: &str = "view.edit";
pub const VIEW_SPLIT: &str = "view.split";
pub const VIEW_PREVIEW: &str = "view.preview";
pub const HELP_SHOW_COMMANDS: &str = "help.showCommands";
pub const APP_QUIT: &str = "app.quit";

#[derive(Clone, Copy)]
struct MenuLabels {
    about: &'static str,
    app_quit: &'static str,
    #[cfg(target_os = "macos")]
    bring_all_to_front: &'static str,
    close_tab: &'static str,
    copy: &'static str,
    cut: &'static str,
    edit: &'static str,
    find: &'static str,
    file: &'static str,
    focus: &'static str,
    help: &'static str,
    #[cfg(target_os = "macos")]
    hide: &'static str,
    #[cfg(target_os = "macos")]
    hide_others: &'static str,
    live: &'static str,
    maximize: &'static str,
    minimize: &'static str,
    new_document: &'static str,
    new_window: &'static str,
    open_workspace: &'static str,
    paste: &'static str,
    preview: &'static str,
    redo: &'static str,
    replace: &'static str,
    save: &'static str,
    save_as: &'static str,
    select_all: &'static str,
    #[cfg(target_os = "macos")]
    services: &'static str,
    #[cfg(target_os = "macos")]
    show_all: &'static str,
    show_commands: &'static str,
    sidebar: &'static str,
    source: &'static str,
    split: &'static str,
    undo: &'static str,
    view: &'static str,
    window: &'static str,
}

fn localized_labels(language: &str) -> MenuLabels {
    if language.eq_ignore_ascii_case("zh-Hans")
        || language
            .get(..2)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("zh"))
    {
        MenuLabels {
            about: "关于 Viva",
            app_quit: "退出 Viva",
            #[cfg(target_os = "macos")]
            bring_all_to_front: "前置全部窗口",
            close_tab: "关闭标签页",
            copy: "复制",
            cut: "剪切",
            edit: "编辑",
            find: "查找…",
            file: "文件",
            focus: "切换专注模式",
            help: "帮助",
            #[cfg(target_os = "macos")]
            hide: "隐藏 Viva",
            #[cfg(target_os = "macos")]
            hide_others: "隐藏其他应用",
            live: "即时编辑",
            maximize: maximize_label(true),
            minimize: "最小化",
            new_document: "新建文档",
            new_window: "新建窗口",
            open_workspace: "打开工作区…",
            paste: "粘贴",
            preview: "预览",
            redo: "重做",
            replace: "查找并替换…",
            save: "保存",
            save_as: "另存为…",
            select_all: "全选",
            #[cfg(target_os = "macos")]
            services: "服务",
            #[cfg(target_os = "macos")]
            show_all: "全部显示",
            show_commands: "键盘快捷键与命令…",
            sidebar: "切换侧栏",
            source: "源码",
            split: "分栏",
            undo: "撤销",
            view: "视图",
            window: "窗口",
        }
    } else {
        MenuLabels {
            about: "About Viva",
            app_quit: quit_label(),
            #[cfg(target_os = "macos")]
            bring_all_to_front: "Bring All to Front",
            close_tab: "Close Tab",
            copy: "Copy",
            cut: "Cut",
            edit: "Edit",
            find: "Find…",
            file: "File",
            focus: "Toggle Focus Mode",
            help: "Help",
            #[cfg(target_os = "macos")]
            hide: "Hide Viva",
            #[cfg(target_os = "macos")]
            hide_others: "Hide Others",
            live: "Live Editing",
            maximize: maximize_label(false),
            minimize: "Minimize",
            new_document: "New Document",
            new_window: "New Window",
            open_workspace: "Open Workspace…",
            paste: "Paste",
            preview: "Preview",
            redo: "Redo",
            replace: "Find and Replace…",
            save: "Save",
            save_as: "Save As…",
            select_all: "Select All",
            #[cfg(target_os = "macos")]
            services: "Services",
            #[cfg(target_os = "macos")]
            show_all: "Show All",
            show_commands: "Keyboard Shortcuts & Commands…",
            sidebar: "Toggle Sidebar",
            source: "Source",
            split: "Split",
            undo: "Undo",
            view: "View",
            window: "Window",
        }
    }
}

fn maximize_label(chinese: bool) -> &'static str {
    #[cfg(target_os = "macos")]
    return if chinese { "缩放" } else { "Zoom" };
    #[cfg(not(target_os = "macos"))]
    return if chinese { "最大化" } else { "Maximize" };
}

fn quit_label() -> &'static str {
    #[cfg(target_os = "macos")]
    return "Quit Viva";
    #[cfg(not(target_os = "macos"))]
    return "Exit Viva";
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    build_localized(app, "en")
}

fn build_localized<R: Runtime>(app: &AppHandle<R>, language: &str) -> tauri::Result<Menu<R>> {
    let labels = localized_labels(language);
    let file = file_menu(app, labels)?;
    let edit = edit_menu(app, labels)?;
    let view = view_menu(app, labels)?;
    let window = window_menu(app, labels)?;
    let help = help_menu(app, labels)?;

    let builder = tauri::menu::MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let builder = builder.item(&application_menu(app, labels)?);

    builder
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&window)
        .item(&help)
        .build()
}

#[tauri::command]
pub fn set_menu_language(app: AppHandle, language: String) -> Result<(), String> {
    let menu = build_localized(&app, &language).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

fn file_menu<R: Runtime>(app: &AppHandle<R>, labels: MenuLabels) -> tauri::Result<Submenu<R>> {
    let new = menu_item(app, FILE_NEW, labels.new_document, "CmdOrCtrl+N")?;
    let new_window = menu_item(app, FILE_NEW_WINDOW, labels.new_window, "CmdOrCtrl+Shift+N")?;
    let open = menu_item(app, FILE_OPEN, labels.open_workspace, "CmdOrCtrl+O")?;
    let save = menu_item(app, FILE_SAVE, labels.save, "CmdOrCtrl+S")?;
    let save_as = menu_item(app, FILE_SAVE_AS, labels.save_as, "CmdOrCtrl+Shift+S")?;
    let close_tab = menu_item(app, FILE_CLOSE_TAB, labels.close_tab, "CmdOrCtrl+W")?;

    let builder = SubmenuBuilder::new(app, labels.file)
        .items(&[&new, &new_window, &open])
        .separator()
        .items(&[&save, &save_as])
        .separator()
        .item(&close_tab);
    #[cfg(not(target_os = "macos"))]
    let builder = {
        let quit = menu_item(app, APP_QUIT, labels.app_quit, "Alt+F4")?;
        builder.separator().item(&quit)
    };
    builder.build()
}

fn edit_menu<R: Runtime>(app: &AppHandle<R>, labels: MenuLabels) -> tauri::Result<Submenu<R>> {
    let builder = SubmenuBuilder::new(app, labels.edit);
    #[cfg(target_os = "macos")]
    let builder = builder
        .undo_with_text(labels.undo)
        .redo_with_text(labels.redo);
    #[cfg(not(target_os = "macos"))]
    let builder = {
        let undo = menu_item(app, EDIT_UNDO, labels.undo, "CmdOrCtrl+Z")?;
        let redo = menu_item(app, EDIT_REDO, labels.redo, "CmdOrCtrl+Y")?;
        builder.items(&[&undo, &redo])
    };

    let find = menu_item(app, EDIT_FIND, labels.find, "CmdOrCtrl+F")?;
    #[cfg(target_os = "macos")]
    let replace = menu_item(app, EDIT_REPLACE, labels.replace, "CmdOrCtrl+Alt+F")?;
    #[cfg(not(target_os = "macos"))]
    let replace = menu_item(app, EDIT_REPLACE, labels.replace, "CmdOrCtrl+H")?;

    builder
        .separator()
        .cut_with_text(labels.cut)
        .copy_with_text(labels.copy)
        .paste_with_text(labels.paste)
        .select_all_with_text(labels.select_all)
        .separator()
        .items(&[&find, &replace])
        .build()
}

fn view_menu<R: Runtime>(app: &AppHandle<R>, labels: MenuLabels) -> tauri::Result<Submenu<R>> {
    let sidebar = menu_item(
        app,
        VIEW_TOGGLE_SIDEBAR,
        labels.sidebar,
        "CmdOrCtrl+Shift+B",
    )?;
    let focus = menu_item(
        app,
        VIEW_TOGGLE_FOCUS,
        labels.focus,
        "CmdOrCtrl+Shift+Enter",
    )?;
    let live = menu_item(app, VIEW_LIVE, labels.live, "CmdOrCtrl+1")?;
    let edit = menu_item(app, VIEW_EDIT, labels.source, "CmdOrCtrl+2")?;
    let split = menu_item(app, VIEW_SPLIT, labels.split, "CmdOrCtrl+3")?;
    let preview = menu_item(app, VIEW_PREVIEW, labels.preview, "CmdOrCtrl+4")?;

    SubmenuBuilder::new(app, labels.view)
        .items(&[&sidebar, &focus])
        .separator()
        .items(&[&live, &edit, &split, &preview])
        .build()
}

fn window_menu<R: Runtime>(app: &AppHandle<R>, labels: MenuLabels) -> tauri::Result<Submenu<R>> {
    let builder = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, labels.window)
        .minimize_with_text(labels.minimize)
        .maximize_with_text(labels.maximize);
    #[cfg(target_os = "macos")]
    let builder = builder
        .separator()
        .bring_all_to_front_with_text(labels.bring_all_to_front);
    builder.build()
}

fn help_menu<R: Runtime>(app: &AppHandle<R>, labels: MenuLabels) -> tauri::Result<Submenu<R>> {
    let show_commands = menu_item(
        app,
        HELP_SHOW_COMMANDS,
        labels.show_commands,
        "CmdOrCtrl+Shift+P",
    )?;
    let builder = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, labels.help).item(&show_commands);
    #[cfg(not(target_os = "macos"))]
    let builder = builder
        .separator()
        .about_with_text(labels.about, Some(about_metadata(app)));
    builder.build()
}

fn about_metadata<R: Runtime>(app: &AppHandle<R>) -> AboutMetadata<'static> {
    let package = app.package_info();
    AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app
            .config()
            .bundle
            .publisher
            .clone()
            .map(|author| vec![author]),
        ..Default::default()
    }
}

#[cfg(target_os = "macos")]
fn application_menu<R: Runtime>(
    app: &AppHandle<R>,
    labels: MenuLabels,
) -> tauri::Result<Submenu<R>> {
    let quit = menu_item(app, APP_QUIT, labels.app_quit, "CmdOrCtrl+Q")?;
    SubmenuBuilder::new(app, "Viva")
        .about_with_text(labels.about, Some(about_metadata(app)))
        .separator()
        .services_with_text(labels.services)
        .separator()
        .hide_with_text(labels.hide)
        .hide_others_with_text(labels.hide_others)
        .show_all_with_text(labels.show_all)
        .separator()
        .item(&quit)
        .build()
}

fn menu_item<R: Runtime>(
    app: &AppHandle<R>,
    id: &'static str,
    label: &str,
    accelerator: &str,
) -> tauri::Result<MenuItem<R>> {
    MenuItemBuilder::with_id(id, label)
        .accelerator(accelerator)
        .build(app)
}

pub fn forward_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match custom_menu_route(id) {
        #[cfg(target_os = "macos")]
        Some(CustomMenuRoute::RequestApplicationQuit) => {
            let _ = crate::quit_guard::request_application_quit(app);
        }
        Some(CustomMenuRoute::EmitToFrontend) => {
            let _ = app.emit_to("main", MENU_EVENT, id.to_owned());
        }
        None => {}
    }
}

#[derive(Debug, Eq, PartialEq)]
enum CustomMenuRoute {
    EmitToFrontend,
    #[cfg(target_os = "macos")]
    RequestApplicationQuit,
}

fn custom_menu_route(id: &str) -> Option<CustomMenuRoute> {
    #[cfg(target_os = "macos")]
    if id == APP_QUIT {
        return Some(CustomMenuRoute::RequestApplicationQuit);
    }
    is_custom_menu_id(id).then_some(CustomMenuRoute::EmitToFrontend)
}

fn is_custom_menu_id(id: &str) -> bool {
    matches!(
        id,
        FILE_NEW
            | FILE_NEW_WINDOW
            | FILE_OPEN
            | FILE_SAVE
            | FILE_SAVE_AS
            | FILE_CLOSE_TAB
            | EDIT_UNDO
            | EDIT_REDO
            | EDIT_FIND
            | EDIT_REPLACE
            | VIEW_TOGGLE_SIDEBAR
            | VIEW_TOGGLE_FOCUS
            | VIEW_LIVE
            | VIEW_EDIT
            | VIEW_SPLIT
            | VIEW_PREVIEW
            | HELP_SHOW_COMMANDS
    ) || id == APP_QUIT
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn custom_menu_ids_are_stable_and_unique() {
        let ids = [
            FILE_NEW,
            FILE_NEW_WINDOW,
            FILE_OPEN,
            FILE_SAVE,
            FILE_SAVE_AS,
            FILE_CLOSE_TAB,
            EDIT_UNDO,
            EDIT_REDO,
            EDIT_FIND,
            EDIT_REPLACE,
            VIEW_TOGGLE_SIDEBAR,
            VIEW_TOGGLE_FOCUS,
            VIEW_LIVE,
            VIEW_EDIT,
            VIEW_SPLIT,
            VIEW_PREVIEW,
            HELP_SHOW_COMMANDS,
            APP_QUIT,
        ];
        let unique: HashSet<_> = ids.into_iter().collect();
        assert_eq!(unique.len(), ids.len());
        assert!(ids.into_iter().all(is_custom_menu_id));
        assert!(!is_custom_menu_id("unknown"));
    }

    #[test]
    fn simplified_chinese_menu_labels_are_complete() {
        let labels = localized_labels("zh-Hans");
        assert_eq!(labels.file, "文件");
        assert_eq!(labels.edit, "编辑");
        assert_eq!(labels.undo, "撤销");
        assert_eq!(labels.find, "查找…");
        assert_eq!(labels.replace, "查找并替换…");
        assert_eq!(labels.copy, "复制");
        assert_eq!(labels.live, "即时编辑");
        assert_eq!(labels.new_window, "新建窗口");
        assert_eq!(labels.window, "窗口");
        assert_eq!(labels.minimize, "最小化");
        assert_eq!(labels.help, "帮助");
        assert_eq!(labels.show_commands, "键盘快捷键与命令…");
        assert_eq!(labels.about, "关于 Viva");
        assert_eq!(labels.app_quit, "退出 Viva");
        assert_eq!(localized_labels("en").file, "File");
    }

    #[test]
    fn menu_routing_keeps_application_quit_on_the_native_termination_path() {
        assert_eq!(
            custom_menu_route(FILE_SAVE),
            Some(CustomMenuRoute::EmitToFrontend)
        );
        assert_eq!(
            custom_menu_route(EDIT_UNDO),
            Some(CustomMenuRoute::EmitToFrontend)
        );
        assert_eq!(
            custom_menu_route(HELP_SHOW_COMMANDS),
            Some(CustomMenuRoute::EmitToFrontend)
        );
        #[cfg(target_os = "macos")]
        assert_eq!(
            custom_menu_route(APP_QUIT),
            Some(CustomMenuRoute::RequestApplicationQuit)
        );
        #[cfg(not(target_os = "macos"))]
        assert_eq!(
            custom_menu_route(APP_QUIT),
            Some(CustomMenuRoute::EmitToFrontend)
        );
        assert_eq!(custom_menu_route("unknown"), None);
    }
}
