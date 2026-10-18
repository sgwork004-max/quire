/**
 * Access to the Quire library from outside the app (CLI and MCP server).
 *
 * Reads come from Quire's own index (SQLite, read-only). Writes are limited to
 * HTML files inside the user's library folders, and an existing file's
 * content is saved to Quire's version history before it is overwritten, so
 * changes made by AI tools can always be undone from the app.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const APP_ID = "app.quire.desktop";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const HTML = new Set([".html", ".htm", ".xhtml"]);

export function defaultDbPath(): string {
  return process.env.QUIRE_DB ?? join(homedir(), "Library", "Application Support", APP_ID, "quire.db");
}

export interface FileInfo {
  path: string;
  name: string;
  title: string | null;
  folder: string;
  modified: string;
  sizeBytes: number;
  starred: boolean;
  snippet?: string;
}

export interface Folder {
  name: string;
  path: string;
  files: number;
}

export class Library {
  constructor(private readonly dbPath = defaultDbPath()) {}

  private open(readOnly: boolean): DatabaseSync {
    if (!existsSync(this.dbPath)) {
      throw new Error("Quire's library wasn't found. Open the Quire app once to create it.");
    }
    const db = new DatabaseSync(this.dbPath, { readOnly });
    db.exec("PRAGMA busy_timeout = 3000");
    return db;
  }

  private read<T>(fn: (db: DatabaseSync) => T): T {
    const db = this.open(true);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  folders(): Folder[] {
    return this.read((db) =>
      db
        .prepare(
          `SELECT l.name, l.path, (SELECT count(*) FROM files f WHERE f.location_id = l.id AND f.trashed_ms IS NULL) AS files
           FROM locations l ORDER BY l.name COLLATE NOCASE`,
        )
        .all() as unknown as Folder[],
    );
  }

  /** Recent files, or a full-text search over names, titles and page text. */
  list(query?: string, limit = 25): FileInfo[] {
    const terms = (query ?? "")
      .split(/\s+/)
      .map((t) => t.replace(/"/g, ""))
      .filter(Boolean)
      .map((t) => `"${t}"*`)
      .join(" ");
    const cols = `f.path, f.name, f.title, f.dir AS folder, f.modified_ms, f.size_bytes, f.starred`;
    return this.read((db) => {
      const rows = (
        terms
          ? db
              .prepare(
                `SELECT ${cols}, snippet(files_fts, 2, '«', '»', '…', 12) AS snippet
                 FROM files f JOIN files_fts ON files_fts.rowid = f.id AND files_fts MATCH ?
                 WHERE f.trashed_ms IS NULL ORDER BY bm25(files_fts, 10.0, 5.0, 1.0) LIMIT ?`,
              )
              .all(terms, limit)
          : db
              .prepare(
                `SELECT ${cols} FROM files f WHERE f.trashed_ms IS NULL
                 ORDER BY COALESCE(f.opened_ms, 0) DESC, f.modified_ms DESC LIMIT ?`,
              )
              .all(limit)
      ) as Record<string, unknown>[];
      return rows.filter((r) => existsSync(String(r.path))).map((r) => ({
        path: String(r.path),
        name: String(r.name),
        title: (r.title as string | null) ?? null,
        folder: String(r.folder),
        modified: new Date(Number(r.modified_ms)).toISOString(),
        sizeBytes: Number(r.size_bytes),
        starred: Number(r.starred) === 1,
        ...(r.snippet ? { snippet: String(r.snippet) } : {}),
      }));
    });
  }

  /** Library folders plus Quire's own default folder for new files. */
  private writableRoots(): string[] {
    return [...this.folders().map((f) => f.path), defaultFolder()];
  }

  private isIndexed(path: string): boolean {
    return this.read((db) => Boolean(db.prepare("SELECT 1 FROM files WHERE path = ? AND trashed_ms IS NULL").get(path)));
  }

  /** Resolves a path and checks it is an HTML file Quire knows about (or inside a library folder). */
  resolveExisting(path: string): string {
    const abs = resolve(expandHome(path));
    if (!existsSync(abs)) throw new Error(`No file at ${path}`);
    const real = realpathSync(abs);
    if (!HTML.has(extname(real).toLowerCase())) throw new Error("Only HTML files can be used");
    if (!this.isIndexed(real) && !insideAny(real, this.writableRoots())) {
      throw new Error("That file isn't in your Quire library. Open it in Quire or add its folder first.");
    }
    return real;
  }

  readFile(path: string): { path: string; html: string } {
    const real = this.resolveExisting(path);
    if (statSync(real).size > MAX_FILE_BYTES) throw new Error("File is larger than 5 MB");
    return { path: real, html: readFileSync(real, "utf8") };
  }

  /** Creates a new HTML file. Never overwrites. */
  createFile(name: string, html: string, folder?: string): string {
    const dir = this.pickFolder(folder);
    const fileName = safeFileName(name);
    let target = join(dir, fileName);
    for (let n = 2; existsSync(target); n++) {
      target = join(dir, fileName.replace(/(\.[^.]+)$/, ` ${n}$1`));
    }
    checkSize(html);
    atomicWrite(target, html);
    return target;
  }

  /** Replaces a file's content, saving the previous content to version history first. */
  updateFile(path: string, html: string): string {
    const real = this.resolveExisting(path);
    checkSize(html);
    const previous = readFileSync(real, "utf8");
    if (previous === html) return real;
    this.recordVersion(real, previous);
    atomicWrite(real, html);
    return real;
  }

  private pickFolder(folder?: string): string {
    if (!folder) {
      const dir = defaultFolder();
      mkdirSync(dir, { recursive: true });
      return dir;
    }
    const match = this.folders().find((f) => f.name.toLowerCase() === folder.toLowerCase() || f.path === resolve(expandHome(folder)));
    if (!match) {
      const names = this.folders().map((f) => f.name);
      throw new Error(`No library folder called "${folder}". Folders: ${names.length ? names.join(", ") : "none yet"}`);
    }
    return match.path;
  }

  /** Saves `content` as the newest version of `path`, unless it already is. */
  private recordVersion(path: string, content: string) {
    const db = this.open(false);
    try {
      const latest = db.prepare("SELECT content FROM versions WHERE path = ? ORDER BY created_ms DESC, id DESC LIMIT 1").get(path) as
        | { content: string }
        | undefined;
      if (latest?.content === content) return;
      const now = Date.now();
      // The app hashes with xxh3 to skip duplicates; any stable id works here,
      // a mismatch only means the app may store one extra identical version.
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      db.prepare(
        "INSERT INTO versions (path, created_ms, updated_ms, source, hash, size_bytes, content, closed) VALUES (?, ?, ?, 'disk', ?, ?, ?, 1)",
      ).run(path, now, now, hash, Buffer.byteLength(content), content);
    } finally {
      db.close();
    }
  }
}

/** Where files go when no folder is named: ~/Quire (never an iCloud-synced folder). */
export function defaultFolder(): string {
  return process.env.QUIRE_DEFAULT_FOLDER ?? join(homedir(), "Quire");
}

/** Opens a file in the Quire app. */
export function openInQuire(path: string): Promise<void> {
  return new Promise((ok, fail) =>
    execFile("open", ["-b", APP_ID, path], (err) => (err ? fail(new Error("Couldn't open Quire. Is it installed?")) : ok())),
  );
}

function expandHome(p: string) {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function insideAny(path: string, roots: string[]) {
  return roots.some((r) => {
    try {
      const root = realpathSync(r);
      return path === root || path.startsWith(root + sep);
    } catch {
      return false;
    }
  });
}

export function safeFileName(name: string): string {
  let n = basename(name.trim()).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^\.+/, "");
  if (!n) n = "Untitled";
  if (!HTML.has(extname(n).toLowerCase())) n += ".html";
  return n.slice(0, 200);
}

function checkSize(html: string) {
  if (Buffer.byteLength(html) > MAX_FILE_BYTES) throw new Error("HTML is larger than 5 MB");
}

function atomicWrite(target: string, content: string) {
  const tmp = join(dirname(target), `.${basename(target)}.quire-tmp`);
  writeFileSync(tmp, content);
  renameSync(tmp, target);
}
