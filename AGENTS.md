# AGENTS.md

## Project overview
- This repository is Flux, a cross-platform RSS reader with three modes:
  - Electron desktop app (local JSON storage, no login, inline browser via Electron webview)
  - Self-hosted web server (Express + auth/session-backed data)
  - Web build served from the same server
- The main app code lives in [src](src) and the server/API lives in [server](server). The frontend is React/Vite and the backend is Node/Express.
- For existing product context and setup details, start with [README.md](README.md).

## Working conventions
- Prefer small, targeted changes that preserve the existing architecture instead of introducing new abstractions.
- Keep Electron-specific code in [src/main](src/main) and UI logic in [src/renderer](src/renderer). Shared fetch/parse logic belongs in [src/core](src/core).
- Server routes, auth, and data-store behavior belong in [server](server).
- If you touch auth, remember that the app has two request styles:
  - browser/web UI requests may rely on session cookies
  - API calls from the renderer may use an `Authorization: Bearer ...` header
- Inline-browser behavior is implemented through the proxy route in [server/index.js](server/index.js); changes there should preserve authentication and same-origin proxy semantics.

## Build and verification
- Install dependencies with `npm install`.
- Start the app in dev mode with `npm run dev`.
- Start the server alone with `npm run dev:server`.
- Build the frontend with `npm run build`.
- For quick server syntax validation, use `node -c server/index.js`.
- If you change frontend code, prefer validating with the relevant build or dev flow rather than making speculative edits.

## Notes for contributors
- The server uses a shared JSON-backed store by default; environment variables such as `DB_PATH` and `FLUX_DB_PATH` can redirect data storage for local testing.
- The inline-browser proxy intentionally rewrites page content and routes dynamic requests back through the server to avoid CORS issues.
- Keep changes compatible with both the Electron path and the HTTP/web path unless the task explicitly targets only one mode.
