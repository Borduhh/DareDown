/**
 * Sidebar file tree. Flattens the folder structure the main process sends into
 * a list of rows so expansion, keyboard navigation and re-rendering stay cheap.
 */

export class Tree {
  /**
   * @param {HTMLElement} container
   * @param {HTMLElement} titleElement
   * @param {{ onOpen: (path: string) => void }} handlers
   */
  constructor(container, titleElement, handlers) {
    this.container = container;
    this.titleElement = titleElement;
    this.handlers = handlers;
    this.data = null;
    /** Directories the reader has opened. */
    this.expanded = new Set();
    this.activePath = null;
    this.openPaths = new Set();
    /** @type {Array<{type: string, path: string, name: string, depth: number}>} */
    this.rows = [];

    this.container.addEventListener('click', (event) => {
      const node = event.target.closest('[data-path]');
      if (!node) return;
      if (node.dataset.type === 'dir') this.toggle(node.dataset.path);
      else this.handlers.onOpen(node.dataset.path);
    });

    this.container.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  /** Replace the tree, keeping expansion state for folders that still exist. */
  setData(data) {
    this.data = data;
    if (data) {
      this.titleElement.textContent = data.name || 'Folder';
      this.titleElement.title = data.root || '';
      // First load: open the root's immediate folders so the tree is not a wall
      // of collapsed rows.
      if (this.expanded.size === 0) {
        for (const child of data.children) {
          if (child.type === 'dir') this.expanded.add(child.path);
        }
      }
    } else {
      this.titleElement.textContent = 'No folder';
      this.titleElement.title = '';
      this.expanded.clear();
    }
    this.render();
  }

  setActive(path) {
    this.activePath = path;
    this.render();
  }

  setOpenPaths(paths) {
    this.openPaths = new Set(paths);
    this.render();
  }

  toggle(path) {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    this.render();
  }

  /** Open every ancestor folder of `path` so the file becomes visible. */
  revealPath(path) {
    if (!this.data) return;
    let changed = false;
    const walk = (nodes, ancestors) => {
      for (const node of nodes) {
        if (node.type === 'dir') {
          if (walk(node.children, [...ancestors, node.path])) {
            if (!this.expanded.has(node.path)) {
              this.expanded.add(node.path);
              changed = true;
            }
            return true;
          }
        } else if (node.path === path) {
          for (const ancestor of ancestors) {
            if (!this.expanded.has(ancestor)) {
              this.expanded.add(ancestor);
              changed = true;
            }
          }
          return true;
        }
      }
      return false;
    };
    walk(this.data.children, []);
    if (changed) this.render();
    this.container.querySelector('.node.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  /** Every Markdown file in the tree, for quick open. */
  allFiles() {
    const files = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.type === 'dir') walk(node.children);
        else files.push(node);
      }
    };
    if (this.data) walk(this.data.children);
    return files;
  }

  render() {
    if (!this.data) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = 'Open a folder to browse its Markdown files.';
      this.container.replaceChildren(empty);
      this.rows = [];
      return;
    }

    this.rows = [];
    const fragment = document.createDocumentFragment();

    const walk = (nodes, depth) => {
      for (const node of nodes) {
        const isDir = node.type === 'dir';
        const expanded = isDir && this.expanded.has(node.path);
        this.rows.push({ type: node.type, path: node.path, name: node.name, depth });
        fragment.append(this.rowElement(node, depth, expanded));
        if (isDir && expanded) walk(node.children, depth + 1);
      }
    };
    walk(this.data.children, 0);

    if (this.data.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = 'No Markdown files in this folder.';
      fragment.append(empty);
    }

    if (this.data.truncated) {
      const note = document.createElement('div');
      note.className = 'tree-truncated';
      note.textContent = 'Large folder — some files were not listed.';
      fragment.append(note);
    }

    this.container.replaceChildren(fragment);
  }

  rowElement(node, depth, expanded) {
    const isDir = node.type === 'dir';
    const row = document.createElement('div');
    row.className = `node ${isDir ? 'is-dir' : 'is-file'}`;
    row.style.setProperty('--depth', String(depth));
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    row.setAttribute('role', isDir ? 'treeitem' : 'treeitem');
    row.tabIndex = -1;
    row.title = node.name;

    if (isDir) row.setAttribute('aria-expanded', String(expanded));
    if (node.path === this.activePath) row.classList.add('is-active');

    const chevron = document.createElement('span');
    chevron.className = 'node-chevron';
    chevron.innerHTML =
      '<svg viewBox="0 0 12 12" aria-hidden="true"><polyline points="4,2.5 8,6 4,9.5"/></svg>';

    const label = document.createElement('span');
    label.className = 'node-label';
    // Files read better without the extension; folders keep their name as-is.
    label.textContent = isDir ? node.name : node.name.replace(/\.(md|markdown|mdown|mkd|mdx|qmd)$/i, '');

    row.append(chevron, label);

    if (!isDir && this.openPaths.has(node.path)) {
      const dot = document.createElement('span');
      dot.className = 'node-dot';
      row.append(dot);
    }
    return row;
  }

  /** Arrow-key navigation over the flattened row list. */
  onKeyDown(event) {
    const rows = this.rows;
    if (rows.length === 0) return;

    const focused = document.activeElement?.closest?.('.node');
    let index = focused ? rows.findIndex((row) => row.path === focused.dataset.path) : -1;

    const focusRow = (target) => {
      const clamped = Math.min(rows.length - 1, Math.max(0, target));
      const element = this.container.querySelector(`[data-path="${cssEscape(rows[clamped].path)}"]`);
      element?.focus();
      element?.scrollIntoView({ block: 'nearest' });
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(index === -1 ? 0 : index - 1);
        break;
      case 'ArrowRight':
        if (index >= 0 && rows[index].type === 'dir' && !this.expanded.has(rows[index].path)) {
          event.preventDefault();
          this.toggle(rows[index].path);
          focusRow(index);
        }
        break;
      case 'ArrowLeft':
        if (index >= 0 && rows[index].type === 'dir' && this.expanded.has(rows[index].path)) {
          event.preventDefault();
          this.toggle(rows[index].path);
          focusRow(index);
        }
        break;
      case 'Enter':
      case ' ':
        if (index >= 0) {
          event.preventDefault();
          const row = rows[index];
          if (row.type === 'dir') {
            this.toggle(row.path);
            focusRow(index);
          } else {
            this.handlers.onOpen(row.path);
          }
        }
        break;
      default:
        break;
    }
  }
}

/** CSS.escape is available in Chromium, but guard for safety. */
function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
