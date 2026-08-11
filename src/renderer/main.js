/**
 * DareDown — renderer entry point.
 *
 * Wires the document view, tabs, sidebar, outline, find, preferences and live
 * reload together. All filesystem and OS access goes through `window.daredown`,
 * the narrow bridge defined in src/main/preload.js.
 */
import './styles/index.css';

import { renderMarkdown } from './markdown.js';
import {
  configureMermaid,
  renderMermaidBlocks,
  refitMermaidBlocks,
  captureMermaidZoom,
  resetMermaidBlocks,
  closeMermaidModal,
  isMermaidModalOpen,
} from './mermaid-view.js';
import { Tabs } from './tabs.js';
import { Tree } from './tree.js';
import { Outline } from './outline.js';
import { Find } from './find.js';
import { openPreferences, openQuickOpen, openShortcuts } from './overlays.js';
import { toast } from './toast.js';

const api = window.daredown;

/** GitHub Sponsors page, opened in the OS browser from the sidebar footer. */
const SPONSOR_URL = 'https://github.com/sponsors/Borduhh';

const el = {
  app: document.getElementById('app'),
  topbar: document.getElementById('topbar'),
  crumbs: document.getElementById('crumbs'),
  progress: document.querySelector('#progress i'),
  sidebar: document.getElementById('sidebar'),
  sidebarTabs: document.querySelector('.sidebar-tabs'),
  sidebarTitle: document.getElementById('sidebar-title'),
  sidebarGrip: document.getElementById('sidebar-grip'),
  tree: document.getElementById('tree'),
  main: document.getElementById('main'),
  tabstrip: document.getElementById('tabstrip'),
  scroller: document.getElementById('scroller'),
  doc: document.getElementById('doc'),
  welcome: document.getElementById('welcome'),
  outlineList: document.getElementById('outline-list'),
  btnSidebar: document.getElementById('btn-sidebar'),
  btnFullWidth: document.getElementById('btn-full-width'),
  btnTheme: document.getElementById('btn-theme'),
  btnPrefs: document.getElementById('btn-prefs'),
  btnOpenFolder: document.getElementById('btn-open-folder'),
  btnSponsor: document.getElementById('btn-sponsor'),
  welcomeFile: document.getElementById('welcome-file'),
  welcomeFolder: document.getElementById('welcome-folder'),
};

/** @type {{prefs: any, folder: string|null, configPath: string, isMac: boolean}} */
const state = {
  prefs: null,
  folder: null,
  configPath: '',
  isMac: api.platform === 'darwin',
  /** Tabs whose file changed on disk while they were in the background. */
  stale: new Set(),
  /** Guards against a slow render landing after the reader moved on. */
  renderToken: 0,
  /**
   * The scroll offset the in-flight render is restoring to, or null when no
   * render is running. While diagrams are still rendering the document is
   * shorter than its final height, so the live scrollTop may be clamped — a
   * reload that fired in that window must use this target, not the DOM value,
   * or repeated saves would walk the reader up the page.
   */
  scrollTarget: null,
  openSheet: null,
};

/** The reading position a reload should restore, race-free. */
function currentScrollTarget() {
  return state.scrollTarget ?? el.scroller.scrollTop;
}

/* ------------------------------------------------------------------ *
 * Path helpers — the renderer has no Node, so these are hand-rolled.
 * ------------------------------------------------------------------ */

const SEPARATOR = /[/\\]/;

function baseName(filePath) {
  const parts = String(filePath).split(SEPARATOR);
  return parts[parts.length - 1] || filePath;
}

function dirName(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? normalized.slice(0, index + 1) || '/' : normalized.slice(0, index);
}

/** Resolve a relative reference against a directory, collapsing . and .. */
function resolveRelative(baseDir, reference) {
  const base = String(baseDir).replace(/\\/g, '/').replace(/\/$/, '');
  const ref = String(reference).replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(ref) || ref.startsWith('/')) return ref;

  const segments = base.split('/');
  for (const part of ref.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/') || '/';
}

