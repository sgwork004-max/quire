import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Role } from "./env";
import { roleFor, type User } from "./sharing";

type CommentsEnv = { Bindings: Env; Variables: { user: User | null } };
type C = Context<CommentsEnv>;

const MAX_BODY = 5000;
const canComment = (role: Role) => role !== "viewer";

interface CommentRow {
  id: string;
  documentId: string;
  threadId: string | null;
  authorId: string;
  body: string;
  anchor: string | null;
  resolved: number;
  createdAt: number;
  updatedAt: number;
}

const user = (c: C) => c.get("user")!;
const fail = (c: C, status: 400 | 403 | 404, error: string) => c.json({ error }, status);
const room = (c: C, id: string) => c.env.ROOMS.get(c.env.ROOMS.idFromName(id));

/** Anchors are opaque to the server but must be small, well-formed JSON. */
function validAnchor(anchor: unknown): string | null | undefined {
  if (anchor === undefined || anchor === null) return null;
  if (typeof anchor !== "object") return undefined;
  const a = anchor as { pos?: unknown; tag?: unknown; snippet?: unknown };
  if (typeof a.pos !== "string" || a.pos.length > 2000) return undefined;
  if (typeof a.tag !== "string" || a.tag.length > 40) return undefined;
  if (a.snippet !== undefined && (typeof a.snippet !== "string" || a.snippet.length > 300)) return undefined;
  return JSON.stringify({ pos: a.pos, tag: a.tag, snippet: a.snippet ?? "" });
}

/** People who can be mentioned on a document: the owner and its members. */
async function participants(env: Env, documentId: string): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare(
    `SELECT lower(u.email) AS email, u.name FROM document d JOIN "user" u ON u.id = d.ownerId WHERE d.id = ?1
     UNION
     SELECT m.email, COALESCE(u.name, m.email) FROM member m LEFT JOIN "user" u ON lower(u.email) = m.email WHERE m.documentId = ?1`,
  )
    .bind(documentId)
    .all<{ email: string; name: string }>();
  return new Map(results.map((r) => [r.email, r.name]));
}

async function listThreads(env: Env, documentId: string) {
  const { results } = await env.DB.prepare(
    `SELECT c.*, u.name AS authorName, u.email AS authorEmail, u.image AS authorImage
     FROM comment c JOIN "user" u ON u.id = c.authorId
     WHERE c.documentId = ? ORDER BY c.createdAt`,
  )
    .bind(documentId)
    .all<CommentRow & { authorName: string; authorEmail: string; authorImage: string | null }>();
  const shape = (r: (typeof results)[number]) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    author: { id: r.authorId, name: r.authorName, email: r.authorEmail, image: r.authorImage },
  });
  const threads = results
    .filter((r) => !r.threadId)
    .map((r) => ({
      ...shape(r),
      anchor: r.anchor ? JSON.parse(r.anchor) : null,
      resolved: r.resolved === 1,
      replies: results.filter((x) => x.threadId === r.id).map(shape),
    }));
  return threads;
}

