'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Expose a plain boolean flag first — api.js checks this to decide whether
// to use IPC or HTTP. It's set synchronously by the preload before any
// React code evaluates, so IS_ELECTRON detection is always reliable.
contextBridge.exposeInMainWorld('__FLUX_ELECTRON__', true);

contextBridge.exposeInMainWorld('flux', {
  feeds: {
    list:        ()      => ipcRenderer.invoke('feeds:list'),
    add:         (c)     => ipcRenderer.invoke('feeds:add', c),
    remove:      (id)    => ipcRenderer.invoke('feeds:remove', id),
    updateRules: (a)     => ipcRenderer.invoke('feeds:updateRules', a),
    fetchAll:    ()      => ipcRenderer.invoke('feeds:fetchAll'),
    fetchStream: ()      => ipcRenderer.invoke('feeds:fetchStream'),
    fetchOne:    (id)    => ipcRenderer.invoke('feeds:fetchOne', id),
    resolve:     (url)   => ipcRenderer.invoke('feeds:resolve', url),
    onStreamResult: (cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on('feeds:streamResult', handler);
      return () => ipcRenderer.removeListener('feeds:streamResult', handler);
    },
  },
  articles: {
    fetch:      (a)      => ipcRenderer.invoke('article:fetch', a),
    clearCache: (url)    => ipcRenderer.invoke('article:clearCache', url),
    markRead:   (a)      => ipcRenderer.invoke('articles:markRead', a),
    toggleStar: (a)      => ipcRenderer.invoke('articles:toggleStar', a),
    getState:   ()       => ipcRenderer.invoke('articles:getState'),
  },
  folders: {
    list:    ()           => ipcRenderer.invoke('folders:list'),
    add:     (a)          => ipcRenderer.invoke('folders:add', a),
    remove:  (id)         => ipcRenderer.invoke('folders:remove', id),
    reorder: (orderedIds) => ipcRenderer.invoke('folders:reorder', orderedIds),
    update:  (a)          => ipcRenderer.invoke('folders:update', a),
  },
  cookies: {
    getForDomain:   (d)  => ipcRenderer.invoke('cookies:getForDomain', d),
    clearForDomain: (d)  => ipcRenderer.invoke('cookies:clearForDomain', d),
  },
  opml: {
    export: ()           => ipcRenderer.invoke('opml:export'),
    import: ()           => ipcRenderer.invoke('opml:import'),
  },
  settings: {
    get: ()              => ipcRenderer.invoke('settings:get'),
    set: (d)             => ipcRenderer.invoke('settings:set', d),
  },
  ollama: {
    cluster:     (a) => ipcRenderer.invoke('ollama:cluster', a),
    summarize:   (a) => ipcRenderer.invoke('ollama:summarize', a),
    dailyDigest: (a) => ipcRenderer.invoke('ollama:dailyDigest', a),
    isRunning:   (u) => ipcRenderer.invoke('ollama:isRunning', u),
    start:       (u) => ipcRenderer.invoke('ollama:start', u),
    stopIfStarted: () => ipcRenderer.invoke('ollama:stopIfStarted'),
  },
  // Remote-server config (Electron "connect to external server" mode) — a
  // small file separate from the app's data store, since it's device-level
  // connection config (which server + device token), not user content.
  remote: {
    getConfig: ()     => ipcRenderer.invoke('remote:getConfig'),
    setConfig: (cfg)  => ipcRenderer.invoke('remote:setConfig', cfg),
    clear:     ()     => ipcRenderer.invoke('remote:clear'),
  },
  webview: {
    onNewWindow: (cb) => {
      const handler = (_event, url) => cb(url);
      ipcRenderer.on('webview:new-window', handler);
      return () => ipcRenderer.removeListener('webview:new-window', handler);
    },
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  platform: process.platform, // 'darwin' | 'win32' | 'linux'
});
