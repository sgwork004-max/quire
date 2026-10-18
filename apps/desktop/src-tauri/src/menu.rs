//! Native menu bar. Menu items emit a `menu` event with their id; the UI
//! handles them. Using the native menu means shortcuts keep working even when
//! focus is inside a document's iframe.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: &str| {
        MenuItemBuilder::with_id(id, label).accelerator(accel).build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Quire")
        .about(None)
        .item(&MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?)
        .separator()
        .item(&item("settings", "Settings…", "CmdOrCtrl+,")?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new-tab", "New Tab", "CmdOrCtrl+T")?)
        .item(&item("import", "Import HTML…", "CmdOrCtrl+Shift+I")?)
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
        .item(&item("add-folder", "Add Folder to Library…", "CmdOrCtrl+Shift+O")?)
        .separator()
        .item(&item("save", "Save Version", "CmdOrCtrl+S")?)
        .item(&item("share", "Share…", "CmdOrCtrl+Shift+S")?)
        .separator()
        .item(&item("export-pdf", "Export as PDF…", "CmdOrCtrl+P")?)
        .item(&item("export-html", "Export as Single HTML File…", "CmdOrCtrl+Shift+E")?)
        .separator()
        // Like Chrome: ⌘W closes the tab, or the window when the Library is showing.
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .item(&item("close-window", "Close Window", "CmdOrCtrl+Shift+W")?)
        .item(&item("reopen-tab", "Reopen Closed Tab", "CmdOrCtrl+Shift+T")?)
        .separator()
        .item(&item("reveal", "Show in Finder", "CmdOrCtrl+Shift+R")?)
        .item(&item("open-in-browser", "Open in Browser", "CmdOrCtrl+Shift+B")?)
        .separator()
        .item(&item("live-data", "Live Data…", "CmdOrCtrl+Shift+D")?)
        .build()?;

    // Undo/redo are custom so one shortcut works across text fields, the code
    // editor and visual edits inside the document (see App.tsx).
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item("undo", "Undo", "CmdOrCtrl+Z")?)
        .item(&item("redo", "Redo", "CmdOrCtrl+Shift+Z")?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item("search", "Search Library", "CmdOrCtrl+K")?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("library", "Library", "CmdOrCtrl+Shift+L")?)
        .item(&item("toggle-sidebar", "Collapse Sidebar", "CmdOrCtrl+\\")?)
        .separator()
        .item(&item("mode-view", "Preview", "CmdOrCtrl+Alt+1")?)
        .item(&item("mode-visual", "Visual Editor", "CmdOrCtrl+Alt+2")?)
        .item(&item("mode-code", "Code Editor", "CmdOrCtrl+Alt+3")?)
        .item(&item("history", "Version History", "CmdOrCtrl+Shift+H")?)
        .item(&item("comments", "Comments", "CmdOrCtrl+Shift+M")?)
        .item(&item("new-comment", "Add Comment", "CmdOrCtrl+Alt+M")?)
        .separator()
        .item(&item("reload", "Reload Page", "CmdOrCtrl+R")?)
        .separator()
        .item(&item("viewport-fit", "Fit Window", "Ctrl+CmdOrCtrl+0")?)
        .item(&item("viewport-desktop", "Desktop Width", "Ctrl+CmdOrCtrl+1")?)
        .item(&item("viewport-tablet", "Tablet Width", "Ctrl+CmdOrCtrl+2")?)
        .item(&item("viewport-mobile", "Mobile Width", "Ctrl+CmdOrCtrl+3")?)
        .separator()
        .fullscreen()
        .build()?;

    let mut window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&item("next-tab", "Show Next Tab", "Ctrl+Tab")?)
        .item(&item("prev-tab", "Show Previous Tab", "Ctrl+Shift+Tab")?)
        .item(&item("next-tab-alt", "Select Next Tab", "CmdOrCtrl+Shift+]")?)
        .item(&item("prev-tab-alt", "Select Previous Tab", "CmdOrCtrl+Shift+[")?)
        .separator();
    // ⌘1…⌘8 jump to a tab by position (Library first), ⌘9 to the last, as in Chrome.
    for n in 1..=9 {
        let label = if n == 9 { "Last Tab".to_string() } else { format!("Tab {n}") };
        window = window.item(&item(&format!("tab-{n}"), &label, &format!("CmdOrCtrl+{n}"))?);
    }
    let window = window.separator().bring_all_to_front().build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help", "Quire Help").build(app)?)
        .item(&MenuItemBuilder::with_id("report-issue", "Report an Issue…").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window, &help])
        .build()
}
