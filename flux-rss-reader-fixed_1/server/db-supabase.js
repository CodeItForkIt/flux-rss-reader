'use strict';
/**
 * server/db-supabase.js
 *
 * Same method surface as JSONStore (server/db.js), backed by Postgres via
 * Supabase instead of a local JSON file — for deploying on Vercel (or
 * anywhere else without a persistent writable filesystem), where a
 * file-backed store doesn't work: serverless functions don't share disk
 * between invocations, and Vercel's filesystem is read-only outside /tmp.
 *
 * Every method here is async (real network calls), unlike JSONStore's
 * synchronous methods — callers throughout server/index.js `await` every
 * db.* call uniformly, which works fine against either store.
 *
 * Requires the SQL in server/supabase-schema.sql to have been run against
 * your Supabase project first, and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * set. Use the *service role* key (not the anon/public key) — this runs
 * server-side only and needs to bypass Row Level Security, since Flux's own
 * auth layer (not Supabase Auth) is what gates access here.
 */
const { createClient } = require('@supabase/supabase-js');
const { encrypt, decrypt, hashToken } = require('./crypto-util');

function camelFolder(row) {
  if (!row) return row;
  return {
    id: row.id, userId: row.user_id, name: row.name, icon: row.icon, order: row.order,
    thumbnailMode: row.thumbnail_mode,
    hideShorts: row.hide_shorts, inlineBrowser: row.inline_browser,
    titleBlocklist: row.title_blocklist || [], preferFeedContent: row.prefer_feed_content,
    fetchStrategyOrder: row.fetch_strategy_order || [],
  };
}
function camelFeed(row) {
  if (!row) return row;
  return {
    id: row.id, userId: row.user_id, name: row.name, url: row.url, folder: row.folder,
    isYoutube: row.is_youtube, inlineBrowser: row.inline_browser, hideShorts: row.hide_shorts,
    cssSelectors: row.css_selectors || [], htmlPatterns: row.html_patterns || [], favicon: row.favicon,
    titleBlocklist: row.title_blocklist || [], fetchStrategyOrder: row.fetch_strategy_order || [],
    showThumbnail: row.show_thumbnail,
    thumbnailMode: row.thumbnail_mode,
    preferFeedContent: row.prefer_feed_content,
  };
}
function feedToRow(feed) {
  const row = {};
  if ('name' in feed) row.name = feed.name;
  if ('url' in feed) row.url = feed.url;
  if ('folder' in feed) row.folder = feed.folder;
  if ('isYoutube' in feed) row.is_youtube = feed.isYoutube;
  if ('inlineBrowser' in feed) row.inline_browser = feed.inlineBrowser;
  if ('hideShorts' in feed) row.hide_shorts = feed.hideShorts;
  if ('cssSelectors' in feed) row.css_selectors = feed.cssSelectors;
  if ('htmlPatterns' in feed) row.html_patterns = feed.htmlPatterns;
  if ('favicon' in feed) row.favicon = feed.favicon;
  if ('titleBlocklist' in feed) row.title_blocklist = feed.titleBlocklist;
  if ('fetchStrategyOrder' in feed) row.fetch_strategy_order = feed.fetchStrategyOrder;
  if ('showThumbnail' in feed) row.show_thumbnail = feed.showThumbnail;
  if ('thumbnailMode' in feed) row.thumbnail_mode = feed.thumbnailMode;
  if ('preferFeedContent' in feed) row.prefer_feed_content = feed.preferFeedContent;
  return row;
}
function camelUser(row) {
  if (!row) return row;
  return {
    id: row.id, username: row.username, password: row.password, isAdmin: row.is_admin,
    email: row.email, twoFactorSecret: row.two_factor_secret, twoFactorEnabled: row.two_factor_enabled,
    pendingTwoFactorSecret: row.pending_two_factor_secret,
  };
}

