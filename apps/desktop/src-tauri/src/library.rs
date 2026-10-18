//! The library: every HTML file Quire knows about, from watched folders
//! ("locations") and files opened directly. Stars, tags, search and trash.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::{err, now_ms, Db};
use crate::extract::extract;

/// Larger files are indexed by their first few megabytes only.
const MAX_INDEX_BYTES: u64 = 4 * 1024 * 1024;
const TRASH_RETENTION_DAYS: i64 = 30;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub dir: String,
    pub location_id: Option<i64>,
    pub title: Option<String>,
    pub size_bytes: i64,
    pub modified_ms: i64,
    pub opened_ms: Option<i64>,
    pub starred: bool,
    pub trashed_ms: Option<i64>,
    pub tag_ids: Vec<i64>,
    /// Folder inside Quire, if any.
    pub folder_id: Option<i64>,
    /// Search excerpt; matches are wrapped in \u{1} ... \u{2}.
    pub snippet: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub locations: Vec<Location>,
    pub folders: Vec<Folder>,
    pub tags: Vec<Tag>,
    pub all: i64,
    pub starred: i64,
    pub recent: i64,
    pub trash: i64,
    pub hidden: i64,
}

/// A folder inside Quire. Files keep living wherever they are on disk.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    /// all | recent | starred | trash | location | tag
    pub view: String,
    pub location_id: Option<i64>,
    pub tag_id: Option<i64>,
    #[serde(default)]
    pub folder_id: Option<i64>,
    pub search: Option<String>,
    /// modified | name | opened
    pub sort: Option<String>,
}

const FILE_COLUMNS: &str = "f.id, f.path, f.name, f.dir, f.location_id, f.title, f.size_bytes, f.modified_ms, \
     f.opened_ms, f.starred, f.trashed_ms, \
     (SELECT group_concat(tag_id) FROM file_tags WHERE file_id = f.id), f.folder_id";

fn file_from_row(row: &Row, snippet: bool) -> rusqlite::Result<FileEntry> {
    let tags: Option<String> = row.get(11)?;
    Ok(FileEntry {
        id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        dir: row.get(3)?,
        location_id: row.get(4)?,
        title: row.get(5)?,
        size_bytes: row.get(6)?,
        modified_ms: row.get(7)?,
        opened_ms: row.get(8)?,
        starred: row.get::<_, i64>(9)? != 0,
        trashed_ms: row.get(10)?,
        tag_ids: tags
            .map(|t| t.split(',').filter_map(|s| s.parse().ok()).collect())
            .unwrap_or_default(),
        folder_id: row.get(12)?,
        snippet: if snippet { row.get(13)? } else { None },
    })
}

pub fn get(conn: &Connection, id: i64) -> Result<FileEntry, String> {
    conn.query_row(&format!("SELECT {FILE_COLUMNS} FROM files f WHERE f.id = ?1"), [id], |r| {
        file_from_row(r, false)
    })
    .map_err(err)
}

// ---------------------------------------------------------------------------
// Indexing

pub fn stat(path: &Path) -> Option<(i64, i64)> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    Some((meta.len() as i64, modified))
}

/// True if the file is new or changed since it was last indexed.
pub fn needs_index(conn: &Connection, path: &str, size: i64, modified: i64) -> bool {
    let row: Option<(i64, i64)> = conn
        .query_row(
            "SELECT size_bytes, modified_ms FROM files WHERE path = ?1",
            [path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    row != Some((size, modified))
}

/// Adds or refreshes a file in the index. Never moves a file out of a
/// location it already belongs to.
pub fn index_file(conn: &Connection, path: &Path, location_id: Option<i64>) -> Result<i64, String> {
    let (size, modified) = stat(path).ok_or_else(|| format!("{} not found", path.display()))?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(MAX_INDEX_BYTES).read_to_end(&mut bytes))
        .map_err(err)?;
    let html = String::from_utf8_lossy(&bytes);
    let extracted = extract(&html);

    let path_str = path.to_string_lossy();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();

    let id: i64 = conn
        .query_row(
            "INSERT INTO files (path, name, dir, location_id, title, size_bytes, modified_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(path) DO UPDATE SET
               name = excluded.name, dir = excluded.dir,
               location_id = COALESCE(excluded.location_id, files.location_id),
               title = excluded.title, size_bytes = excluded.size_bytes, modified_ms = excluded.modified_ms
             RETURNING id",
            params![path_str, name, dir, location_id, extracted.title, size, modified],
            |r| r.get(0),
        )
        .map_err(err)?;
    conn.execute("DELETE FROM files_fts WHERE rowid = ?1", [id]).map_err(err)?;
    conn.execute(
        "INSERT INTO files_fts (rowid, name, title, body) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, extracted.title.unwrap_or_default(), extracted.text],
    )
    .map_err(err)?;
    Ok(id)
}

/// Forgets files at `path` or below it, unless they are in the trash (the
/// trash moved them away on purpose).
pub fn remove_path(conn: &Connection, path: &str) -> Result<usize, String> {
    let prefix = format!("{}{}", path.trim_end_matches('/'), std::path::MAIN_SEPARATOR);
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM files WHERE trashed_ms IS NULL AND (path = ?1 OR substr(path, 1, length(?2)) = ?2)",
            )
            .map_err(err)?;
        let rows = stmt.query_map(params![path, prefix], |r| r.get(0)).map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    for id in &ids {
        delete_row(conn, *id)?;
    }
    Ok(ids.len())
}

