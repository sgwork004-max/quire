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
        .item(&item("new-file", "New HTML File", "CmdOrCtrl+N")?)
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
        .item(&item("add-folder", "Add Folder to Library…", "CmdOrCtrl+Shift+O")?)
        .separator()
        .item(&item("save", "Save Version", "CmdOrCtrl+S")?)
        .item(&item("share", "Share…", "CmdOrCtrl+Shift+S")?)
        .separator()
        .item(&item("export-pdf", "Export as PDF…", "CmdOrCtrl+P")?)
        .item(&item("export-html", "Export as Single HTML File…", "CmdOrCtrl+Shift+E")?)
        .separator()
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
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
        .item(&item("ai-edit", "Edit with AI…", "CmdOrCtrl+J")?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("library", "Library", "CmdOrCtrl+Shift+L")?)
        .separator()
        .item(&item("mode-view", "Preview", "CmdOrCtrl+Alt+1")?)
        .item(&item("mode-visual", "Visual Editor", "CmdOrCtrl+Alt+2")?)
        .item(&item("mode-code", "Code Editor", "CmdOrCtrl+Alt+3")?)
        .item(&item("history", "Version History", "CmdOrCtrl+Shift+H")?)
        .item(&item("comments", "Comments", "CmdOrCtrl+Shift+M")?)
        .item(&item("new-comment", "Add Comment", "CmdOrCtrl+Alt+M")?)
        .separator()
        .item(&item("reload", "Reload", "CmdOrCtrl+R")?)
        .item(&item("toggle-sidebar", "Toggle Sidebar", "CmdOrCtrl+\\")?)
        .separator()
        .item(&item("viewport-fit", "Fit Window", "CmdOrCtrl+0")?)
        .item(&item("viewport-desktop", "Desktop Width", "CmdOrCtrl+1")?)
        .item(&item("viewport-tablet", "Tablet Width", "CmdOrCtrl+2")?)
        .item(&item("viewport-mobile", "Mobile Width", "CmdOrCtrl+3")?)
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&item("next-tab", "Show Next Tab", "CmdOrCtrl+Shift+]")?)
        .item(&item("prev-tab", "Show Previous Tab", "CmdOrCtrl+Shift+[")?)
        .separator()
        .minimize()
        .maximize()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window])
        .build()
}
