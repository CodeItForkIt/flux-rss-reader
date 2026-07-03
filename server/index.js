'use strict';
/**
 * server/index.js — Flux web server (accounts + device-token auth, no Docker)
 *
 * Serves the same data file as the Electron app — point DB_PATH at the same
 * JSON file and the web UI and Electron share data seamlessly.
 *
 * No login/registration. Anyone who can reach the port can use it.
 * Run behind a VPN or local network only, or add your own reverse-proxy auth.
 *
 * Ports:
 *   :3000  This Express server  (npm run dev:server)
 *   :5173  Vite dev server      (npm run dev:renderer, part of npm run dev)
 *
 * In dev, the Vite server proxies /api/* → :3000, so the browser only talks
 * to one origin. In production (npm run build), this server serves dist/ too.
 *
 * Electron never talks to this server — it uses IPC directly.
 */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const dns      = require('dns').promises;
const crypto   = require('crypto');
const multer   = require('multer');
const bcrypt   = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode  = require('qrcode');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const { createStore } = require('./store-factory');

const {
  loadDeps, fetchArticle, fetchFeed, fetchWithCookies,
  buildOpml, parseOpml, ollamaCluster, ollamaSummarize, ollamaDailyDigest, resolveFeedUrl,
} = require('../src/core/fetcher');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT         = parseInt(process.env.PORT || '3000', 10);

// Default data path: same location the packaged Electron app uses
// (~/Library/Application Support/Flux/flux-data.json on macOS,
//  %APPDATA%/Flux/flux-data.json on Windows,
//  ~/.config/Flux/flux-data.json on Linux) so server and app share data
// automatically without needing to set env vars manually.
// Override with DB_PATH env var to point anywhere else.
function getDefaultDbPath() {
  const appName = 'Flux'; // matches electron-builder productName
  let appData;
  if (process.platform === 'darwin') {
    appData = path.join(os.homedir(), 'Library', 'Application Support');
  } else if (process.platform === 'win32') {
    appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else {
    appData = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }
  return path.join(appData, appName, 'flux-data.json');
}

const DB_PATH      = process.env.DB_PATH || getDefaultDbPath();
const STATIC_DIR   = path.join(__dirname, '..', 'dist');
const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';
// Comma-separated list of allowed origins for the web build, e.g.
// "https://flux.example.com,https://flux-staging.example.com". Defaults to
// "same-origin only" (no cross-origin access at all) rather than the old
// `origin: true` (reflect-any-origin), which let any website a person
// happened to have open make authenticated-looking requests against their
// own Flux server purely because the browser was willing to send them.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
// Registration is open by default only until the first account exists —
// after that, a fresh ALLOW_SIGNUP=true env var is required to add more
// accounts (e.g. for a household sharing one instance). This keeps a
// freshly-exposed instance from being an open signup form to the internet
// by default, while still supporting more than one person.
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === 'true';

const db = createStore(DB_PATH);

// Single-user stub — all operations use userId = 1
// Multi-user now — req.userId is set by the requireAuth middleware below
// from the caller's device-session token, rather than a hardcoded stub.

// ─── In-memory cookie jars ────────────────────────────────────────────────────
const cookieJars = {};

// ─── Article content cache ──────────────────────────────────────────────────
// Thin wrapper around whichever store is active (db.cacheGet/Set/Delete/
// Entries) — JSONStore backs this with a local file, SupabaseStore with a
// Postgres table. Both are async here so this code doesn't need to know or
// care which one is in play.
const articleCache = {
  get: (url) => db.cacheGet(url),
  set: (url, val) => db.cacheSet(url, val),
  delete: (url) => db.cacheDelete(url),
  entries: () => db.cacheEntries(),
};
async function articleTtlMs(userId) {
  // No request context at startup (userId undefined) — use the 7-day
  // default rather than any specific user's setting, since this pass is
  // just a size-bounding optimization, not a per-request correctness check.
  const days = userId != null ? ((await db.getSettings(userId)).articleCacheDays ?? 7) : 7;
  return days * 24 * 60 * 60 * 1000;
}
// Prune expired entries on startup to keep the cache from growing
// unboundedly. Best-effort — if the store isn't ready yet or this throws
// for any reason, it's not worth failing startup over.
(async () => {
  try {
    const startupTtl = await articleTtlMs();
    for (const [url, entry] of await articleCache.entries()) {
      if (Date.now() - entry.ts > startupTtl) await articleCache.delete(url);
    }
  } catch (e) { console.error('[article-cache] startup prune skipped:', e.message); }
})();

// ─── SSRF guard ───────────────────────────────────────────────────────────────
// /api/proxy, /api/feeds/resolve, and article/feed fetching all cause THIS
// SERVER to make an outbound request to a URL the client supplies. Without
// a check, a caller could point that at 127.0.0.1, a Docker/VM host's
// internal network, or a cloud provider's metadata endpoint
// (169.254.169.254) and have the server fetch it on their behalf. Checking
// the literal hostname string isn't enough — a hostname can resolve to a
// private IP even when it doesn't look like one — so this resolves DNS
// first and checks the actual resulting address.
function isPrivateOrReservedIp(ip) {
  if (ip.includes(':')) { // IPv6
    const low = ip.toLowerCase();
    return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80') || low === '::';
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true; // malformed — fail closed
  const [a, b] = parts;
  if (a === 127) return true;                          // loopback
  if (a === 10) return true;                            // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
  if (a === 192 && b === 168) return true;               // 192.168.0.0/16
  if (a === 169 && b === 254) return true;               // link-local incl. cloud metadata (169.254.169.254)
  if (a === 0) return true;
  return false;
}
async function checkSsrfSafe(hostname) {
  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const r of records) {
      if (isPrivateOrReservedIp(r.address)) {
        return `Refusing to fetch ${hostname} — resolves to a private/internal address.`;
      }
    }
    return null; // safe
  } catch {
    return `Could not resolve ${hostname}.`;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const TOKEN_HEADER = 'authorization';
function newToken() { return crypto.randomBytes(32).toString('hex'); }
async function requireAuth(req, res, next) {
  const header = req.headers[TOKEN_HEADER] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const session = await db.findSession(token);
    if (!session) return res.status(401).json({ error: 'Session expired or invalid — please log in again.' });
    db.touchSession(token).catch(()=>{}); // fire-and-forget — a failed "last seen" bump shouldn't block the request
    req.userId = session.userId;
    next();
  } catch (e) { res.status(500).json({ error: `Auth check failed: ${e.message}` }); }
}

// A request originating from localhost or the same private network isn't
// subject to the internet-facing brute-force/abuse concerns rate limiting
// exists for — the operator running curl against their own box, or another
// device on the same LAN before this was ever exposed publicly, shouldn't
// get throttled. This checks the actual connecting IP, not a header (which
// a remote caller could spoof to fake being "local").
function isLocalRequest(req) {
  let ip = req.ip || req.socket?.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || isPrivateOrReservedIp(ip);
}
async function rateLimitingActive(req) {
  const sys = await db.getSystemSettings();
  return sys.rateLimitEnabled && !isLocalRequest(req);
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

app.use(helmet({
  contentSecurityPolicy: false, // the SPA and inline-browser proxy both need inline scripts/styles; a real CSP here would need per-route tuning
  crossOriginEmbedderPolicy: false,
}));
app.use(cors(
  ALLOWED_ORIGINS.length
    ? { origin: ALLOWED_ORIGINS, credentials: true }
    : { origin: false } // no cross-origin access by default — set CORS_ORIGIN if the frontend is served from a different origin than the API
));
app.use(express.json({ limit: '2mb' }));

// Generous global limiter (guards against runaway clients/scripted abuse);
// tighter limiter specifically on auth to slow down password guessing.
// Both skip entirely for local/private-network requests and can be turned
// off instance-wide from Admin Settings.
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, skip: async (req) => !(await rateLimitingActive(req)) }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  skip: async (req) => !(await rateLimitingActive(req)),
  message: { error: 'Too many attempts — please wait a few minutes.' } });