/** Absolute filesystem path → file:// URL Chromium will load. */
function toFileUrl(absolutePath) {
  let normalized = String(absolutePath).replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  // encodeURI leaves ':' and '/' intact; '#' and '?' would otherwise truncate.
  return encodeURI(`file://${normalized}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function isExternalHref(href) {
  return /^(https?|mailto|tel|ftp|ftps):/i.test(href);
}

/* ------------------------------------------------------------------ *
 * Preferences & theme
 * ------------------------------------------------------------------ */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * `nativeTheme.themeSource` is driven from the stored preference in main, so
 * this media query already reflects the effective theme — including "system".
 */
function effectiveDark() {
  return darkQuery.matches;
}

function applyTheme({ rerenderDiagrams = true } = {}) {
  const dark = effectiveDark();
  document.body.dataset.theme = dark ? 'dark' : 'light';
  el.btnTheme.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');

  configureMermaid(dark);
  // Diagram colours are baked into the generated SVG, so a theme flip means a
  // full re-render. Zoom levels the reader set are carried across.
  if (rerenderDiagrams && el.doc.querySelector('.mermaid-block')) {
    const memory = captureMermaidZoom(el.doc);
    closeMermaidModal();
    resetMermaidBlocks(el.doc);
    renderMermaidBlocks(el.doc, { zoomMemory: memory });
  }
}

function applyReadingPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--reading-width', `${state.prefs.readingWidth}px`);
  root.style.setProperty('--font-size', `${state.prefs.fontSize}px`);
  root.style.setProperty('--sidebar-width', `${state.prefs.sidebarWidth}px`);
  el.app.dataset.wrapCode = String(Boolean(state.prefs.wrapCode));
  el.app.dataset.fullWidth = String(Boolean(state.prefs.fullWidth));
  el.app.dataset.sidebar = state.prefs.sidebarVisible ? 'visible' : 'hidden';
  el.btnSidebar.setAttribute('aria-pressed', String(Boolean(state.prefs.sidebarVisible)));
  el.btnFullWidth.setAttribute('aria-pressed', String(Boolean(state.prefs.fullWidth)));

  const pane = state.prefs.sidebarPane === 'outline' ? 'outline' : 'files';
  el.sidebar.dataset.pane = pane;
  for (const tab of el.sidebarTabs.querySelectorAll('.sidebar-tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.pane === pane));
  }
  outline.setVisible(pane === 'outline');

  // Diagrams fitted to the old column width need to re-fit to the new one.
  requestAnimationFrame(() => refitMermaidBlocks(el.doc));
}

/** Show a sidebar view, revealing the sidebar if it was collapsed. */
function showSidebarPane(pane) {
  const patch = { sidebarPane: pane };
  if (!state.prefs.sidebarVisible) patch.sidebarVisible = true;
  updatePrefs(patch);
}

/** Merge a preference patch, apply it live, and persist it. */
async function updatePrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  applyReadingPrefs();
  const saved = await api.setConfig(patch);
  state.prefs = { ...state.prefs, ...saved };
  return saved;
}

function toggleTheme() {
  // Toggling from "system" commits to the opposite of what is on screen.
  const next = effectiveDark() ? 'light' : 'dark';
  updatePrefs({ theme: next });
}

/* ------------------------------------------------------------------ *
 * Document rendering
 * ------------------------------------------------------------------ */

const tabs = new Tabs(el.tabstrip, {
  onActivate: (path) => activateTab(path),
  onClose: (path) => closeTab(path),
});

const tree = new Tree(el.tree, el.sidebarTitle, {
  onOpen: (path) => openPath(path, { activate: true }),
});

const outline = new Outline(el.outlineList, el.scroller, {
  onJump: (id) => jumpToAnchor(id),
});

const find = new Find(el.main, el.doc, el.scroller);

/**
 * Load a file into a tab and render it.
 *
 * @param {string} filePath
 * @param {{activate?: boolean, hash?: string, scrollTop?: number, silent?: boolean}} options
 */
async function openPath(filePath, options = {}) {
  const { activate = true, hash = '', scrollTop = null, silent = false } = options;

  let doc;
  try {
    doc = await api.readFile(filePath);
  } catch (err) {
    if (!silent) toast(`Could not open ${baseName(filePath)}: ${cleanMessage(err)}`, { error: true });
    return false;
  }

  const existing = tabs.has(doc.path);
  tabs.add(doc.path, doc.name);
  tabs.markMissing(doc.path, false);
  state.stale.delete(doc.path);

  if (activate) {
    // Remember where the outgoing document was before switching away.
    if (tabs.activePath && tabs.activePath !== doc.path) {
      tabs.saveScroll(tabs.activePath, el.scroller.scrollTop);
    }
    tabs.setActive(doc.path);
    await renderDocument(doc, {
      scrollTop: scrollTop ?? (existing ? tabs.get(doc.path).scrollTop : 0),
      hash,
    });
  }

  syncWorkspace();
  return true;
}

/** Render a loaded document into the reading pane. */
async function renderDocument(doc, { scrollTop = 0, hash = '', preserveDiagramZoom = false } = {}) {
  const token = (state.renderToken += 1);
  state.scrollTarget = hash ? null : scrollTop;
  const zoomMemory = preserveDiagramZoom ? captureMermaidZoom(el.doc) : null;

  closeMermaidModal();
  outline.clear();

  let headings;
  try {
    ({ headings } = renderMarkdown(doc.content, el.doc));
  } catch (err) {
    state.scrollTarget = null;
    renderFailure(doc, err);
    return;
  }

  resolveAssets(el.doc, doc.path);
  el.welcome.hidden = true;
  updateCrumbs(doc.path);
  document.title = `${doc.name} — DareDown`;
  outline.setHeadings(headings, el.doc);

  // Restore the reading position before diagrams change the page height…
  if (hash) {
    jumpToAnchor(hash, { instant: true });
  } else {
    el.scroller.scrollTop = scrollTop;
  }
  updateProgress();

  await renderMermaidBlocks(el.doc, { zoomMemory: zoomMemory ?? undefined });
  if (token !== state.renderToken) return; // a newer render superseded this one

  // …and again afterwards, since rendered diagrams reflow everything below them.
  if (hash) jumpToAnchor(hash, { instant: true });
  else if (scrollTop > 0) el.scroller.scrollTop = scrollTop;
  state.scrollTarget = null;
  updateProgress();
  find.refresh();
}

function renderFailure(doc, err) {
  el.doc.replaceChildren();
  const box = document.createElement('div');
  box.className = 'doc-error';
  const title = document.createElement('h2');
  title.textContent = 'Could not render this document';
  const message = document.createElement('p');
  message.textContent = cleanMessage(err);
  const where = document.createElement('p');
  const code = document.createElement('code');
  code.textContent = doc.path;
  where.append(code);
  box.append(title, message, where);
  el.doc.append(box);
  el.welcome.hidden = true;
}

function cleanMessage(err) {
  return String(err?.message || err || 'Unknown error').replace(/^Error invoking remote method '[^']+':\s*/, '');
}

/**
 * Point relative images at real files and tag links by destination so the
 * click handler knows what to do without re-parsing hrefs.
 */
function resolveAssets(root, docPath) {
  const dir = dirName(docPath);

  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (src && !/^(https?:|data:|file:|blob:)/i.test(src)) {
      img.src = toFileUrl(resolveRelative(dir, decodeURIComponentSafe(src)));
    }
    img.loading = 'lazy';
    img.addEventListener('error', () => img.classList.add('is-missing'), { once: true });

    // An image sharing a paragraph with text is decoration, not a figure.
    const parent = img.parentElement;
    if (parent && parent.tagName === 'P' && parent.textContent.trim().length > 0) {
      img.classList.add('is-inline');
    }
  }

  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#')) {
      link.dataset.link = 'anchor';
    } else if (isExternalHref(href)) {
      link.dataset.link = 'external';
      link.title = href;
    } else {
      link.dataset.link = 'internal';
      link.title = href;
    }
  }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function updateCrumbs(docPath) {
  el.crumbs.replaceChildren();
  const name = baseName(docPath);

  // Inside a workspace, show the path relative to its root. Outside one, show
  // only the containing folder — a full absolute path would swamp the bar.
  let prefix;
  if (state.folder && docPath.startsWith(state.folder)) {
    const relative = dirName(docPath.slice(state.folder.length).replace(/^[/\\]/, ''));
    prefix =
      relative === '/' || relative === '' || relative === docPath
        ? baseName(state.folder)
        : `${baseName(state.folder)}/${relative}`;
  } else {
    prefix = baseName(dirName(docPath));
  }

  if (prefix && prefix !== '/') {
    const dirSpan = document.createElement('span');
    dirSpan.textContent = prefix;
    const separator = document.createElement('span');
    separator.className = 'crumb-sep';
    separator.textContent = '/';
    el.crumbs.append(dirSpan, separator);
  }
  const nameSpan = document.createElement('span');
  nameSpan.className = 'crumb-name';
  nameSpan.textContent = name;
  el.crumbs.append(nameSpan);
  el.crumbs.title = docPath;
}

function jumpToAnchor(idOrHash, { instant = false } = {}) {
  const id = decodeURIComponentSafe(String(idOrHash).replace(/^#/, ''));
  if (!id) return;
  const target =
    el.doc.querySelector(`#${cssEscape(id)}`) ||
    // Fall back to a case-insensitive heading-text match, which is what a
    // hand-written link usually means.
    [...el.doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(
      (h) => h.textContent.trim().toLowerCase() === id.replace(/-/g, ' ').toLowerCase()
    );
  if (!target) {
    toast(`No heading matches “${id}”`);
    return;
  }
  // Measured from rects rather than offsetTop: the nearest positioned ancestor
  // is `.main`, so offsetTop would silently include the tab strip's height.
  const top =
    el.scroller.scrollTop +
    target.getBoundingClientRect().top -
    el.scroller.getBoundingClientRect().top -
    18;
  el.scroller.scrollTo({ top: Math.max(0, top), behavior: instant ? 'auto' : 'smooth' });
  target.classList.remove('is-target');
  // Re-trigger the arrival highlight even for the same target twice in a row.
  target.setAttribute('id', target.id);
  history.replaceState(null, '', ' ');
  outline.highlight(target.id);
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ *
 * Tabs & workspace
 * ------------------------------------------------------------------ */

async function activateTab(path) {
  if (path === tabs.activePath) return;
  if (tabs.activePath) tabs.saveScroll(tabs.activePath, el.scroller.scrollTop);

  const record = tabs.get(path);
  if (!record) return;
  tabs.setActive(path);
  tree.setActive(path);

  try {
    const doc = await api.readFile(path);
    tabs.markMissing(path, false);
    state.stale.delete(path);
    await renderDocument(doc, { scrollTop: record.scrollTop });
  } catch (err) {
    tabs.markMissing(path, true);
    renderFailure({ path }, err);
  }
  syncWorkspace();
}

function closeTab(path) {
  const next = tabs.remove(path);
  state.stale.delete(path);
  if (next) {
    activateTab(next);
  } else if (tabs.count === 0) {
    showWelcome();
  }
  syncWorkspace();
}

function showWelcome() {
  el.doc.replaceChildren();
  outline.clear();
  el.crumbs.replaceChildren();
  el.welcome.hidden = false;
  document.title = 'DareDown';
  updateProgress();
  find.close();
}

/** Push the current file/folder set to the watcher and persist the session. */
function syncWorkspace() {
  tree.setOpenPaths(tabs.paths);
  tree.setActive(tabs.activePath);
  api.watch({ files: tabs.paths, folder: state.folder });
  api.setConfig({
    lastFolder: state.folder,
    lastFiles: tabs.paths,
    activeFile: tabs.activePath,
  });
}

/**
 * @param {string} folderPath
 * @param {{restoreFiles?: string[]|null, revealSidebar?: boolean}} options
 *        revealSidebar force-shows the sidebar, which is what someone who just
 *        chose "Open Folder" wants — but not on session restore, where it would
 *        override a sidebar the reader deliberately collapsed before quitting.
 */
async function openFolder(folderPath, { restoreFiles = null, revealSidebar = true } = {}) {
  try {
    const data = await api.readTree(folderPath);
    state.folder = data.root;
    tree.setData(data);
    if (revealSidebar && !state.prefs.sidebarVisible) await updatePrefs({ sidebarVisible: true });
  } catch (err) {
    toast(`Could not open folder: ${cleanMessage(err)}`, { error: true });
    return;
  }

  if (restoreFiles?.length) {
    for (const [index, file] of restoreFiles.entries()) {
      await openPath(file, { activate: index === restoreFiles.length - 1, silent: true });
    }
  }
  syncWorkspace();
}

function closeFolder() {
  state.folder = null;
  tree.setData(null);
  syncWorkspace();
}

async function refreshTree() {
  if (!state.folder) return;
  try {
    const data = await api.readTree(state.folder);
    tree.setData(data);
    tree.setOpenPaths(tabs.paths);
    tree.setActive(tabs.activePath);
  } catch {
    // The folder disappeared from under us; leave the last known tree in place.
  }
}

/* ------------------------------------------------------------------ *
 * Click handling inside the document
 * ------------------------------------------------------------------ */

el.doc.addEventListener('click', async (event) => {
  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) {
    event.preventDefault();
    const code = copyButton.closest('.code-block')?.querySelector('code');
    if (code) {
      try {
        await navigator.clipboard.writeText(code.textContent);
        copyButton.textContent = 'Copied';
        copyButton.classList.add('is-done');
        setTimeout(() => {
          copyButton.textContent = 'Copy';
          copyButton.classList.remove('is-done');
        }, 1400);
      } catch {
        toast('Could not copy to clipboard', { error: true });
      }
    }
    return;
  }

  const link = event.target.closest('a[href]');
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href') || '';
  const kind = link.dataset.link;

  if (kind === 'anchor') {
    jumpToAnchor(href);
    return;
  }
  if (kind === 'external') {
    const opened = await api.openExternal(href);
    if (!opened) toast('That link points somewhere this app will not follow', { error: true });
    return;
  }

  // Internal: resolve against the current document, allowing extension-less
  // and directory-index links the way documentation sites do.
  const current = tabs.activePath;
  if (!current) return;
  const [target, fragment] = splitHash(href);

  if (!target) {
    jumpToAnchor(fragment);
    return;
  }

  const resolved = await api.resolveLink(current, target);
  if (!resolved) {
    link.dataset.link = 'missing';
    toast(`No file at ${target}`, { error: true });
    return;
  }
  // A relative link to a non-Markdown file is a job for the OS.
  if (!/\.(md|markdown|mdown|mkd|mdx|qmd)$/i.test(resolved)) {
    await api.revealInFolder(resolved);
    return;
  }
  await openPath(resolved, { activate: true, hash: fragment });
});

function splitHash(href) {
  const index = href.indexOf('#');
  if (index === -1) return [href, ''];
  return [href.slice(0, index), href.slice(index + 1)];
}

/* ------------------------------------------------------------------ *
 * Live reload
 * ------------------------------------------------------------------ */

api.onFileChanged(async (changedPath) => {
  if (!tabs.has(changedPath)) return;

  if (changedPath !== tabs.activePath) {
    // Re-read lazily: a background tab reloads when the reader returns to it.
    state.stale.add(changedPath);
    return;
  }

  const scrollTop = currentScrollTarget();
  try {
    const doc = await api.readFile(changedPath);
    tabs.markMissing(changedPath, false);
    await renderDocument(doc, { scrollTop, preserveDiagramZoom: true });
  } catch (err) {
    toast(`Reload failed: ${cleanMessage(err)}`, { error: true });
  }
});

api.onFileRemoved((removedPath) => {
  if (!tabs.has(removedPath)) return;
  tabs.markMissing(removedPath, true);
  if (removedPath === tabs.activePath) {
    toast(`${baseName(removedPath)} was deleted or moved`);
  }
});

let treeRefreshTimer = null;
api.onTreeChanged(() => {
  if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
  treeRefreshTimer = setTimeout(refreshTree, 250);
});

api.onNativeThemeChanged(() => applyTheme());
darkQuery.addEventListener('change', () => applyTheme());

api.onOpenPaths(async (paths) => {
  for (const [index, candidate] of paths.entries()) {
    const info = await api.pathInfo(candidate);
    if (info?.isDirectory) await openFolder(candidate);
    else if (info?.isFile) await openPath(candidate, { activate: index === paths.length - 1 });
  }
});

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

const commands = {
  'file:open': async () => {
    const picked = await api.openFileDialog();
    for (const [index, file] of picked.entries()) {
      await openPath(file, { activate: index === picked.length - 1 });
    }
  },
  'folder:open': async () => {
    const folder = await api.openFolderDialog();
    if (folder) await openFolder(folder);
  },
  'folder:close': () => closeFolder(),
  'doc:reload': async () => {
    const path = tabs.activePath;
    if (!path) return;
    const scrollTop = currentScrollTarget();
    try {
      const doc = await api.readFile(path);
      await renderDocument(doc, { scrollTop, preserveDiagramZoom: true });
      toast('Reloaded');
    } catch (err) {
      toast(`Reload failed: ${cleanMessage(err)}`, { error: true });
    }
  },
  'doc:reveal': () => {
    if (tabs.activePath) api.revealInFolder(tabs.activePath);
  },
  'tab:close': () => {
    if (tabs.activePath) closeTab(tabs.activePath);
  },
  'tab:next': () => {
    const next = tabs.neighbour(1);
    if (next) activateTab(next);
  },
  'tab:prev': () => {
    const previous = tabs.neighbour(-1);
    if (previous) activateTab(previous);
  },
  'sidebar:toggle': () => updatePrefs({ sidebarVisible: !state.prefs.sidebarVisible }),
  'sidebar:files': () => showSidebarPane('files'),
  'sidebar:outline': () => showSidebarPane('outline'),
  'sidebar:switch': () =>
    showSidebarPane(state.prefs.sidebarPane === 'outline' ? 'files' : 'outline'),
  'theme:cycle': () => toggleTheme(),
  // Handed to the OS browser rather than fetched: the app itself still makes no
  // network requests, so the offline guarantee is untouched.
  'sponsor:open': async () => {
    const opened = await api.openExternal(SPONSOR_URL);
    if (!opened) toast('Could not open your browser', { error: true });
  },
  'font:bigger': () => updatePrefs({ fontSize: clampPref(state.prefs.fontSize + 1, 13, 24) }),
  'font:smaller': () => updatePrefs({ fontSize: clampPref(state.prefs.fontSize - 1, 13, 24) }),
  'font:reset': () => updatePrefs({ fontSize: 17 }),
  'width:full': () => updatePrefs({ fullWidth: !state.prefs.fullWidth }),
  // Nudging the measure implies you want a measure, so it leaves full width.
  'width:wider': () =>
    updatePrefs({ fullWidth: false, readingWidth: clampPref(state.prefs.readingWidth + 40, 560, 1100) }),
  'width:narrower': () =>
    updatePrefs({ fullWidth: false, readingWidth: clampPref(state.prefs.readingWidth - 40, 560, 1100) }),
  'doc:top': () => el.scroller.scrollTo({ top: 0, behavior: 'smooth' }),
  'doc:bottom': () => el.scroller.scrollTo({ top: el.scroller.scrollHeight, behavior: 'smooth' }),
  'find:open': () => find.open(),
  'find:next': () => find.step(1),
  'find:prev': () => find.step(-1),
  'prefs:toggle': () => togglePreferences(),
  'quickopen:toggle': () => toggleQuickOpen(),
  'help:shortcuts': () => toggleSheet(() => openShortcuts({ isMac: state.isMac, onClose: clearSheet })),
};

function clampPref(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function run(command) {
  commands[command]?.();
}

api.onMenuCommand(({ command }) => run(command));

/* --- sheets ----------------------------------------------------------- */

function clearSheet() {
  state.openSheet = null;
}

function toggleSheet(factory) {
  if (state.openSheet) {
    state.openSheet.close();
    return;
  }
  state.openSheet = factory();
}

function togglePreferences() {
  toggleSheet(() =>
    openPreferences({
      prefs: state.prefs,
      configPath: state.configPath,
      onChange: (patch) => updatePrefs(patch),
      onClose: clearSheet,
    })
  );
}

function toggleQuickOpen() {
  const files = tree.allFiles();
  if (files.length === 0 && !state.folder) {
    toast('Open a folder to search files');
    return;
  }
  toggleSheet(() =>
    openQuickOpen({
      files,
      rootPath: state.folder || '',
      onPick: (path) => openPath(path, { activate: true }),
      onClose: clearSheet,
    })
  );
}

/* ------------------------------------------------------------------ *
 * Chrome interactions
 * ------------------------------------------------------------------ */

el.btnSidebar.addEventListener('click', () => run('sidebar:toggle'));
el.btnFullWidth.addEventListener('click', () => run('width:full'));
el.btnTheme.addEventListener('click', () => run('theme:cycle'));

el.sidebarTabs.addEventListener('click', (event) => {
  const pane = event.target.closest('.sidebar-tab')?.dataset.pane;
  if (pane) showSidebarPane(pane);
});
el.btnPrefs.addEventListener('click', () => run('prefs:toggle'));
el.btnOpenFolder.addEventListener('click', () => run('folder:open'));
el.btnSponsor.addEventListener('click', () => run('sponsor:open'));
el.welcomeFile.addEventListener('click', () => run('file:open'));
el.welcomeFolder.addEventListener('click', () => run('folder:open'));

/* --- sidebar resizing -------------------------------------------------- */

el.sidebarGrip.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  el.sidebarGrip.setPointerCapture(event.pointerId);
  el.sidebarGrip.classList.add('is-dragging');
  const startX = event.clientX;
  const startWidth = el.sidebar.getBoundingClientRect().width;

  const onMove = (moveEvent) => {
    const width = clampPref(startWidth + (moveEvent.clientX - startX), 180, 480);
    document.documentElement.style.setProperty('--sidebar-width', `${Math.round(width)}px`);
  };
  const onUp = () => {
    el.sidebarGrip.classList.remove('is-dragging');
    el.sidebarGrip.removeEventListener('pointermove', onMove);
    el.sidebarGrip.removeEventListener('pointerup', onUp);
    const width = parseInt(getComputedStyle(el.sidebar).width, 10);
    updatePrefs({ sidebarWidth: clampPref(width, 180, 480) });
    refitMermaidBlocks(el.doc);
  };
  el.sidebarGrip.addEventListener('pointermove', onMove);
  el.sidebarGrip.addEventListener('pointerup', onUp);
});

/* --- scroll bookkeeping ----------------------------------------------- */

function updateProgress() {
  const max = el.scroller.scrollHeight - el.scroller.clientHeight;
  const ratio = max > 8 ? el.scroller.scrollTop / max : 0;
  el.progress.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
}

let scrollSaveTimer = null;
el.scroller.addEventListener(
  'scroll',
  () => {
    updateProgress();
    if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(() => {
      if (tabs.activePath) tabs.saveScroll(tabs.activePath, el.scroller.scrollTop);
    }, 220);
  },
  { passive: true }
);

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    refitMermaidBlocks(el.doc);
    updateProgress();
  }, 150);
});