fn delete_row(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM files_fts WHERE rowid = ?1", [id]).map_err(err)?;
    conn.execute("DELETE FROM files WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

pub fn mark_opened(conn: &Connection, path: &Path) -> Result<i64, String> {
    let location = location_for(conn, path);
    let id = index_file(conn, path, location)?;
    conn.execute("UPDATE files SET opened_ms = ?1 WHERE id = ?2", params![now_ms(), id])
        .map_err(err)?;
    Ok(id)
}

// ---------------------------------------------------------------------------
// Locations

pub fn location_for(conn: &Connection, path: &Path) -> Option<i64> {
    let mut stmt = conn.prepare("SELECT id, path FROM locations").ok()?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .ok()?;
    rows.filter_map(Result::ok)
        .filter(|(_, root)| path.starts_with(root))
        .max_by_key(|(_, root)| root.len())
        .map(|(id, _)| id)
}

pub fn locations(conn: &Connection) -> Result<Vec<(i64, PathBuf)>, String> {
    let mut stmt = conn.prepare("SELECT id, path FROM locations").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, PathBuf::from(r.get::<_, String>(1)?))))
        .map_err(err)?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn add_location(conn: &Connection, path: &Path) -> Result<i64, String> {
    if !path.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "/".into());
    conn.query_row(
        "INSERT INTO locations (path, name, added_ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name RETURNING id",
        params![path.to_string_lossy(), name, now_ms()],
        |r| r.get(0),
    )
    .map_err(err)
}