async function signupOpen() {
  const sys = await db.getSystemSettings();
  return (await db.userCount()) === 0 || sys.allowSignup || ALLOW_SIGNUP;
}

// ─── Health & auth status (public — no token required) ─────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, version: '0.2.0' }));
app.get('/api/auth/status', async (req, res) => {
  res.json({ signupOpen: await signupOpen() });
});
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const isFirstUser = (await db.userCount()) === 0;
  if (!isFirstUser && !(await signupOpen())) {
    return res.status(403).json({ error: 'Registration is closed on this server.' });
  }
  const { username, password, email } = req.body || {};
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and a password of at least 8 characters are required.' });
  }
  if (await db.findUserByUsername(username)) return res.status(409).json({ error: 'That username is taken.' });
  // Email is optional but recommended — it's currently only used to help
  // identify an account (e.g. shown back to the person so they can confirm
  // which account they're in); there's no email-sending configured in this
  // server yet, so it isn't usable for verification or password-reset
  // emails until an SMTP/email-provider integration is added.
  if (email && await db.findUserByEmail(email)) return res.status(409).json({ error: 'That email is already associated with an account.' });
  const hash = await bcrypt.hash(password, 12);
  // The very first account on a fresh instance is the admin — there's no
  // one else to grant that role, and someone standing up their own server
  // is implicitly the operator.
  const user = await db.createUser(username.trim(), hash, isFirstUser, email ? email.trim() : null);
  const token = newToken();
  await db.createSession(user.id, token, req.body?.deviceLabel || null);
  res.json({ token, username: user.username, isAdmin: user.isAdmin });
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password, totpCode } = req.body || {};
  const user = await db.findUserByUsername((username || '').trim());
  // Compare against a dummy hash even when the user doesn't exist, so
  // response timing doesn't reveal whether a username is registered.
  const hash = user?.password || '$2a$12$C6UzMDM.H6dfI/f/IKcEeOoM2r6MW5v2AZTGvj8XZfZq8v0Ry9k7C';
  const ok = await bcrypt.compare(password || '', hash);
  if (!user || !ok) return res.status(401).json({ error: 'Invalid username or password.' });
  if (user.twoFactorEnabled) {
    // Two-step login: password is correct but a valid TOTP code is also
    // required before a session token is issued. The client re-submits
    // this same request with totpCode filled in once the person enters it.
    if (!totpCode) return res.json({ requiresTotp: true });
    if (!authenticator.check(String(totpCode).replace(/\s/g, ''), user.twoFactorSecret)) {
      return res.status(401).json({ error: 'Invalid authentication code.' });
    }
  }
  const token = newToken();
  await db.createSession(user.id, token, req.body?.deviceLabel || null);
  res.json({ token, username: user.username, isAdmin: !!user.isAdmin });
});
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const header = req.headers[TOKEN_HEADER] || '';
  await db.deleteSession(header.slice(7));
  res.json({ ok: true });
});
app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await db.findUserById(req.userId);
  res.json({ username: user?.username, isAdmin: !!user?.isAdmin, email: user?.email || null, twoFactorEnabled: !!user?.twoFactorEnabled });
});

