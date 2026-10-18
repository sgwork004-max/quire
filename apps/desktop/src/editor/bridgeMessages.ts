import { useApp, type ElementInfo } from "../store/app";
import { onFrameReady } from "../components/doc/DocView";
import { frameIdFor } from "./frames";
import { getSession } from "./session";
import { useComments } from "../store/comments";

type BridgeMessage =
  | { type: "ready"; count: number }
  | { type: "selected"; info: ElementInfo | null }
  | { type: "commit-text"; qid: number; html: string; structureChanged: boolean }
  | { type: "style-attr"; qid: number; style: string }
  | { type: "delete"; qid: number }
  | { type: "undo-parent" }
  | { type: "redo-parent" }
  | { type: "editing"; on: boolean }
  | { type: "pin"; id: string };

/**
 * Handles messages from the bridge script inside a preview. Only messages
 * from a registered preview iframe are accepted, and they can only edit that
 * document's own source.
 */
export function handleBridgeMessage(e: MessageEvent) {
  if (!e.data || e.data.__quire !== true) return;
  const id = frameIdFor(e.source);
  if (!id) return;
  const msg = e.data as BridgeMessage;
  const tab = useApp.getState().tabs.find((t) => t.id === id);
  if (!tab) return;

  if (msg.type === "ready") {
    onFrameReady(id);
    return;
  }
  const comments = useComments.getState();
  if (msg.type === "pin") {
    comments.togglePanel(true);
    comments.focus(id, msg.id);
    return;
  }
  if (msg.type === "selected" && comments.picking[id]) {
    if (msg.info) comments.draftFromSelection(id, msg.info);
    else comments.stopPick(id); // Esc
    return;
  }
  // Everything below is editing, which only exists in Visual mode.
  const session = getSession(id);
  if (tab.mode !== "visual" || !session) return;

  switch (msg.type) {
    case "selected":
      useApp.setState((s) => ({ selection: { ...s.selection, [id]: msg.info } }));
      break;
    case "commit-text":
      session.replaceText(msg.qid, msg.html, msg.structureChanged);
      break;
    case "style-attr":
      session.setAttribute(msg.qid, "style", msg.style || null);
      break;
    case "delete":
      if (session.remove(msg.qid)) useApp.setState((s) => ({ selection: { ...s.selection, [id]: null } }));
      break;
    case "undo-parent":
      session.undo();
      break;
    case "redo-parent":
      session.redo();
      break;
  }
}
