// Simulates a second person for testing sharing by hand, against local `wrangler dev`.
// Signs in as EMAIL, connects live to the newest document shared with them,
// optionally appends some HTML, then prints every change it sees.
//
//   node scripts/peer.mjs <wrangler-log> <email> [html-to-append] [seconds]
import { readFileSync } from "node:fs";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const BASE = process.env.QUIRE_API_URL ?? "http://localhost:8787";
const [LOG, EMAIL, APPEND, SECONDS = "20"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  ws.onmessage = (e) => {
    const dec = decoding.createDecoder(new Uint8Array(e.data));
    if (decoding.readVarUint(dec) !== 0) return;
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
  return { doc, ws, text: doc.getText("html"), role: t.role };
}


const token = await signIn(EMAIL);
const list = (await json("/api/documents", { token })).data.documents.filter((d) => d.role !== "owner");
if (!list.length) {
  console.log("Nothing shared with", EMAIL);
  process.exit(1);
}
const doc = list[0];
console.log(`Connected to "${doc.title}" as ${doc.role}`);
const live = await connect(token, doc.id);
console.log("TEXT:", JSON.stringify(live.text.toString()));
live.text.observe(() => console.log("UPDATE:", JSON.stringify(live.text.toString())));
if (APPEND) {
  const at = live.text.toString().lastIndexOf("</body>");
  live.text.insert(at >= 0 ? at : live.text.length, APPEND);
  console.log("APPENDED:", APPEND);
}
await sleep(Number(SECONDS) * 1000);
live.ws.close();
process.exit(0);
