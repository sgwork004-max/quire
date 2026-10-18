/**
 * Short-lived, signed tickets for real-time connections. Browsers (and the
 * app's webview) can't set headers on WebSockets, so the app first asks the
 * API for a ticket with its Bearer token, then connects with `?ticket=`.
 * The ticket only proves identity; the room re-reads the role from the
 * database on every connect, so revoking access takes effect immediately.
 */

export interface Ticket {
  documentId: string;
  userId: string;
  email: string;
  name: string;
  exp: number;
}

const TTL_MS = 12 * 60 * 60 * 1000;
const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signTicket(secret: string, t: Omit<Ticket, "exp">, now = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ ...t, exp: now + TTL_MS })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyTicket(secret: string, token: string, now = Date.now()): Promise<Ticket | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Ticket;
    return t.exp > now ? t : null;
  } catch {
    return null;
  }
}
