/**
 * api.js — Transport abstraction layer
 *
 * Electron has two modes, chosen by the user in Settings:
 *   - Local (default): delegates to window.flux (IPC bridge) — data lives
 *     in a local JSON file, no network, no auth, matches the original
 *     single-machine design.
 *   - Remote: talks HTTP to a Flux server elsewhere (e.g. hosted on a VPS),
 *     the same way the web build does, including login. This is for
 *     "use the app on some devices, the website on others, same account."
 *
 * Web/mobile always uses HTTP against the server it's served from.
 *
 * Both HTTP modes require a device session token (see `auth` below) —
 * "once per device" means logging in once persists the token (localStorage
 * for the web build; a small file via IPC for Electron's remote mode) so
 * subsequent launches skip the login screen until an explicit logout.
 */

const IS_ELECTRON = typeof window !== 'undefined' && !!window.__FLUX_ELECTRON__;
const WEB_TOKEN_KEY = 'flux_device_token';

let _remote = null;
let _onUnauthorized = null;

function currentlyRemote() { return IS_ELECTRON && !!_remote; }
function usesHttp() { return !IS_ELECTRON || currentlyRemote(); }

function httpBase() {
  return currentlyRemote() ? _remote.baseUrl.replace(/\/$/, '') : '';
}
function authToken() {
  if (currentlyRemote()) return _remote.token;
  if (!IS_ELECTRON) { try { return localStorage.getItem(WEB_TOKEN_KEY); } catch { return null; } }
  return null;
}
export function getAuthToken() {
  return authToken();
}

async function http(method, path, body, isFormData = false) {
  const headers = {};
  if (body && !isFormData) headers['Content-Type'] = 'application/json';
  const token = authToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(httpBase() + path, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
  });
  if (resp.status === 401) {
    _onUnauthorized && _onUnauthorized();
    throw new Error('Session expired — please log in again.');
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || resp.statusText);
  }
  const ct = resp.headers.get('content-type') || '';
  return ct.includes('application/json') ? resp.json() : resp.text();
}

function pick(ipcFn, httpFn) {
  return (...args) => (usesHttp() ? httpFn(...args) : ipcFn(...args));
}

export const isElectron = IS_ELECTRON;
export function isRemoteHttp() { return usesHttp(); }

async function initRemoteConfig() {
  if (!IS_ELECTRON) return;
  try {
    const cfg = await window.flux.remote.getConfig();
    if (cfg && cfg.baseUrl && cfg.token) _remote = cfg;
  } catch {}
}
const remoteConfigReady = initRemoteConfig();

export const auth = {
  ready: () => remoteConfigReady,
  supportsRemoteConfig: IS_ELECTRON,

  isLoggedIn() {
    if (IS_ELECTRON && !currentlyRemote()) return true;
    return !!authToken();
  },

  onUnauthorized(cb) { _onUnauthorized = cb; },

  status: () => http('GET', '/api/auth/status'),

  async register(username, password, deviceLabel, email) {
    const result = await http('POST', '/api/auth/register', { username, password, deviceLabel, email });
    await this._persistToken(result.token);
    return result;
  },
  async login(username, password, deviceLabel, totpCode) {
    const result = await http('POST', '/api/auth/login', { username, password, deviceLabel, totpCode });
    if (result.requiresTotp) return result; // no token yet — caller re-submits with a code
    await this._persistToken(result.token);
    return result;
  },
  async logout() {
    try { await http('POST', '/api/auth/logout'); } catch {}
    if (currentlyRemote()) { await window.flux.remote.clear(); _remote = null; }
    else if (!IS_ELECTRON) { try { localStorage.removeItem(WEB_TOKEN_KEY); } catch {} }
  },
  me: () => http('GET', '/api/auth/me'),
  changePassword: (currentPassword, newPassword) => http('POST', '/api/auth/password', { currentPassword, newPassword }),
  twoFactor: {
    setup:   ()      => http('POST', '/api/auth/2fa/setup'),
    enable:  (code)  => http('POST', '/api/auth/2fa/enable', { code }),
    disable: (password) => http('POST', '/api/auth/2fa/disable', { password }),
  },

  async _persistToken(token) {
    if (currentlyRemote()) { _remote.token = token; await window.flux.remote.setConfig(_remote); }
    else if (!IS_ELECTRON) { try { localStorage.setItem(WEB_TOKEN_KEY, token); } catch {} }
  },

  async configureRemote(baseUrl) {
    if (!IS_ELECTRON) throw new Error('Remote server mode is only available in the desktop app.');
    _remote = { baseUrl: baseUrl.replace(/\/$/, ''), token: null };
    await window.flux.remote.setConfig(_remote);
  },
  async clearRemote() {
    if (!IS_ELECTRON) return;
    _remote = null;
    await window.flux.remote.clear();
  },
  getRemoteConfig: () => _remote,
};

