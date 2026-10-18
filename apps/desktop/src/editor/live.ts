import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import * as decoding from "lib0/decoding";
import { useComments } from "../store/comments";
import { errorMessage, ipc, type ShareRole } from "../lib/ipc";
import { useApp, type Peer } from "../store/app";
import { useAccount } from "../store/account";
import { ensureSession, getSession } from "./session";

/** Cursor colours for collaborators: distinct, readable on light and dark. */
const COLORS = ["#e2513a", "#2f7a4d", "#3b6fe0", "#8b5cf6", "#d4458f", "#1e9bb0", "#e8890c", "#5c5752"];

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

interface LiveConnection {
  documentId: string;
  role: ShareRole;
  doc: Y.Doc;
  provider: WebsocketProvider;
}

const connections = new Map<string, LiveConnection>();
const starting = new Set<string>();

const canEdit = (role: ShareRole) => role === "owner" || role === "editor";

function setShare(tabId: string, share: { documentId: string; role: ShareRole } | undefined) {
  useApp.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, share } : t)) }));
}

/**
 * Connects an open tab to its shared document in real time, if the file is
 * shared and you are signed in. Safe to call for any tab, any number of times.
 */
export async function startLive(tabId: string) {
  if (connections.has(tabId) || starting.has(tabId)) return;
  const account = useAccount.getState().account;
  const tab = useApp.getState().tabs.find((t) => t.id === tabId);
  if (!tab || !account) return;
  starting.add(tabId);
  try {
    const link = await ipc.cloudLinkForPath(tab.path);
    if (!link) return;
    setShare(tabId, { documentId: link.documentId, role: link.role });

    // Push any edits made while offline before the live copy takes over.
    await ipc.syncNow().catch(() => {});
    const ticket = await ipc.liveTicket(link.documentId);
    setShare(tabId, { documentId: link.documentId, role: ticket.role });
    const session = await ensureSession(tab);

    const doc = new Y.Doc();
    const text = doc.getText("html");
    const serverUrl = ticket.url.slice(0, ticket.url.lastIndexOf("/"));
    const provider = new WebsocketProvider(serverUrl, link.documentId, doc, {
      params: { ticket: ticket.ticket },
      disableBc: true,
    });
    const conn: LiveConnection = { documentId: link.documentId, role: ticket.role, doc, provider };
    connections.set(tabId, conn);
    // Quire extension to the protocol: one-word events from the room.
    provider.messageHandlers[2] = (_encoder, decoder) => {
      if (decoding.readVarString(decoder) === "comments") void useComments.getState().load(tabId);
    };

    provider.awareness.setLocalStateField("user", {
      name: account.name,
      color: colorFor(account.id),
      colorLight: colorFor(account.id) + "33",
    });
    provider.awareness.on("change", () => {
      const peers: Peer[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        const user = (state as { user?: { name: string; color: string } }).user;
        if (user && clientId !== doc.clientID) peers.push({ clientId, name: user.name, color: user.color });
      });
      useApp.setState((s) => ({ presence: { ...s.presence, [tabId]: peers } }));
    });

    let bound = false;
    provider.on("sync", (synced: boolean) => {
      if (!synced || bound) return;
      bound = true;
      const undoManager = canEdit(ticket.role) ? new Y.UndoManager(text) : null;
      session.bindLive({ text, awareness: provider.awareness, undoManager, readOnly: !canEdit(ticket.role) });
      void ipc.setLive(link.documentId, true);
      // Shared files always preview the live text (annotated, so comments can pin to elements).
      void session.setLive(true).then(() => useComments.getState().load(tabId));
    });

    // 44xx closes are permanent: access was removed or sharing stopped.
    provider.on("closed", (event: { code: number }) => {
      const app = useApp.getState();
      const name = tab.name;
      if (event.code === 4403) app.toast(`Your access to “${name}” changed.`);
      if (event.code === 4410) app.toast(`“${name}” is no longer shared.`);
      void stopLive(tabId).then(() => {
        // A role change reconnects with the new role; removal leaves it read-only locally.
        if (event.code === 4403) void startLive(tabId);
      });
    });
  } catch (e) {
    useApp.getState().toast(`Couldn't connect “${tab.name}” for live editing: ${errorMessage(e)}`);
  } finally {
    starting.delete(tabId);
  }
}

/** Disconnects a tab, recording the text both sides agree on for later syncs. */
export async function stopLive(tabId: string) {
  const conn = connections.get(tabId);
  if (!conn) return;
  connections.delete(tabId);
  const session = getSession(tabId);
  const synced = conn.doc.getText("html").toString();
  session?.unbindLive();
  conn.provider.destroy();
  conn.doc.destroy();
  useApp.setState((s) => {
    const { [tabId]: _, ...presence } = s.presence;
    return { presence };
  });
  await session?.flush();
  await ipc.setLive(conn.documentId, false, synced).catch(() => {});
}

/** Reconnects every open tab (after signing in, or after sharing a file). */
export function startLiveForAll() {
  for (const t of useApp.getState().tabs) void startLive(t.id);
}

export async function stopLiveForAll() {
  await Promise.all([...connections.keys()].map(stopLive));
  useApp.setState((s) => ({ tabs: s.tabs.map((t) => ({ ...t, share: undefined })) }));
}
