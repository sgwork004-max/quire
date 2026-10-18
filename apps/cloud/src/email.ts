import type { Env } from "./env";

/**
 * Sends a sign-in code. Without a RESEND_API_KEY (local development) the code
 * is printed to the Worker console instead, so no email account is needed.
 */
export async function sendSignInCode(env: Env, email: string, code: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[dev] Sign-in code for ${email}: ${code}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "Quire <onboarding@resend.dev>",
      to: email,
      subject: `${code} is your Quire sign-in code`,
      text: `Your Quire sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't try to sign in, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
}
