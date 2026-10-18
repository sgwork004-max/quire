# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(A desktop app built with Tauri: the UI is web technology inside a native macOS window. macOS is the primary platform; Windows builds exist. It should feel at home on a Mac, following macOS conventions for sidebar, toolbar, window chrome, menus, system light/dark appearance and keyboard shortcuts, with the brand carried in the details rather than in a custom chrome.)

## Users

AI-native operators: founders, operations and business people who now get dashboards, reports, one-pagers and prototypes as HTML files from ChatGPT, Claude, Gemini and similar tools, and share them with teammates and clients. They are not developers. Their job is to keep these files findable, view them properly, make small changes, and send them to other people without re-emailing files after every revision.

## Product Purpose

Quire is the home for HTML, the way Preview is the home for PDFs: one place to view, organise, edit and share HTML files. Files stay on the user's Mac; only files they explicitly share go to the cloud, where invited people can view, comment on, or edit them live. Success is that an AI-made page goes from "a file in Downloads" to "something the whole team is looking at and discussing" without anyone touching code.

## Positioning

Local-first and HTML-native. Quire collects HTML from wherever AI tools produce it (Claude via MCP, browser downloads), shows it faithfully in a secure sandbox, and shares individual files with Google Docs-style roles and real-time collaboration. General file sync tools don't render or edit HTML; code editors and hosting tools assume a developer.

## Operating Context

- Opened alongside AI chats and the browser throughout the workday; files arrive from ChatGPT/claude.ai downloads (auto-imported from ~/Downloads into ~/Quire/Inbox) and from Claude Code / Claude desktop through the Quire MCP server.
- Typical files: KPI dashboards, monthly reports, landing-page drafts, one-pagers, CRM-style prototypes; many use Indian business context (₹, lakh/crore, Mumbai/Pune stores).
- Shared files are discussed with comments pinned to elements, and edited live by invited editors.
- Distributed free via GitHub Releases and a one-line installer (no Apple Developer ID); updates install themselves.

## Capabilities and Constraints

- Library: watched folders, live thumbnails, tags, stars, full-text search, trash with restore, Recent, Shared with me, Inbox.
- Viewer: sandboxed per-document origin, device-width previews, live reload, version history with diff/restore.
- Editing: visual editor (select, edit text, style panel) and code editor sharing one history;
- Sharing: Google sign-in, invite by email as Editor/Commenter/Viewer, real-time collaboration with presence, comments with mentions and notifications, live data from CSV/JSON links, export to PDF and single-file HTML. Import HTML from Downloads, Desktop or any folder; hide files from the library without deleting them; multi-select to tag, move or hide in bulk.
- Terminology: Library, Inbox, Folders, Tags, Shared with me, Preview / Visual / Code modes, Version history, Comments.
- Constraint: the document itself is the user's content and must render untouched by Quire's styling; the brand lives in the app around it.
- Constraint: unsigned macOS builds; no paid Apple services.
- The cloud runs at quire-cloud.quire-cloud.workers.dev; there is no custom domain yet.

## Brand Commitments

- Name: Quire (a gathered set of pages). Binding.
- Everything else visual (accent colour, logo, icon) is replaceable; the current orange-red accent and stacked-pages mark are placeholders.
- Nothing in the product may use or reference the creator's employer identity.

## Evidence on Hand

- Working app with real screens to design against (library, viewer, editors, share dialog, comments, sign-in page on the cloud).
- No customers, testimonials, metrics, press or pricing yet. Do not invent any.

## Product Principles

1. The user's HTML is the hero; Quire frames it and gets out of the way.
2. Calm by default, powerful on demand: everyday viewing is quiet, editing and sharing tools appear when asked for.
3. Private unless shared: nothing leaves the Mac without an explicit action, and the UI makes that state obvious.
4. Speak plainly to non-developers: no jargon, no code unless they open Code mode.
5. Feel native on the Mac, so Quire sits naturally next to Preview, Notes and Finder.
