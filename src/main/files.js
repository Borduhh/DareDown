'use strict';
/**
 * Filesystem access for the main process: reading Markdown documents and
 * walking a folder into a tree the sidebar can render. All reads are local;
 * nothing here touches the network.
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.qmd']);

/** Directories that are never worth showing in a reading app. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.svelte-kit',
  'dist', 'build', 'out', 'target', 'vendor', 'coverage', '.cache',
  '.venv', 'venv', '__pycache__', '.idea', '.vscode', '.DS_Store',
  '.terraform', '.gradle', 'Pods', '.turbo', '.parcel-cache',
]);

const MAX_DEPTH = 12;
const MAX_ENTRIES = 8000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function isMarkdown(filePath) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Read a Markdown file, returning its text plus the stat info we watch on. */
async function readMarkdown(filePath) {
  const abs = path.resolve(filePath);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error(`Not a file: ${abs}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large to display (${(stat.size / 1048576).toFixed(1)} MB).`);
  }
  let content = await fs.readFile(abs, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // strip BOM
  return {
    path: abs,
    name: path.basename(abs),
    dir: path.dirname(abs),
    content,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

/**
 * Recursively walk `root`, returning a nested tree of folders and Markdown
 * files. Folders with no Markdown anywhere beneath them are pruned so the
 * sidebar stays a document outline rather than a file browser.
 */
async function readTree(root) {
  const absRoot = path.resolve(root);
  const budget = { entries: 0, truncated: false };
  const tree = await walk(absRoot, 0, budget);
  return {
    root: absRoot,
    name: path.basename(absRoot) || absRoot,
    children: tree ? tree.children : [],
    truncated: budget.truncated,
  };
}

async function walk(dir, depth, budget) {
  if (depth > MAX_DEPTH) {
    budget.truncated = true;
    return null;
  }
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null; // unreadable directory — skip quietly
  }

  const folders = [];
  const files = [];
  for (const entry of entries) {
    if (budget.entries >= MAX_ENTRIES) {
      budget.truncated = true;
      break;
    }
    const name = entry.name;
    if (name.startsWith('.') || IGNORED_DIRS.has(name)) continue;
    const abs = path.join(dir, name);

    if (entry.isDirectory()) {
      const child = await walk(abs, depth + 1, budget);
      // Prune branches that contain no Markdown at all.
      if (child && child.children.length > 0) folders.push(child);
    } else if (entry.isFile() && isMarkdown(name)) {
      budget.entries += 1;
      files.push({ type: 'file', name, path: abs });
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  folders.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => collator.compare(a.name, b.name));

  return { type: 'dir', name: path.basename(dir), path: dir, children: [...folders, ...files] };
}

/**
 * Resolve a relative link found in a document against its own directory,
 * appending a default extension when the link omits one (a common convention
 * in wikis and docs sites). Returns null when nothing on disk matches.
 */
async function resolveLink(fromFile, href) {
  const baseDir = path.dirname(path.resolve(fromFile));
  const decoded = safeDecode(href.replace(/[?#].*$/, ''));
  if (!decoded) return null;

  const target = path.resolve(baseDir, decoded);
  const candidates = [target];
  if (!path.extname(target)) {
    for (const ext of ['.md', '.markdown', '.mdx']) candidates.push(target + ext);
    candidates.push(path.join(target, 'index.md'), path.join(target, 'README.md'));
  }

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

module.exports = { readMarkdown, readTree, resolveLink, isMarkdown, MARKDOWN_EXTENSIONS };