/// Removes a location. Files the user interacted with (opened, starred,
/// tagged, trashed) stay in the library as loose files; the rest are forgotten.
pub fn remove_location(conn: &Connection, id: i64) -> Result<(), String> {
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM files WHERE location_id = ?1 AND opened_ms IS NULL AND starred = 0
                 AND trashed_ms IS NULL AND NOT EXISTS (SELECT 1 FROM file_tags WHERE file_id = files.id)",
            )
            .map_err(err)?;
        let rows = stmt.query_map([id], |r| r.get(0)).map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    for file in ids {
        delete_row(conn, file)?;
    }
    conn.execute("DELETE FROM locations WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

/// Files of a location that are currently in the index (not trashed).
pub fn location_paths(conn: &Connection, id: i64) -> Result<HashMap<String, i64>, String> {
    let mut stmt = conn
        .prepare("SELECT path, id FROM files WHERE location_id = ?1 AND trashed_ms IS NULL")
        .map_err(err)?;
    let rows = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn forget(conn: &Connection, id: i64) -> Result<(), String> {
    delete_row(conn, id)
}

/// Forgets opened files outside any library folder that no longer exist
/// (folders are kept in sync by their watchers; loose files have none).
pub fn forget_missing_loose(conn: &Connection) -> Result<usize, String> {
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, path FROM files WHERE location_id IS NULL AND trashed_ms IS NULL")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    let mut n = 0;
    for (id, path) in rows {
        if !Path::new(&path).exists() {
            delete_row(conn, id)?;
            n += 1;
        }
    }
    Ok(n)
}

// ---------------------------------------------------------------------------
// Queries

pub fn overview(conn: &Connection) -> Result<Overview, String> {
    let count = |sql: &str| -> Result<i64, String> { conn.query_row(sql, [], |r| r.get(0)).map_err(err) };
    let locations = {
        let mut stmt = conn
            .prepare(
                "SELECT l.id, l.path, l.name,
                   (SELECT count(*) FROM files f WHERE f.location_id = l.id AND f.trashed_ms IS NULL AND f.hidden = 0)
                 FROM locations l ORDER BY l.name COLLATE NOCASE",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Location { id: r.get(0)?, path: r.get(1)?, name: r.get(2)?, count: r.get(3)? })
            })
            .map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    let tags = {
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.name, t.color,
                   (SELECT count(*) FROM file_tags ft JOIN files f ON f.id = ft.file_id
                    WHERE ft.tag_id = t.id AND f.trashed_ms IS NULL AND f.hidden = 0)
                 FROM tags t ORDER BY t.name COLLATE NOCASE",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Tag { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, count: r.get(3)? })
            })
            .map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    let folders = {
        let mut stmt = conn
            .prepare(
                "SELECT fo.id, fo.name,
                   (SELECT count(*) FROM files f WHERE f.folder_id = fo.id AND f.trashed_ms IS NULL AND f.hidden = 0)
                 FROM folders fo ORDER BY fo.name COLLATE NOCASE",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))
            .map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    Ok(Overview {
        locations,
        folders,
        tags,
        all: count("SELECT count(*) FROM files WHERE trashed_ms IS NULL AND hidden = 0")?,
        starred: count("SELECT count(*) FROM files WHERE trashed_ms IS NULL AND hidden = 0 AND starred = 1")?,
        recent: count("SELECT count(*) FROM files WHERE trashed_ms IS NULL AND hidden = 0 AND opened_ms IS NOT NULL")?,
        trash: count("SELECT count(*) FROM files WHERE trashed_ms IS NOT NULL")?,
        hidden: count("SELECT count(*) FROM files WHERE trashed_ms IS NULL AND hidden = 1")?,
    })
}

/// Turns free text into an FTS5 prefix query: `q3 rev` -> `"q3"* "rev"*`.
fn fts_query(search: &str) -> Option<String> {
    let terms: Vec<String> = search
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

pub fn query(conn: &Connection, q: &Query) -> Result<Vec<FileEntry>, String> {
    let fts = q.search.as_deref().and_then(fts_query);
    let mut args: Vec<Value> = Vec::new();
    let mut conds: Vec<String> = Vec::new();
    let mut limit = 5000;

    let (join, snippet) = match &fts {
        Some(m) => {
            args.push(Value::Text(m.clone()));
            (
                "JOIN files_fts ON files_fts.rowid = f.id AND files_fts MATCH ?",
                ", snippet(files_fts, 2, char(1), char(2), '…', 16)",
            )
        }
        None => ("", ""),
    };

    match q.view.as_str() {
        "trash" => conds.push("f.trashed_ms IS NOT NULL".into()),
        "hidden" => conds.push("f.trashed_ms IS NULL AND f.hidden = 1".into()),
        view => {
            conds.push("f.trashed_ms IS NULL AND f.hidden = 0".into());
            match view {
                "recent" => {
                    conds.push("f.opened_ms IS NOT NULL".into());
                    limit = 100;
                }
                "starred" => conds.push("f.starred = 1".into()),
                "location" => {
                    conds.push("f.location_id = ?".into());
                    args.push(Value::Integer(q.location_id.ok_or("missing location")?));
                }
                "folder" => {
                    conds.push("f.folder_id = ?".into());
                    args.push(Value::Integer(q.folder_id.ok_or("missing folder")?));
                }
                "tag" => {
                    conds.push("EXISTS (SELECT 1 FROM file_tags WHERE file_id = f.id AND tag_id = ?)".into());
                    args.push(Value::Integer(q.tag_id.ok_or("missing tag")?));
                }
                _ => {}
            }
        }
    }

    let order = match (q.view.as_str(), q.sort.as_deref(), fts.is_some()) {
        ("trash", _, _) => "f.trashed_ms DESC",
        (_, Some("name"), _) => "f.name COLLATE NOCASE ASC",
        (_, Some("opened"), _) => "f.opened_ms DESC NULLS LAST, f.modified_ms DESC",
        (_, Some("modified"), _) => "f.modified_ms DESC",
        (_, _, true) => "bm25(files_fts, 10.0, 5.0, 1.0)",
        ("recent", _, _) => "f.opened_ms DESC",
        _ => "f.modified_ms DESC",
    };

    let sql = format!(
        "SELECT {FILE_COLUMNS}{snippet} FROM files f {join} WHERE {} ORDER BY {order} LIMIT {limit}",
        conds.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(params_from_iter(args), |r| file_from_row(r, fts.is_some()))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

// ---------------------------------------------------------------------------
// Stars and tags

pub fn set_starred(conn: &Connection, id: i64, starred: bool) -> Result<(), String> {
    conn.execute("UPDATE files SET starred = ?1 WHERE id = ?2", params![starred as i64, id])
        .map(|_| ())
        .map_err(err)
}

pub fn create_tag(conn: &Connection, name: &str, color: &str) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Tag name can't be empty".into());
    }
    conn.query_row(
        "INSERT INTO tags (name, color) VALUES (?1, ?2) RETURNING id",
        params![name, color],
        |r| r.get(0),
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            format!("A tag called “{name}” already exists")
        }
        e => e.to_string(),
    })
}

pub fn update_tag(conn: &Connection, id: i64, name: &str, color: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Tag name can't be empty".into());
    }
    conn.execute("UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3", params![name, color, id])
        .map(|_| ())
        .map_err(err)
}

pub fn delete_tag(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM tags WHERE id = ?1", [id]).map(|_| ()).map_err(err)
}

pub fn set_file_tag(conn: &Connection, file_id: i64, tag_id: i64, on: bool) -> Result<(), String> {
    let sql = if on {
        "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)"
    } else {
        "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2"
    };
    conn.execute(sql, params![file_id, tag_id]).map(|_| ()).map_err(err)
}

// ---------------------------------------------------------------------------
// File operations

/// `dir/stem.ext`, or `dir/stem 2.ext`, `dir/stem 3.ext`... if taken.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let make = |n: u32| {
        let name = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem} {n}.{ext}") };
        dir.join(name)
    };
    (1..).map(make).find(|p| !p.exists()).unwrap()
}

