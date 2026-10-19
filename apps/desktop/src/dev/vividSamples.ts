// Dev-only: a bolder sample library for promo recordings (`?demo=vivid`).
// Shaped like the HTML people get from AI tools: dashboards, itineraries,
// landing pages, trackers.

const page = (body: string, bg = "#fff", color = "#111827") =>
  `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,system-ui,sans-serif;background:${bg};color:${color}}@keyframes draw{from{stroke-dashoffset:1200}}@keyframes rise{from{transform:scaleY(0)}}@keyframes pop{from{opacity:0;transform:translateY(8px)}}</style><body>${body}</body>`;
export const asDataUrl = (html: string) => "data:text/html;charset=utf-8," + encodeURIComponent(html + "<!--");

const area = (pts: number[], w = 760, h = 200, c1 = "#a855f7", c2 = "#22d3ee") => {
  const step = w / (pts.length - 1);
  const xy = pts.map((p, i) => `${(i * step).toFixed(1)},${(h - (p / 100) * h).toFixed(1)}`);
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}" stop-opacity=".55"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></linearGradient><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><polygon points="0,${h} ${xy.join(" ")} ${w},${h}" fill="url(#f)"/><polyline points="${xy.join(" ")}" fill="none" stroke="url(#s)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1200" style="animation:draw 2.4s ease-out both"/></svg>`;
};

const kpi = (label: string, value: string, delta: string, grad: string) =>
  `<div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:18px 20px;animation:pop .6s both"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.6">${label}</div><div style="font-size:34px;font-weight:800;margin-top:6px;background:${grad};-webkit-background-clip:text;color:transparent">${value}</div><div style="font-size:13px;color:#4ade80;margin-top:2px">${delta}</div></div>`;

