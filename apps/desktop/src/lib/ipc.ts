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
  folderId: number | null;
  /** Search excerpt; matches are wrapped in \u0001 ... \u0002. */
  snippet: string | null;
}

/** A folder Quire watches for new HTML, and where its imports are filed. */
export interface ImportSource {
  path: string;
  folderId: number | null;
  tagIds: number[];
  sinceMs?: number;
}

export interface ImportCandidate {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedMs: number;
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

/** A folder inside Quire; files stay wherever they are on disk. */
export interface Folder {
  id: number;
  name: string;
  count: number;
}

export interface Overview {
  locations: Location[];
  folders: Folder[];
  tags: Tag[];
  all: number;
  starred: number;
  recent: number;
  trash: number;
  hidden: number;
}

export type LibraryViewKind = "all" | "recent" | "starred" | "trash" | "hidden" | "location" | "folder" | "tag";

export interface LibraryQuery {
  view: LibraryViewKind;
  locationId?: number;
  tagId?: number;
  folderId?: number;
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

export type ShareRole = "owner" | "editor" | "commenter" | "viewer";

export interface CloudDocument {
  id: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  revision: number;
  updatedAt: number;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  role: ShareRole;
  memberCount: number;
}

export interface CloudLink {
  documentId: string;
  path: string;
  role: ShareRole;
  title: string;
  ownerName: string | null;
}

export interface CloudOverview {
  documents: CloudDocument[];
  usage: { usedBytes: number; quotaBytes: number };
  links: CloudLink[];
}

export interface Member {
  email: string;
  role: Exclude<ShareRole, "owner">;
  name: string | null;
  image: string | null;
  pending: boolean;
}

export interface ShareDetails {
  id: string;
  title: string;
  role: ShareRole;
  sizeBytes: number;
  owner: { name: string; email: string; image: string | null };
  members: Member[];
}

export interface Person {
  id?: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface CommentItem {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  author: Person & { id: string };
}

export interface Thread extends CommentItem {
  anchor: { pos: string; tag: string; snippet: string } | null;
  resolved: boolean;
  replies: CommentItem[];
}

export interface CommentsReply {
  threads: Thread[];
  canComment: boolean;
  people: { email: string; name: string }[];
}

export interface AppNotification {
  id: string;
  kind: "mention" | "reply" | "comment";
  createdAt: number;
  readAt: number | null;
  documentId: string;
  commentId: string;
  threadId: string;
  documentTitle: string;
  actorName: string;
  actorImage: string | null;
  excerpt: string;
}

export interface DataSource {
  id: number;
  docPath: string;
  name: string;
  url: string;
  intervalMin: number;
  lastFetchedMs: number | null;
  lastError: string | null;
}

export const ipc = {
  // account
  account: () => invoke<Account | null>("account"),
  updateProfile: (name: string) => invoke<Account | null>("update_profile", { name }),
  startSignIn: () => invoke<SignInStart>("start_sign_in"),
  cancelSignIn: () => invoke<void>("cancel_sign_in"),
  signOut: () => invoke<void>("sign_out"),
  // sharing
  cloudOverview: () => invoke<CloudOverview>("cloud_overview"),
  cloudLinkForPath: (path: string) => invoke<CloudLink | null>("cloud_link_for_path", { path }),
  shareFile: (path: string) => invoke<string>("share_file", { path }),
  shareDetails: (documentId: string) => invoke<ShareDetails>("share_details", { documentId }),
  shareInvite: (documentId: string, email: string, role: string) =>
    invoke<{ members: Member[] }>("share_invite", { documentId, email, role }),
  shareSetRole: (documentId: string, email: string, role: string) =>
    invoke<{ members: Member[] }>("share_set_role", { documentId, email, role }),
  shareRemove: (documentId: string, email: string) => invoke<{ members: Member[] }>("share_remove", { documentId, email }),
  stopSharing: (documentId: string) => invoke<void>("stop_sharing", { documentId }),
  leaveShared: (documentId: string) => invoke<void>("leave_shared", { documentId }),
  openShared: (documentId: string) => invoke<string>("open_shared", { documentId }),
  liveTicket: (documentId: string) => invoke<{ url: string; ticket: string; role: ShareRole }>("live_ticket", { documentId }),
  setLive: (documentId: string, live: boolean, synced?: string) => invoke<void>("set_live", { documentId, live, synced }),
  syncNow: () => invoke<void>("sync_now"),
  listDataSources: (path: string) => invoke<DataSource[]>("list_data_sources", { path }),
  addDataSource: (path: string, url: string, name: string, intervalMin: number) =>
    invoke<DataSource>("add_data_source", { path, url, name, intervalMin }),
  refreshDataSource: (id: number) => invoke<DataSource>("refresh_data_source", { id }),
  removeDataSource: (id: number) => invoke<void>("remove_data_source", { id }),
  /** Paths only; never reads a folder, so it can't trigger a permission prompt. */
  inboxStatus: () => invoke<{ sources: ImportSource[]; downloads: string; desktop: string; documents: string; inbox: string }>("inbox_status"),
  setImportSources: (sources: ImportSource[]) => invoke<void>("set_import_sources", { sources }),
  claudeStatus: () =>
    invoke<{ desktop: { installed: boolean; connected: boolean }; code: { installed: boolean; connected: boolean } }>("claude_status"),
  connectClaude: (target: "desktop" | "code", connect: boolean) => invoke<void>("connect_claude", { target, connect }),
  importScan: (folders: string[], files: string[]) => invoke<ImportCandidate[]>("import_scan", { folders, files }),
  importPaths: (paths: string[], dest: string | null, folderId: number | null = null, tagIds: number[] = []) =>
    invoke<{ added: number; updated: number; unchanged: number; ids: number[] }>("import_paths", { paths, dest, folderId, tagIds }),
  printDocument: (id: string) => invoke<void>("print_document", { id }),
  exportStandalone: (id: string, dest: string) => invoke<string>("export_standalone", { id, dest }),
  cloudApi: <T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
    invoke<T>("cloud_api", { method, path, body }),
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
  setHidden: (ids: number[], hidden: boolean) => invoke<void>("set_hidden", { ids, hidden }),
  createFolder: (name: string) => invoke<number>("create_folder", { name }),
  renameFolder: (id: number, name: string) => invoke<void>("rename_folder", { id, name }),
  deleteFolder: (id: number) => invoke<void>("delete_folder", { id }),
  setFilesFolder: (ids: number[], folder: number | null) => invoke<void>("set_files_folder", { ids, folder }),
  emptyTrash: () => invoke<number>("empty_trash"),
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
