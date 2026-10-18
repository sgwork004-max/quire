export interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

/** The only client allowed to use the device sign-in flow. */
export const DESKTOP_CLIENT_ID = "quire-desktop";