/** The hero dashboard. `extra` adds the section Claude is asked for in the promo. */
export function launchDashboard(extra = false) {
  const bars = [38, 52, 47, 66, 74, 69, 88, 95];
  return page(
    `<div style="padding:34px 40px;min-height:100vh;background:radial-gradient(1200px 500px at 85% -10%,rgba(168,85,247,.45),transparent),radial-gradient(900px 500px at -10% 110%,rgba(34,211,238,.3),transparent),#0b0b1a">
<div style="display:flex;align-items:center;justify-content:space-between"><div><div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#c4b5fd">Nova · Launch week</div><h1 style="margin:4px 0 0;font-size:40px;letter-spacing:-.02em">Launch dashboard</h1></div><span style="background:linear-gradient(90deg,#f472b6,#a855f7);padding:8px 16px;border-radius:999px;font-weight:700;font-size:13px">● LIVE</span></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:26px 0">${kpi("Signups", "48,210", "+212% vs last week", "linear-gradient(90deg,#f472b6,#c084fc)")}${kpi("Revenue", "$182k", "+64%", "linear-gradient(90deg,#22d3ee,#818cf8)")}${kpi("Activation", "71%", "+9 pts", "linear-gradient(90deg,#a3e635,#22d3ee)")}${kpi("NPS", "68", "+12", "linear-gradient(90deg,#fbbf24,#f472b6)")}</div>
<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
<div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:20px 22px"><div style="display:flex;justify-content:space-between;margin-bottom:10px"><b style="font-size:16px">Signups per hour</b><span style="opacity:.55;font-size:13px">Mon → Sun</span></div>${area([12, 18, 15, 30, 26, 44, 40, 58, 52, 70, 66, 84, 79, 96])}</div>
<div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:20px 22px"><b style="font-size:16px">Channels</b><div style="display:flex;align-items:flex-end;gap:12px;height:200px;margin-top:14px">${bars.map((b, i) => `<span style="flex:1;height:${b}%;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,${["#f472b6", "#c084fc", "#818cf8", "#22d3ee", "#34d399", "#a3e635", "#fbbf24", "#fb923c"][i]},rgba(255,255,255,.08));transform-origin:bottom;animation:rise .9s ${i * 0.06}s cubic-bezier(.2,.8,.2,1) both"></span>`).join("")}</div></div>
</div>
${extra ? `<div style="margin-top:16px;background:rgba(255,255,255,.05);border:1px solid rgba(251,191,36,.5);border-radius:20px;padding:20px 22px"><div style="display:flex;justify-content:space-between;margin-bottom:10px"><b style="font-size:16px">Churn by cohort</b><span style="color:#fbbf24;font-size:13px">New</span></div><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">${[92, 81, 74, 69, 66, 64].map((v, i) => `<div style="border-radius:12px;padding:14px;background:rgba(251,191,36,${(0.15 + i * 0.1).toFixed(2)});font-weight:700;font-size:18px">${v}%<div style="font-weight:400;font-size:12px;opacity:.7">Week ${i + 1}</div></div>`).join("")}</div></div>` : ""}
</div>`,
    "#0b0b1a",
    "#f5f3ff",
  );
}

const tokyo = page(`<div style="min-height:100vh;background:#fff7ed"><div style="padding:56px 48px 40px;background:linear-gradient(135deg,#f43f5e,#fb923c 55%,#facc15);color:#fff"><div style="font-weight:700;letter-spacing:.14em;font-size:13px">ITINERARY · 7 DAYS</div><h1 style="font-size:54px;line-height:1;margin:10px 0 8px;letter-spacing:-.03em">Tokyo, slowly.</h1><div style="font-size:17px;opacity:.9">Ramen, record shops and one very early fish market.</div></div><div style="padding:28px 48px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${[
  ["Day 1", "Shibuya & Shimokita", "#f43f5e"],
  ["Day 2", "Tsukiji at 6am", "#fb923c"],
  ["Day 3", "Nakameguro walk", "#eab308"],
  ["Day 4", "Day trip: Kamakura", "#22c55e"],
  ["Day 5", "Akihabara + Yanaka", "#06b6d4"],
  ["Day 6", "Onsen in Hakone", "#8b5cf6"],
].map(([d, t, c]) => `<div style="background:#fff;border-radius:16px;padding:16px 18px;box-shadow:0 6px 20px -10px rgba(0,0,0,.25);border-top:6px solid ${c}"><div style="font-weight:800;color:${c}">${d}</div><div style="font-size:17px;font-weight:600;margin-top:4px">${t}</div></div>`).join("")}</div></div>`);

const landing = page(`<div style="min-height:100vh;padding:40px 56px;background:radial-gradient(800px 500px at 80% 10%,#fde047,transparent),radial-gradient(900px 600px at 10% 90%,#f472b6,transparent),linear-gradient(135deg,#7c3aed,#db2777)"><div style="display:flex;justify-content:space-between;color:#fff;font-weight:700"><span>✦ Brightloop</span><span style="opacity:.85;font-weight:500">Pricing · Docs · Sign in</span></div><h1 style="color:#fff;font-size:72px;line-height:.98;letter-spacing:-.04em;margin:70px 0 18px;max-width:760px">Payroll that runs itself.</h1><p style="color:#fff;opacity:.9;font-size:20px;max-width:540px">Pay your whole team in two clicks. Taxes and compliance handled.</p><span style="display:inline-block;margin-top:22px;background:#111827;color:#fff;padding:15px 26px;border-radius:14px;font-weight:700;font-size:16px">Start free trial →</span></div>`);

const habits = (() => {
  const cells = Array.from({ length: 7 * 26 }, (_, i) => {
    const v = (Math.sin(i * 1.7) + Math.cos(i * 0.37) + 2) / 4;
    const c = ["#ecfccb", "#a3e635", "#22c55e", "#15803d", "#14532d"][Math.min(4, Math.floor(v * 5))];
    return `<i style="display:block;aspect-ratio:1;border-radius:4px;background:${c}"></i>`;
  }).join("");
  return page(`<div style="padding:40px 44px"><div style="display:flex;justify-content:space-between;align-items:end"><div><div style="font-weight:700;color:#16a34a;letter-spacing:.1em;font-size:13px">2026</div><h1 style="margin:4px 0 0;font-size:38px;letter-spacing:-.02em">Habit tracker</h1></div><div style="display:flex;gap:10px">${["🏃 Run", "📚 Read", "🧘 Breathe"].map((t, i) => `<span style="padding:8px 14px;border-radius:999px;background:${["#dcfce7", "#e0f2fe", "#fae8ff"][i]};font-weight:600">${t}</span>`).join("")}</div></div><div style="display:grid;grid-template-columns:repeat(26,1fr);grid-auto-flow:column;grid-template-rows:repeat(7,1fr);gap:5px;margin-top:28px">${cells}</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px">${[["Longest streak", "41 days"], ["This month", "26 / 31"], ["Best habit", "Read"]].map(([l, v]) => `<div style="border-radius:16px;padding:16px 18px;background:#f0fdf4"><div style="opacity:.6;font-size:13px">${l}</div><div style="font-size:26px;font-weight:800">${v}</div></div>`).join("")}</div></div>`, "#ffffff");
})();

