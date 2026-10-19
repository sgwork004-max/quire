const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
:root{--bg:#f6f7f8;--surface:#fff;--text:#14171c;--text-2:#4f5560;--text-3:#6b7280;--border:rgb(20 23 28/.1);
--accent:#3d5588;--accent-hover:#33487a;--accent-soft:rgb(61 85 136/.12);--danger:#c8372d;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#15171b;--surface:#22252b;--text:#eceef1;--text-2:#a9afb9;--text-3:#868d99;
--border:rgb(236 238 241/.1);--accent:#7f9ade;--accent-hover:#97aee6;--accent-soft:rgb(127 154 222/.18);--danger:#ff6b5b;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:16px}
.card{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;
box-shadow:0 1px 2px rgb(0 0 0/.04),0 12px 40px -12px rgb(0 0 0/.12)}
.logo{width:40px;height:40px;margin-bottom:16px;display:block}
h1{font-size:19px;letter-spacing:-.01em;margin:0 0 4px}p{color:var(--text-2);margin:0 0 20px}
label{display:block;font-size:12px;color:var(--text-2);margin-bottom:6px}
input{width:100%;height:40px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);
padding:0 12px;font:inherit;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
button{width:100%;height:40px;border-radius:10px;border:0;font:inherit;font-weight:600;cursor:pointer;margin-top:12px}
.primary{background:var(--accent);color:#fff}.primary:hover{background:var(--accent-hover)}
@media (prefers-color-scheme:dark){.primary{color:#0b1020}}
.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}.secondary:hover{background:var(--accent-soft)}
button:disabled{opacity:.6;cursor:default}
.code{font:600 26px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.12em;text-align:center;padding:16px;
border-radius:12px;background:var(--bg);border:1px dashed var(--border);margin:4px 0 8px}
.or{display:flex;align-items:center;gap:10px;color:var(--text-3);font-size:12px;margin:16px 0 4px}
.or:before,.or:after{content:"";flex:1;height:1px;background:var(--border)}
.error{color:var(--danger);font-size:13px;margin-top:12px;min-height:1px}.muted{color:var(--text-3);font-size:12px;margin-top:16px}
.hidden{display:none}a{color:var(--accent)}
.doc{display:block;max-width:680px;place-self:start center;padding:48px 8px 64px}.doc h1{font-size:30px;letter-spacing:-.02em;margin:0 0 8px}
.doc h2{font-size:16px;margin:28px 0 6px}.doc p,.doc li{color:var(--text-2);margin:0 0 10px}.doc ul{padding-left:20px;margin:0 0 10px}
.doc .lede{font-size:17px;color:var(--text);margin-bottom:24px}.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;
font-weight:600;padding:10px 16px;border-radius:10px;margin:4px 8px 4px 0}.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--border)}
pre{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;overflow-x:auto;font-size:12.5px}
footer{margin-top:40px;font-size:12px;color:var(--text-3)}
`;

/** The Quire mark: a grey-stock q printed slightly off register over sunflower, on federal blue. */
const Q = "M359 685L359 556Q359 528 361.5 497.5Q364 467 368 434.5Q372 402 377 369L368 369Q359 431 336 471.5Q313 512 277.5 532.5Q242 553 195 553Q140 553 95.5 523Q51 493 25.5 431.5Q0 370 0 274Q0 184 23.5 123Q47 62 91 31Q135 0 197 0Q245 0 279.5 19Q314 38 337 78Q360 118 371 179L377 179L375 14L503 14L503 209L503 685ZM247 433Q266 433 283 426Q300 419 314 406Q328 393 338 374.5Q348 356 354 333Q360 310 360 282L360 276Q360 240 351.5 212Q343 184 328 164.5Q313 145 292.5 134.5Q272 124 248 124Q215 124 192 144.5Q169 165 157.5 200Q146 235 146 279Q146 321 157 356.5Q168 392 190.5 412.5Q213 433 247 433Z";
const LOGO = `<svg class="logo" viewBox="0 0 1000 1000" aria-hidden="true"><rect width="1000" height="1000" rx="225" fill="#3d5588"/>
<path d="${Q}" fill="#ffb511" transform="translate(278 211) scale(0.92)"/><path d="${Q}" fill="#eef0f3" transform="translate(259 196) scale(0.92)"/></svg>`;

const REPO = "https://github.com/sgwork004-max/quire";
/** Where users reach a person: data requests, abuse reports, grievances. */
export const CONTACT = "sg.work004+quire@gmail.com";
const mail = (subject: string, label = CONTACT) => `<a href="mailto:${CONTACT}?subject=${encodeURIComponent(subject)}">${label}</a>`;
const NOT_AFFILIATED =
  "Quire is an independent open-source project, not affiliated with or endorsed by OpenAI, Anthropic, Google, Microsoft or Anysphere. ChatGPT, Claude, Gemini, Copilot and Cursor are trademarks of their owners.";

function docPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${STYLE}</style></head><body><main class="doc">${LOGO}${body}
<footer><a href="/">Quire</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="${REPO}">Source code</a> · ${mail("Quire", "Contact")} · ${mail("Report abuse on Quire", "Report abuse")}<br><br>${NOT_AFFILIATED}</footer></main></body></html>`;
}

