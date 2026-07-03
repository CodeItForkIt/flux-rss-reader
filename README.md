# Flux — RSS Reader

Flux is a multi-mode RSS reader that is primarily used through the hosted web app at https://flux-rss-reader.vercel.app, with an optional self-hosted deployment and a desktop Electron build for local use.

## Current deployment modes

- Hosted web app (primary): Vercel serves the frontend and the API entrypoint from [api](api), backed by Supabase when the deployment is configured with Supabase environment variables.
- Electron desktop app: local-first desktop experience with no account login and an embedded inline browser.
- Self-hosted server: run the same app locally or on a VPS with Node/Express. This mode can use either a local JSON store or Supabase.

## What the app does

Flux supports:

- RSS and feed discovery
- Readability-based article reading
- Inline-browser mode for sites that block reader-mode extraction
- Per-feed CSS/HTML blocking rules and a visual element picker
- Folder and filter management
- OPML import/export
- YouTube feed support with playback helpers, SponsorBlock, and Shorts filtering
- Optional Ollama-based article clustering and summarization

## Hosted usage (Vercel first)

The hosted experience is the main target for this repository.

1. Open https://flux-rss-reader.vercel.app.
2. Create the first account to become the admin.
3. Sign in and add feeds.
4. Open articles in inline-browser mode to read pages inside the app without hitting the site directly.

### Required hosting environment

For the hosted Vercel deployment, set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY` (recommended when using Supabase-backed storage)

The app uses the same authenticated session for the web UI and the inline-browser proxy, which prevents the “Not authenticated” error when an article is opened inside the embedded view.

## Local development

Install dependencies:

```bash
npm install
```

Start the full local development flow:

```bash
npm run dev
```

That runs the Vite renderer, the Electron app, and the API server together.

Run the API server alone:

```bash
npm run dev:server
```

Build the frontend bundle:

```bash
npm run build
```

If Electron fails to download its binary, retry with the mirror override:

```bash
export ELECTRON_MIRROR="https://github.com/electron/electron/releases/download/"
npm install
```

## Self-hosted mode

The self-hosted path uses the same Express server and frontend build, but can be run on your own machine or a VPS.

### JSON-backed local store

Use the local JSON store when you want a simple, file-based setup:

```bash
npm run dev:server
```

You can point the server at a specific file with:

```bash
DB_PATH="$HOME/Library/Application Support/Flux/flux-data.json" npm run dev:server
```

### Supabase-backed store

Use Supabase when you want the web app and server to share a hosted database instead of a local file. Configure:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
ENCRYPTION_KEY=... \
npm run dev:server
```

## Architecture overview

- [src/renderer](src/renderer): React/Vite frontend and UI state
- [src/main](src/main): Electron main-process integration and window lifecycle
- [src/preload](src/preload): Electron preload bridge
- [src/core](src/core): shared fetch/parse logic used by the UI and server
- [server](server): Express API, auth, session handling, and data-store implementations
- [api](api): Vercel serverless entrypoint that re-exports the Express app

## Important implementation notes

- The web app and the inline-browser proxy share the same session cookie flow, so browser-based article loads stay authenticated.
- The server selects its persistence layer through [server/store-factory.js](server/store-factory.js): local JSON by default, Supabase when the corresponding environment variables are present.
- Electron still uses local storage and does not require account login.
- The inline-browser proxy rewrites pages and routes dynamic requests back through the server to avoid CORS issues.

## Main features and how to use them

### 1. Add and organize feeds

- Open the sidebar and choose Add Feed.
- Paste an RSS URL, a website URL, or a YouTube channel URL.
- Flux can try to discover the feed URL automatically for many sites.
- Create folders to group related feeds and keep the article list tidy.

### 2. Read articles

- Click an article in the list to open it in the reader.
- Use the toolbar to switch between article views, mark items as read, or star them.
- Use the keyboard shortcuts below to move quickly through articles.

### 3. Use the inline browser

Use the inline browser when a feed only shows excerpts or when a site blocks reader mode.

- Turn it on for a feed in Feed settings.
- Or click the inline-browser button on a specific article to enable it just for that article.
- The inline browser opens pages inside the app so you can read them without leaving the current view.
- If a site refuses to render inside the embed, use the open-in-browser button to jump to your default browser.

### 4. Hide or block unwanted content

Flux can remove noisy or irrelevant parts of articles before they are read.

- Enter pick mode from the reader toolbar and click elements you want to hide or block.
- Rules can also be edited as raw CSS selectors and HTML patterns in Feed settings.
- These rules are applied before the reader extracts the main article content.

### 5. Filter and manage your reading list

- Use the filter bar to show only unread, starred, or specific-feed items.
- Open folders to view combined content from multiple feeds.
- Right-click feeds or folders to manage them quickly.

### 6. Import and export your setup

- Export your feeds and folders as OPML from the sidebar.
- Import OPML later to restore or share your setup.
- Flux preserves feed-specific settings such as inline-browser preference and blocking rules when possible.

### 7. Use YouTube features

- Open YouTube feed items directly in the app.
- Playback progress is saved so you can resume where you left off.
- SponsorBlock can skip repetitive segments automatically.
- Picture-in-Picture is available in Electron and Chromium-based environments.

### 8. Optional AI features

- AI grouping and summarization are available when Ollama is configured.
- They are off by default and can be enabled from Settings.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` or `PageUp` / `PageDown` | Scroll the article |
| `←` / `→` or `k` / `j` | Previous / next article |
| `Alt+←` / `Alt+→` | Previous / next article (while inline browser has focus) |
| `Escape` | Exit element picker, or step back in link history |

---

## OPML import/export

- **Export**: sidebar → "Export OPML" (save dialog in Electron, direct
  download in web mode)
- **Import**: sidebar → "Import OPML" (file dialog in Electron, drag-and-drop
  modal in web mode)

Imports merge with existing feeds (deduplicated by URL) and recreate folder
structure. Flux-specific settings (blocking rules, inline browser, hide
shorts) round-trip via `flux:` custom OPML attributes.

---

## YouTube feeds

```
https://www.youtube.com/feeds/videos.xml?channel_id=UC<CHANNEL_ID>
```

Find a channel ID via the channel page source (search `channelId`).

---

## File structure

```
flux/
├── src/
│   ├── core/fetcher.js     ← Shared: RSS fetch, Readability, blocking, OPML, Ollama, Shorts heuristic
│   ├── main/index.js       ← Electron main process — IPC handlers, webview/ad-block setup
│   ├── preload/index.js    ← Electron context bridge
│   └── renderer/
│       ├── api.js          ← Transport abstraction (Electron IPC vs HTTP)
│       ├── App.jsx          ← Full UI
│       ├── index.html
│       └── main.jsx
├── server/index.js         ← Optional self-hosted Express API (no Docker)
└── vite.config.js
```

---

## Note on "Frame latency is negative" message

```
[1] [...:0609/...:ERROR:...display.cc:272] Frame latency is negative: -0.039 ms.
```

Cosmetic Chromium/Wayland+NVIDIA compositor warning — not an application
error. The Electron main process disables GPU vsync/frame-rate-limit
switches that commonly trigger it; safe to ignore if it still appears.
