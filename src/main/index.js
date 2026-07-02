'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');

// Disable mDNS/Bonjour (used by Chromium for WebRTC peer discovery).
// Without this, Electron triggers macOS's "local network access" permission
// dialog on first launch, which confuses users — Flux only makes outbound
// HTTP requests to feed URLs and never does peer-to-peer networking.
// Must be called before app is ready.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const {
  loadDeps, fetchArticle, fetchFeed, fetchFeedAvatar, buildOpml, parseOpml, ollamaCluster, ollamaSummarize, ollamaDailyDigest,
  getCookieJar, resolveFeedUrl,
} = require('../core/fetcher');
const { JSONStore } = require('../../server/db');

// ─── Custom app:// protocol for the packaged build ───────────────────────────
// Production builds previously loaded dist/index.html directly via
// win.loadFile(), which puts the renderer under a file:// origin. Chromium's
// CSP 'self' keyword is unreliable under file:// — it frequently rejects the
// page's own sibling assets (hashed JS/CSS bundles, the favicon, etc.) with
// "Not allowed to load local resource", producing a blank window. This is
// invisible in dev because the dev server runs on a real http:// origin.
//
// Fix: serve the built app over a custom 'app://' scheme instead, registered
// as privileged (standard + secure) so 'self' in CSP resolves the way it
// does for http(s) origins. This must be registered before app.whenReady().
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const DIST_DIR = path.join(__dirname, '../../dist');

// net.fetch()'s MIME sniffing for file:// URLs has been inconsistent
// across Electron/Chromium versions — sometimes it omits Content-Type
// entirely, sometimes it falls back to application/octet-stream. Browsers
// can refuse to render content from an <img>/<link> tag when the
// Content-Type doesn't match what the tag expects, even though the bytes
// loaded successfully — this is the most likely explanation for the
// sidebar icon (an .svg loaded via a plain <img> tag, outside Vite's
// module graph) silently failing to render in the packaged app while
// everything else worked. Setting it explicitly by extension removes the
// guesswork entirely.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
};

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const reqUrl = new URL(request.url);
    // app://flux/some/path -> dist/some/path  (host segment is ignored/arbitrary)
    let relPath = decodeURIComponent(reqUrl.pathname);
    if (!relPath || relPath === '/') relPath = '/index.html';
    const filePath = path.normalize(path.join(DIST_DIR, relPath));
    // Guard against path traversal escaping dist/
    if (!filePath.startsWith(DIST_DIR)) {
      return new Response('Forbidden', { status: 403 });
    }

    let body;
    try {
      body = fs.readFileSync(filePath);
    } catch {
      return new Response('Not Found', { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return new Response(body, { status: 200, headers: { 'Content-Type': contentType } });
  });
}

// ─── Persistent storage ───────────────────────────────────────────────────────
// Both Electron (here) and the web server (server/index.js) default to the
// same OS-standard userData path so they share data with zero configuration:
//   macOS:   ~/Library/Application Support/Flux/flux-data.json
//   Windows: %APPDATA%/Flux/flux-data.json
//   Linux:   ~/.config/Flux/flux-data.json
// server/index.js computes the same path via plain Node/os module (no
// Electron API needed there), so running `npm run dev` alongside
// `npm run dev:server` automatically shares the same JSON file.
// Override: FLUX_DB_PATH env var (Electron) or DB_PATH env var (server).
const USER_ID = 1; // single-user, matches server/index.js
const DEFAULT_DB_PATH = path.join(app.getPath('userData'), 'flux-data.json');
let store;
function getStore() {
  if (!store) {
    const dbPath = process.env.FLUX_DB_PATH || DEFAULT_DB_PATH;
    // Ensure directory exists (userData may not exist on first run)
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    store = new JSONStore(dbPath);
    console.log(`[flux] data file: ${dbPath}`);
  }
  return store;
}

// ─── Per-domain cookie jars ───────────────────────────────────────────────────
const cookieJars = {};

