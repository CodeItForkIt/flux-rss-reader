'use strict';
/**
 * server/db.js
 *
 * Tiny synchronous JSON-file "database". Replaces better-sqlite3, which
 * requires a native build step that frequently breaks on very new Node
 * versions (C++20/V8 ABI mismatches). For a self-hosted single-process app
 * with a handful of users, an in-memory object backed by a JSON file on disk
 * is plenty — every mutation writes the whole file synchronously.
 */

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, hashToken } = require('./crypto-util');

const EMPTY = () => ({
  nextUserId: 1,
  users: [],          // { id, username, password, isAdmin }
  sessions: [],        // { token, userId, createdAt, lastSeenAt, label }
  folders: [],         // { id, userId, name, icon }
  feeds: [],           // { id, userId, name, url, folder, isYoutube, inlineBrowser, hideShorts, cssSelectors[], htmlPatterns[], favicon }
  articleState: [],    // { key: 'feedId:articleId', userId, isRead, isStarred }
  settings: {},        // userId -> {...}
  systemSettings: {},  // instance-wide admin-controlled settings (rate limiting, AI on/off, etc.)
});

const SYSTEM_SETTINGS_DEFAULTS = {
  rateLimitEnabled: true,
  allowSignup: false,
  aiFeaturesEnabled: true,
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'nomic-embed-text',
};

class JSONStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return EMPTY(); // genuinely first run — fine to start fresh
      // Any other read failure (permissions, a typo'd DB_PATH pointing at a
      // directory, etc.) used to be silently swallowed here and fell back
      // to an empty store — which looks identical to "my data is gone" and,
      // worse, the next mutation would then overwrite the real file at that
      // path with near-empty defaults. Fail loudly instead.
      console.error(`\x1b[31m✗ Could not read database at ${this.filePath}: ${e.message}\x1b[0m`);
      console.error(`  Refusing to start with an empty store — fix the path/permissions and restart.`);
      process.exit(1);
    }
    try {
      const parsed = JSON.parse(raw);
      return { ...EMPTY(), ...parsed }; // backfill any new top-level keys on upgrade
    } catch (e) {
      console.error(`\x1b[31m✗ Database file at ${this.filePath} exists but isn't valid JSON: ${e.message}\x1b[0m`);
      console.error(`  Refusing to start with an empty store and overwrite it — check the file, or restore from a backup.`);
      process.exit(1);
    }
  }

  _save() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    // Write to a temp file then rename — avoids truncated/corrupt files if
    // the process is killed mid-write.
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  // ─── Users ──────────────────────────────────────────────────────────────
  findUserByUsername(username) {
    return this._decryptUser(this.data.users.find(u => u.username === username));
  }
  findUserById(id) {
    return this._decryptUser(this.data.users.find(u => u.id === id));
  }
  createUser(username, passwordHash, isAdmin = false, email = null) {
    const id = this.data.nextUserId++;
    const user = { id, username, password: passwordHash, isAdmin: !!isAdmin, email: email || null, twoFactorSecret: null, twoFactorEnabled: false, pendingTwoFactorSecret: null };
    this.data.users.push(user);
    this._save();
    return user;
  }
  userCount() {
    return this.data.users.length;
  }
  findUserByEmail(email) {
    return this._decryptUser(this.data.users.find(u => u.email && u.email.toLowerCase() === (email || '').toLowerCase()));
  }
  updateUser(id, patch) {
    // Must mutate the real object in this.data.users, not a decrypted copy
    // (findUserById returns a fresh {...user} object via _decryptUser) —
    // otherwise Object.assign below would silently modify a throwaway
    // object and none of it would ever be saved.
    const user = this.data.users.find(u => u.id === id);
    if (!user) return null;
    const safePatch = { ...patch };
    delete safePatch.__proto__; delete safePatch.constructor; delete safePatch.prototype;
    delete safePatch.id; // never allow the primary key to be overwritten via patch
    // 2FA secrets are the one thing in this store that grants ongoing
    // access to an account (unlike a password, which is already hashed) —
    // encrypt them at rest so a copy of the data file alone doesn't hand
    // over the ability to generate valid codes.
    if ('twoFactorSecret' in safePatch) safePatch.twoFactorSecret = safePatch.twoFactorSecret ? encrypt(this.filePath, safePatch.twoFactorSecret) : null;
    if ('pendingTwoFactorSecret' in safePatch) safePatch.pendingTwoFactorSecret = safePatch.pendingTwoFactorSecret ? encrypt(this.filePath, safePatch.pendingTwoFactorSecret) : null;
    Object.assign(user, safePatch);
    this._save();
    return this._decryptUser(user);
  }
  // findUserById/findUserByUsername/findUserByEmail all need decrypted
  // secrets available to the caller (e.g. to verify a TOTP code against
  // twoFactorSecret) — decrypt on the way out rather than keeping two
  // copies of every user object in memory.
  _decryptUser(user) {
    if (!user) return user;
    const out = { ...user };
    if (out.twoFactorSecret) out.twoFactorSecret = decrypt(this.filePath, out.twoFactorSecret);
    if (out.pendingTwoFactorSecret) out.pendingTwoFactorSecret = decrypt(this.filePath, out.pendingTwoFactorSecret);
    return out;
  }
  deleteSessionsForUser(userId, exceptToken) {
    const exceptHash = exceptToken ? hashToken(exceptToken) : null;
    this.data.sessions = this.data.sessions.filter(s => s.userId !== userId || s.tokenHash === exceptHash);
    this._save();
  }

  // ─── System settings (admin-only, instance-wide) ───────────────────────
  getSystemSettings() {
    return { ...SYSTEM_SETTINGS_DEFAULTS, ...this.data.systemSettings };
  }
  setSystemSettings(patch) {
    this.data.systemSettings = { ...this.getSystemSettings(), ...patch };
    this._save();
    return this.data.systemSettings;
  }

  // ─── Sessions (device tokens) ───────────────────────────────────────────
  // A session is created once per successful login and its token is kept
  // by the client indefinitely (localStorage / a settings file) — that's
  // the "once per device" model: log in once per browser/app install, stay
  // logged in until an explicit logout or the session is revoked.
  //
  // Only a SHA-256 hash of the token is ever written to disk — same idea
  // as hashing a password. The real token only ever exists in the request
  // itself and in the client's own storage; a copy of the data file can't
  // be used to impersonate an active session.
  createSession(userId, token, label) {
    const session = { tokenHash: hashToken(token), userId, createdAt: Date.now(), lastSeenAt: Date.now(), label: label || null };
    this.data.sessions.push(session);
    this._save();
    return session;
  }
  findSession(token) {
    const h = hashToken(token);
    return this.data.sessions.find(s => s.tokenHash === h);
  }
  touchSession(token) {
    const s = this.findSession(token);
    if (s) { s.lastSeenAt = Date.now(); this._save(); }
  }
  deleteSession(token) {
    const h = hashToken(token);
    this.data.sessions = this.data.sessions.filter(s => s.tokenHash !== h);
    this._save();
  }
  listSessions(userId) {
    return this.data.sessions.filter(s => s.userId === userId);
  }

  // ─── Folders ────────────────────────────────────────────────────────────
  listFolders(userId) {
    return this.data.folders
      .filter(f => f.userId === userId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  addFolder(userId, name, icon) {
    const existing = this.listFolders(userId);
    const maxOrder = existing.reduce((m, f) => Math.max(m, f.order ?? 0), -1);
    const folder = { id: `folder-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, userId, name, icon: icon || '◈', order: maxOrder + 1 };
    this.data.folders.push(folder);
    this._save();
    return folder;
  }
  findFolder(userId, id) {
    if (!id) return null;
    return this.data.folders.find(f => f.userId === userId && f.id === id) || null;
  }
  folderExistsByName(userId, name) {
    return this.data.folders.find(f => f.userId === userId && f.name === name);
  }
  removeFolder(userId, id) {
    this.data.folders = this.data.folders.filter(f => !(f.userId === userId && f.id === id));
    // Don't leave feeds pointing at a folder that no longer exists
    for (const feed of this.data.feeds) {
      if (feed.userId === userId && feed.folder === id) feed.folder = null;
    }
    this._save();
  }
  updateFolder(userId, id, patch) {
    const folder = this.data.folders.find(f => f.userId === userId && f.id === id);
    if (!folder) return null;
    if (patch.name !== undefined) folder.name = patch.name;
    if (patch.icon !== undefined) folder.icon = patch.icon;
    if (patch.thumbnailMode !== undefined) folder.thumbnailMode = patch.thumbnailMode;
    if (patch.hideShorts !== undefined) folder.hideShorts = patch.hideShorts;
    if (patch.inlineBrowser !== undefined) folder.inlineBrowser = patch.inlineBrowser;
    if (patch.titleBlocklist !== undefined) folder.titleBlocklist = patch.titleBlocklist;
    if (patch.preferFeedContent !== undefined) folder.preferFeedContent = patch.preferFeedContent;
    if (patch.fetchStrategyOrder !== undefined) folder.fetchStrategyOrder = patch.fetchStrategyOrder;
    this._save();
    return folder;
  }
  // orderedIds: full array of this user's folder IDs in the desired order
  reorderFolders(userId, orderedIds) {
    orderedIds.forEach((id, idx) => {
      const folder = this.data.folders.find(f => f.userId === userId && f.id === id);
      if (folder) folder.order = idx;
    });
    this._save();
  }

  // ─── Feeds ──────────────────────────────────────────────────────────────
  listFeeds(userId) {
    return this.data.feeds.filter(f => f.userId === userId);
  }
  findFeed(userId, id) {
    return this.data.feeds.find(f => f.userId === userId && f.id === id);
  }
  addFeed(userId, feed) {
    const row = { id: `f-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, userId, ...feed };
    this.data.feeds.push(row);
    this._save();
    return row;
  }
  updateFeed(userId, id, patch) {
    const feed = this.findFeed(userId, id);
    if (!feed) return null;
    // Object.assign(feed, patch) would let a JSON body containing a literal
    // "__proto__" own key (JSON.parse allows this — it's not the same as
    // the real prototype link) reassign this object's prototype via the
    // inherited setter. Stripping dangerous keys first closes that off.
    const safePatch = { ...patch };
    delete safePatch.__proto__; delete safePatch.constructor; delete safePatch.prototype;
    Object.assign(feed, safePatch);
    this._save();
    return feed;
  }
  removeFeed(userId, id) {
    this.data.feeds = this.data.feeds.filter(f => !(f.userId === userId && f.id === id));
    this._save();
  }
  feedUrlExists(userId, url) {
    return this.data.feeds.some(f => f.userId === userId && f.url === url);
  }

  // ─── Article state ──────────────────────────────────────────────────────
  getArticleState(userId) {
    const rows = this.data.articleState.filter(r => r.userId === userId);
    return {
      read: rows.filter(r => r.isRead).map(r => r.key),
      starred: rows.filter(r => r.isStarred).map(r => r.key),
    };
  }
  markRead(userId, key, read = true) {
    let row = this.data.articleState.find(r => r.userId === userId && r.key === key);
    if (!row) { row = { key, userId, isRead: false, isStarred: false }; this.data.articleState.push(row); }
    row.isRead = read;
    this._save();
  }
  // Bulk variant for "mark all read" — see the matching comment in
  // db-supabase.js. Here the main win is calling _save() once instead of
  // once per article (that's a full JSON.stringify + file write each
  // time), rather than a network-round-trip concern.
  markReadBulk(userId, keys) {
    for (const key of keys) {
      let row = this.data.articleState.find(r => r.userId === userId && r.key === key);
      if (!row) { row = { key, userId, isRead: false, isStarred: false }; this.data.articleState.push(row); }
      row.isRead = true;
    }
    if (keys.length) this._save();
  }
  toggleStar(userId, key, starred) {
    let row = this.data.articleState.find(r => r.userId === userId && r.key === key);
    if (!row) { row = { key, userId, isRead: false, isStarred: false }; this.data.articleState.push(row); }
    row.isStarred = !!starred;
    this._save();
  }

  // ─── Settings ───────────────────────────────────────────────────────────
  getSettings(userId) {
    return this.data.settings[userId] || {};
  }
  setSettings(userId, settings) {
    this.data.settings[userId] = settings;
    this._save();
  }

  // ─── Article content cache ───────────────────────────────────────────────
  // Kept in a separate file from the main data file (not folded into
  // this.data) so that every article fetch doesn't also rewrite the much
  // larger feeds/folders/settings blob to disk on every request.
  _loadCache() {
    if (this._cacheData) return this._cacheData;
    const cachePath = this.filePath.replace(/\.json$/, '-article-cache.json');
    this._cachePath = cachePath;
    try { this._cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8')); }
    catch { this._cacheData = {}; }
    return this._cacheData;
  }
  _flushCache() {
    try {
      fs.mkdirSync(path.dirname(this._cachePath), { recursive: true });
      const tmp = this._cachePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._cacheData));
      fs.renameSync(tmp, this._cachePath);
    } catch (e) { console.error('[article-cache] flush failed:', e.message); }
  }
  async cacheGet(url) {
    const data = this._loadCache();
    return data[url] || null;
  }
  async cacheSet(url, entry) {
    const data = this._loadCache();
    data[url] = entry;
    this._flushCache();
  }
  async cacheDelete(url) {
    const data = this._loadCache();
    delete data[url];
    this._flushCache();
  }
  async cacheEntries() {
    return Object.entries(this._loadCache());
  }
  // Delete every cache entry belonging to one feed (used when rules that
  // change article content — block rules, preferFeedContent,
  // fetchStrategyOrder — are saved for that feed). In-memory, so this is
  // already cheap for JSONStore; the SupabaseStore counterpart is the one
  // that matters (see its comment for why).
  async cacheDeleteByFeedId(feedId) {
    const data = this._loadCache();
    let changed = false;
    for (const [url, entry] of Object.entries(data)) {
      if (entry.feedId === feedId) { delete data[url]; changed = true; }
    }
    if (changed) this._flushCache();
  }
  // Delete every cache entry older than cutoffTs (ms epoch). In-memory for
  // JSONStore — cheap. See SupabaseStore's version for the real fix.
  async cachePruneExpired(cutoffTs) {
    const data = this._loadCache();
    let changed = false;
    for (const [url, entry] of Object.entries(data)) {
      if (entry.ts < cutoffTs) { delete data[url]; changed = true; }
    }
    if (changed) this._flushCache();
  }
  // Self-hosted mode has no error_logs table to write to — the console
  // (already visible to whoever's running the server) is the log here.
  async logError({ source, path, message }) {
    console.error(`[${source}-error]${path ? ` ${path}:` : ''}`, message);
  }
}

module.exports = { JSONStore };
