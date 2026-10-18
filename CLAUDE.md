# Quire

Open-source "home for HTML": view, organise, edit and share HTML files. Local-first desktop app (Tauri 2) plus Quire Cloud on Cloudflare (apps/cloud) for sharing only. Roadmap: docs/ROADMAP.md. Architecture: docs/ARCHITECTURE.md.

## Commands

- `pnpm dev`: run the desktop app in dev mode
- `pnpm dev:cloud`: run Quire Cloud locally at http://localhost:8787 (debug desktop builds use it)
- `pnpm check`: TypeScript + `cargo check`
- `cd packages/mcp && pnpm build`: build the `quire` CLI / MCP server (`node packages/mcp/dist/cli.js mcp`)
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: Rust tests (protocol security rules)
- `pnpm --filter @quire/desktop tauri build --debug --bundles app`: debug `.app`, needed to test Finder "Open With"

## Conventions

- UI: React 19, Tailwind v4, Zustand (`src/store/`). Colours only through tokens in `src/styles.css` (`bg-surface`, `text-ink-2`, `bg-accent`...). Never hard-code colours in components.
- Native shortcuts belong in the Rust menu (`src-tauri/src/menu.rs`), which emits a `menu` event handled in `App.tsx`. JS keydown handlers do not fire while focus is inside a document iframe.
- Rust commands return `Result<T, String>`. Register new commands in `lib.rs` and type them in `src/lib/ipc.ts`.
- Security is non-negotiable: documents only ever load through `quire://<id>/`. Any change to `protocol.rs` needs a test, and `fixtures/security/probe.html` must stay all BLOCKED. Never add `allow-top-navigation` to the iframe sandbox or widen Tauri capabilities to remote origins.
- Unshared files must never be sent to the cloud. Only explicit sharing uploads anything.
- The background screenshot tool often captures the Quire window blank (WKWebView); use a full-screen screenshot before assuming the UI is broken. Run the app binary from a terminal to see `[ui]` errors forwarded by `public/diagnostics.js`.
- License: AGPL-3.0. New files need no header.