fn split_name(name: &str) -> (&str, &str) {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, ext),
        _ => (name, "html"),
    }
}

fn validate_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', ':']) {
        return Err("That name isn't allowed".into());
    }
    if crate::documents::is_html(Path::new(name)) {
        Ok(name.to_string())
    } else {
        Ok(format!("{name}.html"))
    }
}

/// `fs::rename`, falling back to copy + delete across volumes.
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(err)?;
    std::fs::remove_file(from).map_err(err)
}

pub fn rename(conn: &Connection, id: i64, new_name: &str) -> Result<FileEntry, String> {
    let file = get(conn, id)?;
    let new_name = validate_name(new_name)?;
    if new_name == file.name {
        return Ok(file);
    }
    let from = PathBuf::from(&file.path);
    let to = from.with_file_name(&new_name);
    if to.exists() && !new_name.eq_ignore_ascii_case(&file.name) {
        return Err(format!("“{new_name}” already exists in this folder"));
    }
    std::fs::rename(&from, &to).map_err(err)?;
    let to_str = to.to_string_lossy();
    conn.execute(
        "UPDATE files SET path = ?1, name = ?2 WHERE id = ?3",
        params![to_str, new_name, id],
    )
    .map_err(err)?;
    crate::versions::rename_path(conn, &file.path, &to_str)?;
    index_file(conn, &to, file.location_id)?;
    get(conn, id)
}

/// Hides a file from every library view (and search) without touching it on disk.
pub fn set_hidden(conn: &Connection, id: i64, hidden: bool) -> Result<(), String> {
    conn.execute("UPDATE files SET hidden = ?1 WHERE id = ?2", params![hidden as i64, id])
        .map(|_| ())
        .map_err(err)
}

// ---------------------------------------------------------------------------
// Folders inside Quire

pub fn create_folder(conn: &Connection, name: &str) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Folder name can't be empty".into());
    }
    conn.query_row("INSERT INTO folders (name, created_ms) VALUES (?1, ?2) RETURNING id", params![name, now_ms()], |r| r.get(0))
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
                format!("A folder called “{name}” already exists")
            }
            e => e.to_string(),
        })
}

pub fn rename_folder(conn: &Connection, id: i64, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Folder name can't be empty".into());
    }
    conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id]).map(|_| ()).map_err(err)
}

/// Deletes the folder only; its files stay in the library.
pub fn delete_folder(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("UPDATE files SET folder_id = NULL WHERE folder_id = ?1", [id]).map_err(err)?;
    conn.execute("DELETE FROM folders WHERE id = ?1", [id]).map(|_| ()).map_err(err)
}

pub fn set_folder(conn: &Connection, id: i64, folder: Option<i64>) -> Result<(), String> {
    conn.execute("UPDATE files SET folder_id = ?1 WHERE id = ?2", params![folder, id]).map(|_| ()).map_err(err)
}

