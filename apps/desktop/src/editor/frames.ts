/** Live preview iframes by document id, for talking to the bridge inside them. */
const frames = new Map<string, HTMLIFrameElement>();

export function registerFrame(id: string, el: HTMLIFrameElement | null) {
  if (el) frames.set(id, el);
  else frames.delete(id);
}

export function frameIdFor(source: MessageEventSource | null): string | null {
  for (const [id, el] of frames) if (el.contentWindow && el.contentWindow === source) return id;
  return null;
}

export function getFrame(id: string): HTMLIFrameElement | undefined {
  return frames.get(id);
}

/** Sends a message to the bridge running inside a document. */
export function postToFrame(id: string, message: Record<string, unknown>) {
  frames.get(id)?.contentWindow?.postMessage({ __quireParent: true, ...message }, "*");
}
