/**
 * The heading outline, shown as the second view of the sidebar.
 *
 * "Which heading am I under?" is answered by measuring heading offsets and
 * binary-searching them on scroll, rather than with an IntersectionObserver.
 * An observer only reports when a heading *crosses* its band, so jumping
 * straight to an offset — a link, a restored scroll position, ⌘↓ — can land with
 * no heading in the band and leave nothing highlighted at all. Measuring gives
 * an answer for every position.
 */

/** How far below the top of the viewport the "you are here" line sits. */
const CURRENT_LINE_OFFSET = 24;

export class Outline {
  /**
   * @param {HTMLElement} listElement
   * @param {HTMLElement} scroller
   * @param {{ onJump: (id: string) => void }} handlers
   */
  constructor(listElement, scroller, handlers) {
    this.list = listElement;
    this.scroller = scroller;
    this.handlers = handlers;

    /** @type {Map<string, HTMLElement>} */
    this.buttons = new Map();
    /** @type {Array<{id: string, el: HTMLElement}>} */
    this.targets = [];
    /** @type {Array<{id: string, top: number}>} */
    this.offsets = [];
    /** Offsets need re-measuring (content grew, window resized, prefs changed). */
    this.dirty = true;
    this.currentId = null;
    /** Whether this view is the one on screen. */
    this.visible = false;

    this.list.addEventListener('click', (event) => {
      const item = event.target.closest('[data-id]');
      if (item) this.handlers.onJump(item.dataset.id);
    });

    this.scroller.addEventListener('scroll', () => this.update(), { passive: true });

    // Diagrams rendering, a reading-width change or a window resize all move
    // the headings, so the cached offsets stop being true.
    this.resizeObserver = new ResizeObserver(() => {
      this.dirty = true;
      this.update();
    });
  }

  /**
   * @param {Array<{id: string, level: number, text: string}>} headings
   * @param {HTMLElement} docRoot
   */
  setHeadings(headings, docRoot) {
    this.resizeObserver.disconnect();
    this.buttons.clear();
    this.targets = [];
    this.offsets = [];
    this.currentId = null;
    this.dirty = true;

    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = 'This document has no headings.';
      this.list.replaceChildren(empty);
      return;
    }

    // Normalize so a document starting at h2 is not indented for no reason.
    const minLevel = Math.min(...headings.map((h) => h.level));
    const fragment = document.createDocumentFragment();

    for (const heading of headings) {
      const target = docRoot.querySelector(`#${cssEscape(heading.id)}`);
      if (!target) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item';
      button.dataset.id = heading.id;
      button.dataset.level = String(Math.min(6, heading.level - minLevel + 1));
      button.textContent = heading.text || '—';
      button.title = heading.text;
      fragment.append(button);

      this.buttons.set(heading.id, button);
      this.targets.push({ id: heading.id, el: target });
    }
    this.list.replaceChildren(fragment);

    this.resizeObserver.observe(docRoot);
    this.update();
  }

  /** Cache each heading's offset within the scroller's content. */
  measure() {
    const base = this.scroller.getBoundingClientRect().top;
    const scrollTop = this.scroller.scrollTop;
    this.offsets = this.targets.map(({ id, el }) => ({
      id,
      top: scrollTop + el.getBoundingClientRect().top - base,
    }));
    this.dirty = false;
  }

  /** Highlight the last heading at or above the current-position line. */
  update() {
    if (this.targets.length === 0) return;
    if (this.dirty) this.measure();

    // The document ends with a deep bottom margin, so at maximum scroll the
    // final headings still sit above the current-position line and could never
    // become current. At the bottom, take the last heading that is on screen.
    const atBottom =
      this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 4;
    const line = atBottom
      ? this.scroller.scrollTop + this.scroller.clientHeight
      : this.scroller.scrollTop + CURRENT_LINE_OFFSET;

    // Binary search for the last heading whose top is at or above the line.
    let low = 0;
    let high = this.offsets.length - 1;
    let found = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.offsets[mid].top <= line) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    this.highlight(this.offsets[found].id);
  }

  /** Called when the sidebar switches views. */
  setVisible(visible) {
    const becameVisible = visible && !this.visible;
    this.visible = Boolean(visible);
    if (!becameVisible) return;
    // Offsets may have gone stale while this view was hidden.
    this.dirty = true;
    this.update();
    this.scrollCurrentIntoView();
  }

  highlight(id) {
    if (id === this.currentId) return;
    if (this.currentId) this.buttons.get(this.currentId)?.classList.remove('is-current');
    this.currentId = id;
    this.buttons.get(id)?.classList.add('is-current');
    if (this.visible) this.scrollCurrentIntoView();
  }

  scrollCurrentIntoView() {
    if (!this.currentId) return;
    this.buttons.get(this.currentId)?.scrollIntoView({ block: 'nearest' });
  }

  clear() {
    this.resizeObserver.disconnect();
    this.buttons.clear();
    this.targets = [];
    this.offsets = [];
    this.currentId = null;
    this.dirty = true;
    this.list.replaceChildren();
  }
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
