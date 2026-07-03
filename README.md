# Flux — RSS Reader

A cross-platform RSS reader. Two ways to run it from the same codebase:

- **Electron** (primary, Linux desktop app) — local storage, no login, full
  `<webview>`-based inline browser
- **Self-hosted web server** (optional) — multi-user, JWT auth, per-user
  SQLite-backed data; run directly with Node, no Docker required
- **Vercel-hosted Web App** - Access at flux-rss-reader.vercel.app and login/make an account. All the features of the above except for AI features.

Features: real RSS fetching, Readability reader mode, per-feed CSS/HTML
element blocking with a visual point-and-click picker, paywall bypass chain
(cookies → 12ft.io → archive.ph), inline browser for feeds that truncate
content, OPML import/export, folders, per-folder/per-feed filters, YouTube
feeds with embedded video (Picture-in-Picture, watch-progress resume,
SponsorBlock auto-skip, optional Shorts filtering), and optional
Ollama-powered article clustering — fully off by default.

---

## Setup

```bash
npm install
npm run dev
```

If you previously ran `npm install` and it failed partway through, **delete
`node_modules` and `package-lock.json` and reinstall** — a partial install
leaves other packages (express, etc.) missing too, which causes confusing
follow-on errors. There are no native/compiled dependencies in this project,
so installs should be reliable on any recent Node version. A `postinstall`
script (`scripts/check-electron.js`) automatically checks that Electron's
binary downloaded correctly and prints a clear message if it didn't.