// Map a JSONStore feed row (which carries id/userId) to the shape the
// renderer expects (no userId leaking through).
const feedRow = (f) => ({
  id: f.id, name: f.name, url: f.url, folder: f.folder || null,
  isYoutube: !!f.isYoutube, inlineBrowser: !!f.inlineBrowser, hideShorts: !!f.hideShorts,
  cssSelectors: f.cssSelectors || [], htmlPatterns: f.htmlPatterns || [], favicon: f.favicon || null,
  titleBlocklist: f.titleBlocklist || [], fetchStrategyOrder: f.fetchStrategyOrder || [],
});

// ─── IPC ─────────────────────────────────────────────────────────────────────
function registerIPC() {
  const db = getStore();

  // Feeds
  ipcMain.handle('feeds:list', () => db.listFeeds(USER_ID).map(feedRow));

  ipcMain.handle('feeds:resolve', async (_, url) => {
    try { return await resolveFeedUrl(url, cookieJars); }
    catch (e) { throw new Error(e.message); }
  });

  ipcMain.handle('feeds:add', (_, cfg) => {
    let url = (cfg.url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let hostname;
    try { hostname = new URL(url).hostname; }
    catch { throw new Error('Invalid feed URL'); }

    // See the matching comment in server/index.js's POST /api/feeds —
    // duplicate feed URLs were the root cause of articles appearing to
    // "phantom" into folders they don't belong to.
    if (db.feedUrlExists(USER_ID, url)) {
      throw new Error('This feed is already added.');
    }

    const feed = db.addFeed(USER_ID, {
      name: cfg.name || hostname,
      url,
      folder: cfg.folder || null,
      isYoutube: url.includes('youtube.com'),
      inlineBrowser: cfg.inlineBrowser || false,
      hideShorts: cfg.hideShorts || false,
      cssSelectors: cfg.cssSelectors || [],
      htmlPatterns: cfg.htmlPatterns || [],
      favicon: null,
    });
    return feedRow(feed);
  });

  // Article content cache — avoid re-fetching the same article on every
  // open. Declared here (above feeds:updateRules) so the rules handler can
  // invalidate it — see the comment there for why that matters.
  const articleCache = new Map();
  function articleTtlMs() {
    const days = db.getSettings(USER_ID).articleCacheDays ?? 7;
    return days * 24 * 60 * 60 * 1000;
  }

  ipcMain.handle('feeds:remove', (_, id) => { db.removeFeed(USER_ID, id); return true; });

  ipcMain.handle('feeds:updateRules', (_, { feedId, cssSelectors, htmlPatterns, inlineBrowser, hideShorts, name, folder, favicon, titleBlocklist, fetchStrategyOrder }) => {
    const patch = {};
    if (cssSelectors  !== undefined) patch.cssSelectors  = cssSelectors;
    if (htmlPatterns  !== undefined) patch.htmlPatterns  = htmlPatterns;
    if (inlineBrowser !== undefined) patch.inlineBrowser = inlineBrowser;
    if (hideShorts    !== undefined) patch.hideShorts    = hideShorts;
    if (name          !== undefined) patch.name          = name;
    if (folder        !== undefined) patch.folder        = folder;
    if (favicon       !== undefined) patch.favicon       = favicon;
    if (titleBlocklist!== undefined) patch.titleBlocklist= titleBlocklist;
    if (fetchStrategyOrder !== undefined) patch.fetchStrategyOrder = fetchStrategyOrder;
    db.updateFeed(USER_ID, feedId, patch);
    // Bust the article cache whenever a feed's block rules change. Without
    // this, the element picker's "did the rule actually work?" verification
    // re-fetch was hitting a cached copy of the article fetched *before*
    // the rule existed — so the selector would always appear to "still
    // match," even though the rule was working correctly. The verification
    // wasn't lying; it was checking stale content. cssSelectors/htmlPatterns
    // are the only fields that affect fetchArticle's output, but it's
    // simpler and cheap (just forces a re-fetch, not data loss) to clear
    // on any rules update rather than track per-field.
    if (cssSelectors !== undefined || htmlPatterns !== undefined) {
      // Only bust cache entries belonging to this specific feed, not the
      // entire cache. Previously articleCache.clear() meant every other
      // feed's cached articles got evicted too, forcing unnecessary
      // re-fetches for unrelated content.
      for (const [url, entry] of articleCache) {
        if (entry.feedId === feedId) articleCache.delete(url);
      }
    }
    return true;
  });

  ipcMain.handle('feeds:fetchAll', async () => {
    // Legacy batch path — kept for compatibility but streams via event now.
    // Prefer feeds:fetchStream for new code.
    const feeds = db.listFeeds(USER_ID).map(feedRow);
    const CONCURRENCY = 8;
    const results = new Array(feeds.length);
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (next < feeds.length) {
        const i = next++;
        try { results[i] = { ok: true, ...(await fetchFeed(feeds[i], cookieJars)) }; }
        catch (e) { results[i] = { ok: false, feedId: feeds[i].id, error: e.message }; }
      }
    }));
    return results;
  });

  // Streaming feed fetch: pushes each result to the renderer as it
  // completes rather than waiting for all feeds to finish. This makes
  // articles appear progressively — the first feed shows up in ~200ms
  // instead of waiting for the slowest feed in the batch.
  ipcMain.handle('feeds:fetchStream', async (event) => {
    const feeds = db.listFeeds(USER_ID).map(feedRow);
    const CONCURRENCY = 10; // Higher than batch since we're streaming not blocking UI
    let next = 0;
    let done = 0;
    const total = feeds.length;

    const send = (payload) => {
      try { event.sender.send('feeds:streamResult', payload); } catch {}
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
      while (next < total) {
        const i = next++;
        const feed = feeds[i];
        try {
          const result = await fetchFeed(feed, cookieJars);
          done++;
          send({ ok: true, done, total, ...result });
        } catch (e) {
          done++;
          send({ ok: false, done, total, feedId: feed.id, error: e.message });
        }
      }
    }));

    // After all articles are streaming in, kick off background avatar
    // upgrades for YouTube feeds — these are slow page-scrapes that
    // shouldn't delay articles showing up. Fire-and-forget, one at a time
    // to stay polite to YouTube's servers.
    const ytFeeds = feeds.filter(f => f.isYoutube || f.url.includes('youtube.com'));
    for (const feed of ytFeeds) {
      try {
        const avatar = await fetchFeedAvatar(feed, cookieJars);
        if (avatar && avatar !== feed.favicon) {
          db.updateFeed(USER_ID, feed.id, { favicon: avatar });
          send({ type: 'avatarUpdate', feedId: feed.id, favicon: avatar });
        }
      } catch {} // silently ignore — avatars are cosmetic
    }

    return { done: total };
  });

  ipcMain.handle('feeds:fetchOne', async (_, feedId) => {
    const feed = db.findFeed(USER_ID, feedId);
    if (!feed) throw new Error('Feed not found: ' + feedId);
    return fetchFeed(feedRow(feed), cookieJars);
  });

  ipcMain.handle('article:fetch', async (_, { url, feedId, rssFallback }) => {
    const ttl = articleTtlMs();
    const cached = articleCache.get(url);
    if (cached && Date.now() - cached.ts < ttl) return cached.result;

    const feed = feedId ? db.findFeed(USER_ID, feedId) : null;
    const feedRowData = feed ? feedRow(feed) : null;
    // Per-feed fetch order wins; otherwise fall back to the global default
    // set in Settings. fetchArticle reads feedRules.fetchStrategyOrder.
    if (feedRowData && !feedRowData.fetchStrategyOrder?.length) {
      const globalOrder = db.getSettings(USER_ID).fetchStrategyOrder;
      if (globalOrder?.length) feedRowData.fetchStrategyOrder = globalOrder;
    }
    const result = await fetchArticle(url, feedRowData, cookieJars, rssFallback);
    articleCache.set(url, { ts: Date.now(), feedId: feedId || null, result });
    return result;
  });

  ipcMain.handle('article:clearCache', (_, url) => {
    if (url) articleCache.delete(url);
    else articleCache.clear();
    return true;
  });

  // Folders
  ipcMain.handle('folders:list', () => {
    const folders = db.listFolders(USER_ID);
    return folders.length ? folders.map(f => ({ id: f.id, name: f.name, icon: f.icon })) : [];
  });
  ipcMain.handle('folders:add', (_, { name, icon }) => {
    const f = db.addFolder(USER_ID, name, icon || '◈');
    return { id: f.id, name: f.name, icon: f.icon };
  });
  ipcMain.handle('folders:remove', (_, id) => { db.removeFolder(USER_ID, id); return true; });
  ipcMain.handle('folders:reorder', (_, orderedIds) => { db.reorderFolders(USER_ID, orderedIds); return true; });
  ipcMain.handle('folders:update', (_, { folderId, name, icon }) => {
    const folder = db.updateFolder(USER_ID, folderId, { name, icon });
    if (!folder) throw new Error('Folder not found');
    return folder;
  });

  // Open a URL in the user's actual default browser (Safari/Chrome/etc.),
  // not the in-app inline browser or a new Electron window.
  ipcMain.handle('shell:openExternal', (_, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    shell.openExternal(url);
    return true;
  });

  // Article state
  ipcMain.handle('articles:getState', () => db.getArticleState(USER_ID));
  ipcMain.handle('articles:markRead', (_, { articleId, feedId }) => {
    db.markRead(USER_ID, `${feedId}:${articleId}`);
    return true;
  });
  ipcMain.handle('articles:toggleStar', (_, { articleId, feedId, starred }) => {
    db.toggleStar(USER_ID, `${feedId}:${articleId}`, !!starred);
    return true;
  });

  // Cookies
  ipcMain.handle('cookies:getForDomain', (_, domain) => getCookieJar(domain, cookieJars).toJSON());
  ipcMain.handle('cookies:clearForDomain', (_, domain) => { delete cookieJars[domain]; return true; });

  // Settings
  ipcMain.handle('settings:get', () => db.getSettings(USER_ID));
  ipcMain.handle('settings:set', (_, data) => { db.setSettings(USER_ID, data); return true; });

  // Remote-server config ("connect to external server" mode) — a small
  // file separate from flux-data.json, since it's device/installation-level
  // connection info (which server, which device's session token), not
  // synced user content. Lets someone use the desktop app against a
  // server hosted elsewhere while other devices use the plain website,
  // sharing one account.
  const REMOTE_CONFIG_PATH = path.join(app.getPath('userData'), 'remote-config.json');
  ipcMain.handle('remote:getConfig', () => {
    try { return JSON.parse(fs.readFileSync(REMOTE_CONFIG_PATH, 'utf8')); }
    catch { return null; }
  });
  ipcMain.handle('remote:setConfig', (_, cfg) => {
    fs.writeFileSync(REMOTE_CONFIG_PATH, JSON.stringify(cfg || null));
    return true;
  });
  ipcMain.handle('remote:clear', () => {
    try { fs.unlinkSync(REMOTE_CONFIG_PATH); } catch {}
    return true;
  });

  // OPML export
  ipcMain.handle('opml:export', async () => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export feeds as OPML',
      defaultPath: `flux-feeds-${new Date().toISOString().slice(0,10)}.opml`,
      filters: [{ name: 'OPML Files', extensions: ['opml','xml'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const feeds = db.listFeeds(USER_ID).map(feedRow);
    const opml = buildOpml(feeds, db.listFolders(USER_ID));
    fs.writeFileSync(filePath, opml, 'utf8');
    return { canceled: false, filePath, count: feeds.length };
  });

  // OPML import
  ipcMain.handle('opml:import', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import OPML file',
      filters: [{ name: 'OPML Files', extensions: ['opml','xml'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { canceled: true };

    const xml = fs.readFileSync(filePaths[0], 'utf8');
    const { folders: of_, feeds: ofeeds } = parseOpml(xml);

    const folderMap = {};
    for (const ef of db.listFolders(USER_ID)) folderMap[ef.name] = ef.id;
    for (const f of of_) {
      if (!folderMap[f.name]) {
        const folder = db.addFolder(USER_ID, f.name, f.icon || '◈');
        folderMap[folder.name] = folder.id;
      }
    }

    let imported = 0, skipped = 0;
    for (const f of ofeeds) {
      if (db.feedUrlExists(USER_ID, f.url)) { skipped++; continue; }
      db.addFeed(USER_ID, {
        name: f.name, url: f.url,
        folder: f.folderName ? (folderMap[f.folderName] || null) : null,
        isYoutube: f.url.includes('youtube.com'),
        inlineBrowser: f.inlineBrowser || false,
        hideShorts: false,
        cssSelectors: f.cssSelectors || [],
        htmlPatterns: f.htmlPatterns || [],
        favicon: null,
      });
      imported++;
    }
    return { canceled: false, imported, skipped, total: ofeeds.length };
  });

  // Ollama
  // Use 127.0.0.1 explicitly rather than 'localhost' — on macOS, 'localhost'
  // can resolve to ::1 (IPv6) but Ollama binds to 127.0.0.1 (IPv4) by
  // default, causing ECONNREFUSED even when Ollama is running.
  const defaultOllamaUrl = 'http://127.0.0.1:11434';
  let ollamaProc = null; // child process we spawned, if any

  ipcMain.handle('ollama:isRunning', async (_, ollamaUrl) => {
    const url = (ollamaUrl || defaultOllamaUrl).replace('localhost', '127.0.0.1');
    try {
      const { net } = require('electron');
      const resp = await net.fetch(`${url}/`);
      return { running: resp.ok || resp.status < 500 };
    } catch {
      return { running: false };
    }
  });

  ipcMain.handle('ollama:start', async (_, ollamaUrl) => {
    const url = (ollamaUrl || defaultOllamaUrl).replace('localhost', '127.0.0.1');
    // Don't spawn a second one if already running
    const { net } = require('electron');
    try {
      const r = await net.fetch(`${url}/`);
      if (r.ok || r.status < 500) return { ok: true, alreadyRunning: true };
    } catch {}

    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      // Try common install locations on macOS/Linux/Windows
      const candidates = [
        'ollama',
        '/usr/local/bin/ollama',
        '/opt/homebrew/bin/ollama',
        `${process.env.HOME}/.ollama/ollama`,
        'C:\\Program Files\\Ollama\\ollama.exe',
      ];
      let proc = null;
      for (const bin of candidates) {
        try {
          proc = spawn(bin, ['serve'], {
            detached: false,
            stdio: 'ignore',
            env: { ...process.env },
          });
          proc.on('error', () => {}); // ignore per-candidate errors silently
          if (proc.pid) break;
        } catch {}
      }

      if (!proc?.pid) {
        resolve({ ok: false, error: 'Could not find the ollama executable. Make sure Ollama is installed.' });
        return;
      }

      ollamaProc = proc;
      proc.on('exit', () => { if (ollamaProc === proc) ollamaProc = null; });

      // Poll until Ollama responds or we time out (8s)
      const deadline = Date.now() + 8000;
      const poll = async () => {
        try {
          const r = await net.fetch(`${url}/`);
          if (r.ok || r.status < 500) { resolve({ ok: true, alreadyRunning: false }); return; }
        } catch {}
        if (Date.now() > deadline) {
          resolve({ ok: false, error: 'Ollama started but did not respond within 8 seconds.' });
          return;
        }
        setTimeout(poll, 400);
      };
      setTimeout(poll, 800); // give it a moment before first ping
    });
  });

  ipcMain.handle('ollama:stopIfStarted', () => {
    if (ollamaProc) {
      try { ollamaProc.kill(); } catch {}
      ollamaProc = null;
    }
    return { ok: true };
  });

  ipcMain.handle('ollama:cluster', async (_, { articles, ollamaUrl, model, maxDaysApart, excludeSameSource }) => {
    const url = (ollamaUrl || defaultOllamaUrl).replace('localhost', '127.0.0.1');
    return ollamaCluster(articles, url, model || 'nomic-embed-text', { maxDaysApart, excludeSameSource });
  });
  ipcMain.handle('ollama:summarize', async (_, { items, ollamaUrl, model }) => {
    const url = (ollamaUrl || defaultOllamaUrl).replace('localhost', '127.0.0.1');
    return ollamaSummarize(items, url, model || 'llama3.2');
  });
  ipcMain.handle('ollama:dailyDigest', async (_, { articles, ollamaUrl, model }) => {
    const url = (ollamaUrl || defaultOllamaUrl).replace('localhost', '127.0.0.1');
    return ollamaDailyDigest(articles, url, model || 'llama3.2');
  });
}

// ─── Ad / tracker blocklist ───────────────────────────────────────────────────
const AD_BLOCK_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'adservice.google.com', 'permutive.app', 'permutive.com',
  'scorecardresearch.com', 'taboola.com', 'outbrain.com', 'criteo.com',
  'amazon-adsystem.com', 'adsrvr.org', 'pubmatic.com', 'rubiconproject.com',
  'openx.net', 'casalemedia.com', 'moatads.com', 'quantserve.com',
  'adnxs.com', '3lift.com', 'adform.net', 'media.net', 'bidswitch.net',
  'connatix.com', 'chartbeat.com', 'parsely.com',
];