pub fn duplicate(conn: &Connection, id: i64) -> Result<FileEntry, String> {
    let file = get(conn, id)?;
    let from = PathBuf::from(&file.path);
    let (stem, ext) = split_name(&file.name);
    let to = unique_path(from.parent().ok_or("no parent folder")?, &format!("{stem} copy"), ext);
    std::fs::copy(&from, &to).map_err(err)?;
    let new_id = index_file(conn, &to, file.location_id)?;
    get(conn, new_id)
}

pub fn trash(db: &Db, id: i64) -> Result<(), String> {
    let conn = db.conn();
    let file = get(&conn, id)?;
    if file.trashed_ms.is_some() {
        return Ok(());
    }
    let dest = db.trash_dir.join(format!("{id}-{}", file.name));
    // Mark first so the folder watcher doesn't forget the file when it disappears.
    conn.execute(
        "UPDATE files SET trashed_ms = ?1, trash_path = ?2 WHERE id = ?3",
        params![now_ms(), dest.to_string_lossy(), id],
    )
    .map_err(err)?;
    if let Err(e) = move_file(Path::new(&file.path), &dest) {
        conn.execute("UPDATE files SET trashed_ms = NULL, trash_path = NULL WHERE id = ?1", [id])
            .map_err(err)?;
        return Err(e);
    }
    Ok(())
}

pub fn restore(db: &Db, id: i64) -> Result<FileEntry, String> {
    let conn = db.conn();
    let trash_path: Option<String> = conn
        .query_row("SELECT trash_path FROM files WHERE id = ?1", [id], |r| r.get(0))
        .map_err(err)?;
    let file = get(&conn, id)?;
    let Some(trash_path) = trash_path else { return Ok(file) };
    let original = PathBuf::from(&file.path);
    let dir = original.parent().ok_or("no parent folder")?;
    std::fs::create_dir_all(dir).map_err(err)?;
    let target = if original.exists() {
        let (stem, ext) = split_name(&file.name);
        unique_path(dir, &format!("{stem} (restored)"), ext)
    } else {
        original.clone()
    };
    move_file(Path::new(&trash_path), &target)?;
    conn.execute(
        "UPDATE files SET trashed_ms = NULL, trash_path = NULL, path = ?1, name = ?2 WHERE id = ?3",
        params![
            target.to_string_lossy(),
            target.file_name().map(|n| n.to_string_lossy().into_owned()),
            id
        ],
    )
    .map_err(err)?;
    index_file(&conn, &target, file.location_id)?;
    get(&conn, id)
}

