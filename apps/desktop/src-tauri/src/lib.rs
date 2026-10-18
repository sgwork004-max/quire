mod browser;
mod commands;
mod db;
mod documents;
mod extract;
mod library;
mod menu;
mod protocol;
mod scan;
mod versions;
mod watcher;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// Files the OS asked us to open (Finder, "Open With", CLI args) before the UI
/// was ready to receive them.
#[derive(Default)]
pub struct PendingOpens {
    ui_ready: AtomicBool,
    paths: Mutex<Vec<String>>,
}

impl PendingOpens {
    fn push(&self, app: &AppHandle, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        if self.ui_ready.load(Ordering::SeqCst) {
            let _ = app.emit("open-paths", paths);
        } else {
            self.paths.lock().unwrap().extend(paths);
        }
    }

    pub fn take(&self) -> Vec<String> {
        self.ui_ready.store(true, Ordering::SeqCst);
        std::mem::take(&mut *self.paths.lock().unwrap())
    }
}

fn cli_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| documents::is_html(std::path::Path::new(a)))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(documents::Registry::default())
        .manage(watcher::Watchers::default())
        .manage(scan::LocationWatchers::default())
        .manage(PendingOpens::default())
        .register_asynchronous_uri_scheme_protocol(documents::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let registry = app.state::<documents::Registry>();
                responder.respond(protocol::handle(&registry, &request));
            });
        })
        .menu(|app| menu::build(app))
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let db = db::Db::open(&app.path().app_data_dir()?)?;
            if let Err(e) = library::purge_expired_trash(&db) {
                eprintln!("trash purge failed: {e}");
            }
            let locations = library::locations(&db.conn())?;
            app.manage(db);
            for (id, root) in locations {
                scan::start_location(&handle, id, root);
            }
            app.state::<PendingOpens>().push(&handle, cli_paths());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_document,
            commands::close_document,
            commands::preview_url,
            commands::read_document,
            commands::write_document,
            commands::set_overlay,
            commands::checkpoint,
            commands::open_in_browser,
            commands::import_image,
            commands::take_pending_opens,
            commands::library_overview,
            commands::library_query,
            commands::add_location,
            commands::remove_location,
            commands::rescan_location,
            commands::set_starred,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::set_file_tag,
            commands::rename_file,
            commands::duplicate_file,
            commands::trash_file,
            commands::restore_file,
            commands::empty_trash,
            commands::new_file,
            commands::list_versions,
            commands::version_content,
            commands::preview_version,
            commands::restore_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Quire");

    app.run(|_app, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            _app.state::<PendingOpens>().push(_app, paths);
        }
    });
}
