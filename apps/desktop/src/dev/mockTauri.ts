// Dev-only: lets the UI render in a plain browser (no Tauri) with sample
// files, so the design can be checked in a browser preview. Never bundled
// into the app: main.tsx imports it only under `import.meta.env.DEV` when
// Tauri's IPC is missing.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = Date.now();
const page = (title: string, accent: string) =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><body style="margin:0;font:14px system-ui;padding:28px;color:#1f2937">
<h1 style="margin:0 0 14px;font-size:24px">${title}</h1>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
${["Revenue ₹42.6 L", "Orders 1,284", "vs Sep +12%"].map((t) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px">${t}</div>`).join("")}</div>
<div style="display:flex;align-items:flex-end;gap:10px;height:160px;border-bottom:1px solid #e5e7eb">
${[40, 62, 55, 80, 71, 92, 66].map((h) => `<span style="flex:1;height:${h}%;background:${accent};border-radius:3px 3px 0 0"></span>`).join("")}</div></body>`);

const files = [
  ["Pune stores — October", "#6366f1"],
  ["Q3 KPI dashboard", "#0ea5e9"],
  ["Landing page v4", "#f97316"],
  ["Investor one-pager", "#10b981"],
  ["Ops weekly", "#ef4444"],
  ["Pricing experiments", "#8b5cf6"],
  ["Mumbai footfall", "#14b8a6"],
  ["Hiring plan", "#eab308"],
].map(([name, accent], i) => ({
  id: i + 1,
  path: `/Users/demo/Quire/${name}.html`,
  name: `${name}.html`,
  dir: "/Users/demo/Quire",
  locationId: 1,
  title: name,
  sizeBytes: 24000 + i * 1000,
  modifiedMs: now - i * 3_600_000 * 5,
  openedMs: null,
  starred: i === 1,
  trashedMs: null,
  tagIds: i % 3 === 0 ? [1] : [],
  snippet: null,
  accent,
}));

mockWindows("main");
mockIPC((cmd, args) => {
  const a = args as Record<string, unknown>;
  switch (cmd) {
    case "library_overview":
      return { locations: [{ id: 1, path: "/Users/demo/Quire", name: "Quire", count: files.length }, { id: 2, path: "/Users/demo/Clients", name: "Clients", count: 3 }], tags: [{ id: 1, name: "Client", color: "#c8372d", count: 3 }, { id: 2, name: "Board", color: "#1e9bb0", count: 1 }], all: files.length, starred: 1, recent: 4, trash: 1, hidden: 2 };
    case "library_query":
      return files;
    case "preview_url": {
      const f = files.find((x) => x.path === a.path);
      return page(f?.title ?? "Untitled", f?.accent ?? "#6366f1");
    }
    case "open_document": {
      const f = files.find((x) => x.path === a.path) ?? files[0];
      return { id: `doc${f.id}`, path: f.path, name: f.name, url: page(f.title, f.accent), sizeBytes: f.sizeBytes, modifiedMs: f.modifiedMs };
    }
    case "read_document":
      return { content: "<!doctype html>\n<title>Sample</title>", modifiedMs: now };
    case "cloud_link_for_path":
      return a.path === files[0].path ? { documentId: "d1", path: files[0].path, role: "owner", title: files[0].title, ownerName: null } : null;
    case "account":
      return { id: "u1", name: "Shardul", email: "demo@example.com", image: null };
    case "cloud_overview":
      return {
        documents: [{ id: "d9", title: "Store audit — Pune", fileName: "audit.html", sizeBytes: 9000, revision: 3, updatedAt: now, ownerId: "u2", ownerName: "Aarav K", ownerEmail: "a@example.com", role: "editor", memberCount: 3 }],
        usage: { usedBytes: 12_400_000, quotaBytes: 104_857_600 },
        links: [{ documentId: "d1", path: files[0].path, role: "owner", title: files[0].title, ownerName: null }],
      };
    case "inbox_status":
      return { enabled: true, downloads: "/Users/demo/Downloads", desktop: "/Users/demo/Desktop", documents: "/Users/demo/Documents", inbox: "/Users/demo/Quire/Inbox", pastCount: 3 };
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