// Change password — requires the current password, and (deliberately)
// leaves all *other* devices' sessions intact rather than logging everyone
// out, since "I changed my password" isn't the same signal as "I think
// someone else has access" (that's what 2FA disable / a future "sign out
// everywhere" action is for).
app.post('/api/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const user = await db.findUserById(req.userId);
  const ok = await bcrypt.compare(currentPassword || '', user.password);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
  await db.updateUser(user.id, { password: await bcrypt.hash(newPassword, 12) });
  res.json({ ok: true });
});

// ─── Two-factor auth (TOTP) ─────────────────────────────────────────────────
// Setup is two steps: /setup generates a secret and returns it (not yet
// persisted as enabled) so the person can scan/enter it into an
// authenticator app; /enable then requires one valid code against that
// secret before it's actually turned on — this confirms the app was set up
// correctly, rather than possibly locking someone out with a secret they
// never actually got working.
app.post('/api/auth/2fa/setup', requireAuth, async (req, res) => {
  const user = await db.findUserById(req.userId);
  const secret = authenticator.generateSecret();
  await db.updateUser(user.id, { pendingTwoFactorSecret: secret });
  const otpauth = authenticator.keyuri(user.username, 'Flux', secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth, { width: 220, margin: 1 });
  res.json({ secret, otpauth, qrCodeDataUrl });
});
app.post('/api/auth/2fa/enable', requireAuth, async (req, res) => {
  const { code } = req.body || {};
  const user = await db.findUserById(req.userId);
  if (!user.pendingTwoFactorSecret) return res.status(400).json({ error: 'Call /api/auth/2fa/setup first.' });
  if (!authenticator.check(String(code || '').replace(/\s/g, ''), user.pendingTwoFactorSecret)) {
    return res.status(401).json({ error: 'Invalid code — check the time on your device and try again.' });
  }
  await db.updateUser(user.id, { twoFactorSecret: user.pendingTwoFactorSecret, twoFactorEnabled: true, pendingTwoFactorSecret: null });
  res.json({ ok: true });
});
app.post('/api/auth/2fa/disable', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  const user = await db.findUserById(req.userId);
  const ok = await bcrypt.compare(password || '', user.password);
  if (!ok) return res.status(401).json({ error: 'Password is incorrect.' });
  await db.updateUser(user.id, { twoFactorSecret: null, twoFactorEnabled: false, pendingTwoFactorSecret: null });
  res.json({ ok: true });
});

async function requireAdmin(req, res, next) {
  const user = await db.findUserById(req.userId);
  if (!user?.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

// Instance-wide settings only the admin (first account created) can see or
// change — distinct from per-user `settings`, which each account controls
// for itself. Covers things that affect the whole server rather than one
// person's experience: rate limiting, whether AI features are available
// at all, and the shared Ollama connection they point at.
app.get('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  res.json(await db.getSystemSettings());
});
app.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const allowed = ['rateLimitEnabled', 'allowSignup', 'aiFeaturesEnabled', 'ollamaUrl', 'ollamaModel'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  res.json(await db.setSystemSettings(patch));
});

