import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Library, safeFileName } from "./library.js";

/** A minimal copy of the app's schema (src-tauri/src/db.rs). */
function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "quire-mcp-")));
  const site = join(dir, "site");
  mkdirSync(site);
  const dbPath = join(dir, "quire.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE locations (id INTEGER PRIMARY KEY, path TEXT UNIQUE, name TEXT, added_ms INTEGER);
    CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT UNIQUE, name TEXT, dir TEXT, location_id INTEGER, title TEXT,
      size_bytes INTEGER DEFAULT 0, modified_ms INTEGER DEFAULT 0, opened_ms INTEGER, starred INTEGER DEFAULT 0, trashed_ms INTEGER, trash_path TEXT);
    CREATE VIRTUAL TABLE files_fts USING fts5(name, title, body);
    CREATE TABLE versions (id INTEGER PRIMARY KEY, path TEXT, created_ms INTEGER, updated_ms INTEGER, source TEXT, hash TEXT,
      size_bytes INTEGER, content TEXT, closed INTEGER DEFAULT 0);
  `);
  const page = join(site, "sales.html");
  writeFileSync(page, "<title>Sales</title><p>Mumbai revenue</p>");
  db.prepare("INSERT INTO locations (id, path, name, added_ms) VALUES (1, ?, 'site', 0)").run(site);
  db.prepare("INSERT INTO files (id, path, name, dir, location_id, title, modified_ms) VALUES (1, ?, 'sales.html', ?, 1, 'Sales', 1)").run(page, site);
  db.prepare("INSERT INTO files_fts (rowid, name, title, body) VALUES (1, 'sales.html', 'Sales', 'Mumbai revenue')").run();
  db.close();
  process.env.QUIRE_DEFAULT_FOLDER = join(dir, "Quire");
  return { dir, site, page, lib: new Library(dbPath), dbPath };
}

describe("Library", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("lists and searches the index", () => {
    expect(t.lib.list().map((f) => f.name)).toEqual(["sales.html"]);
    const hits = t.lib.list("mumb");
    expect(hits[0].title).toBe("Sales");
    expect(hits[0].snippet).toContain("«Mumbai»");
    expect(t.lib.list("nothing-here")).toEqual([]);
  });

  it("reads library files only", () => {
    expect(t.lib.readFile(t.page).html).toContain("Mumbai");
    const outside = join(t.dir, "secret.html");
    writeFileSync(outside, "<p>secret</p>");
    expect(() => t.lib.readFile(outside)).toThrow(/isn't in your Quire library/);
    writeFileSync(join(t.site, "notes.txt"), "x");
    expect(() => t.lib.readFile(join(t.site, "notes.txt"))).toThrow(/Only HTML/);
  });

  it("creates files without overwriting, in named or default folders", () => {
    const a = t.lib.createFile("Report", "<p>1</p>", "site");
    const b = t.lib.createFile("Report.html", "<p>2</p>", "site");
    expect(a.endsWith("site/Report.html")).toBe(true);
    expect(b.endsWith("site/Report 2.html")).toBe(true);
    expect(t.lib.createFile("x", "<p/>").startsWith(join(t.dir, "Quire"))).toBe(true);
    expect(() => t.lib.createFile("x", "<p/>", "Nope")).toThrow(/No library folder/);
  });

  it("keeps the previous version when updating", () => {
    t.lib.updateFile(t.page, "<p>new</p>");
    expect(readFileSync(t.page, "utf8")).toBe("<p>new</p>");
    const db = new DatabaseSync(t.dbPath);
    const rows = db.prepare("SELECT content, source FROM versions WHERE path = ?").all(t.page) as { content: string; source: string }[];
    db.close();
    expect(rows).toEqual([{ content: "<title>Sales</title><p>Mumbai revenue</p>", source: "disk" }]);
  });

  it("makes safe file names", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd.html");
    expect(safeFileName(".hidden")).toBe("hidden.html");
    expect(safeFileName("a:b?.htm")).toBe("a-b-.htm");
  });
});