/* --- keyboard --------------------------------------------------------- */

document.addEventListener('keydown', (event) => {
  // The diagram modal and the sheets own the keyboard while they are open.
  if (isMermaidModalOpen()) return;

  const mod = state.isMac ? event.metaKey : event.ctrlKey;

  if (event.key === 'Escape') {
    if (state.openSheet) return; // the sheet's own handler closes it
    if (find.isOpen) {
      find.close();
      return;
    }
  }

  // Ctrl+Tab cycling is not expressible as a menu accelerator on macOS.
  if (!state.isMac && event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    run(event.shiftKey ? 'tab:prev' : 'tab:next');
    return;
  }

  if (mod && event.key === '/') {
    event.preventDefault();
    run('help:shortcuts');
    return;
  }

  // Number keys jump straight to a tab.
  if (mod && !event.shiftKey && /^[1-9]$/.test(event.key)) {
    const paths = tabs.paths;
    const index = event.key === '9' ? paths.length - 1 : Number(event.key) - 1;
    if (paths[index]) {
      event.preventDefault();
      activateTab(paths[index]);
    }
    return;
  }

  // Space / Shift+Space page through the document, as in a PDF reader.
  if (event.key === ' ' && !mod && !isTypingTarget(event.target)) {
    event.preventDefault();
    const amount = el.scroller.clientHeight * 0.88;
    el.scroller.scrollBy({ top: event.shiftKey ? -amount : amount, behavior: 'smooth' });
  }
});

