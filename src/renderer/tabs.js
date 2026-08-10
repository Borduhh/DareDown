/**
 * Tab model and strip. Each tab owns a document path plus the reading state we
 * want back when the reader returns to it — scroll offset above all.
 */

export class Tabs {
  /**
   * @param {HTMLElement} strip
   * @param {{ onActivate: (path: string) => void, onClose: (path: string) => void }} handlers
   */
  constructor(strip, handlers) {
    this.strip = strip;
    this.handlers = handlers;
    /** @type {Map<string, {path: string, name: string, scrollTop: number, missing: boolean}>} */
    this.items = new Map();
    this.activePath = null;

    this.strip.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close]');
      if (close) {
        event.stopPropagation();
        this.handlers.onClose(close.closest('[data-path]').dataset.path);
        return;
      }
      const tab = event.target.closest('[data-path]');
      if (tab) this.handlers.onActivate(tab.dataset.path);
    });

    // Middle-click closes, as it does in every other tabbed app.
    this.strip.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const tab = event.target.closest('[data-path]');
      if (tab) {
        event.preventDefault();
        this.handlers.onClose(tab.dataset.path);
      }
    });

    // Let a horizontal-less mouse wheel move through the strip.
    this.strip.addEventListener(
      'wheel',
      (event) => {
        if (event.deltaX !== 0 || this.strip.scrollWidth <= this.strip.clientWidth) return;
        event.preventDefault();
        this.strip.scrollLeft += event.deltaY;
      },
      { passive: false }
    );
  }

  get paths() {
    return [...this.items.keys()];
  }

  get count() {
    return this.items.size;
  }

  has(path) {
    return this.items.has(path);
  }

  get(path) {
    return this.items.get(path);
  }

  get active() {
    return this.activePath ? this.items.get(this.activePath) : null;
  }

  /** Add a tab if absent; returns the record either way. */
  add(path, name) {
    if (!this.items.has(path)) {
      this.items.set(path, { path, name, scrollTop: 0, missing: false });
      this.render();
    }
    return this.items.get(path);
  }

  setActive(path) {
    this.activePath = this.items.has(path) ? path : null;
    this.render();
    this.scrollActiveIntoView();
  }

  /** Remove a tab and return the path that should be shown next, if any. */
  remove(path) {
    if (!this.items.has(path)) return null;
    const order = this.paths;
    const index = order.indexOf(path);
    this.items.delete(path);

    let next = null;
    if (this.activePath === path) {
      const remaining = this.paths;
      next = remaining[Math.min(index, remaining.length - 1)] ?? null;
      this.activePath = next;
    }
    this.render();
    return next;
  }

  closeAll() {
    this.items.clear();
    this.activePath = null;
    this.render();
  }

  /** Step through tabs, wrapping at both ends. */
  neighbour(offset) {
    const order = this.paths;
    if (order.length === 0) return null;
    const index = order.indexOf(this.activePath);
    return order[(index + offset + order.length) % order.length];
  }

  markMissing(path, missing) {
    const item = this.items.get(path);
    if (!item || item.missing === missing) return;
    item.missing = missing;
    this.render();
  }

  saveScroll(path, scrollTop) {
    const item = this.items.get(path);
    if (item) item.scrollTop = scrollTop;
  }

  /** Rename a tab when the file on disk moved. */
  rename(oldPath, newPath, name) {
    if (!this.items.has(oldPath)) return;
    const entries = [...this.items.entries()];
    this.items.clear();
    for (const [key, value] of entries) {
      if (key === oldPath) {
        this.items.set(newPath, { ...value, path: newPath, name });
      } else {
        this.items.set(key, value);
      }
    }
    if (this.activePath === oldPath) this.activePath = newPath;
    this.render();
  }

  render() {
    const fragment = document.createDocumentFragment();

    for (const item of this.items.values()) {
      const tab = document.createElement('div');
      tab.className = 'tab';
      tab.dataset.path = item.path;
      tab.setAttribute('role', 'tab');
      tab.title = item.path;
      if (item.path === this.activePath) {
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
      }
      if (item.missing) tab.classList.add('is-missing');

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = item.name;

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.dataset.close = '';
      close.setAttribute('aria-label', `Close ${item.name}`);
      close.textContent = '×';

      tab.append(label, close);
      fragment.append(tab);
    }

    this.strip.replaceChildren(fragment);
    // A single tab is noise — the breadcrumb in the title bar already names it.
    this.strip.hidden = this.items.size < 2;
  }

  scrollActiveIntoView() {
    const element = this.strip.querySelector('.tab.is-active');
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
