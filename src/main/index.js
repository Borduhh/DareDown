'use strict';
/**
 * DareDown — main process.
 *
 * Owns the window, the application menu, the config file, the filesystem
 * watcher and every IPC handler. The renderer is sandboxed and reaches Node
 * only through src/main/preload.js.
 *
 * Offline by construction: every network request from the app's session is
 * cancelled outright (see installNetworkBlock).
 */
const path = require('node:path');
const fsp = require('node:fs/promises');
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
  screen,
} = require('electron');

const config = require('./config');
const files = require('./files');
const { buildMenu } = require('./menu');
const { Watcher } = require('./watcher');

const RENDERER_HTML = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');

/** @type {BrowserWindow | null} */
let win = null;
/** @type {InstanceType<typeof Watcher> | null} */
let watcher = null;
let rendererReady = false;
/** Paths requested before the renderer finished booting. @type {string[]} */
const pendingPaths = [];

app.setName('DareDown');

/* ------------------------------------------------------------------ *
 * Single instance: a second launch hands its file arguments to the
 * running window instead of opening a rival copy of the app.
 * ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    queuePaths(collectPathArgs(argv));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

/**
 * Keep a restored window on a display that actually exists.
 *
 * @param {import('../types/bridge.js').WindowState} saved
 */
function visibleBounds(saved) {
  const { width, height, x, y } = saved;
  if (x === null || y === null) return { width, height };
  const fitsSomewhere = screen.getAllDisplays().some((display) => {
    const b = display.workArea;
    return x < b.x + b.width && x + 80 > b.x && y < b.y + b.height && y + 40 > b.y;
  });
  return fitsSomewhere ? { width, height, x, y } : { width, height };
}

function createWindow() {
  const prefs = config.get();
  const bounds = visibleBounds(prefs.window);
  const isDark = resolveDark(prefs.theme);

  // Held locally as well as on the module: `win` is nullable and can be cleared
  // by 'closed' before a queued handler runs, but inside this function the
  // window definitely exists.
  const created = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 400,
    show: false,
    title: 'DareDown',
    // Match the theme so the first paint does not flash the wrong colour.
    backgroundColor: isDark ? '#1E1D1B' : '#FAF9F5',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 15 } : undefined,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
      // An occluded or minimized window should still finish rendering the
      // document it was asked to open, rather than freezing mid-diagram.
      backgroundThrottling: false,
      devTools: Boolean(process.env.DAREDOWN_DEBUG),
    },
  });

  win = created;
  if (prefs.window.maximized) created.maximize();

  created.once('ready-to-show', () => {
    created.show();
  });

  created.on('close', () => {
    persistWindowState();
    config.flush();
  });

  created.on('closed', () => {
    win = null;
    rendererReady = false;
  });

  const persist = debounce(persistWindowState, 350);
  created.on('resize', persist);
  created.on('move', persist);
  created.on('maximize', persist);
  created.on('unmaximize', persist);

  // Never navigate away from the local document, and route any target=_blank
  // through the OS browser after an explicit protocol check.
  created.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  created.webContents.on('will-navigate', (event, url) => {
    if (url !== created.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });

  created.loadFile(RENDERER_HTML);
  return created;
}

/** The dialogs are only reachable from a menu, which requires a window. */
function requireWindow() {
  if (!win) throw new Error('no window is open');
  return win;
}

function persistWindowState() {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  // Normal bounds so un-maximizing later restores the pre-maximize geometry.
  const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
  config.set({
    window: {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized,
    },
  });
}

/* ------------------------------------------------------------------ *
 * Offline guarantee + theme
 * ------------------------------------------------------------------ */

const ALLOWED_SCHEMES = new Set(['file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:']);

/**
 * Cancel every request whose scheme could reach the network. The app bundles
 * all of its assets, so a blocked request means a bug or an untrusted document
 * trying to phone home — either way it should not be silently allowed.
 */
/** @param {Electron.Session} targetSession */
function installNetworkBlock(targetSession) {
  targetSession.webRequest.onBeforeRequest((/** @type {any} */ details, /** @type {any} */ callback) => {
    let scheme;
    try {
      scheme = new URL(details.url).protocol;
    } catch {
      return callback({ cancel: true });
    }
    if (ALLOWED_SCHEMES.has(scheme)) return callback({ cancel: false });
    console.warn(`[offline] blocked ${details.resourceType} request to ${details.url}`);
    callback({ cancel: true });
  });

  // Nothing in the app needs these, and denying keeps documents inert.
  targetSession.setPermissionRequestHandler((_wc, _permission, /** @type {(granted: boolean) => void} */ callback) =>
    callback(false)
  );
  targetSession.setPermissionCheckHandler(() => false);
}

/** @param {string} themePref */
function resolveDark(themePref) {
  if (themePref === 'dark') return true;
  if (themePref === 'light') return false;
  return nativeTheme.shouldUseDarkColors;
}