// Every route below this line requires a valid device session token.
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/health') return next();
  requireAuth(req, res, next);
});

// ─── Folders ──────────────────────────────────────────────────────────────────
app.get('/api/folders', async (req, res) => {
  res.json((await db.listFolders(req.userId)).map(f => ({ id: f.id, name: f.name, icon: f.icon })));
});
app.post('/api/folders', async (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  res.json(await db.addFolder(req.userId, name, icon || '◈'));
});
app.delete('/api/folders/:id', async (req, res) => {
  await db.removeFolder(req.userId, req.params.id);
  res.json({ ok: true });
});
app.put('/api/folders/reorder', async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
  await db.reorderFolders(req.userId, orderedIds);
  res.json({ ok: true });
});
app.patch('/api/folders/:id', async (req, res) => {
  const { name, icon } = req.body;
  const folder = await db.updateFolder(req.userId, req.params.id, { name, icon });
  if (!folder) return res.status(404).json({ error: 'Not found' });
  res.json(folder);
});

// ─── Feeds ────────────────────────────────────────────────────────────────────
const feedRow = (f) => ({
  id:            f.id,
  name:          f.name,
  url:           f.url,
  folder:        f.folder || null,
  isYoutube:     !!f.isYoutube,
  inlineBrowser: !!f.inlineBrowser,
  hideShorts:    !!f.hideShorts,
  cssSelectors:  f.cssSelectors || [],
  htmlPatterns:  f.htmlPatterns || [],
  favicon:       f.favicon || null,
  titleBlocklist: f.titleBlocklist || [],
  fetchStrategyOrder: f.fetchStrategyOrder || [],
});

