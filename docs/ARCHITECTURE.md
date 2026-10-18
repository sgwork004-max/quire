# Architecture

Quire is **local-first**. Your HTML files live on your computer and never leave it unless you share them. The cloud exists only to share and collaborate on the files you choose.

## Principles

1. **Unshared files never touch the cloud.** The library, search, thumbnails, editing and version history all run on the desktop.
2. **Sharing turns one file into a cloud document.** Only that file (and the assets it uses) is uploaded. Unsharing deletes the cloud copy; the local file is untouched.
3. **The cloud is a cache, not the source of truth.** The owner always keeps the original on disk, so cloud copies can be evicted when inactive and re-uploaded on demand. This keeps storage bounded.
4. **Costs are capped by design.** Each free account has a shared-storage quota, so the worst-case bill is `users × quota × price`, known in advance.
5. **Self-hostable.** Everything runs on open components; no proprietary-only services.

## Components

```
Desktop app (Tauri)                         Quire Cloud (Cloudflare)
├─ Library, editor, history (local)         ├─ Worker: API + auth          apps/cloud
├─ quire:// sandboxed viewer                ├─ D1: accounts, documents, permissions
├─ Session token in macOS Keychain ──HTTPS──┤  R2: shared assets (by content hash)
└─ Sync client ───────────────WebSocket─────┴─ Durable Objects: one live room per document
```

| Concern | Choice | Why |
| --- | --- | --- |
| API | Cloudflare Workers + Hono | Free tier (100k requests/day), global, no servers |
| Database | D1 (SQLite) | Free tier (5 GB), same SQL as the desktop index |
| File storage | R2 | 10 GB free and **no egress fees**, so popular shares don't cost more |
| Real time | Durable Objects + Yjs | One object per shared document holds the live CRDT; included in the free plan |
| Auth | Better Auth (Google, email code) | Open source, runs on Workers, supports the device flow |

## Accounts (Step A, done)

- Every user has a profile: name, email, avatar.
- The desktop app signs in with the **OAuth 2.0 device authorization grant** (RFC 8628): it shows a code and opens `/device` in the browser, where the person signs in (Google or a 6-digit email code) and approves that code. The app polls and receives a session token.
- The token is stored in the macOS Keychain and sent as `Authorization: Bearer`. Sessions last 60 days and slide forward while used. Signing out revokes it on the server.
- Rate limits are stored in D1 so they hold across Worker isolates. Email codes expire in 10 minutes and allow 5 attempts.

## Sharing (Step B, done)

- `documents` (id, owner, title, size, created), `members` (document, user or pending email, role), `invites`.
- Roles: **Owner**, **Editor**, **Commenter**, **Viewer**. Permission checks happen on the server for every request.
- On share: the desktop uploads the HTML plus referenced assets (deduplicated by content hash) to R2 and links the local file to the document id.
- Recipients see **Shared with me** in the sidebar; files are cached locally for instant, offline opening.
- Shared HTML is only ever rendered in the sandboxed viewer (and, on the web, from a separate user-content domain).

## Real time (Step C, done)

- Each shared document is a Yjs document (`Y.Text` of the HTML source) living in a Durable Object.
- The object checks the caller's role on connect: viewers and commenters get read-only sync; editors can write.
- The owner's desktop applies remote edits to the file on disk; local edits (including from other apps or AI tools) are diffed into the Yjs document.

## Comments (Phase 5, done)

- Comments live in D1 (`comment`, `notification`) and exist only on shared documents. Viewers can read them; commenters, editors and owners can write. Authors edit and delete their own; owners can delete any.
- A thread is pinned to an element by a **Yjs relative position** at the start of the element's tag, so it keeps pointing at the same element while anyone edits text before it. If the element is deleted, the thread stays and says so.
- When comments change, the room broadcasts a one-word event (`comments`) over the live connection (message type 2) and every open copy reloads its threads.
- Notifications are created for mentions (only of people on the file), replies to threads you're in, and new comments on your files. The desktop polls them with its sync loop.

## How sync works on the desktop

- `cloud_links` (desktop SQLite) links a local file to a cloud document: the owner's original, or for recipients a copy in `~/Library/Application Support/app.quire.desktop/shared/<id>/`. Recipient copies are deleted on sign-out.
- An open shared file connects live: the CodeMirror buffer is bound to the room's `Y.Text`, so typing, visual edits and collaborators' edits all flow through Yjs, and autosave still writes the local file. Undo only undoes your own changes.
- Files not open live are synced every few seconds by `cloud.rs`: local edits (including other apps and AI tools) are pushed as a three-way merge against `synced`, the last text both sides agreed on; remote changes are pulled when there are no unpushed local edits.
- Assets are found by scanning the page (and its CSS/JS) for relative references inside its folder, uploaded once per content hash, and downloaded into recipients' copies.

## Testing sharing locally

```bash
pnpm dev:cloud                                   # terminal 1, log in a file you can read
node apps/cloud/scripts/smoke.mjs <wrangler-log>  # 27 end-to-end checks: roles, assets, merges, live sync, revocation
node apps/cloud/scripts/peer.mjs <wrangler-log> someone@example.com '<p>hi</p>' 30
                                                 # a second person editing live, for testing with the app
```

## Cost controls

- Free quota per account (e.g. 100 MB of shared content). Worst case at 1,000 users is ~100 GB ≈ $1.35/month on R2.
- HTML is stored compressed; assets are deduplicated by hash.
- Cloud copies of documents with no activity for 60 days are evicted and re-uploaded by the owner's app on demand.

## Production

- Quire Cloud runs at `https://quire-cloud.quire-cloud.workers.dev` (D1 `quire`, R2 `quire-blobs`, Durable Object `DocRoom`). Release builds of the app use it; debug builds use `localhost:8787` unless built with `QUIRE_API_URL`.
- Sign-in is Google only until an email sender (Resend + a domain you own) is configured; then set `RESEND_API_KEY` and `EMAIL_FROM` as secrets.
- Deploy: `cd apps/cloud && pnpm db:migrate:remote && pnpm deploy`.

## Local development

```bash
cd apps/cloud
cp .dev.vars.example .dev.vars          # then set BETTER_AUTH_SECRET
pnpm db:migrate:local
pnpm dev                                # http://localhost:8787
```

Debug builds of the desktop app talk to `http://localhost:8787`; override with `QUIRE_API_URL`. Without `RESEND_API_KEY`, sign-in codes are printed in the `wrangler dev` console.