function applyAdBlock(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const blocked = AD_BLOCK_DOMAINS.some(d => details.url.includes(d));
    callback({ cancel: blocked });
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1300, height: 820,
    minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e0e12',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  applyAdBlock(win.webContents.session);

  // Hard backstop: the main window must never navigate away from our own
  // app content. Without this, if a link click ever escapes our renderer
  // JS's click interception for any reason (a timing race, a link shape
  // our handler doesn't recognize, a redirect, a form submit — any path
  // that triggers a "real" navigation rather than being preventDefault'd),
  // the *entire* main window would load that external page in place of
  // our UI: no toolbar, no sidebar, nothing — because at that point the
  // window isn't showing our app anymore, it's showing the external site
  // directly. That's "stuck with no way back to Flux," and JS-only
  // protection in the renderer can never fully rule it out since it
  // depends on every click handler being airtight. This Electron-level
  // guard is unconditional: any attempted navigation away from our own
  // app:// (packaged) or localhost:5173 (dev) origin is blocked outright,
  // and handed to the system's default browser instead — so external
  // links always escape to a real browser tab, never replace the app.
  win.webContents.on('will-navigate', (event, url) => {
    const isOwnOrigin = url.startsWith('app://flux/') || url.startsWith('http://localhost:5173');
    if (!isOwnOrigin) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on('did-attach-webview', (_event, webContents) => {
    applyAdBlock(webContents.session);
    webContents.setWindowOpenHandler(({ url }) => {
      // Send to renderer — InlineBrowser's onNewWindow handler will load it
      // in the inline browser if the inline browser is currently open,
      // otherwise api.webview.onNewWindow falls back to openExternal.
      // Don't call shell.openExternal here directly — the renderer needs to
      // decide based on whether InlineBrowser is mounted.
      win.webContents.send('webview:new-window', url);
      return { action: 'deny' };
    });
    // Only restrict navigation for YouTube embed webviews (the ones used
    // for the video player). InlineBrowser webviews must be free to navigate
    // anywhere — that's the whole point of an inline browser.
    //
    // We identify YouTube embed webviews by their initial src URL. The
    // InlineBrowser webview starts at the article/site URL, not a YouTube
    // embed URL.
    let isYouTubeEmbed = false;
    webContents.once('did-start-loading', () => {
      try {
        const u = new URL(webContents.getURL?.() || '');
        isYouTubeEmbed = u.hostname.includes('youtube') || u.hostname.includes('youtu.be');
      } catch {}
    });

    webContents.on('will-navigate', (event, url) => {
      if (!isYouTubeEmbed) return; // InlineBrowser: navigate freely
      try {
        const u = new URL(url);
        const allowed = ['youtube.com', 'youtu.be', 'accounts.google.com', 'youtube-nocookie.com'];
        if (!allowed.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) {
          event.preventDefault();
          if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        }
      } catch {}
    });
    webContents.on('did-fail-load', (event, errorCode) => {
      if (errorCode === -3) event.preventDefault?.();
    });
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadURL('app://flux/index.html');
  }
  return win;
}

app.whenReady().then(async () => {
  registerAppProtocol();
  await loadDeps();
  registerIPC();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