class SupabaseStore {
  constructor() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set to use Supabase storage.');
    }
    this.sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    // Used as the "file path" basis for encryption key derivation — there's
    // no local file here, so crypto-util requires ENCRYPTION_KEY to be set
    // explicitly in this mode (see crypto-util.js's loadKey).
    this._keyBasis = null;
  }
  _throw(err, context) {
    if (err) throw new Error(`Supabase error (${context}): ${err.message}`);
  }

  // ─── Users ──────────────────────────────────────────────────────────────
  async _decryptUser(user) {
    if (!user) return user;
    const out = { ...user };
    if (out.twoFactorSecret) out.twoFactorSecret = decrypt(this._keyBasis, out.twoFactorSecret);
    if (out.pendingTwoFactorSecret) out.pendingTwoFactorSecret = decrypt(this._keyBasis, out.pendingTwoFactorSecret);
    return out;
  }
  async findUserByUsername(username) {
    const { data, error } = await this.sb.from('users').select('*').eq('username', username).maybeSingle();
    this._throw(error, 'findUserByUsername');
    return this._decryptUser(camelUser(data));
  }
  async findUserById(id) {
    const { data, error } = await this.sb.from('users').select('*').eq('id', id).maybeSingle();
    this._throw(error, 'findUserById');
    return this._decryptUser(camelUser(data));
  }
  async findUserByEmail(email) {
    if (!email) return null;
    const { data, error } = await this.sb.from('users').select('*').ilike('email', email).maybeSingle();
    this._throw(error, 'findUserByEmail');
    return this._decryptUser(camelUser(data));
  }
  async createUser(username, passwordHash, isAdmin = false, email = null) {
    const { data, error } = await this.sb.from('users')
      .insert({ username, password: passwordHash, is_admin: !!isAdmin, email: email || null })
      .select().single();
    this._throw(error, 'createUser');
    return camelUser(data);
  }
  async userCount() {
    const { count, error } = await this.sb.from('users').select('*', { count: 'exact', head: true });
    this._throw(error, 'userCount');
    return count || 0;
  }
  async updateUser(id, patch) {
    const row = {};
    if ('password' in patch) row.password = patch.password;
    if ('email' in patch) row.email = patch.email;
    if ('isAdmin' in patch) row.is_admin = patch.isAdmin;
    if ('twoFactorEnabled' in patch) row.two_factor_enabled = patch.twoFactorEnabled;
    if ('twoFactorSecret' in patch) row.two_factor_secret = patch.twoFactorSecret ? encrypt(this._keyBasis, patch.twoFactorSecret) : null;
    if ('pendingTwoFactorSecret' in patch) row.pending_two_factor_secret = patch.pendingTwoFactorSecret ? encrypt(this._keyBasis, patch.pendingTwoFactorSecret) : null;
    const { data, error } = await this.sb.from('users').update(row).eq('id', id).select().single();
    this._throw(error, 'updateUser');
    return this._decryptUser(camelUser(data));
  }
  async deleteSessionsForUser(userId, exceptToken) {
    const exceptHash = exceptToken ? hashToken(exceptToken) : null;
    let q = this.sb.from('sessions').delete().eq('user_id', userId);
    if (exceptHash) q = q.neq('token_hash', exceptHash);
    const { error } = await q;
    this._throw(error, 'deleteSessionsForUser');
  }

  // ─── System settings ─────────────────────────────────────────────────────
  async getSystemSettings() {
    const { data, error } = await this.sb.from('system_settings').select('data').eq('id', true).maybeSingle();
    this._throw(error, 'getSystemSettings');
    const SYSTEM_SETTINGS_DEFAULTS = { rateLimitEnabled: true, allowSignup: false, aiFeaturesEnabled: true, ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'nomic-embed-text' };
    return { ...SYSTEM_SETTINGS_DEFAULTS, ...(data?.data || {}) };
  }
  async setSystemSettings(patch) {
    const current = await this.getSystemSettings();
    const next = { ...current, ...patch };
    const { error } = await this.sb.from('system_settings').upsert({ id: true, data: next });
    this._throw(error, 'setSystemSettings');
    return next;
  }

  // ─── Sessions ────────────────────────────────────────────────────────────
  async createSession(userId, token, label) {
    const row = { token_hash: hashToken(token), user_id: userId, label: label || null };
    const { error } = await this.sb.from('sessions').insert(row);
    this._throw(error, 'createSession');
    return row;
  }
  async findSession(token) {
    const { data, error } = await this.sb.from('sessions').select('*').eq('token_hash', hashToken(token)).maybeSingle();
    this._throw(error, 'findSession');
    return data ? { userId: data.user_id, createdAt: data.created_at, lastSeenAt: data.last_seen_at, label: data.label } : null;
  }
  async touchSession(token) {
    await this.sb.from('sessions').update({ last_seen_at: new Date().toISOString() }).eq('token_hash', hashToken(token));
  }
  async deleteSession(token) {
    const { error } = await this.sb.from('sessions').delete().eq('token_hash', hashToken(token));
    this._throw(error, 'deleteSession');
  }
  async listSessions(userId) {
    const { data, error } = await this.sb.from('sessions').select('*').eq('user_id', userId);
    this._throw(error, 'listSessions');
    return (data || []).map(s => ({ userId: s.user_id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, label: s.label }));
  }

  // ─── Folders ─────────────────────────────────────────────────────────────
  async listFolders(userId) {
    const { data, error } = await this.sb.from('folders').select('*').eq('user_id', userId).order('order', { ascending: true });
    this._throw(error, 'listFolders');
    return (data || []).map(camelFolder);
  }
  async addFolder(userId, name, icon) {
    const existing = await this.listFolders(userId);
    const maxOrder = existing.reduce((m, f) => Math.max(m, f.order ?? 0), -1);
    const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await this.sb.from('folders')
      .insert({ id, user_id: userId, name, icon: icon || '◈', order: maxOrder + 1 })
      .select().single();
    this._throw(error, 'addFolder');
    return camelFolder(data);
  }
  async findFolder(userId, id) {
    if (!id) return null;
    const { data, error } = await this.sb.from('folders').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
    this._throw(error, 'findFolder');
    return camelFolder(data);
  }
  async folderExistsByName(userId, name) {
    const { data, error } = await this.sb.from('folders').select('id').eq('user_id', userId).eq('name', name).maybeSingle();
    this._throw(error, 'folderExistsByName');
    return !!data;
  }
  async removeFolder(userId, id) {
    await this.sb.from('feeds').update({ folder: null }).eq('user_id', userId).eq('folder', id);
    const { error } = await this.sb.from('folders').delete().eq('user_id', userId).eq('id', id);
    this._throw(error, 'removeFolder');
  }
  async updateFolder(userId, id, patch) {
    const row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.icon !== undefined) row.icon = patch.icon;
    if (patch.thumbnailMode !== undefined) row.thumbnail_mode = patch.thumbnailMode;
    if (patch.hideShorts !== undefined) row.hide_shorts = patch.hideShorts;
    if (patch.inlineBrowser !== undefined) row.inline_browser = patch.inlineBrowser;
    if (patch.titleBlocklist !== undefined) row.title_blocklist = patch.titleBlocklist;
    if (patch.preferFeedContent !== undefined) row.prefer_feed_content = patch.preferFeedContent;
    if (patch.fetchStrategyOrder !== undefined) row.fetch_strategy_order = patch.fetchStrategyOrder;
    const { data, error } = await this.sb.from('folders').update(row).eq('user_id', userId).eq('id', id).select().maybeSingle();
    this._throw(error, 'updateFolder');
    return camelFolder(data);
  }
  async reorderFolders(userId, orderedIds) {
    await Promise.all(orderedIds.map((id, idx) =>
      this.sb.from('folders').update({ order: idx }).eq('user_id', userId).eq('id', id)
    ));
  }

  // ─── Feeds ───────────────────────────────────────────────────────────────
  async listFeeds(userId) {
    const { data, error } = await this.sb.from('feeds').select('*').eq('user_id', userId);
    this._throw(error, 'listFeeds');
    return (data || []).map(camelFeed);
  }
  async findFeed(userId, id) {
    const { data, error } = await this.sb.from('feeds').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
    this._throw(error, 'findFeed');
    return camelFeed(data);
  }
  async addFeed(userId, feed) {
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const row = { id, user_id: userId, ...feedToRow(feed) };
    const { data, error } = await this.sb.from('feeds').insert(row).select().single();
    this._throw(error, 'addFeed');
    return camelFeed(data);
  }
  async updateFeed(userId, id, patch) {
    const { data, error } = await this.sb.from('feeds').update(feedToRow(patch)).eq('user_id', userId).eq('id', id).select().maybeSingle();
    this._throw(error, 'updateFeed');
    return camelFeed(data);
  }
  async removeFeed(userId, id) {
    const { error } = await this.sb.from('feeds').delete().eq('user_id', userId).eq('id', id);
    this._throw(error, 'removeFeed');
  }
  async feedUrlExists(userId, url) {
    const { data, error } = await this.sb.from('feeds').select('id').eq('user_id', userId).eq('url', url).maybeSingle();
    this._throw(error, 'feedUrlExists');
    return !!data;
  }

  // ─── Article state ───────────────────────────────────────────────────────
  // Supabase/PostgREST caps any single response at 1000 rows by default
  // (a project-wide setting, not something this query opts into or out
  // of) — a plain select('*') with no .range() silently returns only the
  // first 1000 matching rows, in whatever order Postgres happens to
  // produce them in, with no error or indication of truncation. Every
  // article read/starred beyond that cap would come back missing on this
  // read, every time, for any user who's read more than ~1000 articles —
  // which looks exactly like "read state doesn't persist," except
  // silently affecting an arbitrary subset rather than consistently
  // affecting the oldest or newest. Paginating with .range() here fetches
  // every row regardless of table size.
  async getArticleState(userId) {
    const pageSize = 1000;
    let rows = [], from = 0;
    while (true) {
      // .order('key') is load-bearing, not cosmetic: without an explicit
      // order, Postgres/PostgREST make no guarantee about which rows come
      // back first for a plain select — and article_state gets written to
      // constantly (every article read fires one upsert), so which ~1000
      // rows happened to come back first was never stable from one
      // request to the next even before pagination existed. That's almost
      // certainly what "some articles get marked read but it's
      // inconsistent which" actually was: not a fixed cutoff losing the
      // same rows every time, but an arbitrary, shifting subset of a
      // 2,100+ row table being returned as "the" read set on each load.
      // .range() pagination specifically requires this to be safe at all —
      // without a stable order, two successive range() calls (this loop
      // makes several, since the table is already over 2x the 1000-row
      // page size) have no guarantee of seeing a consistent sequence,
      // which could skip or double-count rows across the page boundary.
      const { data, error } = await this.sb.from('article_state').select('*').eq('user_id', userId).order('key', { ascending: true }).range(from, from + pageSize - 1);
      this._throw(error, 'getArticleState');
      rows = rows.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return { read: rows.filter(r => r.is_read).map(r => r.key), starred: rows.filter(r => r.is_starred).map(r => r.key) };
  }
  async markRead(userId, key, read = true) {
    const { error } = await this.sb.from('article_state').upsert({ key, user_id: userId, is_read: read }, { onConflict: 'key,user_id' });
    this._throw(error, 'markRead');
  }
  // Bulk variant for "mark all read" — previously the client fired one
  // HTTP request + one upsert per article (potentially hundreds at once
  // for a big unread pile). Besides being slow, a burst that size has a
  // real chance of a handful of requests failing under Supabase's
  // connection-pool limits or transient network blips — and with nothing
  // retrying those individually-failed writes, the articles they belonged
  // to would quietly revert to unread on the next reload. A single upsert
  // with all rows is one round-trip and one statement: either all of it
  // lands or the caller gets one clear error to retry, not a partial,
  // silent failure spread across N independent requests.
  async markReadBulk(userId, keys) {
    if (!keys.length) return;
    const rows = keys.map(key => ({ key, user_id: userId, is_read: true }));
    const { error } = await this.sb.from('article_state').upsert(rows, { onConflict: 'key,user_id' });
    this._throw(error, 'markReadBulk');
  }
  async toggleStar(userId, key, starred) {
    const { error } = await this.sb.from('article_state').upsert({ key, user_id: userId, is_starred: !!starred }, { onConflict: 'key,user_id' });
    this._throw(error, 'toggleStar');
  }

  // ─── Settings ────────────────────────────────────────────────────────────
  async getSettings(userId) {
    const { data, error } = await this.sb.from('user_settings').select('data').eq('user_id', userId).maybeSingle();
    this._throw(error, 'getSettings');
    return data?.data || {};
  }
  async setSettings(userId, settings) {
    const { error } = await this.sb.from('user_settings').upsert({ user_id: userId, data: settings });
    this._throw(error, 'setSettings');
  }

  // ─── Article content cache ───────────────────────────────────────────────
  async cacheGet(url) {
    const { data, error } = await this.sb.from('article_cache').select('*').eq('url', url).maybeSingle();
    this._throw(error, 'cacheGet');
    return data ? { ts: data.ts, feedId: data.feed_id, result: data.result } : null;
  }
  async cacheSet(url, entry) {
    const { error } = await this.sb.from('article_cache').upsert({ url, feed_id: entry.feedId || null, ts: entry.ts, result: entry.result });
    this._throw(error, 'cacheSet');
  }
  async cacheDelete(url) {
    const { error } = await this.sb.from('article_cache').delete().eq('url', url);
    this._throw(error, 'cacheDelete');
  }
  // Deletes cache rows for one feed directly in SQL (WHERE feed_id = ...),
  // instead of the previous pattern used at both call sites (startup prune
  // and the feed-rules PATCH route): pulling every row's full `result`
  // jsonb blob over the wire (via a since-removed cacheEntries() method)
  // just to find the ones matching one feedId in JS, then deleting them
  // one HTTP round-trip at a time. With article_cache holding a couple
  // hundred rows averaging ~10KB (one observed as large as 771KB) that
  // full-table pull was measured at ~12MB, and was the direct cause of a
  // logged "canceling statement due to statement timeout" error that took
  // down an entire /api/feeds/fetch-all request with a 504 — and, on the
  // feed-rules save path, is why saving a feed's block rules (cssSelectors/
  // htmlPatterns — exactly what the element picker writes) felt like it
  // hung or crashed: the request was still alive, just very slow, because
  // it was shipping ~12MB of other users'/feeds' cached article content
  // back and forth before it could even start filtering.
  async cacheDeleteByFeedId(feedId) {
    const { error } = await this.sb.from('article_cache').delete().eq('feed_id', feedId);
    this._throw(error, 'cacheDeleteByFeedId');
  }
  // Same as cacheDeleteByFeedId but for many feeds at once (folder-level
  // settings changes need to bust the cache for every feed in the
  // folder) — one DELETE ... WHERE feed_id = ANY(...) instead of N
  // separate round-trips.
  async cacheDeleteByFeedIds(feedIds) {
    if (!feedIds.length) return;
    const { error } = await this.sb.from('article_cache').delete().in('feed_id', feedIds);
    this._throw(error, 'cacheDeleteByFeedIds');
  }
  // Used when articles are marked read (server/index.js's markRead route
  // callers pass the already-versioned cache key, not a raw URL — see
  // articleContentCacheKey) — a single DELETE ... WHERE url = ANY(...)
  // instead of one query per article, which matters most for "mark all
  // read" (potentially hundreds at once).
  async cacheDeleteByUrls(urls) {
    if (!urls.length) return;
    const { error } = await this.sb.from('article_cache').delete().in('url', urls);
    this._throw(error, 'cacheDeleteByUrls');
  }
  // Deletes expired cache rows directly in SQL (WHERE ts < cutoff), instead
  // of the startup prune's previous pattern of pulling every row (see
  // cacheDeleteByFeedId's comment) just to compare timestamps in JS.
  async cachePruneExpired(cutoffTs) {
    const { error } = await this.sb.from('article_cache').delete().lt('ts', cutoffTs);
    this._throw(error, 'cachePruneExpired');
  }
  // "Clear all" — single unconditional delete instead of pulling every row
  // (via the old cacheEntries() pattern) and deleting one at a time. That
  // pattern had the exact same latent bug that broke read-state
  // persistence: an unbounded select('*') is silently capped at 1000 rows
  // by Supabase's default API setting, so "clear all cache" on a table
  // with more than 1000 rows would leave the rest behind with no
  // indication anything was skipped.
  async cacheClearAll() {
    const { error } = await this.sb.from('article_cache').delete().neq('url', '');
    this._throw(error, 'cacheClearAll');
  }

  // ─── Error log ───────────────────────────────────────────────────────────
  // Deliberately swallows its own errors (logging must never be the thing
  // that breaks the request it's trying to describe) and never throws via
  // _throw — a failure here is reported to the console only.
  async logError({ source, userId, path, message, stack, context }) {
    try {
      await this.sb.from('error_logs').insert({
        source, user_id: userId ?? null, path: path || null,
        message: (message || '').slice(0, 2000), stack: (stack || '').slice(0, 8000),
        context: context || null,
      });
      // Lazy prune instead of a cron job — cheap (indexed on created_at)
      // and only runs on the occasional write, not on every read.
      if (Math.random() < 0.05) {
        await this.sb.from('error_logs').delete().lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      }
    } catch (e) { console.error('[error-log] failed to persist:', e.message); }
  }
}

module.exports = { SupabaseStore };
