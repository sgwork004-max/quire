import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { canEdit, type Env, type Role } from "./env";
import { applyMinimalChange, mergeText } from "./merge";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
/** Quire extension: a one-word event, e.g. "comments" when comments changed. */
const MESSAGE_EVENT = 2;
const SAVE_DELAY_MS = 2000;
/** SQLite rows are capped at 2 MB; store the document in 1 MB chunks. */
const CHUNK = 1024 * 1024;

interface Attachment {
  email: string;
  role: Role;
  /** Awareness client ids this socket announced, removed when it closes. */
  clients: number[];
}

/**
 * One live shared document. Holds the Yjs document whose `html` text is the
 * file's source, speaks the y-websocket protocol to connected apps, enforces
 * roles (only owners and editors may change the document), and persists the
 * state in its own SQLite storage. Uses WebSocket hibernation so idle rooms
 * cost nothing.
 */
export class DocRoom extends DurableObject<Env> {
  private doc = new Y.Doc();
  private awareness = new awarenessProtocol.Awareness(this.doc);
  private documentId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.awareness.setLocalState(null); // the server itself is not a participant
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS ydoc (seq INTEGER PRIMARY KEY, data BLOB NOT NULL)");
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      const chunks = ctx.storage.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM ydoc ORDER BY seq").toArray();
      if (chunks.length) {
        const total = chunks.reduce((n, c) => n + c.data.byteLength, 0);
        const state = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          state.set(new Uint8Array(c.data), offset);
          offset += c.data.byteLength;
        }
        Y.applyUpdate(this.doc, state, "storage");
      }
      this.documentId =
        ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'documentId'").toArray()[0]?.value ?? null;
    });

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "storage") return;
      const msg = encoding.createEncoder();
      encoding.writeVarUint(msg, MESSAGE_SYNC);
      syncProtocol.writeUpdate(msg, update);
      this.broadcast(encoding.toUint8Array(msg), origin instanceof WebSocket ? origin : null);
      void this.scheduleSave();
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = added.concat(updated, removed);
        const msg = encoding.createEncoder();
        encoding.writeVarUint(msg, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(msg, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.broadcast(encoding.toUint8Array(msg), origin instanceof WebSocket ? origin : null);
      },
    );
  }

  private get text(): Y.Text {
    return this.doc.getText("html");
  }

  // ------------------------------------------------------------ RPC (from the Worker)

  /** Sets the initial content of a newly shared document. */
  async init(documentId: string, html: string): Promise<void> {
    this.documentId = documentId;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('documentId', ?)", documentId);
    if (this.text.length === 0) this.doc.transact(() => this.text.insert(0, html), "api");
    await this.save();
  }

  async getText(): Promise<string> {
    return this.text.toString();
  }

  /** Merges a full-text edit made from `base` (e.g. by another app) into the live document. */
  async merge(base: string, next: string): Promise<string> {
    const merged = mergeText(this.text.toString(), base, next);
    this.doc.transact(() => applyMinimalChange(this.text, merged), "api");
    return this.text.toString();
  }

  /** Tells every connected app that something outside the text changed. */
  async notify(event: string): Promise<void> {
    const msg = encoding.createEncoder();
    encoding.writeVarUint(msg, MESSAGE_EVENT);
    encoding.writeVarString(msg, event);
    this.broadcast(encoding.toUint8Array(msg), null);
  }

  /** Disconnects everyone signed in as `email` (their access was removed). */
  async kick(email: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.email === email) ws.close(4403, "Access removed");
    }
  }

  /** Called when sharing stops: drop everything. */
  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(4410, "No longer shared");
    await this.ctx.storage.deleteAll();
  }

  // ------------------------------------------------------------ WebSocket

  /** The Worker has already verified the ticket and resolved the role. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const role = request.headers.get("X-Quire-Role") as Role | null;
    const email = request.headers.get("X-Quire-Email");
    if (!role || !email) return new Response("Forbidden", { status: 403 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ email, role, clients: [] } satisfies Attachment);

    // Start the sync: send our state vector, then current presence.
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(sync, this.doc);
    server.send(encoding.toUint8Array(sync));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states));
      server.send(encoding.toUint8Array(aw));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === "string") return;
    const attachment = ws.deserializeAttachment() as Attachment;
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const type = decoding.readVarUint(decoder);

    if (type === MESSAGE_SYNC) {
      const step = decoding.readVarUint(decoder);
      if (step === syncProtocol.messageYjsSyncStep1) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(reply, this.doc, decoding.readVarUint8Array(decoder));
        ws.send(encoding.toUint8Array(reply));
      } else if (step === syncProtocol.messageYjsSyncStep2 || step === syncProtocol.messageYjsUpdate) {
        // Read-only roles can follow along but their changes are dropped here,
        // on the server, whatever their app does.
        if (canEdit(attachment.role)) Y.applyUpdate(this.doc, decoding.readVarUint8Array(decoder), ws);
      }
    } else if (type === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      // Remember which presence entries belong to this socket.
      const d = decoding.createDecoder(update);
      const count = decoding.readVarUint(d);
      const ids = new Set(attachment.clients);
      for (let i = 0; i < count; i++) {
        ids.add(decoding.readVarUint(d));
        decoding.readVarUint(d); // clock
        decoding.readVarString(d); // state
      }
      if (ids.size !== attachment.clients.length) ws.serializeAttachment({ ...attachment, clients: [...ids] });
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.clients.length) awarenessProtocol.removeAwarenessStates(this.awareness, attachment.clients, ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private broadcast(message: Uint8Array, except: WebSocket | null) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(message);
      } catch {
        // closed socket; the runtime will call webSocketClose
      }
    }
  }

  // ------------------------------------------------------------ persistence

  private async scheduleSave() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SAVE_DELAY_MS);
  }

  async alarm(): Promise<void> {
    await this.save();
  }

  /** Writes the compacted document and bumps the revision others poll for. */
  private async save() {
    const state = Y.encodeStateAsUpdate(this.doc);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM ydoc");
      for (let i = 0, seq = 0; i < state.length; i += CHUNK, seq++) {
        this.ctx.storage.sql.exec("INSERT INTO ydoc (seq, data) VALUES (?, ?)", seq, state.slice(i, i + CHUNK));
      }
    });
    if (this.documentId) {
      const htmlBytes = new TextEncoder().encode(this.text.toString()).length;
      await this.env.DB.prepare(
        `UPDATE document SET revision = revision + 1, updatedAt = ?,
           sizeBytes = ? + COALESCE((SELECT SUM(sizeBytes) FROM asset WHERE documentId = ?), 0)
         WHERE id = ?`,
      )
        .bind(Date.now(), htmlBytes, this.documentId, this.documentId)
        .run();
    }
  }
}
