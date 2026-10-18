import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust types in src-tauri/src (documents.rs, library.rs, versions.rs).

export interface DocumentInfo {
  id: string;
  path: string;
  name: string;
  url: string;
  sizeBytes: number;
  modifiedMs: number;
}

export interface FileEntry {
  id: number;
  path: string;
  name: string;
  dir: string;
  locationId: number | null;
  title: string | null;
  sizeBytes: number;
  modifiedMs: number;
  openedMs: number | null;
  starred: boolean;
  trashedMs: number | null;
  tagIds: number[];
  /** Search excerpt; matches are wrapped in \u0001 ... \u0002. */
  snippet: string | null;
}

export interface Location {
  id: number;
  path: string;
  name: string;
  count: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  count: number;
}

export interface Overview {
  locations: Location[];
  tags: Tag[];
  all: number;
  starred: number;
  recent: number;
  trash: number;
}

export type LibraryViewKind = "all" | "recent" | "starred" | "trash" | "location" | "tag";

export interface LibraryQuery {
  view: LibraryViewKind;
  locationId?: number;
  tagId?: number;
  search?: string;
  sort?: SortKey;
}

export type SortKey = "modified" | "name" | "opened";

export interface VersionMeta {
  id: number;
  createdMs: number;
  updatedMs: number;
  source: "opened" | "disk" | "edit" | "restore" | string;
  sizeBytes: number;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface SignInStart {
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

export const ipc = {
  // account
  account: () => invoke<Account | null>("account"),
  updateProfile: (name: string) => invoke<Account | null>("update_profile", { name }),
  startSignIn: () => invoke<SignInStart>("start_sign_in"),
  cancelSignIn: () => invoke<void>("cancel_sign_in"),
  signOut: () => invoke<void>("sign_out"),
  // documents
  openDocument: (path: string) => invoke<DocumentInfo>("open_document", { path }),
  closeDocument: (id: string) => invoke<void>("close_document", { id }),
  previewUrl: (path: string) => invoke<string>("preview_url", { path }),
  readDocument: (id: string) => invoke<{ content: string; modifiedMs: number }>("read_document", { id }),
  writeDocument: (id: string, content: string) => invoke<number>("write_document", { id, content }),
  setOverlay: (id: string, content: string | null) => invoke<void>("set_overlay", { id, content }),
  checkpoint: (id: string) => invoke<void>("checkpoint", { id }),
  openInBrowser: (id: string) => invoke<void>("open_in_browser", { id }),
  importImage: (id: string, source: string) => invoke<string>("import_image", { id, source }),
  takePendingOpens: () => invoke<string[]>("take_pending_opens"),
  // library
  overview: () => invoke<Overview>("library_overview"),
  query: (query: LibraryQuery) => invoke<FileEntry[]>("library_query", { query }),
  addLocation: (path: string) => invoke<number>("add_location", { path }),
  removeLocation: (id: number) => invoke<void>("remove_location", { id }),
  rescanLocation: (id: number) => invoke<void>("rescan_location", { id }),
  setStarred: (id: number, starred: boolean) => invoke<void>("set_starred", { id, starred }),
  createTag: (name: string, color: string) => invoke<number>("create_tag", { name, color }),
  updateTag: (id: number, name: string, color: string) => invoke<void>("update_tag", { id, name, color }),
  deleteTag: (id: number) => invoke<void>("delete_tag", { id }),
  setFileTag: (fileId: number, tagId: number, on: boolean) => invoke<void>("set_file_tag", { fileId, tagId, on }),
  renameFile: (id: number, name: string) => invoke<FileEntry>("rename_file", { id, name }),
  duplicateFile: (id: number) => invoke<FileEntry>("duplicate_file", { id }),
  trashFile: (id: number) => invoke<void>("trash_file", { id }),
  restoreFile: (id: number) => invoke<FileEntry>("restore_file", { id }),
  emptyTrash: () => invoke<number>("empty_trash"),
  newFile: (dir: string) => invoke<FileEntry>("new_file", { dir }),
  // versions
  listVersions: (path: string) => invoke<VersionMeta[]>("list_versions", { path }),
  versionContent: (id: number) => invoke<string>("version_content", { id }),
  previewVersion: (id: number) => invoke<DocumentInfo>("preview_version", { id }),
  restoreVersion: (docId: string, versionId: number) => invoke<string>("restore_version", { docId, versionId }),
};

export const HTML_EXTENSIONS = ["html", "htm", "xhtml"];

export function isHtmlPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return HTML_EXTENSIONS.includes(ext);
}

export function errorMessage(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
