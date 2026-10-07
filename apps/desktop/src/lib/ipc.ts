import { invoke } from "@tauri-apps/api/core";

/** Mirrors `DocumentInfo` in src-tauri/src/documents.rs. */
export interface DocumentInfo {
  id: string;
  path: string;
  name: string;
  url: string;
  sizeBytes: number;
  modifiedMs: number;
}

export const ipc = {
  openDocument: (path: string) => invoke<DocumentInfo>("open_document", { path }),
  closeDocument: (id: string) => invoke<void>("close_document", { id }),
  openInBrowser: (id: string) => invoke<void>("open_in_browser", { id }),
  takePendingOpens: () => invoke<string[]>("take_pending_opens"),
};

export const HTML_EXTENSIONS = ["html", "htm", "xhtml"];

export function isHtmlPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return HTML_EXTENSIONS.includes(ext);
}
