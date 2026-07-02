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
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      // Merge with EMPTY to backfill any new top-level keys on upgrade
      return { ...EMPTY(), ...parsed };
    } catch {
      return EMPTY();
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
    return this.data.users.find(u => u.username === username);
  }
  findUserById(id) {
    return this.data.users.find(u => u.id === id);
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
    return this.data.users.find(u => u.email && u.email.toLowerCase() === (email || '').toLowerCase());
  }
  updateUser(id, patch) {
    const user = this.findUserById(id);
    if (!user) return null;
    const safePatch = { ...patch };
    delete safePatch.__proto__; delete safePatch.constructor; delete safePatch.prototype;
    delete safePatch.id; // never allow the primary key to be overwritten via patch
    Object.assign(user, safePatch);
    this._save();
    return user;
  }
  deleteSessionsForUser(userId, exceptToken) {
    this.data.sessions = this.data.sessions.filter(s => s.userId !== userId || s.token === exceptToken);
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
  createSession(userId, token, label) {
    const session = { token, userId, createdAt: Date.now(), lastSeenAt: Date.now(), label: label || null };
    this.data.sessions.push(session);
    this._save();
    return session;
  }
  findSession(token) {
    return this.data.sessions.find(s => s.token === token);
  }
  touchSession(token) {
    const s = this.findSession(token);
    if (s) { s.lastSeenAt = Date.now(); this._save(); }
  }
  deleteSession(token) {
    this.data.sessions = this.data.sessions.filter(s => s.token !== token);
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
  markRead(userId, key) {
    let row = this.data.articleState.find(r => r.userId === userId && r.key === key);
    if (!row) { row = { key, userId, isRead: false, isStarred: false }; this.data.articleState.push(row); }
    row.isRead = true;
    this._save();
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
}

module.exports = { JSONStore };
