'use strict';
/**
 * Live reload. Watches the set of open files (and the workspace folder, when
 * one is open) with chokidar and pushes coalesced change events to the
 * renderer, which re-renders in place while preserving scroll position.
 */
const path = require('node:path');
const { isMarkdown } = require('./files');

// chokidar 5 is ESM-only, so it is imported lazily rather than required.
/**
 * Only the two members used here are described, deliberately: importing
 * chokidar's own types into a CommonJS module requires a resolution-mode
 * attribute, and this file needs nothing more than `watch` and `close`.
 *
 * @typedef {{ on(event: string, cb: (arg: any) => void): FsWatcherLike, close(): Promise<void> }} FsWatcherLike
 * @typedef {{ watch(paths: string | string[], options?: any): FsWatcherLike }} ChokidarLike
 */

/** @type {Promise<ChokidarLike> | null} */
let chokidarPromise = null;
function getChokidar() {
  if (!chokidarPromise) chokidarPromise = import('chokidar').then((m) => m.default ?? m);
  return chokidarPromise;
}

const SETTLE_MS = 90;
/**
 * How long to wait before believing an `unlink`.
 *
 * Many editors save atomically: write a temp file, then rename it over the
 * original. chokidar reports that as unlink-then-add, so reporting the removal
 * straight away would flash "file was deleted" on every save in vim, VS Code
 * and anything else using a rename-replace.
 */
const UNLINK_GRACE_MS = 450;

/** @typedef {{kind: string, path: string}} WatchEvent */

class Watcher {
  /** @param {(payload: WatchEvent) => void} onEvent */
  constructor(onEvent) {
    this.onEvent = onEvent;
    /** @type {FsWatcherLike | null} */
    this.fileWatcher = null;
    /** @type {FsWatcherLike | null} */
    this.folderWatcher = null;
    /** @type {string[]} */
    this.files = [];
    /** @type {string | null} */
    this.folder = null;
    /** @type {Map<string, WatchEvent>} */
    this.pending = new Map();
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.timer = null;
    /** path → timeout, for unlinks awaiting confirmation. @type {Map<string, NodeJS.Timeout>} */
    this.unlinkTimers = new Map();
  }

  /** Replace the watched file set. Paths not currently open stop being watched. */
  /** @param {string[]} files */
  async setFiles(files) {
    const next = [...new Set(files.map((/** @type {string} */ f) => path.resolve(f)))].sort();
    if (sameList(next, this.files)) return;
    this.files = next;

    await closeWatcher(this.fileWatcher);
    this.fileWatcher = null;
    if (next.length === 0) return;

    const chokidar = await getChokidar();
    if (!chokidar) return;
    this.fileWatcher = chokidar.watch(next, {
      ignoreInitial: true,
      // Editors that write via rename/replace fire quick add/unlink pairs;
      // awaitWriteFinish keeps us from rendering a half-written file.
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
    });
    const changed = (/** @type {string} */ p) => {
      // The file is here, so any pending "it vanished" is a rename-replace.
      this.cancelUnlink(p);
      this.queue('file-changed', p);
    };
    this.fileWatcher
      .on('change', changed)
      .on('add', changed)
      .on('unlink', (/** @type {string} */ p) => this.deferUnlink(p))
      .on('error', (/** @type {unknown} */ err) =>
        console.error('[watch:file]', err instanceof Error ? err.message : err)
      );
  }

  /** Hold an unlink briefly in case the path is about to reappear. */
  /** @param {string} target */
  deferUnlink(target) {
    this.cancelUnlink(target);
    const timer = setTimeout(() => {
      this.unlinkTimers.delete(target);
      this.queue('file-removed', target);
    }, UNLINK_GRACE_MS);
    this.unlinkTimers.set(target, timer);
  }

  /** @param {string} target */
  cancelUnlink(target) {
    const timer = this.unlinkTimers.get(target);
    if (timer) {
      clearTimeout(timer);
      this.unlinkTimers.delete(target);
    }
  }

  /** Watch a workspace folder so the sidebar tree stays current. */
  /** @param {string | null} folder */
  async setFolder(folder) {
    const next = folder ? path.resolve(folder) : null;
    if (next === this.folder) return;
    this.folder = next;

    await closeWatcher(this.folderWatcher);
    this.folderWatcher = null;
    if (!next) return;

    const chokidar = await getChokidar();
    if (!chokidar) return;
    this.folderWatcher = chokidar.watch(next, {
      ignoreInitial: true,
      depth: 12,
      ignored: (/** @type {string} */ p) => /(^|[\\/])(\.[^\\/]+|node_modules|dist|build|out|target|coverage|vendor)([\\/]|$)/.test(p),
    });
    const bump = (/** @type {string} */ p) => {
      if (isMarkdown(p) || !path.extname(p)) this.queue('tree-changed', next);
    };
    this.folderWatcher
      .on('add', bump)
      .on('unlink', bump)
      .on('addDir', bump)
      .on('unlinkDir', bump)
      .on('error', (/** @type {unknown} */ err) =>
        console.error('[watch:folder]', err instanceof Error ? err.message : err)
      );
  }

  /** Coalesce bursts of events (a save can emit several) into one flush. */
  /** @param {string} kind @param {string} target */
  /** @param {string} kind @param {string} target */
  queue(kind, target) {
    this.pending.set(`${kind}:${target}`, { kind, path: target });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const events = [...this.pending.values()];
      this.pending.clear();
      this.timer = null;
      for (const event of events) this.onEvent(event);
    }, SETTLE_MS);
  }

  async close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    for (const timer of this.unlinkTimers.values()) clearTimeout(timer);
    this.unlinkTimers.clear();
    await Promise.all([closeWatcher(this.fileWatcher), closeWatcher(this.folderWatcher)]);
    this.fileWatcher = null;
    this.folderWatcher = null;
    this.files = [];
    this.folder = null;
  }
}

/** @param {FsWatcherLike | null} watcher */
async function closeWatcher(watcher) {
  if (!watcher) return;
  try {
    await watcher.close();
  } catch {}
}

/** @param {string[]} a @param {string[]} b */
function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

module.exports = { Watcher };
