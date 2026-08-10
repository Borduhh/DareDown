/**
 * Development harness. Stands in for src/main/preload.js so the renderer can be
 * opened directly in a browser for visual checks — theme, typography, diagram
 * rendering, the fullscreen modal — without launching Electron.
 *
 * The build script injects the samples/ tree as `__DAREDOWN_FIXTURES__`; this file
 * is only emitted by `node scripts/build.mjs --harness` and never ships.
 */
(() => {
  const FIXTURES = window.__DAREDOWN_FIXTURES__ || { root: '/samples', files: {} };
  const listeners = new Map();

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

  const baseName = (p) => p.split('/').pop();
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
  const themeListeners = new Set();
  let themeSource = 'system';

  const darkQuery = {
    media: '(prefers-color-scheme: dark)',
    get matches() {
      return themeSource === 'dark' || (themeSource === 'system' && systemQuery.matches);
    },
    onchange: null,
    addEventListener: (type, handler) => {
      if (type === 'change') themeListeners.add(handler);
    },
    removeEventListener: (_type, handler) => themeListeners.delete(handler),
    addListener: (handler) => themeListeners.add(handler),
    removeListener: (handler) => themeListeners.delete(handler),
    dispatchEvent: () => true,
  };

  window.matchMedia = (query) =>
    /prefers-color-scheme:\s*dark/i.test(query) ? darkQuery : nativeMatchMedia(query);

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
  function buildTree(root) {
    const rootNode = { type: 'dir', name: baseName(root), path: root, children: [] };
    const dirs = new Map([[root, rootNode]]);

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

  window.daredown = {
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
      if ('theme' in patch) setThemeSource(patch.theme);
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

  function register(name, handler) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
    return () => listeners.get(name).delete(handler);
  }

  /** Drive the app from the console or an automation script. */
  window.__harness = {
    fixtures: FIXTURES,
    command: (command) => {
      for (const handler of listeners.get('menu') || []) handler({ command });
    },
    emit: (name, payload) => {
      for (const handler of listeners.get(name) || []) handler(payload);
    },
    /** Simulate an external edit for live-reload checks. */
    editFile: (path, content) => {
      FIXTURES.files[path] = content;
      for (const handler of listeners.get('file-changed') || []) handler(path);
    },
  };
})();
