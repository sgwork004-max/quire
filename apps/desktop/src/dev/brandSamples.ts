// Dev-only: an on-brand sample library for marketing captures (`?demo=brand`).
// Quire's palette: ink, cool greys, paper, federal blue, sunflower. Calm, print-like.

const INK = "#14171c";
const INK2 = "#4f5560";
const INK3 = "#8a909b";
const LINE = "#e3e5e9";
const PAPER = "#f7f5f0";
const BLUE = "#3d5588";
const BLUE_SOFT = "#e4e9f3";
const SUN = "#ffb511";
const SUN_SOFT = "#fff3d6";

const page = (body: string, bg = "#fff") =>
  `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,"Helvetica Neue",system-ui,sans-serif;background:${bg};color:${INK};-webkit-font-smoothing:antialiased}.k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${INK3};font-weight:600}.serif{font-family:"Iowan Old Style",Georgia,serif}h1,h2{letter-spacing:-.025em}</style><body>${body}</body>`;
const url = (html: string) => "data:text/html;charset=utf-8," + encodeURIComponent(html + "<!--");

const line = (pts: number[], w = 560, h = 150) => {
  const step = w / (pts.length - 1);
  const xy = pts.map((p, i) => `${(i * step).toFixed(1)},${(h - 10 - (p / 100) * (h - 20)).toFixed(1)}`);
  const last = xy[xy.length - 1].split(",");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${[0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${w}" y1="${h * g}" y2="${h * g}" stroke="${LINE}"/>`).join("")}<polygon points="0,${h} ${xy.join(" ")} ${w},${h}" fill="${BLUE}" opacity=".08"/><polyline points="${xy.join(" ")}" fill="none" stroke="${BLUE}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="6" fill="${SUN}" stroke="#fff" stroke-width="2.5"/></svg>`;
};

const bars = (vals: number[], labels: string[], h = 150, hi = vals.length - 1) =>
  `<div style="display:flex;align-items:flex-end;gap:10px;height:${h}px;border-bottom:1px solid ${LINE}">${vals.map((v, i) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%"><div style="height:${v}%;background:${i === hi ? SUN : BLUE};border-radius:4px 4px 0 0"></div></div>`).join("")}</div><div style="display:flex;gap:10px;margin-top:6px">${labels.map((l) => `<span style="flex:1;text-align:center;font-size:11px;color:${INK3}">${l}</span>`).join("")}</div>`;

const kpi = (label: string, value: string, delta: string, up = true) =>
  `<div style="padding:16px 18px;border:1px solid ${LINE};border-radius:12px;background:#fff"><div class="k">${label}</div><div style="font-size:28px;font-weight:700;letter-spacing:-.02em;margin-top:6px">${value}</div><div style="font-size:12.5px;color:${up ? BLUE : "#b4532a"};font-weight:600">${delta}</div></div>`;

const td = (x: string, b = false) => `<td style="padding:9px 0;border-bottom:1px solid ${LINE};${b ? "font-weight:600" : `color:${INK2}`}">${x}</td>`;

/** The hero report used in most captures. */
export const growthReview = page(`<div style="padding:36px 44px;background:${PAPER};min-height:100vh">
<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div class="k">Northwind · Quarterly review</div><h1 style="margin:6px 0 4px;font-size:36px">Q3 growth review</h1><div style="color:${INK2}">Revenue, retention and the three bets for Q4.</div></div><span style="background:${SUN_SOFT};color:#7a5200;font-weight:600;font-size:12px;padding:6px 12px;border-radius:999px">Final · 14 Oct</span></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0">${kpi("Revenue", "₹4.82 Cr", "+24% vs Q2")}${kpi("Gross margin", "61%", "+3.2 pts")}${kpi("Net retention", "118%", "+6 pts")}${kpi("Burn", "₹38 L/mo", "−11%")}</div>
<div style="display:grid;grid-template-columns:1.55fr 1fr;gap:12px">
<div style="background:#fff;border:1px solid ${LINE};border-radius:12px;padding:16px 18px"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><b>Monthly revenue</b><span style="font-size:12px;color:${INK3}">Jan → Sep</span></div>${line([18, 24, 22, 35, 41, 46, 58, 66, 79])}</div>
<div style="background:#fff;border:1px solid ${LINE};border-radius:12px;padding:16px 18px"><b>Revenue by city</b><div style="margin-top:12px">${bars([72, 58, 44, 36, 88], ["Pune", "Mumbai", "Delhi", "Blr", "New"], 120)}</div></div>
</div>
<table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:13px"><tr>${["Bet for Q4", "Owner", "Target"].map((h) => `<th style="text-align:left;padding:8px 0;border-bottom:1.5px solid ${INK};font-size:11px;letter-spacing:.08em;text-transform:uppercase">${h}</th>`).join("")}</tr>
<tr>${td("Two new cities", true)}${td("Priya")}${td("₹60 L revenue")}</tr><tr>${td("Annual plans", true)}${td("Arjun")}${td("30% of new revenue")}</tr><tr>${td("Self-serve onboarding", true)}${td("Meera")}${td("Activation 70%")}</tr></table>
</div>`);

const stores = page(`<div style="padding:34px 40px"><div class="k">Retail · October</div><h1 style="margin:6px 0 18px;font-size:32px">Pune stores</h1>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">${kpi("Revenue", "₹42.6 L", "+12% vs Sep")}${kpi("Orders", "1,284", "+8%")}${kpi("Footfall", "18.2k", "+15%")}</div>
${bars([42, 61, 55, 78, 70, 92], ["KP", "Baner", "Viman", "Aundh", "Kothrud", "Hinjewadi"], 140, 5)}</div>`);

const memo = page(`<div style="padding:48px 64px;max-width:860px" class="serif"><div class="k" style="font-family:system-ui">Board memo · Q3</div><h1 style="font-size:40px;line-height:1.08;margin:12px 0 16px">We grew 24% and spent less doing it.</h1>
<p style="font-size:17px;color:${INK2};line-height:1.6">Three decisions made the quarter: we stopped paid search in two cities, moved onboarding in-house, and priced annual plans for the first time.</p>
<p style="font-size:22px;line-height:1.4;margin:26px 0;padding-left:18px;border-left:4px solid ${SUN}">“Annual plans now bring in a third of new <span style="background:${SUN_SOFT}">revenue</span>.”</p>
<p style="font-size:17px;color:${INK2};line-height:1.6">For Q4 we ask the board to approve two new cities and a hiring plan of six.</p></div>`);

const roadmap = page(`<div style="padding:34px 40px;background:${PAPER};min-height:100vh"><div class="k">Product</div><h1 style="margin:6px 0 22px;font-size:32px">Launch plan</h1>
${[
  ["Private beta", 0, 26],
  ["Pricing page", 18, 22],
  ["Annual plans", 30, 30],
  ["Self-serve onboarding", 44, 34],
  ["Two new cities", 62, 34],
].map(([t, l, w], i) => `<div style="display:flex;align-items:center;gap:14px;margin:13px 0"><span style="width:170px;font-weight:600">${t}</span><div style="flex:1;position:relative;height:24px;background:#fff;border:1px solid ${LINE};border-radius:6px"><span style="position:absolute;left:${l}%;width:${w}%;top:3px;bottom:3px;border-radius:4px;background:${i === 2 ? SUN : BLUE}"></span></div></div>`).join("")}</div>`);

const pricing = page(`<div style="padding:44px 52px;text-align:center"><div class="k">Pricing</div><h1 style="font-size:40px;margin:10px 0 6px">Simple, <span style="background:linear-gradient(transparent 62%,${SUN} 62%,${SUN} 90%,transparent 90%)">honest</span> pricing</h1><div style="color:${INK2};margin-bottom:28px">Cancel any time.</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:left">${[
  ["Starter", "₹0", false],
  ["Team", "₹499", true],
  ["Business", "₹1,499", false],
].map(([n, p, hi]) => `<div style="border:${hi ? `2px solid ${BLUE}` : `1px solid ${LINE}`};border-radius:14px;padding:22px;background:${hi ? BLUE_SOFT : "#fff"}"><b>${n}</b><div style="font-size:34px;font-weight:700;margin:8px 0">${p}</div><div style="font-size:12px;color:${INK3}">per user / month</div><div style="margin-top:16px;background:${hi ? BLUE : INK};color:#fff;text-align:center;padding:10px;border-radius:9px;font-weight:600">Choose ${n}</div></div>`).join("")}</div></div>`);

const offsite = page(`<div style="min-height:100vh;background:${PAPER}"><div style="padding:40px 44px 28px;background:${BLUE};color:#fff"><div class="k" style="color:#c9d3ea">Team offsite · 3 days</div><h1 style="font-size:40px;margin:8px 0 4px">Goa, slowly.</h1><div style="opacity:.85">Planning in the mornings, the sea after lunch.</div></div>
<div style="padding:24px 44px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px">${[
  ["Day 1", "Arrive · Q4 kick-off", "Beach dinner"],
  ["Day 2", "Bets workshop", "Kayaking"],
  ["Day 3", "Plans & owners", "Fly home"],
].map(([d, a, b]) => `<div style="background:#fff;border:1px solid ${LINE};border-radius:12px;padding:16px"><div style="font-weight:700;color:${BLUE}">${d}</div><div style="margin-top:8px">${a}</div><div style="color:${INK2}">${b}</div><div style="margin-top:12px;height:4px;border-radius:2px;background:${SUN};width:40%"></div></div>`).join("")}</div></div>`);

const hiring = page(`<div style="padding:32px 36px"><div class="k">People</div><h1 style="margin:6px 0 18px;font-size:30px">Hiring tracker</h1><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${[
  ["Applied", ["Design lead", "Data analyst", "Support"]],
  ["Interview", ["Backend engineer", "Growth PM"]],
  ["Offer", ["iOS engineer"]],
  ["Joined", ["Ops manager", "Sales lead"]],
].map(([c, items]) => `<div style="background:${PAPER};border-radius:12px;padding:12px"><div class="k" style="margin-bottom:10px">${c} · ${(items as string[]).length}</div>${(items as string[]).map((t) => `<div style="background:#fff;border:1px solid ${LINE};border-radius:9px;padding:10px 12px;margin-bottom:8px;font-weight:600">${t}<div style="height:3px;width:30%;margin-top:8px;border-radius:2px;background:${c === "Offer" ? SUN : BLUE}"></div></div>`).join("")}</div>`).join("")}</div></div>`);

const weekly = page(`<div style="padding:32px 36px;background:${PAPER};min-height:100vh"><div class="k">Every Monday</div><h1 style="margin:6px 0 18px;font-size:30px">Weekly metrics</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${[
  ["Signups", "2,410", [30, 38, 35, 50, 58, 62, 74]],
  ["Revenue", "₹31.2 L", [40, 44, 52, 50, 61, 66, 70]],
  ["Active teams", "812", [55, 57, 60, 62, 66, 69, 73]],
  ["Churn", "1.8%", [60, 54, 50, 46, 44, 40, 38]],
  ["NPS", "54", [40, 42, 47, 49, 50, 53, 54]],
  ["Tickets", "143", [70, 64, 60, 52, 50, 46, 44]],
].map(([l, v, p]) => `<div style="background:#fff;border:1px solid ${LINE};border-radius:12px;padding:14px 16px"><div class="k">${l}</div><div style="font-size:24px;font-weight:700;margin:4px 0 6px">${v}</div>${line(p as number[], 240, 50)}</div>`).join("")}</div></div>`);

export const BRAND: [string, string][] = [
  ["Q3 growth review", url(growthReview)],
  ["Pune stores", url(stores)],
  ["Board memo", url(memo)],
  ["Launch plan", url(roadmap)],
  ["Pricing page", url(pricing)],
  ["Team offsite — Goa", url(offsite)],
  ["Hiring tracker", url(hiring)],
  ["Weekly metrics", url(weekly)],
];
