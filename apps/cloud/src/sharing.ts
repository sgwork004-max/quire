import { Hono } from "hono";
import type { Context } from "hono";
import { canEdit, MAX_ASSET_BYTES, MAX_ASSETS, MAX_HTML_BYTES, type Env, type Role } from "./env";
import { sendInvite } from "./email";
import { signTicket, verifyTicket } from "./ticket";

export interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

type SharingEnv = { Bindings: Env; Variables: { user: User | null } };
type C = Context<SharingEnv>;

const ROLES = new Set(["editor", "commenter", "viewer"]);
const HASH = /^[0-9a-f]{64}$/;

interface DocumentRow {
  id: string;
  ownerId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

interface AssetInput {
  path: string;
  hash: string;
  size: number;
}

const user = (c: C) => c.get("user")!;
const room = (c: C, id: string) => c.env.ROOMS.get(c.env.ROOMS.idFromName(id));
const bytes = (s: string) => new TextEncoder().encode(s).length;
const fail = (c: C, status: 400 | 403 | 404 | 409 | 413, error: string) => c.json({ error }, status);

/** The caller's role on a document, or null if they have no access. */
async function roleFor(env: Env, documentId: string, u: User): Promise<{ doc: DocumentRow; role: Role } | null> {
  const doc = await env.DB.prepare("SELECT * FROM document WHERE id = ?").bind(documentId).first<DocumentRow>();
  if (!doc) return null;
  if (doc.ownerId === u.id) return { doc, role: "owner" };
  const m = await env.DB.prepare("SELECT role FROM member WHERE documentId = ? AND email = ?")
    .bind(documentId, u.email.toLowerCase())
    .first<{ role: Role }>();
  return m ? { doc, role: m.role } : null;
}

async function usedBytes(env: Env, ownerId: string, excluding?: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(sizeBytes), 0) AS used FROM document WHERE ownerId = ? AND id != ?")
    .bind(ownerId, excluding ?? "")
    .first<{ used: number }>();
  return r?.used ?? 0;
}

const quotaBytes = (env: Env) => Number(env.QUOTA_MB || "100") * 1024 * 1024;

/** Asset paths are relative, inside the document's folder, never hidden. */
function validAssets(assets: unknown): AssetInput[] | null {
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) return null;
  for (const a of assets as AssetInput[]) {
    if (typeof a?.path !== "string" || !HASH.test(a.hash) || !Number.isInteger(a.size)) return null;
    if (a.size < 0 || a.size > MAX_ASSET_BYTES) return null;
    const parts = a.path.split("/");
    if (a.path.startsWith("/") || parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) return null;
  }
  return assets as AssetInput[];
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function writeAssets(env: Env, documentId: string, assets: AssetInput[]) {
  const stmts = [env.DB.prepare("DELETE FROM asset WHERE documentId = ?").bind(documentId)];
  for (const a of assets) {
    stmts.push(
      env.DB.prepare("INSERT INTO asset (documentId, path, hash, sizeBytes) VALUES (?, ?, ?, ?)").bind(documentId, a.path, a.hash, a.size),
    );
  }
  stmts.push(env.DB.prepare("UPDATE document SET revision = revision + 1, updatedAt = ? WHERE id = ?").bind(Date.now(), documentId));
  await env.DB.batch(stmts);
}

async function members(env: Env, documentId: string) {
  const { results } = await env.DB.prepare(
    `SELECT m.email, m.role, m.createdAt, u.name, u.image
     FROM member m LEFT JOIN "user" u ON lower(u.email) = m.email
     WHERE m.documentId = ? ORDER BY m.createdAt`,
  )
    .bind(documentId)
    .all<{ email: string; role: Role; createdAt: number; name: string | null; image: string | null }>();
  return results.map((m) => ({ ...m, pending: m.name === null }));
}

export const sharing = new Hono<SharingEnv>();

// ---------------------------------------------------------------- documents