const board = page(`<div style="padding:48px 60px;background:#fffbeb;min-height:100vh;font-family:Georgia,serif"><div style="font:700 12px system-ui;letter-spacing:.14em;color:#c2410c">Q3 2026 · BOARD REPORT</div><h1 style="font-size:46px;line-height:1.05;margin:10px 0 14px;letter-spacing:-.02em">Growth up 24%.<br><span style="color:#c2410c">Costs down twice.</span></h1><div style="display:flex;align-items:flex-end;gap:14px;height:170px;margin-top:26px;font-family:system-ui">${[
  ["Q4", 40, "#fed7aa"],
  ["Q1", 52, "#fdba74"],
  ["Q2", 63, "#fb923c"],
  ["Q3", 88, "#ea580c"],
].map(([q, h, c]) => `<div style="flex:1;height:100%;text-align:center;display:flex;flex-direction:column;justify-content:flex-end"><div style="height:${h}%;background:${c};border-radius:10px 10px 4px 4px;transform-origin:bottom;animation:rise 1s both"></div><div style="font-weight:700;margin-top:6px">${q}</div></div>`).join("")}</div></div>`);

const pricing = page(`<div style="padding:44px;text-align:center;background:#f8fafc;min-height:100vh"><h1 style="font-size:40px;letter-spacing:-.03em;margin:0 0 6px">Simple pricing</h1><div style="opacity:.6;margin-bottom:28px">Cancel anytime.</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;align-items:center">${[
  ["Starter", "$0", "#fff", "#111827"],
  ["Team", "$12", "linear-gradient(160deg,#6366f1,#a855f7 60%,#ec4899)", "#fff"],
  ["Business", "$39", "#fff", "#111827"],
].map(([n, p, bg, c], i) => `<div style="background:${bg};color:${c};border-radius:22px;padding:${i === 1 ? "38px 24px" : "26px 24px"};box-shadow:0 20px 40px -20px rgba(79,70,229,${i === 1 ? ".7" : ".2"})"><div style="font-weight:700">${n}</div><div style="font-size:46px;font-weight:800;margin:8px 0">${p}</div><div style="opacity:.7;font-size:13px">per user / month</div></div>`).join("")}</div></div>`);

const roadmap = page(`<div style="padding:36px 40px;background:#0f172a;min-height:100vh;color:#e2e8f0"><h1 style="margin:0 0 22px;font-size:34px;letter-spacing:-.02em">Roadmap 2027</h1>${[
  ["Mobile app", 0, 38, "#f472b6"],
  ["Team spaces", 18, 34, "#a78bfa"],
  ["Offline sync", 30, 30, "#38bdf8"],
  ["Integrations", 46, 36, "#34d399"],
  ["AI assistant", 60, 34, "#fbbf24"],
  ["Analytics", 72, 26, "#fb7185"],
].map(([t, l, w, c]) => `<div style="display:flex;align-items:center;gap:14px;margin:14px 0"><span style="width:130px;font-weight:600">${t}</span><div style="flex:1;position:relative;height:28px"><span style="position:absolute;left:${l}%;width:${w}%;height:100%;border-radius:999px;background:linear-gradient(90deg,${c},${c}99);box-shadow:0 0 24px -4px ${c}"></span></div></div>`).join("")}</div>`);

const stores = page(`<div style="padding:34px 40px;background:linear-gradient(180deg,#eef2ff,#fff 60%);min-height:100vh"><h1 style="margin:0;font-size:34px;letter-spacing:-.02em">Pune stores · October</h1><div style="opacity:.6">Revenue, orders and footfall across 6 stores</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:22px 0">${[
  ["Revenue", "₹42.6 L", "#4f46e5"],
  ["Orders", "1,284", "#0891b2"],
  ["Footfall", "18.2k", "#db2777"],
].map(([l, v, c]) => `<div style="border-radius:16px;padding:16px 18px;background:#fff;box-shadow:0 10px 30px -18px ${c}"><div style="opacity:.6;font-size:13px">${l}</div><div style="font-size:30px;font-weight:800;color:${c}">${v}</div></div>`).join("")}</div><div style="display:flex;align-items:flex-end;gap:10px;height:170px">${[42, 61, 55, 78, 70, 92, 66, 74, 88, 95].map((h, i) => `<span style="flex:1;height:${h}%;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,${i % 2 ? "#818cf8" : "#4f46e5"},#c7d2fe)"></span>`).join("")}</div></div>`);

export const VIVID: [string, string][] = [
  ["Launch dashboard", asDataUrl(launchDashboard())],
  ["Tokyo in 7 days", asDataUrl(tokyo)],
  ["Brightloop landing page", asDataUrl(landing)],
  ["Habit tracker 2026", asDataUrl(habits)],
  ["Q3 board report", asDataUrl(board)],
  ["Pricing experiments", asDataUrl(pricing)],
  ["Roadmap 2027", asDataUrl(roadmap)],
  ["Pune stores — October", asDataUrl(stores)],
];
