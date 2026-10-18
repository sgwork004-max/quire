mod assets;
mod auth;
mod browser;
mod cloud;
mod commands;
mod datasources;
mod db;
mod documents;
mod export;
mod extract;
mod inbox;
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

/// UI errors forwarded by public/diagnostics.js.
#[tauri::command]
fn ui_log(message: String) {
    eprintln!("[ui] {message}");
}

/// The user's home folder on every platform (HOME on macOS/Linux, USERPROFILE on Windows).
pub fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(std::path::PathBuf::from)
}

fn cli_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| documents::is_html(std::path::Path::new(a)))
        .collect()
}

#[cfg(target_os = "macos")]
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(documents::Registry::default())
        .manage(watcher::Watchers::default())
        .manage(scan::LocationWatchers::default())
        .manage(PendingOpens::default())
        .manage(auth::AuthState::default())
        .manage(cloud::Cloud::default())
        .manage(inbox::Inbox::default())
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
            if let Err(e) = library::forget_missing_loose(&db.conn()) {
                eprintln!("index cleanup failed: {e}");
            }
            if let Err(e) = library::purge_expired_trash(&db) {
                eprintln!("trash purge failed: {e}");
            }
            // ~/Quire is where the CLI and MCP server put new files; keep it in the library.
            if let Some(home) = home_dir() {
                let quire_dir = home.join("Quire");
                if quire_dir.is_dir() {
                    if let Ok(dir) = documents::dunce_canonicalize(&quire_dir) {
                        let _ = library::add_location(&db.conn(), &dir);
                    }
                }
            }
            let locations = library::locations(&db.conn())?;
            app.manage(db);
            for (id, root) in locations {
                scan::start_location(&handle, id, root);
            }
            app.state::<PendingOpens>().push(&handle, cli_paths());
            cloud::start(&handle);
            datasources::start(&handle);
            inbox::start(&handle);
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
            commands::set_hidden,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::set_files_folder,
            commands::empty_trash,
            commands::list_versions,
            commands::version_content,
            commands::preview_version,
            commands::restore_version,
            auth::account,
            auth::update_profile,
            auth::start_sign_in,
            auth::cancel_sign_in,
            auth::sign_out,
            cloud::cloud_overview,
            cloud::cloud_link_for_path,
            cloud::share_file,
            cloud::share_details,
            cloud::share_invite,
            cloud::share_set_role,
            cloud::share_remove,
            cloud::stop_sharing,
            cloud::leave_shared,
            cloud::open_shared,
            cloud::live_ticket,
            cloud::set_live,
            cloud::sync_now,
            cloud::cloud_api,
            datasources::list_data_sources,
            datasources::add_data_source,
            datasources::refresh_data_source,
            datasources::remove_data_source,
            export::print_document,
            export::export_standalone,
            inbox::inbox_status,
            inbox::set_inbox_enabled,
            inbox::import_scan,
            inbox::import_paths,
            ui_log,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Quire");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        match _event {
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                _app.state::<PendingOpens>().push(_app, paths);
                show_main(_app);
            }
            // Dock icon clicked while the window is closed: bring it back, like any Mac app.
            tauri::RunEvent::Reopen { has_visible_windows: false, .. } => show_main(_app),
            _ => {}
        }
    });
}
