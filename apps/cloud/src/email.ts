import { emailEnabled, type Env } from "./env";

/**
 * Sends a plain-text email through Resend. Without a RESEND_API_KEY (local
 * development) it is printed to the Worker console instead.
 */
async function send(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!emailEnabled(env)) return; // no email service configured: skip silently
  if (!env.RESEND_API_KEY) {
    console.log(`[dev] Email to ${to}: ${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM ?? "Quire <onboarding@resend.dev>", to, subject, text }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
}

const ROLE_VERB: Record<string, string> = { editor: "edit", commenter: "comment on", viewer: "view" };

export async function sendInvite(env: Env, opts: { to: string; from: string; title: string; role: string }) {
  await send(
    env,
    opts.to,
    `${opts.from} shared “${opts.title}” with you`,
    `${opts.from} invited you to ${ROLE_VERB[opts.role] ?? "view"} “${opts.title}” in Quire.\n\n` +
      `Open Quire and sign in with ${opts.to}. The file will be under Shared with me.\n\n` +
      `Don't have Quire yet? Get it at https://quire.app`,
  );
}

export async function sendSignInCode(env: Env, email: string, code: string): Promise<void> {
  if (!emailEnabled(env)) throw new Error("Email sign-in isn't available. Continue with Google.");
  if (!env.RESEND_API_KEY) console.log(`[dev] Sign-in code for ${email}: ${code}`);
  else
    await send(
      env,
      email,
      `${code} is your Quire sign-in code`,
      `Your Quire sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't try to sign in, ignore this email.`,
    );
}
