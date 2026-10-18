// Dev-only: lets the UI render in a plain browser (no Tauri) with sample
// files, so the design can be checked in a browser preview. Never bundled
// into the app: main.tsx imports it only under `import.meta.env.DEV` when
// Tauri's IPC is missing.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = Date.now();
const doc = (body: string, bg = "#fff", color = "#1f2937") =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px/1.5 -apple-system,system-ui,sans-serif;background:${bg};color:${color}">${body}</body><!--`); // the thumbnail's ?t= cache-buster lands in this comment
const bars = (hs: number[], c: string) =>
  `<div style="display:flex;align-items:flex-end;gap:10px;height:170px;border-bottom:1px solid #e5e7eb">${hs.map((h) => `<span style="flex:1;height:${h}%;background:${c};border-radius:4px 4px 0 0"></span>`).join("")}</div>`;
const kpis = (items: [string, string, string][], border = "#e5e7eb") =>
  `<div style="display:grid;grid-template-columns:repeat(${items.length},1fr);gap:14px;margin:18px 0">${items
    .map(([l, v, d]) => `<div style="border:1px solid ${border};border-radius:12px;padding:16px"><div style="font-size:12px;opacity:.6">${l}</div><div style="font-size:26px;font-weight:700;margin-top:4px">${v}</div><div style="font-size:12px;color:#16a34a">${d}</div></div>`)
    .join("")}</div>`;
const rows = (r: string[][]) =>
  `<table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:13px">${r
    .map((c, i) => `<tr>${c.map((x) => `<${i ? "td" : "th"} style="text-align:left;padding:9px 6px;border-bottom:1px solid #e5e7eb">${x}</${i ? "td" : "th"}>`).join("")}</tr>`)
    .join("")}</table>`;

