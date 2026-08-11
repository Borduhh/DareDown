/**
 * Tab model and strip. Each tab owns a document path plus the reading state we
 * want back when the reader returns to it — scroll offset above all.
 */

export interface Tab {
  path: string;
  name: string;
  scrollTop: number;
  missing: boolean;
}

export interface TabsHandlers {
  onActivate(path: string): void;
  onClose(path: string): void;
}

export class Tabs {
  private readonly strip: HTMLElement;
  private readonly handlers: TabsHandlers;
  private readonly items = new Map<string, Tab>();
  activePath: string | null = null;

  /**
   * @param {HTMLElement} strip
   * @param {{ onActivate: (path: string) => void, onClose: (path: string) => void }} handlers
   */
  constructor(strip: HTMLElement, handlers: TabsHandlers) {
    this.strip = strip;
    this.handlers = handlers;

    this.strip.addEventListener('click', (event: MouseEvent) => {
      const target = event.target as Element | null;
      const close = target?.closest('[data-close]');
      if (close) {
        event.stopPropagation();
        const owner = close.closest<HTMLElement>('[data-path]');
        if (owner?.dataset.path) this.handlers.onClose(owner.dataset.path);
        return;
      }
      const tab = target?.closest<HTMLElement>('[data-path]');
      if (tab?.dataset.path) this.handlers.onActivate(tab.dataset.path);
    });

    // Middle-click closes, as it does in every other tabbed app.
    this.strip.addEventListener('auxclick', (event: MouseEvent) => {
      if (event.button !== 1) return;
      const tab = (event.target as Element | null)?.closest<HTMLElement>('[data-path]');
      if (tab?.dataset.path) {
        event.preventDefault();
        this.handlers.onClose(tab.dataset.path);
      }
    });

    // Let a horizontal-less mouse wheel move through the strip.
    this.strip.addEventListener(
      'wheel',
      (event: WheelEvent) => {
        if (event.deltaX !== 0 || this.strip.scrollWidth <= this.strip.clientWidth) return;
        event.preventDefault();
        this.strip.scrollLeft += event.deltaY;
      },
      { passive: false }
    );
  }

  get paths(): string[] {
    return [...this.items.keys()];
  }

  get count(): number {
    return this.items.size;
  }

  has(path: string): boolean {
    return this.items.has(path);
  }

  get(path: string): Tab | undefined {
    return this.items.get(path);
  }

  get active(): Tab | null {
    return (this.activePath ? this.items.get(this.activePath) : null) ?? null;
  }

  /** Add a tab if absent; returns the record either way. */
  add(path: string, name: string): Tab {
    const existing = this.items.get(path);
    if (existing) return existing;
    const tab: Tab = { path, name, scrollTop: 0, missing: false };
    this.items.set(path, tab);
    this.render();
    return tab;
  }

  setActive(path: string | null): void {
    this.activePath = path !== null && this.items.has(path) ? path : null;
    this.render();
    this.scrollActiveIntoView();
  }

  /** Remove a tab and return the path that should be shown next, if any. */
  remove(path: string): string | null {
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

  closeAll(): void {
    this.items.clear();
    this.activePath = null;
    this.render();
  }

  /** Step through tabs, wrapping at both ends. */
  neighbour(offset: number): string | null {
    const order = this.paths;
    if (order.length === 0) return null;
    // With nothing active this stays -1, so a +1 step lands on the first tab.
    const index = this.activePath === null ? -1 : order.indexOf(this.activePath);
    return order[(index + offset + order.length) % order.length] ?? null;
  }

  markMissing(path: string, missing: boolean): void {
    const item = this.items.get(path);
    if (!item || item.missing === missing) return;
    item.missing = missing;
    this.render();
  }

  saveScroll(path: string, scrollTop: number): void {
    const item = this.items.get(path);
    if (item) item.scrollTop = scrollTop;
  }

  /** Rename a tab when the file on disk moved. */
  rename(oldPath: string, newPath: string, name: string): void {
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

  render(): void {
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
