# Quire

Open-source "home for HTML": view, organise, edit and share HTML files. Desktop app first (Tauri 2), cloud sharing later. Roadmap and phase status: docs/ROADMAP.md.

## Commands

- `pnpm dev`: run the desktop app in dev mode
- `pnpm check`: TypeScript + `cargo check`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: Rust tests (protocol security rules)
- `pnpm --filter @quire/desktop tauri build --debug --bundles app`: debug `.app`, needed to test Finder "Open With"

## Conventions

- UI: React 19, Tailwind v4, Zustand (`src/store/`). Colours only through tokens in `src/styles.css` (`bg-surface`, `text-ink-2`, `bg-accent`...). Never hard-code colours in components.
- Native shortcuts belong in the Rust menu (`src-tauri/src/menu.rs`), which emits a `menu` event handled in `App.tsx`. JS keydown handlers do not fire while focus is inside a document iframe.
- Rust commands return `Result<T, String>`. Register new commands in `lib.rs` and type them in `src/lib/ipc.ts`.
- Security is non-negotiable: documents only ever load through `quire://<id>/`. Any change to `protocol.rs` needs a test, and `fixtures/security/probe.html` must stay all BLOCKED. Never add `allow-top-navigation` to the iframe sandbox or widen Tauri capabilities to remote origins.
- License: AGPL-3.0. New files need no header.
