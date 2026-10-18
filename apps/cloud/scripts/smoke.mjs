// End-to-end smoke test against a local `wrangler dev` (http://localhost:8787).
// Signs in two users through the real device flow (reading the dev email codes
// from the wrangler log), shares a document, and checks sharing, roles,
// assets, merges and real-time sync.
//
//   node scripts/smoke.mjs <path-to-wrangler-log>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const BASE = process.env.QUIRE_API_URL ?? "http://localhost:8787";
const LOG = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

async function json(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: BASE,
      ...headers,
    },
    body: body instanceof Uint8Array ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookie: res.headers.getSetCookie?.() ?? [] };
}

async function signIn(email) {
  // Sign-in endpoints are rate limited per IP; space test sign-ins out.
  await sleep(7000);
  const code = (await json("/api/auth/device/code", { method: "POST", body: { client_id: "quire-desktop" } })).data;
  await json("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email, type: "sign-in" } });
  await sleep(500);
  const otp = [...readFileSync(LOG, "utf8").matchAll(new RegExp(`${email}: (\\d{6})`, "g"))].pop()[1];
  const signed = await json("/api/auth/sign-in/email-otp", { method: "POST", body: { email, otp } });
  const cookie = signed.cookie.map((c) => c.split(";")[0]).join("; ");
  await json(`/api/auth/device?user_code=${code.user_code}`, { headers: { Cookie: cookie } });
  await json("/api/auth/device/approve", { method: "POST", body: { userCode: code.user_code }, headers: { Cookie: cookie } });
  await sleep(3200);
  const tok = await json("/api/auth/device/token", {
    method: "POST",
    body: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code, client_id: "quire-desktop" },
  });
  return tok.data.access_token;
}

/** Minimal y-websocket client. */
async function connect(token, docId) {
  const t = (await json(`/api/documents/${docId}/ticket`, { method: "POST", token })).data;
  const doc = new Y.Doc();
  const ws = new WebSocket(`${t.url}?ticket=${encodeURIComponent(t.ticket)}`);
  ws.binaryType = "arraybuffer";
  let synced = false;
  const events = [];
  ws.onmessage = (e) => {
    const dec = decoding.createDecoder(new Uint8Array(e.data));
    const kind = decoding.readVarUint(dec);
    if (kind === 2) events.push(decoding.readVarString(dec));
    if (kind !== 0) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    const type = syncProtocol.readSyncMessage(dec, enc, doc, "remote");
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    if (type === 1) synced = true;
  };
  doc.on("update", (update, origin) => {
    if (origin === "remote" || ws.readyState !== 1) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));
  for (let i = 0; i < 50 && !synced; i++) await sleep(50);
  return { doc, ws, text: doc.getText("html"), role: t.role, events };
}

const owner = await signIn(`owner-${Date.now()}@example.com`);
const editorEmail = `editor-${Date.now()}@example.com`;
const editor = await signIn(editorEmail);
const viewerEmail = `viewer-${Date.now()}@example.com`;
const viewer = await signIn(viewerEmail);
const stranger = await signIn(`stranger-${Date.now()}@example.com`);
check("four users signed in", owner && editor && viewer && stranger);

// Share
const html = "<!doctype html><title>Q3</title><h1>Revenue</h1><p>Up 12%</p>";
const created = await json("/api/documents", { method: "POST", token: owner, body: { fileName: "q3.html", title: "Q3", html } });
const id = created.data?.id;
check("owner shares a file", created.status === 201 && id, JSON.stringify(created.data));
check("no access without a token", (await json(`/api/documents/${id}`)).status === 401);
check("stranger can't see it", (await json(`/api/documents/${id}`, { token: stranger })).status === 404);

// Assets
const css = new TextEncoder().encode("h1{color:red}");
const hash = createHash("sha256").update(css).digest("hex");
const missing = await json(`/api/documents/${id}/blobs/missing`, { method: "POST", token: owner, body: { hashes: [hash] } });
check("missing blob detected", missing.data?.missing?.[0] === hash);
check("bad hash rejected", (await json(`/api/documents/${id}/blobs/${"0".repeat(64)}`, { method: "PUT", token: owner, body: css })).status === 400);
check("blob uploads", (await json(`/api/documents/${id}/blobs/${hash}`, { method: "PUT", token: owner, body: css })).status === 200);
check(
  "path traversal in asset list rejected",
  (await json(`/api/documents/${id}/assets`, { method: "PUT", token: owner, body: { assets: [{ path: "../x.css", hash, size: css.length }] } })).status === 400,
);
check(
  "asset list saved",
  (await json(`/api/documents/${id}/assets`, { method: "PUT", token: owner, body: { assets: [{ path: "style.css", hash, size: css.length }] } })).status === 200,
);

// Members
check("invalid role rejected", (await json(`/api/documents/${id}/members`, { method: "POST", token: owner, body: { email: editorEmail, role: "admin" } })).status === 400);
await json(`/api/documents/${id}/members`, { method: "POST", token: owner, body: { email: editorEmail, role: "editor" } });
const m = await json(`/api/documents/${id}/members`, { method: "POST", token: owner, body: { email: viewerEmail, role: "viewer" } });
check("two members added", m.data?.members?.length === 2);
check("editor can't share onward", (await json(`/api/documents/${id}/members`, { method: "POST", token: editor, body: { email: "x@example.com", role: "viewer" } })).status === 403);
const list = await json("/api/documents", { token: viewer });
check("appears in viewer's Shared with me", list.data?.documents?.some((d) => d.id === id && d.role === "viewer"));
check("viewer can download the asset", (await fetch(`${BASE}/api/documents/${id}/blobs/${hash}`, { headers: { Authorization: `Bearer ${viewer}` } })).status === 200);
check("stranger can't download the asset", (await json(`/api/documents/${id}/blobs/${hash}`, { token: stranger })).status === 404);

