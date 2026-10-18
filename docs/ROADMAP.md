# Roadmap

Quire is built in phases. Each phase ships something usable.

| Phase | Scope | Status |
| --- | --- | --- |
| 0. Foundations | Tauri shell, design tokens, open from Finder / drag / ⌘O, tabs, recents, sandboxed viewer, live reload, device-width previews | Done |
| 1. Library | Watched folders, live thumbnails, tags, stars, full-text search, trash with restore | Done |
| 2. Editing | Code editor with live preview, visual text/image editing, style panel, autosave, conflict handling, version history with diff and restore | Done |
| 3. Cloud and sharing | **A. Accounts: done.** Then: sharing with roles, Shared with me, R2 storage, quotas. Accounts, sync, Owner / Editor / Commenter / Viewer roles, link sharing, folder inheritance, web viewer for link recipients, `quire.page` user-content domain | |
| 4. Live collaboration | Yjs + Hocuspocus, presence, cursors, code and visual edits in one shared document | |
| 5. Comments and review | Element-pinned comments, threads, mentions, suggestion mode, notifications | |
| 6. Power features | AI edit (bring your own key), MCP server + CLI so AI tools publish straight to Quire, live data sources, export to PDF/PNG, templates | |
| 7. Launch | Abuse prevention for public pages, security review, self-host Docker image, docs site, billing for the hosted plan | |

## Decisions

- **Desktop first** with Tauri 2. A lightweight web viewer is added in Phase 3 so people receiving a link do not need to install anything.
- **Hosted cloud on day one** of Phase 3; self-hosting follows.
- **AGPL-3.0** to keep the hosted product protected while staying fully open source.
- **No proprietary-only infrastructure** (e.g. Liveblocks). Everything must be self-hostable.
