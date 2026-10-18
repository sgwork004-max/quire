//! SQLite storage for the library index, tags and version history.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[
    // v1: library, tags, versions
    r#"
    CREATE TABLE locations (
        id        INTEGER PRIMARY KEY,
        path      TEXT NOT NULL UNIQUE,
        name      TEXT NOT NULL,
        added_ms  INTEGER NOT NULL
    );
    CREATE TABLE files (
        id           INTEGER PRIMARY KEY,
        path         TEXT NOT NULL UNIQUE,
        name         TEXT NOT NULL,
        dir          TEXT NOT NULL,
        location_id  INTEGER REFERENCES locations(id) ON DELETE SET NULL,
        title        TEXT,
        size_bytes   INTEGER NOT NULL DEFAULT 0,
        modified_ms  INTEGER NOT NULL DEFAULT 0,
        opened_ms    INTEGER,
        starred      INTEGER NOT NULL DEFAULT 0,
        trashed_ms   INTEGER,
        trash_path   TEXT
    );
    CREATE INDEX files_location ON files(location_id);
    CREATE INDEX files_opened ON files(opened_ms);
    CREATE VIRTUAL TABLE files_fts USING fts5(name, title, body, tokenize = 'unicode61 remove_diacritics 2');
    CREATE TABLE tags (
        id     INTEGER PRIMARY KEY,
        name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color  TEXT NOT NULL
    );
    CREATE TABLE file_tags (
        file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (file_id, tag_id)
    );
    CREATE TABLE versions (
        id          INTEGER PRIMARY KEY,
        path        TEXT NOT NULL,
        created_ms  INTEGER NOT NULL,
        updated_ms  INTEGER NOT NULL,
        source      TEXT NOT NULL,
        hash        TEXT NOT NULL,
        size_bytes  INTEGER NOT NULL,
        content     TEXT NOT NULL,
        closed      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX versions_path ON versions(path, created_ms DESC);
    "#,
    // v2: links between local files and shared cloud documents
    r#"
    CREATE TABLE cloud_links (
        document_id  TEXT PRIMARY KEY,
        -- The owner's original file, or the local cached copy for recipients.
        path         TEXT NOT NULL UNIQUE,
        account_id   TEXT NOT NULL,
        role         TEXT NOT NULL,
        title        TEXT NOT NULL,
        owner_name   TEXT,
        revision     INTEGER NOT NULL DEFAULT 0,
        -- Text known to be identical locally and in the cloud: the merge base.
        synced       TEXT NOT NULL DEFAULT '',
        -- Fingerprint of the last asset list pushed or pulled.
        assets_sig   TEXT NOT NULL DEFAULT ''
    );
    "#,
    // v3: live data sources downloaded next to a page on a schedule
    r#"
    CREATE TABLE data_sources (
        id             INTEGER PRIMARY KEY,
        doc_path       TEXT NOT NULL,
        name           TEXT NOT NULL,
        url            TEXT NOT NULL,
        interval_min   INTEGER NOT NULL,
        last_fetched_ms INTEGER,
        last_error     TEXT,
        created_ms     INTEGER NOT NULL,
        UNIQUE (doc_path, name)
    );
    "#,
    // v4: small app settings (e.g. Downloads import)
    r#"
    CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
    );
    "#,
    // v5: files hidden from the library views (not trashed; the file stays on disk)
    r#"
    ALTER TABLE files ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
    "#,
    // v6: folders that live in Quire (not on disk): a file is in at most one
    r#"
    CREATE TABLE folders (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_ms  INTEGER NOT NULL
    );
    ALTER TABLE files ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
    "#,
];

pub fn setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub struct Db {
    conn: Mutex<Connection>,
    /// Where trashed files are kept until the trash is emptied.
    pub trash_dir: PathBuf,
    /// Local copies of files other people shared with you.
    pub shared_dir: PathBuf,
}

impl Db {
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        let trash_dir = data_dir.join("trash");
        std::fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
        let shared_dir = data_dir.join("shared");
        std::fs::create_dir_all(&shared_dir).map_err(|e| e.to_string())?;
        let shared_dir = std::fs::canonicalize(&shared_dir).map_err(|e| e.to_string())?;
        let conn = Connection::open(data_dir.join("quire.db")).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;")
            .map_err(|e| e.to_string())?;
        migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn), trash_dir, shared_dir })
    }

    #[cfg(test)]
    pub fn open_in_memory(trash_dir: PathBuf) -> Self {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&conn).unwrap();
        let shared_dir = trash_dir.with_file_name("shared");
        Self { conn: Mutex::new(conn), trash_dir, shared_dir }
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: usize = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        conn.execute_batch(&format!("BEGIN; {sql} PRAGMA user_version = {}; COMMIT;", i + 1))
            .map_err(|e| format!("migration {} failed: {e}", i + 1))?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