// Content merge (offline edits)
const viewerPut = await json(`/api/documents/${id}/content`, { method: "PUT", token: viewer, body: { base: html, html: html + "x" } });
check("viewer can't push edits", viewerPut.status === 403);
await json(`/api/documents/${id}/content`, { method: "PUT", token: owner, body: { base: html, html: html.replace("Up 12%", "Up 15%") } });
const merged = await json(`/api/documents/${id}/content`, { method: "PUT", token: editor, body: { base: html, html: html.replace("Revenue", "Sales") } });
check("concurrent offline edits both survive", merged.data?.html?.includes("Sales") && merged.data?.html?.includes("Up 15%"), merged.data?.html);

// Real time
const a = await connect(editor, id);
const b = await connect(viewer, id);
check("live sync delivers current text", a.text.toString() === merged.data.html && b.text.toString() === merged.data.html);
check("ticket reports role", a.role === "editor" && b.role === "viewer");
a.text.insert(a.text.length, "<footer>live</footer>");
await sleep(400);
check("editor's live edit reaches viewer", b.text.toString().includes("<footer>live</footer>"));
b.text.insert(0, "<!-- hacked -->");
await sleep(400);
const server = (await json(`/api/documents/${id}/content`, { token: owner })).data.html;
check("viewer's live edit is dropped by the server", !server.includes("hacked") && server.includes("live"));
check("forged ticket rejected", (await fetch(`${BASE}/live/${id}?ticket=abc.def`)).status === 401);

// Comments
const anchor = { pos: "AQ==", tag: "h1", snippet: "Sales" };
check("viewer can read comments", (await json(`/api/documents/${id}/comments`, { token: viewer })).data?.canComment === false);
check("viewer can't comment", (await json(`/api/documents/${id}/comments`, { method: "POST", token: viewer, body: { body: "hi", anchor } })).status === 403);
check("bad anchor rejected", (await json(`/api/documents/${id}/comments`, { method: "POST", token: owner, body: { body: "hi", anchor: { pos: 1 } } })).status === 400);
const thread = await json(`/api/documents/${id}/comments`, {
  method: "POST",
  token: owner,
  body: { body: "Can we double-check this number?", anchor, mentions: [editorEmail, "stranger@example.com"] },
});
const threadId = thread.data?.id;
check("owner starts a thread", thread.status === 201 && thread.data.threads[0].anchor.tag === "h1");
await sleep(300);
check("live clients hear about new comments", a.events.includes("comments"));
const reply = await json(`/api/documents/${id}/comments`, { method: "POST", token: editor, body: { body: "Yes, confirmed.", threadId } });
check("editor replies", reply.status === 201 && reply.data.threads[0].replies.length === 1);
const replyId = reply.data.id;
let notes = (await json("/api/notifications", { token: editor })).data;
check("mentioned editor is notified", notes?.notifications?.some((n) => n.kind === "mention" && n.documentId === id));
check("owner is notified of the reply", (await json("/api/notifications", { token: owner })).data?.notifications?.some((n) => n.kind === "reply"));
check("non-members can't be mentioned", (await json("/api/notifications", { token: stranger })).data?.notifications?.length === 0);
await json("/api/notifications/read", { method: "POST", token: editor, body: {} });
check("notifications marked read", (await json("/api/notifications", { token: editor })).data?.unread === 0);
check("editor can't edit owner's comment", (await json(`/api/documents/${id}/comments/${threadId}`, { method: "PATCH", token: editor, body: { body: "x" } })).status === 403);
check("viewer can't resolve", (await json(`/api/documents/${id}/comments/${threadId}`, { method: "PATCH", token: viewer, body: { resolved: true } })).status === 403);
const resolved = await json(`/api/documents/${id}/comments/${threadId}`, { method: "PATCH", token: editor, body: { resolved: true } });
check("editor resolves the thread", resolved.data?.threads?.[0]?.resolved === true);
check("editor can't delete owner's thread", (await json(`/api/documents/${id}/comments/${threadId}`, { method: "DELETE", token: editor })).status === 403);
const del = await json(`/api/documents/${id}/comments/${replyId}`, { method: "DELETE", token: owner });
check("owner deletes a reply", del.data?.threads?.[0]?.replies?.length === 0);
check("stranger can't read comments", (await json(`/api/documents/${id}/comments`, { token: stranger })).status === 404);

// Revoke while connected
const closed = new Promise((r) => (a.ws.onclose = (e) => r(e.code)));
await json(`/api/documents/${id}/members/${encodeURIComponent(editorEmail)}`, { method: "DELETE", token: owner });
check("removed editor is disconnected", (await Promise.race([closed, sleep(2000).then(() => 0)])) === 4403);
check("removed editor loses access", (await json(`/api/documents/${id}`, { token: editor })).status === 404);
b.ws.close();

// Stop sharing
check("only owner can stop sharing", (await json(`/api/documents/${id}`, { method: "DELETE", token: viewer })).status === 403);
check("owner stops sharing", (await json(`/api/documents/${id}`, { method: "DELETE", token: owner })).status === 200);
check("document is gone", (await json(`/api/documents/${id}`, { token: owner })).status === 404);
const again = await json("/api/documents", { method: "POST", token: owner, body: { fileName: "x.html", html: "<p>x</p>" } });
const gone = await json(`/api/documents/${again.data.id}/blobs/missing`, { method: "POST", token: owner, body: { hashes: [hash] } });
check("unshared files' uploads are deleted", gone.data?.missing?.[0] === hash);
await json(`/api/documents/${again.data.id}`, { method: "DELETE", token: owner });

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