function isTypingTarget(target) {
  return target instanceof HTMLElement && /^(input|textarea|select)$/i.test(target.tagName);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  document.body.dataset.platform = api.platform;

  state.prefs = await api.getConfig();
  state.configPath = state.prefs.configPath || '';
  applyReadingPrefs();
  applyTheme({ rerenderDiagrams: false });

  tree.setData(null);

  const { lastFolder, lastFiles, activeFile } = state.prefs;

  if (lastFolder) {
    const info = await api.pathInfo(lastFolder);
    if (info?.isDirectory) await openFolder(lastFolder, { revealSidebar: false });
  }

  // Restore the previous session's tabs, then the file that was in front.
  let restored = 0;
  for (const file of lastFiles || []) {
    const opened = await openPath(file, { activate: false, silent: true });
    if (opened) restored += 1;
  }
  if (restored > 0) {
    const target = activeFile && tabs.has(activeFile) ? activeFile : tabs.paths[0];
    if (target) {
      tabs.setActive(null);
      await activateTab(target);
      tree.revealPath(target);
    }
  } else {
    showWelcome();
  }

  syncWorkspace();

  // Tell main we are listening; queued "open with" paths arrive right after.
  await api.ready();
}

boot().catch((err) => {
  console.error('[daredown] failed to start', err);
  toast(`DareDown could not start: ${cleanMessage(err)}`, { error: true, duration: 8000 });
});