/** Synthetic sample pages, shaped like what AI tools produce. */
const SAMPLES: [string, string][] = [
  ["Pune stores — October", doc(`<div style="padding:32px"><h1 style="margin:0;font-size:28px">Pune stores · October</h1><div style="opacity:.6">Sales, orders and footfall across 6 stores</div>${kpis([["Revenue", "₹42.6 L", "+12% vs Sep"], ["Orders", "1,284", "+8%"], ["Avg basket", "₹3,318", "+4%"], ["Footfall", "18.2k", "+15%"]])}${bars([42, 61, 55, 78, 70, 92, 66, 74, 88, 95], "#6366f1")}${rows([["Store", "Revenue", "Orders", "Growth"], ["Koregaon Park", "₹9.8 L", "302", "+18%"], ["Baner", "₹8.1 L", "251", "+11%"], ["Viman Nagar", "₹7.4 L", "229", "+9%"]])}</div>`)],
  ["Ops command centre", doc(`<div style="padding:32px"><h1 style="margin:0;font-size:28px;color:#fff">Ops command centre</h1><div style="opacity:.6">Live · updated 2 min ago</div>${kpis([["Open tickets", "37", "−9 today"], ["SLA met", "96.4%", "+1.2 pts"], ["Avg resolve", "3h 12m", "−18m"]], "#2a2f3a")}${bars([30, 45, 38, 60, 52, 71, 64, 80, 58, 76], "#22d3ee")}</div>`, "#0f1219", "#e5e7eb")],
  ["Q3 board report", doc(`<div style="padding:48px 64px;font-family:Georgia,serif"><div style="font:600 12px system-ui;letter-spacing:.08em;color:#9a3412">QUARTERLY REPORT</div><h1 style="font-size:36px;margin:8px 0 6px">Q3 2026: steady growth, sharper focus</h1><p style="color:#57534e;font-size:16px">Revenue grew 24% year on year while operating costs fell for the second quarter running. Three priorities carry us into Q4.</p><h2 style="font-size:20px;margin-top:28px">1. Expand to two new cities</h2><p style="color:#57534e">Hyderabad and Ahmedabad pilots exceeded targets by 31%, with payback inside seven months.</p><h2 style="font-size:20px">2. Lift repeat purchase</h2><p style="color:#57534e">Members now account for 58% of revenue, up from 41%.</p></div>`, "#fffdf8")],
  ["Landing page v4", doc(`<div style="padding:40px 56px;background:linear-gradient(180deg,#fff7ed,#fff)"><div style="display:flex;justify-content:space-between;font-weight:600"><span>Brightloop</span><span style="opacity:.6;font-weight:400">Pricing · Docs · Sign in</span></div><h1 style="font-size:52px;line-height:1.05;margin:56px 0 14px;max-width:620px">Payroll that runs itself.</h1><p style="font-size:18px;color:#57534e;max-width:520px">Pay your whole team in two clicks, with taxes and compliance handled for you.</p><span style="display:inline-block;margin-top:18px;background:#ea580c;color:#fff;padding:12px 22px;border-radius:10px;font-weight:600">Start free trial</span></div>`)],
  ["Investor one-pager", doc(`<div style="padding:40px;display:grid;grid-template-columns:1.3fr 1fr;gap:32px"><div><h1 style="margin:0;font-size:30px">Northwind Foods</h1><p style="color:#57534e">Healthy packaged meals for India's metro offices. Seed round · ₹6 Cr.</p><h3>Traction</h3><p style="color:#57534e">42 corporate clients, 9,000 meals a day, 71% gross margin.</p></div><div style="background:#ecfdf5;border-radius:14px;padding:20px">${kpis([["ARR", "₹3.4 Cr", "+3.1×"]], "#a7f3d0")}${bars([20, 34, 48, 66, 90], "#10b981")}</div></div>`)],
  ["Leads pipeline", doc(`<div style="padding:32px"><h1 style="margin:0;font-size:26px">Leads pipeline</h1>${rows([["Company", "Owner", "Stage", "Value"], ["Acme Retail", "Priya", "Proposal", "₹12 L"], ["Bluefin Logistics", "Arjun", "Demo", "₹8 L"], ["Cedar Health", "Meera", "Negotiation", "₹21 L"], ["Delta Steel", "Kabir", "Qualified", "₹5 L"], ["Evergreen Labs", "Priya", "Won", "₹16 L"]])}</div>`)],
  ["Product roadmap 2027", doc(`<div style="padding:32px"><h1 style="margin:0 0 18px;font-size:26px">Product roadmap 2027</h1>${["Mobile app", "Team spaces", "Offline sync", "Integrations", "Analytics"].map((t, i) => `<div style="display:flex;align-items:center;gap:12px;margin:12px 0"><span style="width:120px;font-size:13px">${t}</span><span style="margin-left:${i * 9}%;width:${30 + (i % 3) * 12}%;height:22px;border-radius:6px;background:${["#8b5cf6", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444"][i]}"></span></div>`).join("")}</div>`)],
  ["Pricing experiments", doc(`<div style="padding:32px;text-align:center"><h1 style="font-size:28px;margin:0 0 20px">Simple pricing</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">${["Starter|₹0", "Team|₹499", "Business|₹1,499"].map((p, i) => `<div style="border:${i === 1 ? "2px solid #7c3aed" : "1px solid #e5e7eb"};border-radius:14px;padding:22px"><div style="font-weight:600">${p.split("|")[0]}</div><div style="font-size:30px;font-weight:700;margin:8px 0">${p.split("|")[1]}</div><div style="font-size:12px;opacity:.6">per user / month</div></div>`).join("")}</div></div>`)],
];

const files = SAMPLES.map(([name, url], i) => ({
  id: i + 1,
  path: `/Users/demo/Quire/${name}.html`,
  name: `${name}.html`,
  dir: "/Users/demo/Quire",
  locationId: 1,
  title: name,
  sizeBytes: 24000 + i * 3100,
  modifiedMs: now - i * 3_600_000 * 4 - 120_000,
  openedMs: null,
  starred: i === 2,
  trashedMs: null,
  tagIds: i === 0 || i === 4 ? [1] : i === 2 ? [2] : [],
  folderId: i < 3 ? 1 : null,
  snippet: null,
  url,
}));
const page = (title: string) => files.find((f) => f.title === title)?.url ?? files[0].url;

// ?open=1 opens the first file with collaborators present, for screenshots.
if (new URLSearchParams(location.search).has("open")) {
  window.setTimeout(async () => {
    const { useApp } = await import("../store/app");
    await useApp.getState().openPaths([files[0].path]);
    const id = useApp.getState().activeId;
    useApp.setState((s) => ({
      presence: { ...s.presence, [id]: [{ clientId: 1, name: "Aarav", color: "#ffb511" }, { clientId: 2, name: "Meera", color: "#ff8a3d" }] },
    }));
  }, 600);
}

mockWindows("main");
mockIPC((cmd, args) => {
  const a = args as Record<string, unknown>;
  switch (cmd) {
    case "library_overview":
      return {
        locations: [{ id: 1, path: "/Users/demo/Quire", name: "Quire", count: files.length }],
        folders: [{ id: 1, name: "Clients", count: 3 }, { id: 2, name: "Board meetings", count: 1 }, { id: 3, name: "Experiments", count: 2 }],
        tags: [{ id: 1, name: "Weekly", color: "#c8372d", count: 2 }, { id: 2, name: "Board", color: "#1e9bb0", count: 1 }],
        all: files.length,
        starred: 1,
        recent: 4,
        trash: 0,
        hidden: 0,
      };
    case "library_query":
      return files;
    case "preview_url": {
      const f = files.find((x) => x.path === a.path);
      return page(f?.title ?? "");
    }
    case "open_document": {
      const f = files.find((x) => x.path === a.path) ?? files[0];
      return { id: `doc${f.id}`, path: f.path, name: f.name, url: page(f.title), sizeBytes: f.sizeBytes, modifiedMs: f.modifiedMs };
    }
    case "read_document":
      return { content: "<!doctype html>\n<title>Sample</title>", modifiedMs: now };
    case "live_ticket":
      return new Promise(() => {}); // no live server in the preview; stay quietly "connecting"
    case "cloud_link_for_path":
      return a.path === files[0].path ? { documentId: "d1", path: files[0].path, role: "owner", title: files[0].title, ownerName: null } : null;
    case "account":
      return { id: "u1", name: "Riya Shah", email: "riya@example.com", image: null };
    case "cloud_overview":
      return {
        documents: [{ id: "d9", title: "Store audit — Pune", fileName: "audit.html", sizeBytes: 9000, revision: 3, updatedAt: now, ownerId: "u2", ownerName: "Aarav K", ownerEmail: "a@example.com", role: "editor", memberCount: 3 }],
        usage: { usedBytes: 3_400_000, quotaBytes: 26_214_400 },
        links: [{ documentId: "d1", path: files[0].path, role: "owner", title: files[0].title, ownerName: null }],
      };
    case "inbox_status":
      return { enabled: true, downloads: "/Users/demo/Downloads", desktop: "/Users/demo/Desktop", documents: "/Users/demo/Documents", inbox: "/Users/demo/Quire/Inbox", pastCount: 0 };
    case "import_scan":
      return files.slice(0, ((a.folders as string[]).length * 3 + (a.files as string[]).length) % 9).map((f) => ({ path: f.path, name: f.name, sizeBytes: f.sizeBytes, modifiedMs: f.modifiedMs }));
    case "take_pending_opens":
      return [];
    case "cloud_api":
      return { notifications: [], unread: 0 };
    case "plugin:event|listen":
      return 1;
    default:
      return null;
  }
});
