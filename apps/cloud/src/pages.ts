const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
:root{--bg:#fbfaf8;--surface:#fff;--text:#1c1917;--text-2:#5c5752;--text-3:#a39d97;--border:rgb(28 25 23/.1);
--accent:#e2513a;--accent-hover:#cf4430;--accent-soft:rgb(226 81 58/.1);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#171615;--surface:#232120;--text:#eeebe8;--text-2:#aaa49e;--text-3:#6d6762;
--border:rgb(255 255 255/.1);--accent:#f0664f;--accent-hover:#f47b66;--accent-soft:rgb(240 102 79/.14);color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:16px}
.card{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;
box-shadow:0 1px 2px rgb(0 0 0/.04),0 12px 40px -12px rgb(0 0 0/.12)}
.logo{width:36px;height:36px;margin-bottom:16px}
h1{font-size:19px;letter-spacing:-.01em;margin:0 0 4px}p{color:var(--text-2);margin:0 0 20px}
label{display:block;font-size:12px;color:var(--text-2);margin-bottom:6px}
input{width:100%;height:40px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);
padding:0 12px;font:inherit;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
button{width:100%;height:40px;border-radius:10px;border:0;font:inherit;font-weight:600;cursor:pointer;margin-top:12px}
.primary{background:var(--accent);color:#fff}.primary:hover{background:var(--accent-hover)}
.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}.secondary:hover{background:var(--accent-soft)}
button:disabled{opacity:.6;cursor:default}
.code{font:600 26px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.12em;text-align:center;padding:16px;
border-radius:12px;background:var(--bg);border:1px dashed var(--border);margin:4px 0 8px}
.or{display:flex;align-items:center;gap:10px;color:var(--text-3);font-size:12px;margin:16px 0 4px}
.or:before,.or:after{content:"";flex:1;height:1px;background:var(--border)}
.error{color:var(--accent);font-size:13px;margin-top:12px;min-height:1px}.muted{color:var(--text-3);font-size:12px;margin-top:16px}
.hidden{display:none}a{color:var(--accent)}
`;

const LOGO = `<svg class="logo" viewBox="0 0 20 20" fill="none"><rect x="7" y="1" width="11" height="14" rx="2" fill="currentColor" opacity=".2"/>
<rect x="5" y="2.5" width="11" height="14" rx="2" fill="currentColor" opacity=".38"/>
<path d="M5 4h5.5L14 7.5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="var(--accent)"/>
<path d="M10.5 4v2.5a1 1 0 0 0 1 1H14" stroke="var(--surface)" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

/**
 * The page the desktop app opens to finish signing in. It signs the person in
 * (Google or an emailed code) and then asks them to approve the code shown in
 * the app. Approving creates the session the app receives.
 */
export function devicePage(opts: { userCode: string; google: boolean }): string {
  const code = escape(opts.userCode);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to Quire</title><style>${STYLE}</style></head><body><main class="card">${LOGO}

<section id="loading"><p>Loading…</p></section>

<section id="enter-code" class="hidden">
  <h1>Sign in to Quire</h1><p>Enter the code shown in the Quire app.</p>
  <form id="code-form"><label for="code">Code</label><input id="code" autocomplete="off" autocapitalize="characters" required>
  <button class="primary">Continue</button></form>
</section>

<section id="sign-in" class="hidden">
  <h1>Sign in to Quire</h1><p>Use the account you want on this Mac.</p>
  ${opts.google ? `<button id="google" class="secondary">Continue with Google</button><div class="or">or</div>` : ""}
  <form id="email-form"><label for="email">Email</label><input id="email" type="email" autocomplete="email" placeholder="you@company.com" required>
  <button class="primary">Email me a code</button></form>
  <form id="otp-form" class="hidden"><p id="otp-hint"></p><label for="otp">6-digit code</label>
  <input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
  <button class="primary">Sign in</button></form>
</section>

<section id="approve" class="hidden">
  <h1>Sign in on your Mac?</h1><p>Quire is asking to sign in as <strong id="who"></strong>. Check that this code matches the one in the app.</p>
  <div class="code" id="shown-code"></div>
  <button id="approve-btn" class="primary">Sign in to Quire</button>
  <button id="deny-btn" class="secondary">This isn't me</button>
  <p class="muted">Not you? <a href="#" id="switch">Use a different account</a></p>
</section>

<section id="done" class="hidden"><h1>You're signed in</h1><p>Go back to Quire. You can close this tab.</p></section>
<section id="denied" class="hidden"><h1>Sign-in cancelled</h1><p>Nothing was signed in. You can close this tab.</p></section>
<div class="error" id="error" role="alert"></div>
</main>
<script>
const api = (path, body) => fetch("/api/auth" + path, {
  method: body ? "POST" : "GET", credentials: "include",
  headers: body ? { "Content-Type": "application/json" } : {},
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => { const data = await r.json().catch(() => null); if (!r.ok) throw new Error((data && (data.message || data.error_description || data.error)) || "Something went wrong"); return data; });

let userCode = ${JSON.stringify(code)};
const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll("main > section")) s.classList.toggle("hidden", s.id !== id); $("error").textContent = ""; };
const fail = (e) => { $("error").textContent = e.message || String(e); };
const busy = (btn, on) => { btn.disabled = on; };

async function route() {
  if (!userCode) return show("enter-code");
  try { await api("/device?user_code=" + encodeURIComponent(userCode)); }
  catch (e) { show("enter-code"); return fail(new Error("That code is invalid or has expired. Start again from the app.")); }
  const session = await api("/get-session").catch(() => null);
  if (!session || !session.user) return show("sign-in");
  $("who").textContent = session.user.email;
  $("shown-code").textContent = userCode;
  show("approve");
}

$("code-form").onsubmit = (e) => { e.preventDefault(); userCode = $("code").value.trim().toUpperCase(); history.replaceState(null, "", "?user_code=" + encodeURIComponent(userCode)); route(); };

const google = $("google");
if (google) google.onclick = async () => {
  try { const r = await api("/sign-in/social", { provider: "google", callbackURL: location.href }); location.href = r.url; } catch (e) { fail(e); }
};

$("email-form").onsubmit = async (e) => {
  e.preventDefault(); const btn = e.submitter; busy(btn, true);
  try {
    await api("/email-otp/send-verification-otp", { email: $("email").value.trim(), type: "sign-in" });
    $("otp-hint").textContent = "We sent a code to " + $("email").value.trim() + ".";
    $("email-form").classList.add("hidden"); $("otp-form").classList.remove("hidden"); $("otp").focus();
  } catch (err) { fail(err); } finally { busy(btn, false); }
};

$("otp-form").onsubmit = async (e) => {
  e.preventDefault(); const btn = e.submitter; busy(btn, true);
  try { await api("/sign-in/email-otp", { email: $("email").value.trim(), otp: $("otp").value.trim() }); await route(); }
  catch (err) { fail(err); } finally { busy(btn, false); }
};

$("approve-btn").onclick = async (e) => {
  busy(e.target, true);
  try { await api("/device/approve", { userCode }); show("done"); } catch (err) { fail(err); busy(e.target, false); }
};
$("deny-btn").onclick = async () => { try { await api("/device/deny", { userCode }); show("denied"); } catch (err) { fail(err); } };
$("switch").onclick = async (e) => { e.preventDefault(); await api("/sign-out", {}).catch(() => {}); show("sign-in"); };

route().catch(fail);
</script></body></html>`;
}
