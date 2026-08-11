'use strict';
/**
 * The only bridge between the sandboxed renderer and Node. Exposes a small,
 * explicit API surface — no `ipcRenderer`, no `require`, no arbitrary channels.
 */
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Wrap a main-process listener so callers get an unsubscribe function.
 *
 * @param {string} channel
 * @param {(payload: any) => void} handler
 * @returns {() => void}
 */
function on(channel, handler) {
  /** @type {(event: Electron.IpcRendererEvent, payload: any) => void} */
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

/**
 * The shape here is the contract in src/types/bridge.ts. Annotating it means a
 * member renamed on one side stops type-checking on the other.
 *
 * @type {import('../types/bridge.js').DareDownApi}
 */
const api = {
  platform: process.platform,

  // ---- documents -------------------------------------------------------
  readFile: (/** @type {string} */ filePath) => ipcRenderer.invoke('file:read', filePath),
  readTree: (/** @type {string} */ folder) => ipcRenderer.invoke('folder:tree', folder),
  resolveLink: (/** @type {string} */ fromFile, /** @type {string} */ href) => ipcRenderer.invoke('link:resolve', { fromFile, href }),
  pathInfo: (/** @type {string} */ filePath) => ipcRenderer.invoke('path:info', filePath),

  // ---- dialogs & shell -------------------------------------------------
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  openExternal: (/** @type {string} */ url) => ipcRenderer.invoke('shell:open-external', url),
  revealInFolder: (/** @type {string} */ filePath) => ipcRenderer.invoke('shell:reveal', filePath),

  // ---- preferences -----------------------------------------------------
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (/** @type {any} */ patch) => ipcRenderer.invoke('config:set', patch),
  setThemeSource: (/** @type {any} */ source) => ipcRenderer.invoke('theme:set-source', source),

  // ---- live reload -----------------------------------------------------
  watch: (/** @type {any} */ payload) => ipcRenderer.invoke('watch:set', payload),

  // ---- events from main ------------------------------------------------
  onFileChanged: (/** @type {any} */ handler) => on('file:changed', handler),
  onFileRemoved: (/** @type {any} */ handler) => on('file:removed', handler),
  onTreeChanged: (/** @type {any} */ handler) => on('tree:changed', handler),
  onNativeThemeChanged: (/** @type {any} */ handler) => on('theme:native-changed', handler),
  onMenuCommand: (/** @type {any} */ handler) => on('menu:command', handler),
  onOpenPaths: (/** @type {any} */ handler) => on('app:open-paths', handler),

  // ---- lifecycle -------------------------------------------------------
  /** Renderer tells main it is ready so queued file-open requests can flush. */
  ready: () => ipcRenderer.invoke('app:renderer-ready'),
};

contextBridge.exposeInMainWorld('daredown', api);
