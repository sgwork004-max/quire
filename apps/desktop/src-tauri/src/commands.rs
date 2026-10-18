//! Tauri commands: the whole API the UI can call. Arguments arrive camelCased.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::{err, Db};
use crate::documents::{DocumentInfo, Registry};
use crate::library::{self, FileEntry, Overview, Query};
use crate::scan::{self, LocationWatchers};
use crate::versions::{self, VersionMeta};
use crate::watcher::Watchers;
use crate::{browser, PendingOpens};

type R<T> = Result<T, String>;

// ---------------------------------------------------------------- documents

#[tauri::command(async)]
pub fn open_document(
    app: AppHandle,
    registry: State<'_, Registry>,
    watchers: State<'_, Watchers>,
    db: State<'_, Db>,
    path: String,
) -> R<DocumentInfo> {
    let (info, is_new) = registry.open(Path::new(&path))?;
    let doc = registry.get(&info.id).ok_or("document vanished")?;
    if is_new {
        // Live reload is a nicety; a watcher failure must not block viewing.
        if let Err(e) = watchers.watch(&app, &info.id, &doc.path, &doc.root) {
            eprintln!("watch failed for {}: {e}", doc.path.display());
        }
    }
    let conn = db.conn();
    // Copies of files shared with you live in Quire's own folder, not your library.
    if !doc.path.starts_with(&db.shared_dir) {
        library::mark_opened(&conn, &doc.path)?;
    }
    if let Ok(bytes) = std::fs::read(&doc.path) {
        versions::record(&conn, &info.path, &String::from_utf8_lossy(&bytes), "opened")?;
    }
    Ok(info)
}

#[tauri::command(async)]
pub fn close_document(registry: State<'_, Registry>, watchers: State<'_, Watchers>, id: String) -> R<()> {
    watchers.unwatch(&id);
    registry.close(&id);
    Ok(())
}

/// Registers a file for a library thumbnail: no watcher, no history.
#[tauri::command(async)]
pub fn preview_url(registry: State<'_, Registry>, path: String) -> R<String> {
    Ok(registry.open(Path::new(&path))?.0.url)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocContent {
    content: String,
    modified_ms: i64,
}

#[tauri::command(async)]
pub fn read_document(registry: State<'_, Registry>, id: String) -> R<DocContent> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    let bytes = std::fs::read(&doc.path).map_err(err)?;
    Ok(DocContent {
        content: String::from_utf8_lossy(&bytes).into_owned(),
        modified_ms: library::stat(&doc.path).map(|s| s.1).unwrap_or(0),
    })
}

/// Writes atomically (temp file + rename) so a crash never leaves half a file.
pub(crate) fn write_file(db: &Db, path: &Path, content: &str, source: &str) -> R<i64> {
    let dir = path.parent().ok_or("no parent folder")?;
    let name = path.file_name().ok_or("no file name")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.quire-tmp"));
    std::fs::write(&tmp, content).map_err(err)?;
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err(e));
    }
    let conn = db.conn();
    versions::record(&conn, &path.to_string_lossy(), content, source)?;
    if !path.starts_with(&db.shared_dir) {
        let location = library::location_for(&conn, path);
        library::index_file(&conn, path, location)?;
    }
    Ok(library::stat(path).map(|s| s.1).unwrap_or(0))
}

#[tauri::command(async)]
pub fn write_document(registry: State<'_, Registry>, db: State<'_, Db>, id: String, content: String) -> R<i64> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    if doc.is_virtual {
        return Err("this is a read-only preview".into());
    }
    write_file(&db, &doc.path, &content, "edit")
}

#[tauri::command(async)]
pub fn set_overlay(registry: State<'_, Registry>, id: String, content: Option<String>) -> R<()> {
    registry.set_overlay(&id, content)
}

/// ⌘S: the next edit starts a new version.
#[tauri::command(async)]
pub fn checkpoint(registry: State<'_, Registry>, db: State<'_, Db>, id: String) -> R<()> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    versions::close_session(&db.conn(), &doc.path.to_string_lossy())
}

#[tauri::command(async)]
pub fn open_in_browser(registry: State<'_, Registry>, id: String) -> R<()> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    browser::open(&doc.path)
}

/// Copies an image next to the document (into `images/`) and returns the
/// relative path to use in `src`.
#[tauri::command(async)]
pub fn import_image(registry: State<'_, Registry>, id: String, source: String) -> R<String> {
    let doc = registry.get(&id).ok_or("document is not open")?;
    let source = PathBuf::from(source);
    let name = source.file_name().ok_or("missing file name")?.to_string_lossy().into_owned();
    let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, "png"));
    let dir = doc.root.join("images");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let dest = library::unique_path(&dir, stem, ext);
    std::fs::copy(&source, &dest).map_err(err)?;
    Ok(format!("images/{}", dest.file_name().unwrap().to_string_lossy()))
}

/// Called once by the UI after its listeners are attached.
#[tauri::command(async)]
pub fn take_pending_opens(pending: State<'_, PendingOpens>) -> R<Vec<String>> {
    Ok(pending.take())
}

// ---------------------------------------------------------------- library

#[tauri::command(async)]
pub fn library_overview(db: State<'_, Db>) -> R<Overview> {
    library::overview(&db.conn())
}

