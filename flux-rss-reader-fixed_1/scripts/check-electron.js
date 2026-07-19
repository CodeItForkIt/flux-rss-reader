#!/usr/bin/env node
'use strict';
/**
 * scripts/check-electron.js — postinstall sanity check
 *
 * Runs automatically after `npm install`. Verifies the Electron binary
 * that npm just downloaded actually exists and reports its version,
 * catching a corrupted/incomplete install immediately with a clear
 * message — instead of the cryptic runtime crash from electron/index.js
 * ("Electron failed to install correctly...") that otherwise only shows
 * up later when you run `npm run dev`.
 *
 * This is non-fatal: it warns but does not fail the install, since a
 * fresh `npm install` failing here would be more disruptive than helpful
 * (e.g. on CI where Electron's binary might be fetched in a later step).
 */
const fs = require('fs');

let electronPath;
try {
  electronPath = require('electron');
} catch {
  // Module itself missing — this is normal mid-install (e.g. npm hasn't
  // gotten to electron's postinstall yet) and not necessarily a problem.
  // Stay quiet rather than alarm people on every fresh install.
  process.exit(0);
}

try {
  if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
    throw new Error('binary path missing or does not exist on disk');
  }
  console.log(`✓ Electron binary OK (${electronPath})`);
} catch (e) {
  console.warn(`
⚠️  Electron binary check failed: ${e.message}

This usually means a previous 'npm audit fix --force' (or a half-finished
install) corrupted the downloaded Electron binary. Fix it with:

  rm -rf node_modules package-lock.json
  npm install

Avoid running 'npm audit fix --force' in this project — Electron's version
is intentionally pinned (see "overrides" in package.json) because force-
upgrading it independently of the rest of the toolchain is what causes
this in the first place. Electron's own advisories are about apps *built
with* Electron exposing unsafe APIs to remote content; they don't apply to
running this app locally to read RSS feeds.
`);
}