app.get('/api/feeds', async (req, res) => {
  res.json((await db.listFeeds(req.userId)).map(feedRow));
});
// Feed discovery: paste a YouTube channel/video URL, a channel @handle
// URL, or any regular website URL, and resolve it to an actual feed URL.
// Powers the "discover" flow in AddFeedModal so people don't have to
// already know how to construct a YouTube RSS URL by hand.
app.post('/api/feeds/resolve', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  let hostname;
  try { hostname = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname; }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  const ssrfError = await checkSsrfSafe(hostname);
  if (ssrfError) return res.status(400).json({ error: ssrfError });
  try {
    const result = await resolveFeedUrl(url, cookieJars);
    res.json(result);
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

app.post('/api/feeds', async (req, res) => {
  let { name, url, folder, cssSelectors = [], htmlPatterns = [], inlineBrowser = false, hideShorts = false } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  url = url.trim();
  // Be forgiving of URLs pasted without a scheme (very common, especially
  // on mobile where people often paste from a share sheet) — without this,
  // `new URL()` below throws and the whole request 500s.
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let hostname;
  try { hostname = new URL(url).hostname; }
  catch { return res.status(400).json({ error: 'Invalid feed URL' }); }
  const ssrfError = await checkSsrfSafe(hostname);
  if (ssrfError) return res.status(400).json({ error: ssrfError });

  // Reject exact-duplicate feed URLs. Without this, adding the same feed
  // twice (e.g. retrying after an earlier error, or not realizing it was
  // already added) creates two separate feed records that both fetch and
  // store the same articles under two different feedIds — the same
  // physical article then appears to "phantom" into whichever folder the
  // second, possibly-misfiled feed entry happens to be in, and shows up
  // duplicated in unfiltered views.
  if (await db.feedUrlExists(req.userId, url)) {
    return res.status(409).json({ error: 'This feed is already added.' });
  }

  const feed = await db.addFeed(req.userId, {
    name: name || hostname, url, folder: folder || null,
    isYoutube: url.includes('youtube.com'), inlineBrowser: !!inlineBrowser,
    hideShorts: !!hideShorts, cssSelectors, htmlPatterns, favicon: null,
  });
  res.json(feedRow(feed));
});
app.patch('/api/feeds/:id', async (req, res) => {
  const { cssSelectors, htmlPatterns, inlineBrowser, hideShorts, name, folder, favicon, titleBlocklist, fetchStrategyOrder, url } = req.body;
  const patch = {};
  if (cssSelectors  !== undefined) patch.cssSelectors  = cssSelectors;
  if (htmlPatterns  !== undefined) patch.htmlPatterns  = htmlPatterns;
  if (inlineBrowser !== undefined) patch.inlineBrowser = !!inlineBrowser;
  if (hideShorts    !== undefined) patch.hideShorts    = !!hideShorts;
  if (name          !== undefined) patch.name          = name;
  if (folder        !== undefined) patch.folder        = folder;
  if (favicon       !== undefined) patch.favicon       = favicon;
  if (titleBlocklist!== undefined) patch.titleBlocklist= titleBlocklist;
  if (fetchStrategyOrder !== undefined) patch.fetchStrategyOrder = fetchStrategyOrder;
  if (url !== undefined) {
    let newUrl = url.trim();
    if (!/^https?:\/\//i.test(newUrl)) newUrl = 'https://' + newUrl;
    let hostname;
    try { hostname = new URL(newUrl).hostname; }
    catch { return res.status(400).json({ error: 'Invalid feed URL' }); }
    const ssrfError = await checkSsrfSafe(hostname);
    if (ssrfError) return res.status(400).json({ error: ssrfError });
    if (await db.feedUrlExists(req.userId, newUrl)) {
      const existing = (await db.listFeeds(req.userId)).find(f => f.url === newUrl);
      if (existing && existing.id !== req.params.id) return res.status(409).json({ error: 'Another feed already uses this URL.' });
    }
    patch.url = newUrl;
    patch.isYoutube = newUrl.includes('youtube.com');
  }
  const feed = await db.updateFeed(req.userId, req.params.id, patch);
  if (!feed) return res.status(404).json({ error: 'Not found' });
  // Changing the URL invalidates any cached content fetched under the old
  // one — without this, the reader would keep showing old-feed content
  // (or errors from it) until the cache TTL happens to expire on its own.
  if (url !== undefined) await articleCache.delete(feed.url);
  // Bust the article cache when block rules change — see the matching
  // comment in src/main/index.js's feeds:updateRules handler for why this
  // matters (otherwise the element picker's verification step checks
  // stale, pre-rule cached content and always reports a false negative).
  if (cssSelectors !== undefined || htmlPatterns !== undefined) {
    const feedId = req.params.id;
    for (const [cacheUrl, entry] of await articleCache.entries()) {
      if (entry.feedId === feedId) await articleCache.delete(cacheUrl);
    }
  }
  res.json(feedRow(feed));
});
app.delete('/api/feeds/:id', async (req, res) => {
  await db.removeFeed(req.userId, req.params.id);
  res.json({ ok: true });
});

// ─── Feed fetching ────────────────────────────────────────────────────────────
app.post('/api/feeds/fetch-all', async (req, res) => {
  const feeds = (await db.listFeeds(req.userId)).map(feedRow);
  const CONCURRENCY = 6;
  const results = new Array(feeds.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < feeds.length) {
      const i = next++;
      try { results[i] = { ok: true, ...await fetchFeed(feeds[i], cookieJars) }; }
      catch (e) { results[i] = { ok: false, feedId: feeds[i].id, error: e.message }; }
    }
  }));
  res.json(results);
});
app.post('/api/feeds/:id/fetch', async (req, res) => {
  const feed = await db.findFeed(req.userId, req.params.id);
  if (!feed) return res.status(404).json({ error: 'Not found' });
  try { res.json({ ok: true, ...await fetchFeed(feedRow(feed), cookieJars) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Article content ──────────────────────────────────────────────────────────
app.post('/api/article/fetch', async (req, res) => {
  const { url, feedId, rssFallback } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const ttl = await articleTtlMs(req.userId);
  const cached = await articleCache.get(url);
  if (cached && Date.now() - cached.ts < ttl) return res.json(cached.result);

  const feed = feedId ? await db.findFeed(req.userId, feedId) : null;
  const feedRowData = feed ? feedRow(feed) : null;
  if (feedRowData && !feedRowData.fetchStrategyOrder?.length) {
    const globalOrder = (await db.getSettings(req.userId)).fetchStrategyOrder;
    if (globalOrder?.length) feedRowData.fetchStrategyOrder = globalOrder;
  }
  try {
    const result = await fetchArticle(url, feedRowData, cookieJars, rssFallback);
    await articleCache.set(url, { ts: Date.now(), feedId: feedId || null, result });
    res.json(result);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/article/clear-cache', async (req, res) => {
  const { url } = req.body || {};
  if (url) {
    await articleCache.delete(url);
  } else {
    for (const [key] of await articleCache.entries()) await articleCache.delete(key);
  }
  res.json({ ok: true });
});

// ─── Article state ────────────────────────────────────────────────────────────
app.get('/api/articles/state', async (req, res) => res.json(await db.getArticleState(req.userId)));
app.post('/api/articles/mark-read', async (req, res) => {
  const { articleId, feedId } = req.body;
  await db.markRead(req.userId, `${feedId}:${articleId}`);
  res.json({ ok: true });
});
app.post('/api/articles/toggle-star', async (req, res) => {
  const { articleId, feedId, starred } = req.body;
  await db.toggleStar(req.userId, `${feedId}:${articleId}`, !!starred);
  res.json({ ok: true });
});

// ─── Inline browser proxy ─────────────────────────────────────────────────────
// Two layers of rewriting happen here:
//  1. Static HTML rewriting — root-relative/protocol-relative URLs in tag
//     attributes and CSS get rewritten to absolute URLs against the real
//     origin, so the *initial* page paints correctly.
//  2. A runtime shim injected into the page patches window.fetch and
//     XMLHttpRequest so any request the page's OWN JavaScript makes gets
//     routed back through this same /api/proxy endpoint instead of hitting
//     the real origin directly. Without this, a rewritten absolute URL like
//     https://site.com/api/cards still gets requested as genuine cross-origin
//     by the embedded page's own script — which the real site's CORS policy
//     almost never allows — so any content a site loads dynamically (hover
//     previews, infinite scroll, client-rendered data) silently fails even
//     though the static shell renders fine. Routing it back through our own
//     server makes it same-origin from the browser's perspective, so CORS
//     no longer applies at all.
app.get('/api/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing url param');
  let parsed;
  try { parsed = new URL(target); } catch { return res.status(400).send('Invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).send('Unsupported protocol');
  const ssrfError = await checkSsrfSafe(parsed.hostname);
  if (ssrfError) return res.status(400).send(ssrfError);
  try {
    const upstream = await fetchWithCookies(target, {}, cookieJars);
    const ct = upstream.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      let html = await upstream.text();
      const base = `${parsed.protocol}//${parsed.host}`;
      html = html
        // Root-relative: href="/x" → href="https://site.com/x"
        .replace(/(href|src|action)=("|')\/(?!\/)/g, `$1=$2${base}/`)
        // Protocol-relative: src="//cdn.site.com/x" → src="https://cdn.site.com/x"
        .replace(/(href|src|action)=("|')\/\//g, `$1=$2${parsed.protocol}//`)
        // srcset (images/picture) — comma-separated list of url + descriptor pairs
        .replace(/srcset=("|')([^"']+)("|')/gi, (m, q1, list, q2) => {
          const rewritten = list.split(',').map(part => {
            const seg = part.trim().split(/\s+/);
            if (seg[0].startsWith('/') && !seg[0].startsWith('//')) seg[0] = base + seg[0];
            else if (seg[0].startsWith('//')) seg[0] = parsed.protocol + seg[0];
            return seg.join(' ');
          }).join(', ');
          return `srcset=${q1}${rewritten}${q2}`;
        })
        // CSS url(...) in <style> blocks and inline style attributes
        .replace(/url\((["']?)\/(?!\/)([^)"']*)\1\)/gi, `url($1${base}/$2$1)`)
        .replace(/url\((["']?)\/\/([^)"']*)\1\)/gi, `url($1${parsed.protocol}//$2$1)`)
        .replace(/<head([^>]*)>/i, `<head$1><base href="${base}/">` + buildProxyShim(base));
      // Strip ALL frame-blocking mechanisms — X-Frame-Options and CSP
      // frame-ancestors both prevent the proxy iframe from rendering.
      res.removeHeader('X-Frame-Options');
      res.removeHeader('x-frame-options');
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('content-security-policy');
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.send(buf);
  } catch (e) { res.status(502).send(`Proxy fetch failed: ${e.message}`); }
});

function buildProxyShim(base) {
  // Runs before any of the page's own <script> tags. Rewrites same-page
  // fetch()/XHR calls to go through /api/proxy so they're same-origin (no
  // CORS) and share the same server-side cookie jar as the initial load.
  return `<script>(function(){
    var BASE=${JSON.stringify(base)};
    function toProxied(u){
      try{
        var abs=new URL(u, document.baseURI).href;
        if (abs.indexOf(location.origin+'/api/proxy')===0) return u; // already proxied
        return '/api/proxy?url='+encodeURIComponent(abs);
      }catch(e){ return u; }
    }
    var of=window.fetch;
    if (of) window.fetch=function(input, init){
      try{
        if (typeof input==='string') input=toProxied(input);
        else if (input && input.url) input=new Request(toProxied(input.url), input);
      }catch(e){}
      return of.call(this, input, init);
    };
    var oo=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method, url){
      try{ arguments[1]=toProxied(url); }catch(e){}
      return oo.apply(this, arguments);
    };
  })();</script>`;
}

// ─── OPML ─────────────────────────────────────────────────────────────────────
app.get('/api/opml/export', async (req, res) => {
  const feeds   = (await db.listFeeds(req.userId)).map(feedRow);
  const folders = await db.listFolders(req.userId);
  const opml    = buildOpml(feeds, folders);
  const fn = `flux-feeds-${new Date().toISOString().slice(0,10)}.opml`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
  res.send(opml);
});
app.post('/api/opml/import', upload.single('file'), async (req, res) => {
  const xml = req.file ? req.file.buffer.toString('utf8') : req.body.xml;
  if (!xml) return res.status(400).json({ error: 'No OPML data' });
  const { folders: of_, feeds: ofeeds } = parseOpml(xml);
  const folderMap = {};
  for (const ef of await db.listFolders(req.userId)) folderMap[ef.name] = ef.id;
  for (const f of of_) {
    if (!folderMap[f.name]) { const folder = await db.addFolder(req.userId, f.name, f.icon || '◈'); folderMap[folder.name] = folder.id; }
  }
  let imported = 0, skipped = 0;
  for (const f of ofeeds) {
    if (await db.feedUrlExists(req.userId, f.url)) { skipped++; continue; }
    await db.addFeed(req.userId, { name:f.name, url:f.url, folder:f.folderName?(folderMap[f.folderName]||null):null,
      isYoutube:f.url.includes('youtube.com'), inlineBrowser:!!f.inlineBrowser, hideShorts:false,
      cssSelectors:f.cssSelectors||[], htmlPatterns:f.htmlPatterns||[], favicon:null });
    imported++;
  }
  res.json({ imported, skipped, total: ofeeds.length });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => res.json(await db.getSettings(req.userId)));
app.put('/api/settings', async (req, res) => { await db.setSettings(req.userId, req.body || {}); res.json({ ok: true }); });

// ─── Ollama ───────────────────────────────────────────────────────────────────
// ─── Ollama ───────────────────────────────────────────────────────────────────
// The Electron app starts/stops Ollama from its main process via child_process.
// A traditionally-hosted server (a VPS, your own machine) can do the same
// thing — but a serverless platform like Vercel fundamentally can't:
// functions there don't allow spawning long-running background processes,
// and even if they did, each invocation is a fresh, isolated environment
// with no relationship to the next one. IS_SERVERLESS gates the
// process-spawning endpoint specifically; AI features themselves still
// work fine under Supabase/Vercel as long as OLLAMA_URL points at an
// Ollama instance running somewhere else that's reachable over HTTP.
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let ollamaProcess   = null;  // the child_process we spawned, if any
let weStartedOllama = false; // only stop it if we're the one who started it

async function pingOllama(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/ollama/is-running', async (req, res) => {
  const url = req.query.url || OLLAMA_URL;
  res.json({ running: await pingOllama(url) });
});

async function requireAiEnabled(req, res, next) {
  const sys = await db.getSystemSettings();
  if (!sys.aiFeaturesEnabled) {
    return res.status(403).json({ error: 'AI features are disabled on this server.' });
  }
  next();
}
// Admin-configured Ollama URL/model (system settings) take precedence over
// the env-var defaults, but a caller-supplied value (e.g. someone pointing
// their own client at a personal Ollama instance) wins over both.
async function resolvedOllama(reqUrl, reqModel) {
  const sys = await db.getSystemSettings();
  return { url: reqUrl || sys.ollamaUrl || OLLAMA_URL, model: reqModel || sys.ollamaModel || OLLAMA_MODEL };
}

app.post('/api/ollama/start', requireAiEnabled, async (req, res) => {
  if (IS_SERVERLESS) {
    return res.status(400).json({ ok: false, error: "Can't start Ollama from a serverless deployment (Vercel/Lambda) — there's no persistent process to keep it running. Run Ollama somewhere else (your own machine, a VPS) and point OLLAMA_URL / Admin Settings at it instead." });
  }
  const { url } = await resolvedOllama(req.body?.url);
  if (await pingOllama(url)) return res.json({ ok: true, alreadyRunning: true });

  if (ollamaProcess) return res.json({ ok: true, starting: true }); // a start is already in flight

  // PATH available to a server run as a background service (systemd,
  // launchd, pm2, etc.) often doesn't include Ollama's install location,
  // even though it's on PATH in an interactive shell — try the same
  // candidate locations the Electron build does before giving up.
  const candidates = [
    'ollama',
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    path.join(os.homedir(), '.ollama', 'ollama'),
    'C:\\Program Files\\Ollama\\ollama.exe',
  ];
  for (const bin of candidates) {
    try {
      const proc = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', env: { ...process.env } });
      proc.on('error', () => {}); // ignore per-candidate errors silently, try the next one
      if (proc.pid) { ollamaProcess = proc; break; }
    } catch {}
  }

  if (!ollamaProcess) {
    return res.status(500).json({ ok: false, error: 'Could not find the ollama executable. Make sure Ollama is installed and reachable from this process.' });
  }

  weStartedOllama = true;
  ollamaProcess.on('exit', () => { ollamaProcess = null; weStartedOllama = false; });

  // Poll until it actually responds, rather than guessing a fixed delay.
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await pingOllama(url)) return res.json({ ok: true });
  }
  res.status(502).json({ ok: false, error: 'Ollama process started but never became reachable after 10s.' });
});

app.post('/api/ollama/stop-if-started', async (req, res) => {
  if (weStartedOllama && ollamaProcess) {
    try {
      if (process.platform === 'win32') {
        // Windows: negative-PID process-group kill doesn't apply; taskkill
        // with /T tears down the child tree spawned by `ollama serve`.
        spawn('taskkill', ['/PID', String(ollamaProcess.pid), '/T', '/F']);
      } else {
        process.kill(-ollamaProcess.pid); // negative PID = whole process group (detached:true gave it its own)
      }
    } catch { try { ollamaProcess.kill(); } catch {} }
    ollamaProcess = null; weStartedOllama = false;
  }
  res.json({ ok: true });
});

app.post('/api/ollama/cluster', requireAiEnabled, async (req, res) => {
  const { articles, ollamaUrl, model, maxDaysApart, excludeSameSource } = req.body;
  if (!Array.isArray(articles)) return res.status(400).json({ error: 'articles array required' });
  const s = await db.getSettings(req.userId);
  const { url, model: resolvedModel } = await resolvedOllama(ollamaUrl, model);
  const opts = {
    maxDaysApart:      maxDaysApart      !== undefined ? maxDaysApart      : (s.clusterMaxDaysApart ?? 3),
    excludeSameSource: excludeSameSource !== undefined ? excludeSameSource : (s.clusterExcludeSameSource !== false),
  };
  try { res.json(await ollamaCluster(articles, url, resolvedModel, opts)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/ollama/summarize', requireAiEnabled, async (req, res) => {
  const { items, ollamaUrl, model } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  const { url, model: resolvedModel } = await resolvedOllama(ollamaUrl, model || 'llama3.2');
  try { res.json({ summary: await ollamaSummarize(items, url, resolvedModel) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/ollama/daily-digest', requireAiEnabled, async (req, res) => {
  const { articles, ollamaUrl, model } = req.body;
  if (!Array.isArray(articles)) return res.status(400).json({ error: 'articles array required' });
  const { url, model: resolvedModel } = await resolvedOllama(ollamaUrl, model || 'llama3.2');
  try { res.json({ digest: await ollamaDailyDigest(articles, url, resolvedModel) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Static SPA ───────────────────────────────────────────────────────────────
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', (_, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
} else {
  app.get('/', (_, res) => res.send('<h2>Flux: run <code>npm run build</code> first to serve the frontend.</h2>'));
}

// Simple per-request logger (dev-friendly, no extra deps)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const color = res.statusCode >= 500 ? '\x1b[31m' : res.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
    console.log(`${color}${res.statusCode}\x1b[0m ${req.method} ${req.path} \x1b[2m(${ms}ms)\x1b[0m`);
  });
  next();
});

// ─── Start ────────────────────────────────────────────────────────────────────
// Under Vercel (or any serverless platform), the platform's runtime owns the
// HTTP server and invokes the exported Express app per-request — calling
// app.listen() ourselves would be both unnecessary and actively wrong there
// (nothing would ever call it, or it could throw trying to bind a port that
// isn't relevant in that model). See api/index.js, the Vercel entry point,
// which does `module.exports = require('../server/index.js')`.
if (IS_SERVERLESS) {
  loadDeps().catch(e => console.error('Failed to load deps:', e));
} else {
  loadDeps().then(async () => {
    const ifaces = require('os').networkInterfaces();
    const localIps = Object.values(ifaces).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    app.listen(PORT, '0.0.0.0', async () => {
      console.log(`\n  \x1b[1m\x1b[36mFlux web server\x1b[0m`);
      console.log(`  \x1b[2mLocal:\x1b[0m   http://localhost:${PORT}`);
      localIps.forEach(ip => console.log(`  \x1b[2mNetwork:\x1b[0m http://${ip}:${PORT}  ← mobile/other devices`));
      console.log(`  \x1b[2mData:\x1b[0m    ${process.env.SUPABASE_URL ? `Supabase (${process.env.SUPABASE_URL})` : DB_PATH}`);
      console.log(`  \x1b[2mOllama:\x1b[0m  ${OLLAMA_URL}`);
      if ((await db.userCount()) === 0) {
        console.log(`\n  \x1b[33m⚠ No account exists yet — the first person to register becomes the admin.\x1b[0m`);
      }
      const sys = await db.getSystemSettings();
      if (ALLOW_SIGNUP || sys.allowSignup) {
        console.log(`  \x1b[33m⚠ Open signup is enabled — anyone who can reach this server can create an account.\x1b[0m`);
      }
      console.log('');
    });
  }).catch(e => { console.error('Failed to load deps:', e); process.exit(1); });
}

module.exports = app;