#[tauri::command(async)]
pub fn library_query(db: State<'_, Db>, query: Query) -> R<Vec<FileEntry>> {
    library::query(&db.conn(), &query)
}

#[tauri::command(async)]
pub fn add_location(app: AppHandle, db: State<'_, Db>, path: String) -> R<i64> {
    let root = crate::documents::dunce_canonicalize(Path::new(&path))?;
    let id = library::add_location(&db.conn(), &root)?;
    scan::start_location(&app, id, root);
    Ok(id)
}

#[tauri::command(async)]
pub fn remove_location(db: State<'_, Db>, watchers: State<'_, LocationWatchers>, id: i64) -> R<()> {
    watchers.unwatch(id);
    library::remove_location(&db.conn(), id)
}

#[tauri::command(async)]
pub fn rescan_location(app: AppHandle, db: State<'_, Db>, watchers: State<'_, LocationWatchers>, id: i64) -> R<()> {
    let root = library::locations(&db.conn())?
        .into_iter()
        .find(|(l, _)| *l == id)
        .map(|(_, p)| p)
        .ok_or("folder not found")?;
    watchers.unwatch(id);
    scan::start_location(&app, id, root);
    Ok(())
}

#[tauri::command(async)]
pub fn set_starred(db: State<'_, Db>, id: i64, starred: bool) -> R<()> {
    library::set_starred(&db.conn(), id, starred)
}

#[tauri::command(async)]
pub fn create_tag(db: State<'_, Db>, name: String, color: String) -> R<i64> {
    library::create_tag(&db.conn(), &name, &color)
}

#[tauri::command(async)]
pub fn update_tag(db: State<'_, Db>, id: i64, name: String, color: String) -> R<()> {
    library::update_tag(&db.conn(), id, &name, &color)
}

#[tauri::command(async)]
pub fn delete_tag(db: State<'_, Db>, id: i64) -> R<()> {
    library::delete_tag(&db.conn(), id)
}

#[tauri::command(async)]
pub fn set_file_tag(db: State<'_, Db>, file_id: i64, tag_id: i64, on: bool) -> R<()> {
    library::set_file_tag(&db.conn(), file_id, tag_id, on)
}

#[tauri::command(async)]
pub fn rename_file(db: State<'_, Db>, id: i64, name: String) -> R<FileEntry> {
    library::rename(&db.conn(), id, &name)
}

#[tauri::command(async)]
pub fn duplicate_file(db: State<'_, Db>, id: i64) -> R<FileEntry> {
    library::duplicate(&db.conn(), id)
}

#[tauri::command(async)]
pub fn trash_file(db: State<'_, Db>, id: i64) -> R<()> {
    library::trash(&db, id)
}

#[tauri::command(async)]
pub fn restore_file(db: State<'_, Db>, id: i64) -> R<FileEntry> {
    library::restore(&db, id)
}

#[tauri::command(async)]
pub fn empty_trash(db: State<'_, Db>) -> R<usize> {
    library::empty_trash(&db, None)
}

#[tauri::command(async)]
pub fn new_file(app: AppHandle, db: State<'_, Db>, dir: String, template: Option<String>) -> R<FileEntry> {
    // No folder chosen: use ~/Quire, the default home for new files (also used by the CLI and MCP server).
    let dir = if dir.is_empty() {
        let quire = crate::home_dir().ok_or("No home folder")?.join("Quire");
        std::fs::create_dir_all(&quire).map_err(err)?;
        let quire = crate::documents::dunce_canonicalize(&quire)?;
        let known = library::locations(&db.conn())?.iter().any(|(_, p)| *p == quire);
        if !known {
            let id = library::add_location(&db.conn(), &quire)?;
            scan::start_location(&app, id, quire.clone());
        }
        quire.to_string_lossy().into_owned()
    } else {
        dir
    };
    match template {
        Some(t) => library::new_from_template(&db.conn(), Path::new(&dir), &t),
        None => library::new_file(&db.conn(), Path::new(&dir)),
    }
}

// ---------------------------------------------------------------- versions

#[tauri::command(async)]
pub fn list_versions(db: State<'_, Db>, path: String) -> R<Vec<VersionMeta>> {
    versions::list(&db.conn(), &path)
}

#[tauri::command(async)]
pub fn version_content(db: State<'_, Db>, id: i64) -> R<String> {
    Ok(versions::get(&db.conn(), id)?.1)
}

/// A read-only document showing an old version, with the file's real assets.
#[tauri::command(async)]
pub fn preview_version(registry: State<'_, Registry>, db: State<'_, Db>, id: i64) -> R<DocumentInfo> {
    let (path, content) = versions::get(&db.conn(), id)?;
    registry.open_virtual(Path::new(&path), content)
}

#[tauri::command(async)]
pub fn restore_version(registry: State<'_, Registry>, db: State<'_, Db>, doc_id: String, version_id: i64) -> R<String> {
    let doc = registry.get(&doc_id).ok_or("document is not open")?;
    let (_, content) = versions::get(&db.conn(), version_id)?;
    let path = doc.path.to_string_lossy().into_owned();
    versions::close_session(&db.conn(), &path)?;
    write_file(&db, &doc.path, &content, "restore")?;
    Ok(content)
}
