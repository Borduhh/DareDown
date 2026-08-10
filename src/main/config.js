'use strict';
/**
 * A tiny JSON-file config store living in the OS app-data directory.
 * Everything the app remembers between launches goes through here: window
 * geometry, theme, reading preferences and the last opened file/folder.
 * No network, no cloud — just one file the user can read or delete.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  window: { width: 1120, height: 800, x: null, y: null, maximized: false },
  theme: 'system', // 'system' | 'light' | 'dark'
  readingWidth: 720, // px, 560–1100
  fullWidth: false, // ignore readingWidth and fill the pane
  fontSize: 17, // px, 13–24
  sidebarVisible: true,
  sidebarWidth: 260,
  sidebarPane: 'files', // 'files' | 'outline'
  wrapCode: false,
  lastFolder: null,
  lastFiles: [], // absolute paths of tabs open at quit
  activeFile: null,
};

const CLAMPS = {
  readingWidth: [560, 1100],
  fontSize: [13, 24],
  sidebarWidth: [180, 480],
};

let filePath = null;
let cache = null;
let writeTimer = null;

function configPath() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'config.json');
  return filePath;
}

function clampNumber(key, value, fallback) {
  const range = CLAMPS[key];
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (!range) return n;
  return Math.min(range[1], Math.max(range[0], n));
}

/** Merge stored values over defaults, dropping anything malformed. */
function sanitize(raw) {
  const out = structuredClone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return out;

  if (raw.window && typeof raw.window === 'object') {
    const w = raw.window;
    out.window = {
      width: Number.isFinite(w.width) ? Math.max(480, w.width) : DEFAULTS.window.width,
      height: Number.isFinite(w.height) ? Math.max(360, w.height) : DEFAULTS.window.height,
      x: Number.isFinite(w.x) ? w.x : null,
      y: Number.isFinite(w.y) ? w.y : null,
      maximized: Boolean(w.maximized),
    };
  }
  if (['system', 'light', 'dark'].includes(raw.theme)) out.theme = raw.theme;
  out.readingWidth = clampNumber('readingWidth', raw.readingWidth, DEFAULTS.readingWidth);
  out.fontSize = clampNumber('fontSize', raw.fontSize, DEFAULTS.fontSize);
  out.sidebarWidth = clampNumber('sidebarWidth', raw.sidebarWidth, DEFAULTS.sidebarWidth);
  for (const flag of ['sidebarVisible', 'fullWidth', 'wrapCode']) {
    if (typeof raw[flag] === 'boolean') out[flag] = raw[flag];
  }
  if (['files', 'outline'].includes(raw.sidebarPane)) out.sidebarPane = raw.sidebarPane;
  if (typeof raw.lastFolder === 'string') out.lastFolder = raw.lastFolder;
  if (typeof raw.activeFile === 'string') out.activeFile = raw.activeFile;
  if (Array.isArray(raw.lastFiles)) {
    out.lastFiles = raw.lastFiles.filter((p) => typeof p === 'string').slice(0, 40);
  }
  return out;
}

function load() {
  if (cache) return cache;
  try {
    cache = sanitize(JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch {
    // Missing or corrupt config is not an error — fall back to defaults.
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

function get() {
  return structuredClone(load());
}

/** Shallow-merge a patch into the config and schedule a debounced write. */
function set(patch) {
  const current = load();
  cache = sanitize({ ...current, ...patch });
  scheduleWrite();
  return get();
}

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 400);
}

/** Write-to-temp-then-rename so a crash mid-write cannot truncate the config. */
function flush() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!cache) return;
  const target = configPath();
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('[config] could not save preferences:', err.message);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
  }
}

module.exports = { DEFAULTS, get, set, flush, configPath };