/** @param {string} themePref */
function applyThemeSource(themePref) {
  nativeTheme.themeSource = /** @type {'system' | 'light' | 'dark'} */ (
    themePref === 'system' ? 'system' : themePref
  );
}

/* ------------------------------------------------------------------ *
 * Opening documents
 * ------------------------------------------------------------------ */

/**
 * Pull Markdown paths out of a process argv vector.
 *
 * @param {string[]} argv
 */
function collectPathArgs(argv) {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((/** @type {string} */ arg) => !arg.startsWith('-'))
    .map((/** @type {string} */ arg) => path.resolve(arg))
    .filter((/** @type {string} */ arg) => files.isMarkdown(arg) || !path.extname(arg));
}

/** @param {string[] | null | undefined} paths */
function queuePaths(paths) {
  if (!paths || paths.length === 0) return;
  if (rendererReady && win && !win.isDestroyed()) {
    win.webContents.send('app:open-paths', paths);
  } else {
    pendingPaths.push(...paths);
  }
}

function flushPendingPaths() {
  if (pendingPaths.length === 0 || !win || win.isDestroyed()) return;
  const paths = pendingPaths.splice(0, pendingPaths.length);
  win.webContents.send('app:open-paths', paths);
}

/** @param {string} url */
function openExternal(url) {
  // Only ever hand http(s) and mailto to the OS; never file:// or custom schemes.
  try {
    const parsed = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      shell.openExternal(url);
      return true;
    }
  } catch {}
  return false;
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:renderer-ready', () => {
    rendererReady = true;
    flushPendingPaths();
    return { platform: process.platform, version: app.getVersion() };
  });

  ipcMain.handle('file:read', async (_event, filePath) => {
    if (typeof filePath !== 'string') throw new Error('Invalid path');
    return files.readMarkdown(filePath);
  });

  ipcMain.handle('folder:tree', async (_event, folder) => {
    if (typeof folder !== 'string') throw new Error('Invalid folder');
    return files.readTree(folder);
  });

  ipcMain.handle('link:resolve', async (_event, { fromFile, href }) => {
    if (typeof fromFile !== 'string' || typeof href !== 'string') return null;
    return files.resolveLink(fromFile, href);
  });

  ipcMain.handle('path:info', async (_event, filePath) => {
    if (typeof filePath !== 'string') return null;
    try {
      const stat = await fsp.stat(filePath);
      return { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
    } catch {
      return { exists: false, isFile: false, isDirectory: false };
    }
  });

  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: 'Open Markdown File',
      buttonLabel: 'Open',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'qmd'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: 'Open Folder',
      buttonLabel: 'Open',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('shell:open-external', (_event, url) => openExternal(url));

  ipcMain.handle('shell:reveal', (_event, filePath) => {
    if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath);
  });

  // configPath rides along so the preferences panel can show where it saves.
  ipcMain.handle('config:get', () => ({ ...config.get(), configPath: config.configPath() }));

  ipcMain.handle('config:set', (_event, patch) => {
    const next = config.set(patch && typeof patch === 'object' ? patch : {});
    if (patch && 'theme' in patch) applyThemeSource(next.theme);
    return next;
  });

  ipcMain.handle('theme:set-source', (_event, source) => {
    applyThemeSource(source);
    return nativeTheme.shouldUseDarkColors;
  });

  ipcMain.handle('watch:set', async (_event, payload) => {
    if (!watcher) return false;
    const openFiles = Array.isArray(payload?.files)
      ? payload.files.filter((/** @type {unknown} */ f) => typeof f === 'string')
      : [];
    const folder = typeof payload?.folder === 'string' ? payload.folder : null;
    await Promise.all([watcher.setFiles(openFiles), watcher.setFolder(folder)]);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

// macOS delivers "open with" before `ready`, so register the handler first.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queuePaths([filePath]);
});

app.whenReady().then(() => {
  installNetworkBlock(session.defaultSession);
  applyThemeSource(config.get().theme);
  registerIpc();

  watcher = new Watcher((payload) => {
    if (!win || win.isDestroyed()) return;
    const channel =
      payload.kind === 'file-changed'
        ? 'file:changed'
        : payload.kind === 'file-removed'
          ? 'file:removed'
          : 'tree:changed';
    win.webContents.send(channel, payload.path);
  });

  Menu.setApplicationMenu(
    buildMenu({
      onCommand: (command, arg) => {
        if (!win || win.isDestroyed()) return;
        win.webContents.send('menu:command', { command, arg });
      },
    })
  );

  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('theme:native-changed', nativeTheme.shouldUseDarkColors);
    }
  });

  createWindow();
  queuePaths(collectPathArgs(process.argv));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  persistWindowState();
  config.flush();
  if (watcher) await watcher.close();
});

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} ms
 * @returns {(...args: Parameters<F>) => void}
 */
function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  return (/** @type {Parameters<F>} */ ...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}