/// Moves trashed files to the system Trash (still recoverable from Finder)
/// and forgets them. `older_than_ms` limits it to files trashed before then.
pub fn empty_trash(db: &Db, older_than_ms: Option<i64>) -> Result<usize, String> {
    let conn = db.conn();
    let rows: Vec<(i64, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT id, trash_path FROM files WHERE trashed_ms IS NOT NULL AND trashed_ms < ?1")
            .map_err(err)?;
        let rows = stmt
            .query_map([older_than_ms.unwrap_or(i64::MAX)], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    for (id, path) in &rows {
        if let Some(path) = path.as_deref().filter(|p| Path::new(p).exists()) {
            trash::delete(path).map_err(err)?;
        }
        delete_row(&conn, *id)?;
    }
    Ok(rows.len())
}

pub fn purge_expired_trash(db: &Db) -> Result<usize, String> {
    empty_trash(db, Some(now_ms() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (Db, PathBuf) {
        let dir = std::env::temp_dir().join(format!("quire-lib-{:x}", rand::random::<u64>()));
        fs::create_dir_all(dir.join("site")).unwrap();
        let db = Db::open_in_memory(dir.join("trash"));
        fs::create_dir_all(&db.trash_dir).unwrap();
        (db, dir)
    }

    fn q(view: &str, search: Option<&str>) -> Query {
        Query { view: view.into(), location_id: None, tag_id: None, folder_id: None, search: search.map(Into::into), sort: None }
    }

    #[test]
    fn hides_and_moves_files() {
        let (db, dir) = setup();
        let conn = db.conn();
        let a = dir.join("site/a.html");
        fs::write(&a, "<title>A</title>").unwrap();
        let site = add_location(&conn, &dir.join("site")).unwrap();
        let id = index_file(&conn, &a, Some(site)).unwrap();

        set_hidden(&conn, id, true).unwrap();
        assert!(query(&conn, &q("all", None)).unwrap().is_empty(), "hidden files leave the library views");
        assert!(query(&conn, &q("all", Some("a"))).unwrap().is_empty(), "and search");
        assert_eq!(query(&conn, &q("hidden", None)).unwrap().len(), 1);
        assert_eq!(overview(&conn).unwrap().hidden, 1);
        assert!(a.exists(), "hiding never touches the file");
        set_hidden(&conn, id, false).unwrap();

        let folder = create_folder(&conn, "Clients").unwrap();
        assert!(create_folder(&conn, "clients").is_err(), "folder names are case-insensitive unique");
        set_folder(&conn, id, Some(folder)).unwrap();
        let inside = query(&conn, &Query { folder_id: Some(folder), ..q("folder", None) }).unwrap();
        assert_eq!(inside.len(), 1);
        assert_eq!(inside[0].folder_id, Some(folder));
        assert_eq!(overview(&conn).unwrap().folders[0].count, 1);
        delete_folder(&conn, folder).unwrap();
        assert_eq!(get(&conn, id).unwrap().folder_id, None, "deleting a folder keeps its files");
        assert!(a.exists());
    }

    #[test]
    fn indexes_searches_and_tags() {
        let (db, dir) = setup();
        let conn = db.conn();
        let a = dir.join("site/revenue.html");
        fs::write(&a, "<title>Q3 revenue</title><body><p>Mumbai stores grew fast</p></body>").unwrap();
        let b = dir.join("site/notes.html");
        fs::write(&b, "<body><p>Meeting notes</p></body>").unwrap();
        let loc = add_location(&conn, &dir.join("site")).unwrap();
        let ida = index_file(&conn, &a, Some(loc)).unwrap();
        index_file(&conn, &b, Some(loc)).unwrap();

        let hits = query(&conn, &q("all", Some("mumb"))).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title.as_deref(), Some("Q3 revenue"));
        assert!(hits[0].snippet.as_deref().unwrap().contains("\u{1}Mumbai\u{2}"));

        let tag = create_tag(&conn, "Client", "#e2513a").unwrap();
        assert!(create_tag(&conn, "client", "#000").is_err(), "names are case-insensitive unique");
        set_file_tag(&conn, ida, tag, true).unwrap();
        set_starred(&conn, ida, true).unwrap();
        let tagged = query(&conn, &Query { tag_id: Some(tag), ..q("tag", None) }).unwrap();
        assert_eq!(tagged.iter().map(|f| f.id).collect::<Vec<_>>(), vec![ida]);
        assert_eq!(tagged[0].tag_ids, vec![tag]);
        let o = overview(&conn).unwrap();
        assert_eq!((o.all, o.starred, o.locations[0].count, o.tags[0].count), (2, 1, 2, 1));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn trash_restore_and_rename() {
        let (db, dir) = setup();
        let file = dir.join("site/page.html");
        fs::write(&file, "<p>hello</p>").unwrap();
        let id = index_file(&db.conn(), &file, None).unwrap();

        trash(&db, id).unwrap();
        assert!(!file.exists());
        // The watcher would now report the file gone; trashed rows must survive it.
        remove_path(&db.conn(), &file.to_string_lossy()).unwrap();
        assert_eq!(query(&db.conn(), &q("trash", None)).unwrap().len(), 1);
        assert_eq!(query(&db.conn(), &q("all", None)).unwrap().len(), 0);

        let restored = restore(&db, id).unwrap();
        assert!(file.exists());
        assert_eq!(restored.trashed_ms, None);

        let renamed = rename(&db.conn(), id, "Report").unwrap();
        assert_eq!(renamed.name, "Report.html");
        assert!(dir.join("site/Report.html").exists());
        assert!(rename(&db.conn(), id, "../escape").is_err());

        let copy = duplicate(&db.conn(), id).unwrap();
        assert_eq!(copy.name, "Report copy.html");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn removing_a_folder_forgets_its_files() {
        let (db, dir) = setup();
        let conn = db.conn();
        fs::create_dir_all(dir.join("site/sub")).unwrap();
        let f = dir.join("site/sub/x.html");
        fs::write(&f, "x").unwrap();
        index_file(&conn, &f, None).unwrap();
        assert_eq!(remove_path(&conn, &dir.join("site/sub").to_string_lossy()).unwrap(), 1);
        let _ = fs::remove_dir_all(dir);
    }
}
