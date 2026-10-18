# Quire

**The home for your HTML.** View, organise, edit and share HTML files the way you do with docs, sheets and PDFs.

AI tools now produce HTML all the time: dashboards, reports, one-pagers, prototypes. There is still no app that plays the role Preview plays for PDFs. Quire is that app, with Google Docs-style sharing on top: send a link, choose who can view, comment or edit, and everyone always sees the latest version.

> Status: early development (Phases 0–2 done: viewer, library, editing). See [docs/ROADMAP.md](docs/ROADMAP.md).

## What works today

- Native macOS app (Tauri). Opens any `.html` from Finder, "Open With", drag and drop, or ⌘O
- Library: add folders and Quire indexes every HTML file in them, kept in sync with disk. Live thumbnails, tags, stars, full-text search (⌘K), trash with restore
- Visual editor: click to select, double-click text to edit, style panel, replace images, duplicate and delete
- Code editor with live preview; both editors share one undo history and only change the bytes you touch
- Autosave, and a version history of every change (including changes made by other apps or AI tools), with diff and restore
- Sandboxed viewer: each file can only load assets from its own folder, never hidden files, never the app itself
- Live reload when the file or its CSS/JS/JSON changes on disk
- Device-width previews: fit, desktop 1440, tablet 768, mobile 390
- Show in Finder, Open in Browser

## Install

**Mac** (Apple Silicon and Intel), in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/sgwork004-max/quire/main/scripts/install.sh | sh
```

Or download the `.dmg` from [Releases](https://github.com/sgwork004-max/quire/releases/latest). Quire isn't signed with an Apple Developer ID, so the first time you open a downloaded copy, right-click Quire.app → Open (on macOS 15+, System Settings → Privacy & Security → Open Anyway). The installer above avoids this step.

**Windows:** download the installer from [Releases](https://github.com/sgwork004-max/quire/releases/latest). If SmartScreen warns, choose More info → Run anyway.

Quire updates itself (Quire menu → Check for Updates).

## Develop

Requirements: Node 22+, pnpm 10+, Rust (stable), Xcode Command Line Tools.

```bash
pnpm install
pnpm dev
```

Open the fixtures to try things out:

```bash
pnpm dev -- -- "$PWD/fixtures/demo/index.html" "$PWD/fixtures/security/probe.html"
```

Checks:

```bash
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Repository layout

```
apps/desktop/            Tauri desktop app
  src/                   React UI (Vite, Tailwind, Zustand)
  src-tauri/src/         Rust: document registry, quire:// protocol, file watcher, menu
fixtures/                HTML files for manual testing (demo + sandbox probe)
docs/                    Roadmap and architecture notes
```

## Security model

HTML can run scripts, so documents never run with the app's privileges:

1. Every open file gets a random id and is served over the custom `quire://<id>/` scheme, so each document is its own origin, separate from the app.
2. The scheme serves files only from that document's folder. Path traversal, symlinks that escape the folder, and hidden files (`.env`, `.git`, ...) are refused. These rules are covered by unit tests in `src-tauri/src/protocol.rs`.
3. The iframe is sandboxed without `allow-top-navigation`, and Tauri capabilities are scoped to the app's own origin, so documents cannot call native commands.

`fixtures/security/probe.html` checks all of this from inside a running app. Every line should read BLOCKED.

Found a security issue? Please email the maintainers instead of opening a public issue.

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host Quire freely. If you run a modified version as a service, you must publish your changes.
