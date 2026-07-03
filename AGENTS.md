# AGENTS.md

## Project overview
- Flux is primarily a hosted web app for Vercel, with a desktop Electron build and an optional self-hosted server path.
- The main frontend lives in [src/renderer](src/renderer), Electron shell code in [src/main](src/main), shared fetch/parse logic in [src/core](src/core), and the API/server implementation in [server](server).
- The Vercel entrypoint is [api/index.js](api/index.js); it re-exports the same Express app used by the self-hosted server.
- Start with [README.md](README.md) for product context and deployment details.

## Architecture and conventions
- Keep Electron-specific code isolated in [src/main](src/main) and [src/preload](src/preload). UI logic belongs in [src/renderer](src/renderer).
- Keep server-side auth, session handling, and data-store behavior in [server](server).
- Prefer small, targeted changes that preserve the existing shape of the app instead of introducing a new abstraction layer.
- If you touch auth, make sure both request styles still work:
  - browser/web requests may rely on session cookies
  - renderer/API requests may use an `Authorization: Bearer ...` header
- The inline-browser proxy in [server/index.js](server/index.js) must keep working for the hosted web app; changes there should preserve authentication, same-origin proxy semantics, and the proxy’s content rewriting behavior.

## Storage and deployment modes
- The server selects its persistence layer through [server/store-factory.js](server/store-factory.js):
  - local JSON store by default
  - Supabase-backed store when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present
- Vercel deployments are expected to run with HTTPS and to set the Supabase variables for the hosted experience.
- Electron mode remains local-first and does not require account login.

## Build and verification
- Install dependencies with `npm install`.
- Run the full local app with `npm run dev`.
- Run the server alone with `npm run dev:server`.
- Build the frontend bundle with `npm run build`.
- For a quick syntax check, use `node -c server/index.js`.
- When changing frontend behavior, prefer validating through the relevant dev/build flow rather than making speculative edits.

## Repo-specific notes
- The inline-browser proxy intentionally rewrites page content and routes dynamic requests back through the server to avoid CORS issues.
- The app is currently designed around a hosted Vercel workflow, but it still supports self-hosting and desktop use.
- Keep changes compatible with both the hosted web path and the self-hosted/Electron path unless the task explicitly targets only one mode.
