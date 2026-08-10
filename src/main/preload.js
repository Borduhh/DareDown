'use strict';
/**
 * The only bridge between the sandboxed renderer and Node. Exposes a small,
 * explicit API surface — no `ipcRenderer`, no `require`, no arbitrary channels.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Wrap a main-process listener so callers get an unsubscribe function. */
function on(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

contextBridge.exposeInMainWorld('daredown', {
  platform: process.platform,

  // ---- documents -------------------------------------------------------
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  readTree: (folder) => ipcRenderer.invoke('folder:tree', folder),
  resolveLink: (fromFile, href) => ipcRenderer.invoke('link:resolve', { fromFile, href }),
  pathInfo: (filePath) => ipcRenderer.invoke('path:info', filePath),

  // ---- dialogs & shell -------------------------------------------------
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),

  // ---- preferences -----------------------------------------------------
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setThemeSource: (source) => ipcRenderer.invoke('theme:set-source', source),

  // ---- live reload -----------------------------------------------------
  watch: (payload) => ipcRenderer.invoke('watch:set', payload),

  // ---- events from main ------------------------------------------------
  onFileChanged: (handler) => on('file:changed', handler),
  onFileRemoved: (handler) => on('file:removed', handler),
  onTreeChanged: (handler) => on('tree:changed', handler),
  onNativeThemeChanged: (handler) => on('theme:native-changed', handler),
  onMenuCommand: (handler) => on('menu:command', handler),
  onOpenPaths: (handler) => on('app:open-paths', handler),

  // ---- lifecycle -------------------------------------------------------
  /** Renderer tells main it is ready so queued file-open requests can flush. */
  ready: () => ipcRenderer.invoke('app:renderer-ready'),
});
