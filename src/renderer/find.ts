/**
 * In-document find.
 *
 * Uses the CSS Custom Highlight API, so matches are painted without touching
 * the DOM — no wrapper spans to insert and unpick, and re-rendering the
 * document on live reload cannot leave orphaned markup behind.
 */

const HIT = 'find-hit';
const ACTIVE = 'find-hit-active';

interface FindUi {
  bar: HTMLElement;
  input: HTMLInputElement;
  counter: HTMLElement;
}

/** A text node plus its absolute offset in the document's concatenated text. */
interface TextSegment {
  node: Text;
  start: number;
}

export class Find {
  private readonly host: HTMLElement;
  private readonly docRoot: HTMLElement;
  private readonly scroller: HTMLElement;
  /**
   * The three elements exist together or not at all — open() creates all of
   * them, close() drops all of them. Grouping them makes that invariant part of
   * the type, so one null check narrows all three instead of eleven assertions.
   */
  private ui: FindUi | null = null;
  private ranges: Range[] = [];
  private index = 0;
  /** The CSS Custom Highlight API; without it find is disabled rather than faked. */
  private readonly supported: boolean;

  /**
   * @param {HTMLElement} host element the bar is positioned within
   * @param {HTMLElement} docRoot searched subtree
   * @param {HTMLElement} scroller scroll container
   */
  constructor(host: HTMLElement, docRoot: HTMLElement, scroller: HTMLElement) {
    this.host = host;
    this.docRoot = docRoot;
    this.scroller = scroller;
    /** @type {Range[]} */
    this.supported = typeof Highlight === 'function' && Boolean(window.CSS?.highlights);
  }

  get isOpen() {
    return this.ui !== null;
  }

  open(): void {
    if (this.ui) {
      this.ui.input.select();
      this.ui.input.focus();
      return;
    }

    const bar = document.createElement('div');
    bar.className = 'findbar';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Find in document';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Find in document');

    const counter = document.createElement('span');
    counter.className = 'find-count';

    const previous = smallButton('↑', 'Previous match');
    const next = smallButton('↓', 'Next match');
    const close = smallButton('×', 'Close find');

    bar.append(input, counter, previous, next, close);
    this.host.append(bar);

    this.ui = { bar, input, counter };

    input.addEventListener('input', () => this.search(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    previous.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    close.addEventListener('click', () => this.close());

    // Seed with the current selection, the way editors do.
    const selected = window.getSelection()?.toString().trim();
    if (selected && selected.length < 80) {
      input.value = selected;
      this.search(selected);
    }
    input.focus();
    input.select();
  }

  close(): void {
    const ui = this.ui;
    if (!ui) return;
    this.clearHighlights();
    ui.bar.remove();
    this.ranges = [];
    this.scroller.focus({ preventScroll: true });
  }

  /** Re-run the current query, e.g. after the document re-rendered. */
  refresh(): void {
    if (this.ui?.input.value) this.search(this.ui.input.value);
  }

  search(query: string): void {
    const ui = this.ui;
    if (!ui) return;
    this.clearHighlights();
    this.ranges = [];
    this.index = 0;

    const needle = query.trim();
    if (!needle) {
      ui.counter.textContent = '';
      ui.counter.classList.remove('is-none');
      return;
    }
    if (!this.supported) {
      ui.counter.textContent = 'n/a';
      return;
    }

    this.ranges = findRanges(this.docRoot, needle);
    ui.counter.classList.toggle('is-none', this.ranges.length === 0);

    if (this.ranges.length === 0) {
      ui.counter.textContent = 'no results';
      return;
    }
    // Start from whatever is nearest the reader's current position.
    this.index = this.nearestToViewport();
    this.paint();
    this.revealCurrent();
  }

  step(offset: number): void {
    if (this.ranges.length === 0) return;
    this.index = (this.index + offset + this.ranges.length) % this.ranges.length;
    this.paint();
    this.revealCurrent();
  }

  nearestToViewport(): number {
    const top = this.scroller.scrollTop;
    let best = 0;
    let bestDistance = Infinity;
    for (const [index, range] of this.ranges.entries()) {
      const rect = range.getBoundingClientRect();
      const offset = rect.top + this.scroller.scrollTop - this.scroller.getBoundingClientRect().top;
      const distance = Math.abs(offset - top);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }

  paint(): void {
    const ui = this.ui;
    if (!ui) return;
    const others = this.ranges.filter((_, index) => index !== this.index);
    CSS.highlights.set(HIT, new Highlight(...others));
    const current = this.ranges[this.index];
    CSS.highlights.set(ACTIVE, new Highlight(...(current ? [current] : [])));
    ui.counter.textContent = `${this.index + 1} of ${this.ranges.length}`;
  }

  revealCurrent() {
    const range = this.ranges[this.index];
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const view = this.scroller.getBoundingClientRect();
    // Only scroll when the match is outside the comfortable middle band.
    if (rect.top < view.top + 60 || rect.bottom > view.bottom - 60) {
      const target = this.scroller.scrollTop + (rect.top - view.top) - view.height * 0.32;
      this.scroller.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
    }
  }

  clearHighlights(): void {
    if (!this.supported) return;
    CSS.highlights.delete(HIT);
    CSS.highlights.delete(ACTIVE);
  }
}

function smallButton(glyph: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mmd-btn';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.textContent = glyph;
  return button;
}

/**
 * Collect ranges for every case-insensitive occurrence of `needle`.
 * Matches are found against the concatenated text of the subtree so a hit can
 * span element boundaries (e.g. a word interrupted by `<em>`).
 */
function findRanges(root: HTMLElement, needle: string): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // Diagram source is hidden, and diagram internals are not prose.
      if (parent.closest('.mermaid-source, .mermaid-controls, .mermaid-foot, svg')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments: TextSegment[] = [];
  let haystack = '';
  // SHOW_TEXT guarantees Text nodes; the DOM types still widen to Node.
  let node = walker.nextNode() as Text | null;
  while (node) {
    segments.push({ node, start: haystack.length });
    haystack += node.nodeValue ?? '';
    node = walker.nextNode() as Text | null;
  }

  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const ranges = [];
  let cursor = 0;
  const LIMIT = 3000;

  while (ranges.length < LIMIT) {
    const found = lowerHay.indexOf(lowerNeedle, cursor);
    if (found === -1) break;
    const range = rangeFor(segments, found, found + needle.length);
    if (range) ranges.push(range);
    cursor = found + Math.max(1, needle.length);
  }
  return ranges;
}

/** Map absolute offsets in the concatenated text back to a DOM Range. */
function rangeFor(segments: TextSegment[], start: number, end: number): Range | null {
  const startSegment = segmentAt(segments, start);
  const endSegment = segmentAt(segments, end - 1);
  if (!startSegment || !endSegment) return null;

  const range = document.createRange();
  try {
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);
  } catch {
    return null;
  }
  return range;
}

/** Binary search for the text node containing an absolute offset. */
function segmentAt(segments: TextSegment[], offset: number): TextSegment | null {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = segments[mid];
    if (!segment) break;
    const segmentEnd = segment.start + (segment.node.nodeValue?.length ?? 0);
    if (offset < segment.start) high = mid - 1;
    else if (offset >= segmentEnd) low = mid + 1;
    else return segment;
  }
  return null;
}