**Don't run `npm audit fix --force` in this project.** It will report
Electron CVEs — these are almost all about apps *built with* Electron
exposing unsafe APIs to remote/untrusted web content (XSS in a renderer
escalating to native code, that kind of thing). They're real concerns for,
say, a chat app that renders arbitrary HTML from other users — not for a
personal RSS reader you run locally against feeds you chose. `--force`
ignores your pinned version range entirely and grabs whatever satisfies the
audit, which is also exactly what corrupts the Electron install: it
downloads a new version's package metadata but doesn't necessarily finish
downloading/extracting the matching binary, leaving `node_modules/electron`
in a broken half-state — `Electron failed to install correctly` (or
`electron: command not found` after you delete the folder hoping a reinstall
fixes it, which it won't without `package-lock.json` also matching the
metadata that's now wrong). Deleting `node_modules/electron` alone doesn't
fix it either, since the metadata pointing at the wrong version is still in
`package-lock.json`. **The real fix once this has already happened:**
```bash
rm -rf node_modules package-lock.json
npm install
```
Electron is pinned via both `devDependencies` and `overrides` in
`package.json`, specifically so a stray `npm audit fix` (even without
`--force`) can't silently swap it out from under the rest of the toolchain.
If `npm audit` reports something in one of the actual app dependencies
(express, jsdom, etc.) that's worth a look — those run against real
content you don't control (RSS feeds, fetched articles) — but check what
the advisory actually describes before reaching for `--force`.

### About the `npm warn deprecated` lines

`npm install` prints a few deprecation warnings for packages this project
doesn't depend on directly — they're transitive (dependencies of
dependencies), and traced below for anyone who wants to verify rather than
take it on faith:

| Package | Pulled in by | Why it's not a problem |
|---|---|---|
| `boolean` | `electron` → `@electron/get` → `global-agent` | Part of Electron's own binary-downloader, used once at install time. Never imported by app code, never shipped in the packaged app. |
| `whatwg-encoding`, `node-domexception` | `jsdom` (article extraction) and `node-fetch` (HTTP client) respectively | Deprecated in favor of newer platform-native APIs upstream, not because of a security issue. Functionally fine; will go away on their own whenever `jsdom`/`node-fetch` release majors that drop them. |
| `inflight`, `rimraf@2`, `glob@7` | `electron-builder` (only if you've installed it separately to build a `.dmg`/AppImage — see below) | Not part of this project's own dependency tree at all. `electron-builder` is a packaging CLI you run once locally; none of its dependencies end up bundled into the app users actually run. |

None of these run inside the shipped application — they're either
install-time tooling or article-parsing/fetch internals with no known
vulnerabilities, just upstream-deprecated APIs. Pinning around them would
mean forking `jsdom`, `node-fetch`, or `electron` itself, which isn't worth
the trade for warnings that don't reflect actual risk.

This runs `vite --host` (frontend, bound to `0.0.0.0:5173` so you can also
open it from your phone on the same network for UI testing) and Electron
(with `--trace-warnings` for easier debugging) together.

If `electron`'s binary download fails on a slow connection:
```bash
export ELECTRON_MIRROR="https://github.com/electron/electron/releases/download/"
npm install
```

### Build AppImage (Linux)

```bash
npm install --save-dev electron-builder
npm run build
npx electron-builder --linux AppImage
```

### Build a .dmg (macOS)

```bash
npm install --save-dev electron-builder
npm run build
npx electron-builder --mac dmg
```

App icons (`assets/icon.png` for Linux, `assets/icon.icns` for macOS) are
already built and wired into `package.json`'s `build` config — no manual
conversion step needed. Both were generated from `assets/icon.svg`, which
is also used as the browser-tab favicon in web mode and the in-app sidebar
logo. If you change the SVG, regenerate the others to match:

```bash
pip install cairosvg --break-system-packages
python3 -c "
import cairosvg
cairosvg.svg2png(url='assets/icon.svg', write_to='assets/icon.png', output_width=512, output_height=512)
"
# .icns is a documented binary container (magic + length-prefixed PNG
# chunks at standard Apple sizes) — see the generation approach used for
# this repo if you need to regenerate it without macOS's iconutil.
```

The packaged app loads its UI over a custom `app://` scheme rather than raw
`file://`. This matters: Chromium's CSP `'self'` keyword doesn't reliably
resolve sibling assets (hashed JS/CSS bundles, the favicon, etc.) under a
`file://` origin once everything is bundled into an `asar` archive — it
shows up as a blank window with "Not allowed to load local resource" in the
console, even though the build itself is fine. Routing through `app://`
(registered as a privileged, secure, standard scheme) makes `'self'`
resolve the way it does for `http(s)` origins, so the CSP behaves
predictably. This only affects packaged builds — `npm run dev` is
unaffected since it runs on a real `http://localhost:5173` origin.

Two related details worth knowing if you ever touch this code: the CSP
also explicitly lists `app:` alongside `'self'` in every directive (rather
than relying on `'self'` alone), since custom-scheme handling has had
inconsistent edge cases across Chromium versions and being explicit avoids
relying on it. And the `app://` protocol handler sets `Content-Type`
manually based on file extension instead of trusting Electron's built-in
MIME sniffing for `file://`-backed responses — that sniffing has
historically been unreliable for some asset types (notably `.svg` loaded
via a plain `<img>` tag, outside Vite's module graph), which is what
caused the sidebar icon specifically to go missing in packaged builds even
though the rest of the UI rendered fine.

In Electron mode there's no login screen — your data lives in
`<userData>/flux-data.json` (e.g. on macOS:
`~/Library/Application Support/flux-reader/flux-data.json`; on Linux:
`~/.config/flux-reader/flux-data.json`). The path is logged to the terminal
on startup so you don't have to guess it.

### Testing the mobile/web UI

`npm run dev` binds Vite to your LAN IP. Visiting `http://<your-ip>:5173`
from a phone browser loads the same React UI in **web mode** — no login, no
separate account. See below for running the API server it talks to.

---

## Self-hosted web server (no auth, no Docker)

```bash
npm run dev:server      # starts Express on :3000
```

The Vite dev server (`:5173`) proxies `/api/*` to `:3000`, so visiting
`http://<your-ip>:5173` from a phone gives the full web UI.

**Ports:**
- `:5173` — Vite dev server / React frontend. Only used while `npm run dev`
  is running; Electron loads its UI from here in development but talks to
  its own main process via IPC, never over HTTP.
- `:3000` — Express API server (`npm run dev:server`). This is what the web/
  mobile browser actually talks to. Not needed at all if you're only using
  the Electron app.

**No authentication.** Anyone who can reach port 3000 on your machine can
read and modify your feeds. Run behind a VPN, local network, or reverse
proxy if you need access control.

### Sharing data between Electron and the web server

Both now use the exact same `JSONStore` class and file format (see
`server/db.js`), so pointing them at the same file gives you identical data
everywhere — add a feed on your phone, see it immediately in the desktop app
(after a refresh).

Electron logs its data file path on startup. Point the server at it with `DB_PATH`:

```bash
# macOS
DB_PATH="$HOME/Library/Application Support/flux-reader/flux-data.json" npm run dev:server

# Linux
DB_PATH="$HOME/.config/flux-reader/flux-data.json" npm run dev:server
```

Or go the other way — set `FLUX_DB_PATH` before launching Electron to point
it at the server's file instead:

```bash
FLUX_DB_PATH="$(pwd)/server/flux-data.json" npm run dev
```

If you don't set either, Electron and the server each keep their own
separate file — fine for trying things out, but they won't be in sync.

Environment variables:

| Variable       | Default                       | Purpose |
|----------------|--------------------------------|---------|
| `PORT`         | `3000`                         | Server port |
| `DB_PATH`      | `server/flux-data.json`        | Server's JSON data file location |
| `FLUX_DB_PATH` | `<Electron userData>/flux-data.json` | Electron's JSON data file location (set to share with the server) |
| `OLLAMA_URL`   | `http://127.0.0.1:11434`       | Ollama API endpoint |
| `OLLAMA_MODEL` | `nomic-embed-text`             | Embedding model for clustering |

For a production deployment, build the frontend and run the server behind a
reverse proxy (nginx/Caddy) for TLS:

```bash
npm run build            # outputs to dist/
JWT_SECRET=$(openssl rand -hex 32) PORT=3000 node server/index.js
```

The server serves the built frontend directly from `dist/` when present.

### First account

The first screen in web mode is login/register — register creates a new
account. Each account gets its own feeds, folders, read/starred state,
settings, and in-memory cookie jars (used for paywall bypass on sites you've
logged into; evicted after 4h idle).

---

## Settings (AI features & SponsorBlock)

Click the **⚙** icon at the bottom of the sidebar.

- **AI article grouping** — off by default. When enabled, Flux embeds each
  article's title+summary via a local Ollama instance after every refresh
  and clusters articles describing the same story (cosine similarity ≥0.82).
  Configurable Ollama URL/model. If Ollama isn't reachable, clustering
  silently no-ops — no errors, no nagging, ever.

  Grouped stories appear as a single "◆ N sources" card in the article list.
  Clicking it opens a group view with a short AI-generated summary of the
  combined coverage (using a chat model — `llama3.2` by default, separate
  from the embedding model used for grouping) plus a list of each individual
  article to read on its own.
- **SponsorBlock** — on by default. Auto-skips sponsor/self-promo/intro/outro
  segments in YouTube videos using community timestamps from
  `sponsor.ajay.app`.

Turning AI grouping off immediately clears any existing cluster badges and
hides the "Grouped only / Ungrouped only" filter option.

---

## Folders & filters

- **New folder**: "+ New folder" at the bottom of the sidebar feed list.
- **Folder navigation**: click a folder name to view all articles from its
  feeds (combined). Click the ▾ chevron to expand/collapse the feed list
  underneath without changing views.
- **Manage feeds in a folder**: right-click a folder → "Manage feeds" to
  check/uncheck which feeds belong to it. Right-click → "Delete folder"
  removes the folder; its feeds become unfiled (not deleted).
- **Per-feed settings**: right-click any feed in the sidebar, or click the
  **⚙** in the article list header when viewing a single feed. Covers:
  - Inline browser toggle (also settable from the reader's **◫** button,
    which remembers the choice for that feed)
  - Hide YouTube Shorts (best-effort — see below)
  - CSS/HTML blocking rules
- **Filter bar** (top of the article list, per view): filter by read/unread/
  starred status, by source feed (when a folder/view contains multiple
  feeds), and — if AI grouping is enabled — by grouped/ungrouped only.
  Filters are remembered per view (All Items, each folder, each feed, etc.)

### Hide Shorts caveat

YouTube's RSS feed doesn't include video duration, so "Hide Shorts" detects
videos tagged `#shorts` in the title or description — the convention nearly
all creators use. Untagged Shorts may still slip through occasionally.

---

## YouTube playback

- **Click-to-play**: videos don't auto-load; click the thumbnail to start
  the player (uses the YouTube IFrame API).
- **Watch progress**: playback position is saved to `localStorage` every
  second and resumed automatically next time you open the same video.
- **SponsorBlock**: segments are fetched once per video and skipped via
  `seekTo()` during playback (toggle in Settings).
- **Picture-in-Picture**: click "Picture-in-Picture" under a playing video.
  Uses the Document Picture-in-Picture API (Chromium 116+ — available in
  recent Electron). Moving the player to the PiP window causes one reload,
  carrying over the current timestamp for a near-seamless resume.
- **Embedded videos in articles** (e.g. a Verge post embedding a YouTube
  video): converted to click-to-play thumbnails automatically. These don't
  get the full IFrame API treatment (PiP/progress/SponsorBlock) — only
  native YouTube feed items do.

---

## Element picker (visual blocking rules)

Click **⊹** in the reader toolbar to enter pick mode:

- Hover highlights elements and shows their CSS selector
- Click pins a selection — choose **Block** (removed before Readability
  runs on future loads) or **Hide**
- **Escape** cancels a pinned selection, or exits pick mode if none is pinned
- Committing a rule re-fetches the article immediately, and warns you (with
  a dismissible banner) if the selector still matches something after
  re-fetching — meaning the rule didn't actually do anything

Edit rules as raw text via **⚙** (CSS selectors + regex HTML patterns, one
per line).

Blocking rules run on the raw page HTML *before* Readability extracts the
article, but the picker shows you the *extracted* result. For the selectors
it builds to transfer correctly between the two, Readability is configured
to preserve the original `class`/`id` attributes (`keepClasses: true`) —
without this, class-only elements (byline photos, "skip to content" links,
etc.) would get picked but the resulting selector would match nothing on
the next fetch.

---

## Inline browser mode

For feeds that only publish truncated content:

- **Per-feed default**: **⚙ → Feed settings** → "Use inline browser for this
  feed"
- **Per-article**: click **◫** — this also updates the feed's default for
  next time
- Uses Electron's `<webview>`, which (unlike `<iframe>`) isn't subject to
  `X-Frame-Options`/`frame-ancestors`, so sites like The Verge and Ars
  Technica that send `X-Frame-Options: DENY` render correctly
- A built-in ad/tracker blocklist (Google ad networks, Permutive, Taboola,
  Outbrain, etc.) is applied to reduce noise and speed up loads

### Link following + back navigation

- External links open in the inline browser overlay with a **↩ Back** button
- **Escape** steps back through followed-link history
- **Alt+←** / **Alt+→** switch between articles while the inline browser has
  focus (plain arrow keys can't be intercepted from inside the embedded
  page without breaking normal page use, e.g. text fields, video seeking)
- **↗** always opens the current page in your real default browser

In web mode (no `<webview>`), the inline browser goes through `/api/proxy`,
which strips frame-blocking headers — some sites still refuse to embed even
then; use **↗** for those.

---

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