async function notifyRecipients(
  env: Env,
  documentId: string,
  commentId: string,
  actor: User,
  recipients: Map<string, "mention" | "reply" | "comment">,
) {
  const self = actor.email.toLowerCase();
  const now = Date.now();
  const stmts = [...recipients]
    .filter(([email]) => email !== self)
    .map(([email, kind]) =>
      env.DB.prepare(
        "INSERT INTO notification (id, recipientEmail, documentId, commentId, actorId, kind, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), email, documentId, commentId, actor.id, kind, now),
    );
  if (stmts.length) await env.DB.batch(stmts);
}

export const comments = new Hono<CommentsEnv>();

comments.get("/:id/comments", async (c) => {
  const access = await roleFor(c.env, c.req.param("id"), user(c));
  if (!access) return fail(c, 404, "Not found");
  const people = await participants(c.env, access.doc.id);
  return c.json({
    threads: await listThreads(c.env, access.doc.id),
    canComment: canComment(access.role),
    people: [...people].map(([email, name]) => ({ email, name })),
  });
});

/** New thread (with an anchor) or a reply (with threadId). */
comments.post("/:id/comments", async (c) => {
  const u = user(c);
  const access = await roleFor(c.env, c.req.param("id"), u);
  if (!access) return fail(c, 404, "Not found");
  if (!canComment(access.role)) return fail(c, 403, "You can view this file but not comment on it");
  const body = await c.req.json<{ body?: string; anchor?: unknown; threadId?: string; mentions?: string[] }>().catch(() => null);
  const text = body?.body?.trim() ?? "";
  if (!text || text.length > MAX_BODY) return fail(c, 400, "Comments must be 1–5000 characters");

  let threadId: string | null = null;
  let anchor: string | null = null;
  if (body?.threadId) {
    const root = await c.env.DB.prepare("SELECT * FROM comment WHERE id = ? AND documentId = ? AND threadId IS NULL")
      .bind(body.threadId, access.doc.id)
      .first<CommentRow>();
    if (!root) return fail(c, 404, "That thread no longer exists");
    threadId = root.id;
  } else {
    const a = validAnchor(body?.anchor);
    if (a === undefined) return fail(c, 400, "Invalid anchor");
    anchor = a;
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO comment (id, documentId, threadId, authorId, body, anchor, resolved, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
  )
    .bind(id, access.doc.id, threadId, u.id, text, anchor, now, now)
    .run();
  // Replying to a resolved thread reopens it, as in Google Docs.
  if (threadId) await c.env.DB.prepare("UPDATE comment SET resolved = 0 WHERE id = ?").bind(threadId).run();

  // Who to tell: mentioned people, others in the thread, and the owner of a new thread's file.
  const people = await participants(c.env, access.doc.id);
  const recipients = new Map<string, "mention" | "reply" | "comment">();
  if (threadId) {
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT lower(u.email) AS email FROM comment c JOIN "user" u ON u.id = c.authorId WHERE c.id = ?1 OR c.threadId = ?1`,
    )
      .bind(threadId)
      .all<{ email: string }>();
    for (const r of results) if (people.has(r.email)) recipients.set(r.email, "reply");
  } else {
    const owner = await c.env.DB.prepare(`SELECT lower(email) AS email FROM "user" WHERE id = ?`).bind(access.doc.ownerId).first<{ email: string }>();
    if (owner) recipients.set(owner.email, "comment");
  }
  for (const m of body?.mentions ?? []) {
    const email = String(m).toLowerCase();
    if (people.has(email)) recipients.set(email, "mention"); // only people on the file
  }
  await notifyRecipients(c.env, access.doc.id, id, u, recipients);
  await room(c, access.doc.id).notify("comments");
  return c.json({ id, threads: await listThreads(c.env, access.doc.id) }, 201);
});

/** Edit your own comment, or resolve/reopen a thread. */
comments.patch("/:id/comments/:cid", async (c) => {
  const u = user(c);
  const access = await roleFor(c.env, c.req.param("id"), u);
  if (!access) return fail(c, 404, "Not found");
  if (!canComment(access.role)) return fail(c, 403, "You can view this file but not comment on it");
  const row = await c.env.DB.prepare("SELECT * FROM comment WHERE id = ? AND documentId = ?")
    .bind(c.req.param("cid"), access.doc.id)
    .first<CommentRow>();
  if (!row) return fail(c, 404, "That comment no longer exists");
  const body = await c.req.json<{ body?: string; resolved?: boolean }>().catch(() => null);

  if (typeof body?.resolved === "boolean") {
    if (row.threadId) return fail(c, 400, "Only threads can be resolved");
    await c.env.DB.prepare("UPDATE comment SET resolved = ?, updatedAt = ? WHERE id = ?").bind(body.resolved ? 1 : 0, Date.now(), row.id).run();
  }
  if (typeof body?.body === "string") {
    if (row.authorId !== u.id) return fail(c, 403, "You can only edit your own comments");
    const text = body.body.trim();
    if (!text || text.length > MAX_BODY) return fail(c, 400, "Comments must be 1–5000 characters");
    await c.env.DB.prepare("UPDATE comment SET body = ?, updatedAt = ? WHERE id = ?").bind(text, Date.now(), row.id).run();
  }
  await room(c, access.doc.id).notify("comments");
  return c.json({ threads: await listThreads(c.env, access.doc.id) });
});

/** Authors delete their own comments; owners can delete any. Deleting a thread's first comment deletes the thread. */
comments.delete("/:id/comments/:cid", async (c) => {
  const u = user(c);
  const access = await roleFor(c.env, c.req.param("id"), u);
  if (!access) return fail(c, 404, "Not found");
  const row = await c.env.DB.prepare("SELECT * FROM comment WHERE id = ? AND documentId = ?")
    .bind(c.req.param("cid"), access.doc.id)
    .first<CommentRow>();
  if (!row) return fail(c, 404, "That comment no longer exists");
  if (row.authorId !== u.id && access.role !== "owner") return fail(c, 403, "You can only delete your own comments");
  await c.env.DB.prepare("DELETE FROM comment WHERE id = ? OR threadId = ?").bind(row.id, row.id).run();
  await room(c, access.doc.id).notify("comments");
  return c.json({ threads: await listThreads(c.env, access.doc.id) });
});

// ---------------------------------------------------------------- notifications

export const notifications = new Hono<CommentsEnv>();

notifications.get("/", async (c) => {
  const u = user(c);
  const { results } = await c.env.DB.prepare(
    `SELECT n.id, n.kind, n.createdAt, n.readAt, n.documentId, n.commentId,
            d.title AS documentTitle, a.name AS actorName, a.image AS actorImage,
            substr(cm.body, 1, 200) AS excerpt, COALESCE(cm.threadId, cm.id) AS threadId
     FROM notification n
     JOIN document d ON d.id = n.documentId
     JOIN "user" a ON a.id = n.actorId
     JOIN comment cm ON cm.id = n.commentId
     WHERE n.recipientEmail = ?
       AND (d.ownerId = ?2 OR EXISTS (SELECT 1 FROM member m WHERE m.documentId = d.id AND m.email = n.recipientEmail))
     ORDER BY n.createdAt DESC LIMIT 50`,
  )
    .bind(u.email.toLowerCase(), u.id)
    .all();
  const unread = results.filter((r) => !r.readAt).length;
  return c.json({ notifications: results, unread });
});

notifications.post("/read", async (c) => {
  const u = user(c);
  const body = await c.req.json<{ ids?: string[] }>().catch(() => null);
  const now = Date.now();
  if (body?.ids?.length) {
    const ids = body.ids.slice(0, 100);
    await c.env.DB.prepare(
      `UPDATE notification SET readAt = ? WHERE recipientEmail = ? AND readAt IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(now, u.email.toLowerCase(), ...ids)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE notification SET readAt = ? WHERE recipientEmail = ? AND readAt IS NULL").bind(now, u.email.toLowerCase()).run();
  }
  return c.json({ ok: true });
});