// ── Feeds ─────────────────────────────────────────────────────────────────────
export const feeds = {
  list:           pick(() => window.flux.feeds.list(),              () => http('GET',    '/api/feeds')),
  add:            pick((c) => window.flux.feeds.add(c),              (c) => http('POST',   '/api/feeds', c)),
  remove:         pick((id) => window.flux.feeds.remove(id),         (id) => http('DELETE', `/api/feeds/${id}`)),
  updateRules:    pick((a) => window.flux.feeds.updateRules(a),      (a) => http('PATCH',  `/api/feeds/${a.feedId}`, a)),
  fetchAll:       pick(() => window.flux.feeds.fetchAll(),           () => http('POST',   '/api/feeds/fetch-all')),
  fetchStream:    pick(() => window.flux.feeds.fetchStream(),        () => http('POST',   '/api/feeds/fetch-all')),
  fetchOne:       pick((id) => window.flux.feeds.fetchOne(id),       (id) => http('POST',   `/api/feeds/${id}/fetch`)),
  resolve:        pick((url) => window.flux.feeds.resolve(url),      (url) => http('POST',   '/api/feeds/resolve', { url })),
  onStreamResult: pick((cb) => window.flux.feeds.onStreamResult(cb), ()   => () => {}),
};

// ── Articles ──────────────────────────────────────────────────────────────────
export const articles = {
  fetch:      pick((a)   => window.flux.articles.fetch(a),      (a)   => http('POST', '/api/article/fetch', a)),
  clearCache: pick((url) => window.flux.articles.clearCache(url), (url) => http('POST', '/api/article/clear-cache', { url })),
  markRead:   pick((a)   => window.flux.articles.markRead(a),   (a)   => http('POST', '/api/articles/mark-read', a)),
  toggleStar: pick((a)   => window.flux.articles.toggleStar(a), (a)   => http('POST', '/api/articles/toggle-star', a)),
  getState:   pick(()    => window.flux.articles.getState(),    ()    => http('GET',  '/api/articles/state')),
};

// ── Folders ───────────────────────────────────────────────────────────────────
export const folders = {
  list:    pick(()             => window.flux.folders.list(),           ()             => http('GET',    '/api/folders')),
  add:     pick((a)            => window.flux.folders.add(a),           (a)            => http('POST',   '/api/folders', a)),
  remove:  pick((id)           => window.flux.folders.remove(id),       (id)           => http('DELETE', `/api/folders/${id}`)),
  reorder: pick((orderedIds)   => window.flux.folders.reorder(orderedIds), (orderedIds) => http('PUT',    '/api/folders/reorder', { orderedIds })),
  update:  pick((a)            => window.flux.folders.update(a),        (a)            => http('PATCH',  `/api/folders/${a.folderId}`, a)),
};

// ── OPML ──────────────────────────────────────────────────────────────────────
async function httpOpmlExport() {
  const resp = await fetch(httpBase() + '/api/opml/export', {
    headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {},
  });
  const blob = await resp.blob();
  const cd   = resp.headers.get('content-disposition') || '';
  const fn   = cd.match(/filename="([^"]+)"/)?.[1] || 'flux-feeds.opml';
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = fn;
  a.click();
  URL.revokeObjectURL(a.href);
  return { canceled: false };
}
export const opml = {
  export:     pick(() => window.flux.opml.export(), httpOpmlExport),
  import:     pick(() => window.flux.opml.import(), () => Promise.resolve({ canceled: true })),
  importFile: (file) => {
    if (!usesHttp()) return null;
    const fd = new FormData();
    fd.append('file', file);
    return http('POST', '/api/opml/import', fd, true);
  },
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const settings = {
  get: pick(() => window.flux.settings.get(), () => http('GET', '/api/settings')),
  set: pick((d) => window.flux.settings.set(d), (d) => http('PUT', '/api/settings', d)),
};

// ── Ollama ────────────────────────────────────────────────────────────────────
export const ollama = {
  cluster:       pick((a) => window.flux.ollama.cluster(a),     (a) => http('POST', '/api/ollama/cluster', a)),
  summarize:     pick(async (a) => ({ summary: await window.flux.ollama.summarize(a) }), (a) => http('POST', '/api/ollama/summarize', a)),
  dailyDigest:   pick((a) => window.flux.ollama.dailyDigest(a), (a) => http('POST', '/api/ollama/daily-digest', a)),
  isRunning:     pick((u) => window.flux.ollama.isRunning(u),   (u) => http('GET',  `/api/ollama/is-running${u?`?url=${encodeURIComponent(u)}`:''}`)),
  start:         pick((u) => window.flux.ollama.start(u),       (u) => http('POST', '/api/ollama/start', { url: u })),
  stopIfStarted: pick(()  => window.flux.ollama.stopIfStarted(), () => http('POST', '/api/ollama/stop-if-started')),
};

// ── Webview events (Electron local mode only) ─────────────────────────────────
export const webview = {
  onNewWindow: (!IS_ELECTRON) ? () => () => {} : (cb) => window.flux.webview.onNewWindow(cb),
};

// ── Open links in the system's default browser ───────────────────────────────
export function openExternal(url) {
  if (!url) return;
  if (IS_ELECTRON) window.flux.shell.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Platform ──────────────────────────────────────────────────────────────────
export const platform = IS_ELECTRON ? (window.flux.platform || 'linux') : 'web';
