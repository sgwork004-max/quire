//! Version history. Every HTML file Quire sees gets snapshots: when first
//! opened, when changed outside Quire (e.g. by an AI tool) and while edited in
//! Quire, where bursts of edits are folded into one version per session.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use xxhash_rust::xxh3::xxh3_64;

use crate::db::{err, now_ms};

/// Edits closer together than this extend the same version.
const EDIT_SESSION_MS: i64 = 2 * 60 * 1000;
const MAX_VERSIONS_PER_FILE: i64 = 300;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta {
    pub id: i64,
    pub created_ms: i64,
    pub updated_ms: i64,
    /// opened | disk | edit | restore | saved
    pub source: String,
    pub size_bytes: i64,
}

fn hash(content: &str) -> String {
    format!("{:016x}", xxh3_64(content.as_bytes()))
}

/// Records `content` as the newest version of `path` unless it is identical to
/// the current newest version. Returns true if history changed.
pub fn record(conn: &Connection, path: &str, content: &str, source: &str) -> Result<bool, String> {
    let h = hash(content);
    let now = now_ms();
    let latest: Option<(i64, String, String, i64, bool)> = conn
        .query_row(
            "SELECT id, hash, source, created_ms, closed FROM versions WHERE path = ?1
             ORDER BY created_ms DESC, id DESC LIMIT 1",
            [path],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? != 0)),
        )
        .optional()
        .map_err(err)?;

    if let Some((id, latest_hash, latest_source, created, closed)) = latest {
        if latest_hash == h {
            return Ok(false);
        }
        if source == "edit" && latest_source == "edit" && !closed && now - created < EDIT_SESSION_MS {
            conn.execute(
                "UPDATE versions SET content = ?1, hash = ?2, size_bytes = ?3, updated_ms = ?4 WHERE id = ?5",
                params![content, h, content.len() as i64, now, id],
            )
            .map_err(err)?;
            return Ok(true);
        }
    }

    conn.execute(
        "INSERT INTO versions (path, created_ms, updated_ms, source, hash, size_bytes, content)
         VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6)",
        params![path, now, source, h, content.len() as i64, content],
    )
    .map_err(err)?;
    conn.execute(
        "DELETE FROM versions WHERE path = ?1 AND id NOT IN
           (SELECT id FROM versions WHERE path = ?1 ORDER BY created_ms DESC, id DESC LIMIT ?2)",
        params![path, MAX_VERSIONS_PER_FILE],
    )
    .map_err(err)?;
    Ok(true)
}

/// Ends the current edit session so the next edit starts a new version.
pub fn close_session(conn: &Connection, path: &str) -> Result<(), String> {
    conn.execute("UPDATE versions SET closed = 1 WHERE path = ?1 AND closed = 0", [path])
        .map(|_| ())
        .map_err(err)
}

pub fn list(conn: &Connection, path: &str) -> Result<Vec<VersionMeta>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, created_ms, updated_ms, source, size_bytes FROM versions WHERE path = ?1
             ORDER BY created_ms DESC, id DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([path], |r| {
            Ok(VersionMeta {
                id: r.get(0)?,
                created_ms: r.get(1)?,
                updated_ms: r.get(2)?,
                source: r.get(3)?,
                size_bytes: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn get(conn: &Connection, id: i64) -> Result<(String, String), String> {
    conn.query_row("SELECT path, content FROM versions WHERE id = ?1", [id], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })
    .map_err(err)
}

pub fn rename_path(conn: &Connection, from: &str, to: &str) -> Result<(), String> {
    conn.execute("UPDATE versions SET path = ?1 WHERE path = ?2", params![to, from])
        .map(|_| ())
        .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn dedupes_and_folds_edit_sessions() {
        let db = Db::open_in_memory(std::env::temp_dir());
        let c = db.conn();
        assert!(record(&c, "/a.html", "v1", "opened").unwrap());
        assert!(!record(&c, "/a.html", "v1", "disk").unwrap(), "identical content is skipped");
        record(&c, "/a.html", "v2", "edit").unwrap();
        record(&c, "/a.html", "v3", "edit").unwrap();
        let v = list(&c, "/a.html").unwrap();
        assert_eq!(v.len(), 2, "two edits in one session fold into one version");
        assert_eq!(get(&c, v[0].id).unwrap().1, "v3");

        close_session(&c, "/a.html").unwrap();
        record(&c, "/a.html", "v4", "edit").unwrap();
        assert_eq!(list(&c, "/a.html").unwrap().len(), 3);
    }
}