/** Public home page (also the app's home page for Google sign-in). */
export function homePage(): string {
  return docPage(
    "Quire: a home for your HTML",
    `<h1>Quire</h1>
<p class="lede">A free, open-source Mac and Windows app to view, organise, edit and share HTML files, like the dashboards, reports and pages AI tools make for you.</p>
<a class="btn" href="https://getquire.pages.dev">Visit the Quire website</a><a class="btn ghost" href="${REPO}/releases/latest">Download</a>
<h2>Install on a Mac</h2>
<p>Open Terminal and paste:</p>
<pre>curl -fsSL https://getquire.pages.dev/install.sh | sh</pre>
<h2>Private by default</h2>
<p>Your files stay on your computer. Only files you choose to share are uploaded, so the people you invite can view, comment on or edit them with you. <a href="/privacy">Privacy policy</a>.</p>`,
  );
}

/** Privacy policy. Keep it true to what the code does. */
export function privacyPage(): string {
  return docPage(
    "Quire privacy policy",
    `<h1>Privacy policy</h1>
<p>Last updated 19 October 2026.</p>
<p class="lede">Quire works on your computer. Nothing leaves it unless you sign in and share a file.</p>
<h2>Files on your computer</h2>
<p>The HTML files in your Quire library, your folders, tags and version history stay on your computer. Quire only reads the folders and files you choose to import, and does not upload them, scan them for us, or send them anywhere.</p>
<h2>When you sign in</h2>
<p>Signing in with Google is only needed to share and comment. We receive and store your name, email address and profile picture, and keep a session so you stay signed in. We do not get access to your Google account, email, contacts or files.</p>
<h2>When you share a file</h2>
<ul>
<li>We store the shared file, the images and other files it uses, its earlier versions, the comments on it, and the email addresses and roles of the people you invite.</li>
<li>Only you and the people you invite can open it.</li>
<li>When you stop sharing a file, we delete it and its data from our servers.</li>
</ul>
<h2>Why we use your data</h2>
<p>Only to run Quire Cloud for you: to sign you in, store what you share, show it to the people you invited, and send comment notifications inside the app. You consent to this by signing in; you can withdraw it at any time by deleting your account.</p>
<h2>Where it is stored</h2>
<p>Quire Cloud runs on Cloudflare (Workers, D1 and R2), which processes data for us on servers that may be outside your country. Data is encrypted in transit.</p>
<h2>What we don't do</h2>
<p>No ads, no tracking, no analytics, and we never sell or rent your data. We don't send you marketing email.</p>
<h2>Your rights</h2>
<p>You can ask to see, correct or delete your data, or to delete your account, by emailing ${mail("Quire data request")}. We reply within 7 days and complete deletion within 30 days. Stopping sharing on a file deletes that file from our servers straight away.</p>
<h2>Age</h2>
<p>Quire Cloud is for people aged 18 and over.</p>
<h2>If something goes wrong</h2>
<p>If a security incident affects your data, we will tell you by email, and the relevant authorities where the law requires it, as soon as we can.</p>
<h2>Grievance officer</h2>
<p>Shardul Gupta, ${mail("Quire grievance")}. Complaints are acknowledged within 24 hours and resolved within 15 days.</p>
<h2>Changes</h2>
<p>If this policy changes, we update this page and the date above. Quire is open source, so you can read exactly what the app and the cloud do.</p>`,
  );
}

