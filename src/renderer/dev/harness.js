/**
 * Development harness. Stands in for src/main/preload.js so the renderer can be
 * opened directly in a browser for visual checks — theme, typography, diagram
 * rendering, the fullscreen modal — without launching Electron.
 *
 * The build script injects the samples/ tree as `__DAREDOWN_FIXTURES__`; this file
 * is only emitted by `node scripts/build.mjs --harness` and never ships.
 *
 * Stays plain JavaScript on purpose: scripts/build.mjs copies it verbatim rather
 * than bundling it, so TypeScript here would reach the browser untranspiled. It
 * is still type-checked against the real bridge contract, which is the point —
 * this stub used to drift from preload silently.
 *
 */
(() => {
  const FIXTURES = /** @type {{root: string, files: Record<string, string>, openFiles?: string[], activeFile?: string}} */ (
    /** @type {any} */ (window).__DAREDOWN_FIXTURES__
  ) || { root: '/samples', files: {} };
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const listeners = new Map();

  /** @type {import('../../types/bridge.js').ConfigWithPath} */
  const prefs = {
    window: { width: 1120, height: 800, x: null, y: null, maximized: false },
    theme: 'system',
    readingWidth: 720,
    fontSize: 17,
    sidebarVisible: true,
    sidebarWidth: 260,
    sidebarPane: 'files',
    fullWidth: false,
    wrapCode: false,
    lastFolder: FIXTURES.root,
    lastFiles: FIXTURES.openFiles || [],
    activeFile: FIXTURES.activeFile || null,
    configPath: '/dev/null/config.json',
  };

  /** @param {string} p */
  const baseName = (p) => p.split('/').pop() ?? p;
  /** @param {string} p */
  const dirName = (p) => p.slice(0, p.lastIndexOf('/')) || '/';

  /* ---------------------------------------------------------------- *
   * matchMedia shim.
   *
   * In the real app the theme preference is pushed to
   * `nativeTheme.themeSource`, which makes the renderer's
   * prefers-color-scheme query report the *effective* theme — that is how
   * "system" works with a manual override on top. A plain browser has no
   * such hook, so the query is shimmed to follow the stored preference.
   * ---------------------------------------------------------------- */
  const nativeMatchMedia = window.matchMedia.bind(window);
  const systemQuery = nativeMatchMedia('(prefers-color-scheme: dark)');
  /** @type {Set<(event: any) => void>} */
  const themeListeners = new Set();
  let themeSource = 'system';

  const darkQuery = {
    media: '(prefers-color-scheme: dark)',
    get matches() {
      return themeSource === 'dark' || (themeSource === 'system' && systemQuery.matches);
    },
    onchange: null,
    /** @param {string} type @param {(event: any) => void} handler */
    addEventListener: (type, handler) => {
      if (type === 'change') themeListeners.add(handler);
    },
    /** @param {string} _type @param {(event: any) => void} handler */
    removeEventListener: (_type, handler) => themeListeners.delete(handler),
    /** @param {(event: any) => void} handler */
    addListener: (handler) => themeListeners.add(handler),
    /** @param {(event: any) => void} handler */
    removeListener: (handler) => themeListeners.delete(handler),
    dispatchEvent: () => true,
  };

  window.matchMedia = /** @type {typeof window.matchMedia} */ ((query) =>
    /prefers-color-scheme:\s*dark/i.test(query) ? darkQuery : nativeMatchMedia(query));

  /** @param {string} next */
  function setThemeSource(next) {
    const before = darkQuery.matches;
    themeSource = next;
    if (darkQuery.matches === before) return;
    const event = { matches: darkQuery.matches, media: darkQuery.media };
    for (const handler of themeListeners) handler(event);
  }

  systemQuery.addEventListener('change', () => {
    if (themeSource === 'system') setThemeSource('system');
  });

  /** Build the nested tree the sidebar expects from the flat fixture map. */
  /** @param {string} root */
  function buildTree(root) {
    const rootNode = { type: 'dir', name: baseName(root), path: root, children: [] };
    const dirs = new Map([[root, rootNode]]);

    /** @param {string} path @returns {any} */
    const ensureDir = (path) => {
      if (dirs.has(path)) return dirs.get(path);
      const node = { type: 'dir', name: baseName(path), path, children: [] };
      dirs.set(path, node);
      ensureDir(dirName(path)).children.push(node);
      return node;
    };

    for (const path of Object.keys(FIXTURES.files).sort()) {
      ensureDir(dirName(path)).children.push({ type: 'file', name: baseName(path), path });
    }
    return { root, name: baseName(root), children: rootNode.children, truncated: false };
  }

  /** @type {import('../../types/bridge.js').DareDownApi} */
  const api = {
    platform: 'darwin',

    readFile: async (path) => {
      const content = FIXTURES.files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return {
        path,
        name: baseName(path),
        dir: dirName(path),
        content,
        mtimeMs: 0,
        size: content.length,
      };
    },

    readTree: async (folder) => buildTree(folder),

    resolveLink: async (fromFile, href) => {
      const base = dirName(fromFile);
      const segments = base.split('/');
      for (const part of href.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') segments.pop();
        else segments.push(part);
      }
      const target = segments.join('/');
      for (const candidate of [target, `${target}.md`, `${target}/index.md`, `${target}/README.md`]) {
        if (FIXTURES.files[candidate] !== undefined) return candidate;
      }
      return null;
    },

    pathInfo: async (path) => ({
      exists: FIXTURES.files[path] !== undefined || path === FIXTURES.root,
      isFile: FIXTURES.files[path] !== undefined,
      isDirectory: path === FIXTURES.root,
    }),

    openFileDialog: async () => [],
    openFolderDialog: async () => FIXTURES.root,
    openExternal: async (url) => {
      console.info('[harness] openExternal', url);
      return true;
    },
    revealInFolder: async (path) => console.info('[harness] reveal', path),

    getConfig: async () => ({ ...prefs }),
    setConfig: async (patch) => {
      Object.assign(prefs, patch);
      // Same as the main process: the preference becomes the theme source, and
      // the renderer learns about it through the media query.
      if (patch.theme) setThemeSource(patch.theme);
      return { ...prefs };
    },
    setThemeSource: async (source) => {
      setThemeSource(source);
      return darkQuery.matches;
    },
    watch: async () => true,

    onFileChanged: (h) => register('file-changed', h),
    onFileRemoved: (h) => register('file-removed', h),
    onTreeChanged: (h) => register('tree-changed', h),
    onNativeThemeChanged: (h) => register('theme', h),
    onMenuCommand: (h) => register('menu', h),
    onOpenPaths: (h) => register('open-paths', h),

    ready: async () => ({ platform: 'darwin', version: '0.0.0-harness' }),
  };

  window.daredown = api;

  /**
   * @param {string} name
   * @param {(payload: any) => void} handler
   * @returns {() => void}
   */
  function register(name, handler) {
    let set = listeners.get(name);
    if (!set) {
      set = new Set();
      listeners.set(name, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /** Drive the app from the console or an automation script. */
  window.__harness = {
    fixtures: FIXTURES,
    command: (command) => {
      for (const handler of listeners.get('menu') || []) handler({ command });
    },
    /** @param {string} name @param {any} payload */
    emit: (name, payload) => {
      for (const handler of listeners.get(name) || []) handler(payload);
    },
    /** Simulate an external edit for live-reload checks. */
    /** @param {string} path @param {string} content */
    editFile: (path, content) => {
      FIXTURES.files[path] = content;
      for (const handler of listeners.get('file-changed') || []) handler(path);
    },
  };
})();
