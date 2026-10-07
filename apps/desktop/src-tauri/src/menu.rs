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
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
        .separator()
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .separator()
        .item(&item("reveal", "Show in Finder", "CmdOrCtrl+Shift+R")?)
        .item(&item("open-in-browser", "Open in Browser", "CmdOrCtrl+Shift+B")?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
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
