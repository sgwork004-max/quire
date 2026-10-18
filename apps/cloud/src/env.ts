import type { DocRoom } from "./room";

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  ROOMS: DurableObjectNamespace<DocRoom>;
  QUOTA_MB: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

/** The only client allowed to use the device sign-in flow. */
export const DESKTOP_CLIENT_ID = "quire-desktop";

export type Role = "owner" | "editor" | "commenter" | "viewer";

export const canEdit = (role: Role | null) => role === "owner" || role === "editor";

/** Largest HTML document and largest single asset accepted. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_ASSETS = 300;