/** Everything I own or that was shared with me. */
sharing.get("/", async (c) => {
  const u = user(c);
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.fileName, d.sizeBytes, d.revision, d.updatedAt, d.ownerId,
            o.name AS ownerName, o.email AS ownerEmail,
            CASE WHEN d.ownerId = ?1 THEN 'owner' ELSE m.role END AS role,
            (SELECT COUNT(*) FROM member WHERE documentId = d.id) AS memberCount
     FROM document d
     JOIN "user" o ON o.id = d.ownerId
     LEFT JOIN member m ON m.documentId = d.id AND m.email = ?2
     WHERE d.ownerId = ?1 OR m.email IS NOT NULL
     ORDER BY d.updatedAt DESC`,
  )
    .bind(u.id, u.email.toLowerCase())
    .all();
  const used = await usedBytes(c.env, u.id);
  return c.json({ documents: results, usage: { usedBytes: used, quotaBytes: quotaBytes(c.env) } });
});

/** Shares a file: creates the cloud document with its HTML. Assets follow via /blobs and /assets. */
sharing.post("/", async (c) => {
  const u = user(c);
  const body = await c.req.json<{ title?: string; fileName?: string; html?: string }>().catch(() => null);
  if (!body || typeof body.html !== "string" || typeof body.fileName !== "string") return fail(c, 400, "html and fileName are required");
  const size = bytes(body.html);
  if (size > MAX_HTML_BYTES) return fail(c, 413, "This file is larger than 5 MB, the sharing limit");
  if ((await usedBytes(c.env, u.id)) + size > quotaBytes(c.env)) return fail(c, 413, "You've used all your shared storage");

  const id = crypto.randomUUID();
  const now = Date.now();
  const title = (body.title?.trim() || body.fileName).slice(0, 200);
  await c.env.DB.prepare(
    "INSERT INTO document (id, ownerId, title, fileName, sizeBytes, revision, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
  )
    .bind(id, u.id, title, body.fileName.slice(0, 200), size, now, now)
    .run();
  await room(c, id).init(id, body.html);
  return c.json({ id }, 201);
});

sharing.get("/:id", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  const owner = await c.env.DB.prepare(`SELECT name, email, image FROM "user" WHERE id = ?`).bind(access.doc.ownerId).first();
  return c.json({ ...access.doc, role: access.role, owner, members: await members(c.env, access.doc.id) });
});

/** Stop sharing: deletes the cloud copy. The owner's local file is untouched. */
sharing.delete("/:id", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  if (access.role !== "owner") return fail(c, 403, "Only the owner can stop sharing");
  await room(c, access.doc.id).destroy();
  await c.env.DB.prepare("DELETE FROM document WHERE id = ?").bind(access.doc.id).run();
  // Blobs no other document uses are removed. Content addressing makes this safe.
  const { results } = await c.env.DB.prepare(
    "SELECT hash FROM asset WHERE documentId = ? EXCEPT SELECT hash FROM asset WHERE documentId != ?",
  )
    .bind(access.doc.id, access.doc.id)
    .all<{ hash: string }>();
  if (results.length) await c.env.BLOBS.delete(results.map((r) => `blobs/${r.hash}`));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- content

sharing.get("/:id/content", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  return c.json({ html: await room(c, access.doc.id).getText(), revision: access.doc.revision });
});

/**
 * Pushes a full-text edit made outside a live session (another app, an AI tool,
 * offline work). `base` is the text the client last synced; the change from
 * base to html is merged into the live document so others' edits survive.
 */
sharing.put("/:id/content", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  if (!canEdit(access.role)) return fail(c, 403, "You can view this file but not edit it");
  const body = await c.req.json<{ base?: string; html?: string }>().catch(() => null);
  if (!body || typeof body.html !== "string" || typeof body.base !== "string") return fail(c, 400, "base and html are required");
  if (bytes(body.html) > MAX_HTML_BYTES) return fail(c, 413, "This file is larger than 5 MB, the sharing limit");
  const html = await room(c, access.doc.id).merge(body.base, body.html);
  return c.json({ html });
});

// ---------------------------------------------------------------- assets

sharing.get("/:id/assets", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  const { results } = await c.env.DB.prepare("SELECT path, hash, sizeBytes AS size FROM asset WHERE documentId = ?")
    .bind(access.doc.id)
    .all<AssetInput>();
  return c.json({ assets: results });
});

/** Replaces the asset list. Every listed blob must already be uploaded. */
sharing.put("/:id/assets", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  if (!canEdit(access.role)) return fail(c, 403, "You can view this file but not edit it");
  const body = await c.req.json<{ assets?: unknown }>().catch(() => null);
  const assets = validAssets(body?.assets);
  if (!assets) return fail(c, 400, "Invalid asset list");
  for (const a of assets) {
    if (!(await c.env.BLOBS.head(`blobs/${a.hash}`))) return fail(c, 409, `Upload ${a.path} first`);
  }
  const assetBytes = assets.reduce((n, a) => n + a.size, 0);
  const html = await room(c, access.doc.id).getText();
  const total = bytes(html) + assetBytes;
  if ((await usedBytes(c.env, access.doc.ownerId, access.doc.id)) + total > quotaBytes(c.env)) {
    return fail(c, 413, "This would go over the owner's shared storage");
  }
  await writeAssets(c.env, access.doc.id, assets);
  await c.env.DB.prepare("UPDATE document SET sizeBytes = ? WHERE id = ?").bind(total, access.doc.id).run();
  return c.json({ ok: true });
});

/** Which of these hashes still need uploading. */
sharing.post("/:id/blobs/missing", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  const body = await c.req.json<{ hashes?: string[] }>().catch(() => null);
  const hashes = (body?.hashes ?? []).filter((h) => HASH.test(h)).slice(0, MAX_ASSETS);
  const missing: string[] = [];
  for (const h of hashes) if (!(await c.env.BLOBS.head(`blobs/${h}`))) missing.push(h);
  return c.json({ missing });
});

sharing.put("/:id/blobs/:hash", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  if (!canEdit(access.role)) return fail(c, 403, "You can view this file but not edit it");
  const hash = c.req.param("hash");
  if (!HASH.test(hash)) return fail(c, 400, "Invalid hash");
  const data = await c.req.arrayBuffer();
  if (data.byteLength > MAX_ASSET_BYTES) return fail(c, 413, "Files larger than 25 MB can't be shared");
  if ((await sha256Hex(data)) !== hash) return fail(c, 400, "Content doesn't match its hash");
  await c.env.BLOBS.put(`blobs/${hash}`, data);
  return c.json({ ok: true });
});

/** Downloads an asset. Only hashes this document actually uses are served. */
sharing.get("/:id/blobs/:hash", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  const used = await c.env.DB.prepare("SELECT 1 FROM asset WHERE documentId = ? AND hash = ?")
    .bind(access.doc.id, c.req.param("hash"))
    .first();
  if (!used) return fail(c, 404, "Not found");
  const obj = await c.env.BLOBS.get(`blobs/${c.req.param("hash")}`);
  if (!obj) return fail(c, 404, "Not found");
  return new Response(obj.body, { headers: { "Content-Type": "application/octet-stream" } });
});

// ---------------------------------------------------------------- members

sharing.post("/:id/members", async (c) => {
  const u = user(c);
  const access = await roleFor(c.env, c.req.param("id"), u);
  if (!access) return fail(c, 404, "Not found");
  if (access.role !== "owner") return fail(c, 403, "Only the owner can share this file");
  const body = await c.req.json<{ email?: string; role?: string }>().catch(() => null);
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(c, 400, "Enter a valid email address");
  if (!ROLES.has(body?.role ?? "")) return fail(c, 400, "Role must be editor, commenter or viewer");
  if (email === u.email.toLowerCase()) return fail(c, 400, "You already own this file");
  await c.env.DB.prepare(
    `INSERT INTO member (documentId, email, role, invitedBy, createdAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (documentId, email) DO UPDATE SET role = excluded.role`,
  )
    .bind(access.doc.id, email, body!.role, u.id, Date.now())
    .run();
  c.executionCtx.waitUntil(
    sendInvite(c.env, { to: email, from: u.name, title: access.doc.title, role: body!.role! }).catch((e) =>
      console.error("invite email failed", e),
    ),
  );
  return c.json({ members: await members(c.env, access.doc.id) });
});

sharing.patch("/:id/members/:email", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  if (access.role !== "owner") return fail(c, 403, "Only the owner can change access");
  const body = await c.req.json<{ role?: string }>().catch(() => null);
  if (!ROLES.has(body?.role ?? "")) return fail(c, 400, "Role must be editor, commenter or viewer");
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  await c.env.DB.prepare("UPDATE member SET role = ? WHERE documentId = ? AND email = ?").bind(body!.role, access.doc.id, email).run();
  // Reconnect so the new role applies to their live session.
  await room(c, access.doc.id).kick(email);
  return c.json({ members: await members(c.env, access.doc.id) });
});

sharing.delete("/:id/members/:email", async (c) => {
  const u = user(c);
  const access = await roleFor(c.env, c.req.param("id"), u);
  if (!access) return fail(c, 404, "Not found");
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  // Owners remove anyone; members can remove themselves ("leave").
  if (access.role !== "owner" && email !== u.email.toLowerCase()) return fail(c, 403, "Only the owner can remove people");
  await c.env.DB.prepare("DELETE FROM member WHERE documentId = ? AND email = ?").bind(access.doc.id, email).run();
  await room(c, access.doc.id).kick(email);
  return c.json({ members: await members(c.env, access.doc.id) });
});

// ---------------------------------------------------------------- real time

/** A ticket for the live connection (WebSockets can't carry the Bearer header). */
sharing.post("/:id/ticket", async (c) => {
  const u = user(c);
  const access = await roleFor(c.env, c.req.param("id"), u);
  if (!access) return fail(c, 404, "Not found");
  const ticket = await signTicket(c.env.BETTER_AUTH_SECRET, {
    documentId: access.doc.id,
    userId: u.id,
    email: u.email.toLowerCase(),
    name: u.name,
  });
  const url = new URL(c.req.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/live/${access.doc.id}`;
  url.search = "";
  return c.json({ url: url.toString(), ticket, role: access.role });
});

/** WebSocket entry point. Verifies the ticket and the current role, then hands over to the room. */
export async function live(c: Context<{ Bindings: Env }>) {
  const documentId = c.req.param("id")!;
  const ticket = await verifyTicket(c.env.BETTER_AUTH_SECRET, c.req.query("ticket") ?? "");
  if (!ticket || ticket.documentId !== documentId) return c.text("Invalid ticket", 401);
  const access = await roleFor(c.env, documentId, { id: ticket.userId, name: ticket.name, email: ticket.email });
  if (!access) return c.text("No access", 403);
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Quire-Role", access.role);
  headers.set("X-Quire-Email", ticket.email);
  return c.env.ROOMS.get(c.env.ROOMS.idFromName(documentId)).fetch(new Request(c.req.raw, { headers }));
}
