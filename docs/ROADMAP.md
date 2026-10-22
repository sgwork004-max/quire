# Roadmap

Quire is built in phases. Each phase ships something usable.

| Phase | Scope | Status |
| --- | --- | --- |
| 0. Foundations | Tauri shell, design tokens, open from Finder / drag / ⌘O, tabs, recents, sandboxed viewer, live reload, device-width previews | Done |
| 1. Library | Watched folders, live thumbnails, tags, stars, full-text search, trash with restore | Done |
| 2. Editing | Code editor with live preview, visual text/image editing, style panel, autosave, conflict handling, version history with diff and restore | Done |
| 3. Cloud and sharing | Accounts, sharing by email with Owner/Editor/Commenter/Viewer roles, Shared with me, assets in R2, storage quotas. Later: share links, folder sharing, web viewer for link recipients on a `quire.page` domain | Done, live on Cloudflare |
| 4. Live collaboration | Yjs in Durable Objects, presence, live cursors, code and visual edits in one shared document | Done, live on Cloudflare |
| 5. Comments and review | Comments pinned to elements (anchored with Yjs relative positions), threads, @mentions, resolve/reopen, live updates, in-app notifications. Later: email notifications, suggestion mode | Done, live on Cloudflare |
| 6. Power features | MCP server + `quire` CLI (Claude creates, finds and updates HTML in your library), live data from CSV/JSON/Google Sheets links, export to PDF and single-file HTML | Done |
| 7. Launch | Abuse prevention for public pages, security review, self-host Docker image, docs site, billing for the hosted plan | |

## Next release

Collected here and shipped together as one release, now that Quire is live.

- Find in page (⌘F) for the open document: a search bar that highlights every match and steps through them with Return / ⇧Return.
- Collapsed sidebar on macOS: the traffic lights, q logo and expand button are cramped and misaligned in the narrow rail. Lay them out cleanly (lights in their own row with proper inset, logo and expand button centred and evenly spaced below).

## Decisions

- **Desktop first** with Tauri 2. A lightweight web viewer is added in Phase 3 so people receiving a link do not need to install anything.
- **Hosted cloud on day one** of Phase 3; self-hosting follows.
- **AGPL-3.0** to keep the hosted product protected while staying fully open source.
- **No proprietary-only infrastructure** (e.g. Liveblocks). Everything must be self-hostable.