/** Terms of Service. Plain language; keep in step with what the product does. */
export function termsPage(): string {
  return docPage(
    "Quire terms of service",
    `<h1>Terms of service</h1>
<p>Last updated 19 October 2026.</p>
<p class="lede">Quire is free, open-source software. These terms cover the Quire apps and Quire Cloud, the service that lets you share files with other people.</p>
<h2>Using Quire</h2>
<p>You can use the Quire apps freely under their open-source licence (AGPL-3.0). To use Quire Cloud you need a Google account and must be 18 or older. Keep your account to yourself; you're responsible for what happens under it.</p>
<h2>Your content is yours</h2>
<p>You own the files you put in Quire and share through it. By sharing a file you let us store it and show it to the people you invited, only to run the service. We don't claim any other rights to it.</p>
<h2>What you must not share</h2>
<ul>
<li>Phishing pages, fake login or payment forms, malware, or anything designed to trick or harm people.</li>
<li>Content that is illegal, infringes someone else's rights, or that you don't have permission to share.</li>
<li>Content that harasses, threatens or exploits anyone, or sexual content involving minors.</li>
<li>Anything that attacks, overloads or tries to get around the limits or security of Quire Cloud.</li>
</ul>
<p>We may remove content or suspend accounts that break these rules, and we cooperate with valid legal requests. Report abuse to ${mail("Report abuse on Quire")}.</p>
<h2>Limits and changes</h2>
<p>Quire Cloud is free with limits (currently 25 MB of shared files per account) that may change. We may change or stop the service; if we stop it, we'll give notice so you can keep your files. Your files on your computer are never affected.</p>
<h2>No warranty</h2>
<p>Quire is provided “as is”, without warranties of any kind. Keep your own copies of anything important. To the extent the law allows, we aren't liable for lost data, lost profits or indirect damages, and our total liability is limited to ₹1,000 (about US$12).</p>
<h2>Ending</h2>
<p>You can stop using Quire and delete your account at any time by emailing ${mail("Delete my Quire account")}. We may end accounts that break these terms.</p>
<h2>Law and contact</h2>
<p>These terms are governed by the laws of India. Questions or complaints: ${mail("Quire terms")}. Grievance officer: Shardul Gupta, same address.</p>
<h2>Other services</h2>
<p>${NOT_AFFILIATED}</p>`,
  );
}

/**
 * The page the desktop app opens to finish signing in. It signs the person in
 * (Google or an emailed code) and then asks them to approve the code shown in
 * the app. Approving creates the session the app receives.
 */
export function devicePage(opts: { userCode: string; google: boolean; email: boolean }): string {
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
  ${opts.google ? `<button id="google" class="${opts.email ? "secondary" : "primary"}">Continue with Google</button>` : ""}
  <p class="muted">By continuing you agree to Quire's <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy policy</a>. Quire Cloud is for people 18 and over.</p>
  ${opts.google && opts.email ? `<div class="or">or</div>` : ""}
  ${!opts.google && !opts.email ? `<p>Sign-in isn't set up on this server yet.</p>` : ""}
  <form id="email-form" class="${opts.email ? "" : "hidden"}"><label for="email">Email</label><input id="email" type="email" autocomplete="email" placeholder="you@company.com" required>
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
