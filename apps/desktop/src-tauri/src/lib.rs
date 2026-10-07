mod browser;
mod documents;
mod menu;
mod protocol;
mod watcher;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use documents::{DocumentInfo, Registry};
use watcher::Watchers;

/// Files the OS asked us to open (Finder, "Open With", CLI args) before the UI
/// was ready to receive them.
#[derive(Default)]
struct PendingOpens {
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
}

#[tauri::command]
fn open_document(
    app: AppHandle,
    registry: State<Registry>,
    watchers: State<Watchers>,
    path: String,
) -> Result<DocumentInfo, String> {
    let (info, is_new) = registry.open(&PathBuf::from(&path))?;
    if is_new {
        if let Some(doc) = registry.get(&info.id) {
            // Live reload is a nicety; a watcher failure must not block viewing.
            if let Err(e) = watchers.watch(&app, &info.id, &doc.path, &doc.root) {
                eprintln!("watch failed for {}: {e}", doc.path.display());
            }
        }
    }
    Ok(info)
}

#[tauri::command]
fn close_document(registry: State<Registry>, watchers: State<Watchers>, id: String) {
    watchers.unwatch(&id);
    registry.close(&id);
}

#[tauri::command]
fn open_in_browser(registry: State<Registry>, id: String) -> Result<(), String> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    browser::open(&doc.path)
}

/// Called once by the UI after its listeners are attached.
#[tauri::command]
fn take_pending_opens(pending: State<PendingOpens>) -> Vec<String> {
    pending.ui_ready.store(true, Ordering::SeqCst);
    std::mem::take(&mut *pending.paths.lock().unwrap())
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
        .manage(Registry::default())
        .manage(Watchers::default())
        .manage(PendingOpens::default())
        .register_asynchronous_uri_scheme_protocol(documents::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let registry = app.state::<Registry>();
                responder.respond(protocol::handle(&registry, &request));
            });
        })
        .menu(|app| menu::build(app))
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<PendingOpens>().push(&handle, cli_paths());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            close_document,
            open_in_browser,
            take_pending_opens
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
