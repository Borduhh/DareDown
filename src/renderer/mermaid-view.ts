/**
 * Mermaid diagrams — rendering, inline zoom, and the fullscreen pan/zoom modal.
 *
 * Two different zoom mechanisms, on purpose:
 *
 *   inline  — the SVG's own width/height are set in pixels, so the frame gets
 *             real scrollbars and the page reflows around the diagram.
 *   modal   — a CSS transform on a viewport div, because cursor-anchored zoom
 *             and free panning need a continuous coordinate space.
 *
 * The SVG element is *moved* into the modal rather than cloned: mermaid scopes
 * its generated CSS by the SVG's id, so a clone would collide with the original
 * and both copies would fight over the same rules.
 */
import mermaid from 'mermaid';
import { mermaidConfig } from './mermaid-theme.js';

/** A diagram block, with the state we hang off it once rendered. */
interface MermaidBlockElement extends HTMLElement {
  __mermaid?: DiagramState | null;
}

interface Size {
  w: number;
  h: number;
}

interface DiagramState {
  block: MermaidBlockElement;
  frame: HTMLElement;
  canvas: HTMLElement;
  svg: SVGSVGElement;
  natural: Size;
  source: string;
  label: string;
  /** Current inline zoom, relative to the diagram's natural size. */
  scale: number;
  /** The scale at which it just fits the frame; what reset returns to. */
  fitScale: number;
  zoomLabel: HTMLElement;
  buttons: { out: HTMLButtonElement; in: HTMLButtonElement; reset: HTMLButtonElement };
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 1.25;

/** Human labels for the diagram-type footer. */
const DIAGRAM_LABELS: Array<[RegExp, string]> = [
  [/^(graph|flowchart)\b/i, 'Flowchart'],
  [/^sequenceDiagram\b/i, 'Sequence'],
  [/^classDiagram(-v2)?\b/i, 'Class'],
  [/^stateDiagram(-v2)?\b/i, 'State'],
  [/^erDiagram\b/i, 'Entity Relationship'],
  [/^journey\b/i, 'User Journey'],
  [/^gantt\b/i, 'Gantt'],
  [/^pie\b/i, 'Pie'],
  [/^quadrantChart\b/i, 'Quadrant'],
  [/^requirementDiagram\b/i, 'Requirements'],
  [/^gitGraph\b/i, 'Git Graph'],
  [/^(mindmap)\b/i, 'Mindmap'],
  [/^timeline\b/i, 'Timeline'],
  [/^sankey(-beta)?\b/i, 'Sankey'],
  [/^xychart(-beta)?\b/i, 'XY Chart'],
  [/^block(-beta)?\b/i, 'Block'],
  [/^packet(-beta)?\b/i, 'Packet'],
  [/^architecture(-beta)?\b/i, 'Architecture'],
  [/^kanban\b/i, 'Kanban'],
  [/^radar(-beta)?\b/i, 'Radar'],
  [/^treemap(-beta)?\b/i, 'Treemap'],
  [/^C4(Context|Container|Component|Dynamic|Deployment)\b/i, 'C4'],
  [/^zenuml\b/i, 'ZenUML'],
];

function diagramLabel(source: string): string {
  // Skip front-matter, directives and comments to find the type keyword.
  const body = source
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line && !line.startsWith('%%'))
    .join('\n');
  for (const [pattern, label] of DIAGRAM_LABELS) {
    if (pattern.test(body)) return label;
  }
  return 'Diagram';
}

let idCounter = 0;
let currentIsDark = false;
let initialized = false;

/** (Re)configure mermaid for a theme. Diagrams must be re-rendered after. */
export function configureMermaid(isDark: boolean): void {
  currentIsDark = Boolean(isDark);
  mermaid.initialize(mermaidConfig(currentIsDark));
  initialized = true;
}

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

const ICONS = {
  zoomIn: '<circle cx="8.6" cy="8.6" r="5.4"/><line x1="12.6" y1="12.6" x2="17" y2="17"/><line x1="6.3" y1="8.6" x2="10.9" y2="8.6"/><line x1="8.6" y1="6.3" x2="8.6" y2="10.9"/>',
  zoomOut: '<circle cx="8.6" cy="8.6" r="5.4"/><line x1="12.6" y1="12.6" x2="17" y2="17"/><line x1="6.3" y1="8.6" x2="10.9" y2="8.6"/>',
  reset: '<path d="M3.4 8.2a6.8 6.8 0 1 1 1.2 5"/><polyline points="2.6,3.4 3.4,8.4 8.4,7.6"/>',
  expand: '<polyline points="7.4,2.8 2.8,2.8 2.8,7.4"/><polyline points="12.6,2.8 17.2,2.8 17.2,7.4"/><polyline points="17.2,12.6 17.2,17.2 12.6,17.2"/><polyline points="2.8,12.6 2.8,17.2 7.4,17.2"/>',
  close: '<line x1="4.6" y1="4.6" x2="15.4" y2="15.4"/><line x1="15.4" y1="4.6" x2="4.6" y2="15.4"/>',
};

function iconButton(
  icon: string | null,
  title: string,
  action: string,
  { text = '' }: { text?: string } = {}
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = text ? 'mmd-btn text' : 'mmd-btn';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.dataset.action = action;
  if (text) button.textContent = text;
  else button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${icon}</svg>`;
  return button;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function clamp(value: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.min(max, Math.max(min, value));
}

/** Natural (unscaled) diagram size, from the viewBox where available. */
function naturalSize(svg: SVGSVGElement): Size {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 1 && box.height > 1) {
    return { w: box.width, h: box.height };
  }
  const width = parseFloat(svg.getAttribute('width') ?? '');
  const height = parseFloat(svg.getAttribute('height') ?? '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 1) {
    return { w: width, h: height };
  }
  const rect = svg.getBoundingClientRect();
  return { w: rect.width || 640, h: rect.height || 400 };
}

/**
 * Render every pending mermaid block inside `root`.
 *
 * @param {HTMLElement} root
 * @param {{ zoomMemory?: Map<string, number> }} [options]
 *        zoomMemory maps diagram source → inline scale, so a live-reload or a
 *        theme flip does not throw away the zoom the reader had set.
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  { zoomMemory }: { zoomMemory?: Map<string, number> } = {}
): Promise<void> {
  const blocks = [...root.querySelectorAll<MermaidBlockElement>('.mermaid-block[data-state="pending"]')];
  if (blocks.length === 0) return;
  if (!initialized) configureMermaid(currentIsDark);

  for (const block of blocks) {
    // The document may have been replaced while we were awaiting a render.
    if (!block.isConnected) continue;
    const sourceNode = block.querySelector('.mermaid-source');
    const source = (sourceNode?.textContent || '').trim();
    if (!source) {
      block.dataset.state = 'error';
      renderError(block, 'Empty diagram block.', '');
      continue;
    }
    await renderOne(block, source, zoomMemory);
    // Yield so a document full of diagrams paints progressively.
    await yieldToPaint();
  }
}

/**
 * Hand control back to the browser between diagrams.
 *
 * requestAnimationFrame alone is not enough: an occluded or minimized window
 * stops firing frames entirely, which would leave the remaining diagrams stuck
 * on "Rendering…" until the window came back. Racing a timer keeps the queue
 * moving while still aligning with paint when the window is visible.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

async function renderOne(
  block: MermaidBlockElement,
  source: string,
  zoomMemory?: Map<string, number>
): Promise<void> {
  const id = `daredown-mmd-${(idCounter += 1)}`;
  let svgText;

  try {
    // parse() first so a syntax error surfaces as our own message rather than
    // mermaid's injected error graphic.
    await mermaid.parse(source);
    ({ svg: svgText } = await mermaid.render(id, source));
  } catch (err) {
    if (!block.isConnected) return;
    block.dataset.state = 'error';
    renderError(block, cleanErrorMessage(err), source);
    return;
  } finally {
    // mermaid leaves a measurement node behind when a render throws.
    document.getElementById(`d${id}`)?.remove();
  }

  if (!block.isConnected) return;
  mount(block, source, svgText, zoomMemory);
}

function cleanErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : err;
  const message = String(raw || 'Unknown error').trim();
  // Mermaid prefixes parse failures with a long grammar dump; keep the useful part.
  return message.replace(/^Parse error on line/, 'Parse error, line').slice(0, 800);
}

function renderError(block: HTMLElement, message: string, source: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'mermaid-error';

  const title = document.createElement('div');
  title.className = 'mermaid-error-title';
  title.textContent = 'Diagram could not be rendered';

  const msg = document.createElement('p');
  msg.className = 'mermaid-error-msg';
  msg.textContent = message;

  wrap.append(title, msg);

  if (source) {
    const pre = document.createElement('pre');
    pre.textContent = source;
    wrap.append(pre);
  }
  // Keep the source node so a re-render can retry from the same block.
  block.querySelector('.mermaid-frame')?.remove();
  block.querySelector('.mermaid-controls')?.remove();
  block.querySelector('.mermaid-foot')?.remove();
  block.querySelector('.mermaid-error')?.remove();
  block.append(wrap);
}

/** Build the frame, controls and footer around a freshly rendered SVG. */
function mount(
  block: MermaidBlockElement,
  source: string,
  svgText: string,
  zoomMemory?: Map<string, number>
): void {
  const frame = document.createElement('div');
  frame.className = 'mermaid-frame';

  const canvas = document.createElement('div');
  canvas.className = 'mermaid-canvas';
  // svgText comes from mermaid itself (securityLevel: 'strict' has already
  // encoded any HTML from the document), so this is our own trusted markup.
  canvas.innerHTML = svgText;
  frame.append(canvas);

  const svg = canvas.querySelector('svg');
  if (!svg) {
    block.dataset.state = 'error';
    renderError(block, 'Mermaid produced no diagram.', source);
    return;
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.maxWidth = 'none';
  svg.setAttribute('role', 'img');

  const label = diagramLabel(source);

  const controls = document.createElement('div');
  controls.className = 'mermaid-controls';
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'mmd-zoom-label';
  const separator = document.createElement('span');
  separator.className = 'mmd-sep';

  const btnOut = iconButton(ICONS.zoomOut, 'Zoom out', 'out');
  const btnIn = iconButton(ICONS.zoomIn, 'Zoom in', 'in');
  const btnReset = iconButton(ICONS.reset, 'Reset zoom', 'reset');
  const btnFull = iconButton(ICONS.expand, 'Open fullscreen', 'full');
  controls.append(btnOut, zoomLabel, btnIn, separator, btnReset, btnFull);

  const foot = document.createElement('div');
  foot.className = 'mermaid-foot';
  const kind = document.createElement('span');
  kind.textContent = label;
  const hint = document.createElement('span');
  hint.className = 'mermaid-hint';
  hint.textContent = 'Click to open fullscreen';
  foot.append(kind, hint);

  block.replaceChildren();
  // The source stays in the DOM so re-renders and the modal can read it back.
  const sourceNode = document.createElement('pre');
  sourceNode.className = 'mermaid-source';
  sourceNode.textContent = source;
  block.append(sourceNode, frame, controls, foot);
  block.dataset.state = 'ok';

  const natural = naturalSize(svg);
  svg.setAttribute('aria-label', `${label} diagram`);

  const state: DiagramState = {
    block,
    frame,
    canvas,
    svg,
    natural,
    source,
    label,
    scale: 1,
    fitScale: 1,
    zoomLabel,
    buttons: { out: btnOut, in: btnIn, reset: btnReset },
  };
  block.__mermaid = state;

  state.fitScale = computeFitScale(state);
  const remembered = zoomMemory?.get(source);
  setInlineScale(state, remembered ?? state.fitScale);

  controls.addEventListener('click', (event: MouseEvent) => {
    const action = (event.target as Element | null)?.closest<HTMLElement>('[data-action]')?.dataset
      .action;
    if (!action) return;
    event.stopPropagation();
    if (action === 'in') setInlineScale(state, state.scale * STEP);
    else if (action === 'out') setInlineScale(state, state.scale / STEP);
    else if (action === 'reset') setInlineScale(state, state.fitScale);
    else if (action === 'full') openFullscreen(state);
  });

  // Clicking the diagram itself opens the modal; dragging to select does not.
  svg.addEventListener('click', (event) => {
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
    openFullscreen(state);
  });

  // Ctrl/Cmd + wheel zooms inline without hijacking ordinary page scrolling.
  frame.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setInlineScale(state, state.scale * Math.exp(-normalizeDelta(event) * 0.004));
    },
    { passive: false }
  );
}

/** Scale at which the diagram just fits the frame's content width. */
function computeFitScale(state: DiagramState): number {
  const available = state.frame.clientWidth - 36; // frame padding
  if (available <= 0 || state.natural.w <= 0) return 1;
  return clamp(Math.min(1, available / state.natural.w), MIN_SCALE, 1);
}

function setInlineScale(state: DiagramState, next: number): void {
  const scale = clamp(next);
  state.scale = scale;
  state.svg.style.width = `${Math.round(state.natural.w * scale)}px`;
  state.svg.style.height = `${Math.round(state.natural.h * scale)}px`;
  state.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  state.buttons.in.disabled = scale >= MAX_SCALE - 0.001;
  state.buttons.out.disabled = scale <= MIN_SCALE + 0.001;
  // Left-align once the diagram is wider than its frame so panning by scroll
  // starts from the diagram's own origin.
  state.block.dataset.zoomed = String(state.natural.w * scale > state.frame.clientWidth - 36);
}

/**
 * Recompute fit scales after a layout change (window resize, reading-width
 * change). Diagrams the reader has zoomed manually are left alone.
 */
export function refitMermaidBlocks(root: HTMLElement): void {
  for (const block of root.querySelectorAll<MermaidBlockElement>('.mermaid-block[data-state="ok"]')) {
    const state = block.__mermaid;
    if (!state) continue;
    const wasAtFit = Math.abs(state.scale - state.fitScale) < 0.005;
    state.fitScale = computeFitScale(state);
    if (wasAtFit) setInlineScale(state, state.fitScale);
  }
}

/** Snapshot inline zoom levels keyed by diagram source, for re-render. */
export function captureMermaidZoom(root: HTMLElement): Map<string, number> {
  const memory = new Map();
  for (const block of root.querySelectorAll<MermaidBlockElement>('.mermaid-block[data-state="ok"]')) {
    const state = block.__mermaid;
    // Only remember deliberate zoom; a fitted diagram should re-fit next time.
    if (state && Math.abs(state.scale - state.fitScale) > 0.005) {
      memory.set(state.source, state.scale);
    }
  }
  return memory;
}

/** Reset every block to pending so the next render pass redraws it. */
export function resetMermaidBlocks(root: HTMLElement): void {
  for (const block of root.querySelectorAll<MermaidBlockElement>('.mermaid-block')) {
    const source = block.querySelector('.mermaid-source')?.textContent ?? '';
    block.__mermaid = null;
    block.dataset.state = 'pending';
    delete block.dataset.zoomed;
    const pre = document.createElement('pre');
    pre.className = 'mermaid-source';
    pre.textContent = source;
    block.replaceChildren(pre);
  }
}

/* ------------------------------------------------------------------ *
 * Fullscreen modal
 * ------------------------------------------------------------------ */

/** @type {null | { close: () => void }} */
let activeModal: { close: () => void } | null = null;

export function isMermaidModalOpen(): boolean {
  return activeModal !== null;
}

export function closeMermaidModal(): void {
  activeModal?.close();
}

function openFullscreen(state: DiagramState): void {
  if (activeModal) activeModal.close();

  const previousFocus = document.activeElement;
  const overlay = document.getElementById('overlay-root') || document.body;

  const modal = document.createElement('div');
  modal.className = 'mmd-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `${state.label} diagram, fullscreen`);

  const scrim = document.createElement('div');
  scrim.className = 'mmd-scrim';

  const panel = document.createElement('div');
  panel.className = 'mmd-panel';

  const bar = document.createElement('div');
  bar.className = 'mmd-bar';
  const title = document.createElement('div');
  title.className = 'mmd-bar-title';
  title.textContent = state.label;

  const actions = document.createElement('div');
  actions.className = 'mmd-bar-actions';
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'mmd-zoom-label';
  const btnOut = iconButton(ICONS.zoomOut, 'Zoom out (−)', 'out');
  const btnIn = iconButton(ICONS.zoomIn, 'Zoom in (+)', 'in');
  const btnReset = iconButton(null, 'Reset view (0)', 'reset', { text: 'Reset' });
  const separator = document.createElement('span');
  separator.className = 'mmd-sep';
  const btnClose = iconButton(ICONS.close, 'Close (Esc)', 'close');
  btnClose.classList.add('mmd-close');
  actions.append(btnOut, zoomLabel, btnIn, separator, btnReset, btnClose);
  bar.append(title, actions);

  const stage = document.createElement('div');
  stage.className = 'mmd-stage';
  const viewport = document.createElement('div');
  viewport.className = 'mmd-viewport';
  stage.append(viewport);

  const hints = document.createElement('div');
  hints.className = 'mmd-hints';
  hints.innerHTML =
    '<span>Drag to pan</span><span>Scroll or pinch to zoom</span>' +
    '<span><kbd>0</kbd> reset</span><span><kbd>Esc</kbd> close</span>';
  stage.append(hints);

  panel.append(bar, stage);
  modal.append(scrim, panel);
  overlay.append(modal);

  /* ---- move the live SVG in, remembering how to put it back ---------- */
  const savedStyle = state.svg.getAttribute('style') || '';
  const placeholder = document.createComment('daredown-diagram');
  state.svg.replaceWith(placeholder);
  viewport.append(state.svg);
  // Transform does the scaling here, so the SVG sits at its natural size.
  state.svg.style.maxWidth = 'none';
  state.svg.style.width = `${state.natural.w}px`;
  state.svg.style.height = `${state.natural.h}px`;

  const view = { scale: 1, tx: 0, ty: 0 };
  let fit = { scale: 1, tx: 0, ty: 0 };

  function apply(): void {
    viewport.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
    btnIn.disabled = view.scale >= MAX_SCALE - 0.001;
    btnOut.disabled = view.scale <= MIN_SCALE + 0.001;
  }

  /** Centre the diagram in the stage at the largest scale that fits. */
  function computeFit(): { scale: number; tx: number; ty: number } {
    const rect = stage.getBoundingClientRect();
    const pad = 48;
    const scale = clamp(
      Math.min(
        (rect.width - pad) / state.natural.w,
        (rect.height - pad) / state.natural.h
      )
    );
    fit = {
      scale,
      tx: (rect.width - state.natural.w * scale) / 2,
      ty: (rect.height - state.natural.h * scale) / 2,
    };
    return fit;
  }

  function reset(): void {
    const target = computeFit();
    view.scale = target.scale;
    view.tx = target.tx;
    view.ty = target.ty;
    apply();
  }

  /** Zoom by `factor`, keeping the point (px, py) in stage space fixed. */
  function zoomAt(px: number, py: number, factor: number): void {
    const next = clamp(view.scale * factor);
    if (next === view.scale) return;
    const ratio = next / view.scale;
    view.tx = px - (px - view.tx) * ratio;
    view.ty = py - (py - view.ty) * ratio;
    view.scale = next;
    apply();
  }

  function zoomCentre(factor: number): void {
    const rect = stage.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  function stagePoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /* ---- pointer panning and touch pinch ------------------------------- */

  const pointers = new Map();
  let pinch: { distance: number; scale: number; midpoint: { x: number; y: number } } | null = null;
  let dragged = false;

  stage.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, stagePoint(event));
    dragged = false;

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
    stage.classList.add('is-panning');
    hints.classList.add('is-faded');
  });

  stage.addEventListener('pointermove', (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    const current = stagePoint(event);
    pointers.set(event.pointerId, current);

    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.distance > 0) {
        const target = clamp(pinch.scale * (distance / pinch.distance));
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // Zoom about the current midpoint, then follow the midpoint's drift.
        zoomAt(midpoint.x, midpoint.y, target / view.scale);
        view.tx += midpoint.x - pinch.midpoint.x;
        view.ty += midpoint.y - pinch.midpoint.y;
        pinch.midpoint = midpoint;
        apply();
      }
      dragged = true;
      return;
    }

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) dragged = true;
    view.tx += dx;
    view.ty += dy;
    apply();
  });

  function endPointer(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) stage.classList.remove('is-panning');
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  /* ---- wheel and trackpad pinch -------------------------------------- */

  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const { x, y } = stagePoint(event);
      // A trackpad pinch arrives as wheel + ctrlKey with small, rapid deltas,
      // so it needs a much stronger curve than a mouse notch. 0.0022 makes one
      // 100-unit notch land on the same 1.25x step as the zoom buttons.
      const intensity = event.ctrlKey ? 0.012 : 0.0022;
      zoomAt(x, y, Math.exp(-normalizeDelta(event) * intensity));
      hints.classList.add('is-faded');
    },
    { passive: false }
  );

  stage.addEventListener('dblclick', (event: MouseEvent) => {
    const { x, y } = stagePoint(event);
    zoomAt(x, y, event.altKey ? 1 / 1.8 : 1.8);
  });

  /* ---- controls, scrim, keyboard ------------------------------------- */

  actions.addEventListener('click', (event: MouseEvent) => {
    const action = (event.target as Element | null)?.closest<HTMLElement>('[data-action]')?.dataset
      .action;
    if (!action) return;
    if (action === 'in') zoomCentre(STEP);
    else if (action === 'out') zoomCentre(1 / STEP);
    else if (action === 'reset') reset();
    else if (action === 'close') close();
  });

  // Clicking outside the panel closes — but not when a pan gesture happened
  // to finish out there.
  scrim.addEventListener('click', () => {
    if (!dragged) close();
  });

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomCentre(STEP);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomCentre(1 / STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      reset();
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const distance = event.shiftKey ? 220 : 70;
      if (event.key === 'ArrowLeft') view.tx += distance;
      if (event.key === 'ArrowRight') view.tx -= distance;
      if (event.key === 'ArrowUp') view.ty += distance;
      if (event.key === 'ArrowDown') view.ty -= distance;
      apply();
    } else if (event.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusable = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (focusable.length === 0) return;
      const active = document.activeElement;
      // -1 when focus is elsewhere, so a forward Tab lands on the first button.
      const index = active instanceof HTMLButtonElement ? focusable.indexOf(active) : -1;
      event.preventDefault();
      const next = event.shiftKey ? index - 1 : index + 1;
      focusable[(next + focusable.length) % focusable.length]?.focus();
    }
  }
  // Capture phase so the app's global shortcuts never see these keys.
  document.addEventListener('keydown', onKeyDown, true);

  const onResize = () => {
    // Keep the diagram in view when the window changes under the modal.
    if (Math.abs(view.scale - fit.scale) < 0.005) reset();
  };
  window.addEventListener('resize', onResize);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
    activeModal = null;

    // Put the SVG back exactly as it was found.
    state.svg.setAttribute('style', savedStyle);
    placeholder.replaceWith(state.svg);
    // Re-apply the inline zoom, which savedStyle already encodes, so the frame
    // scroll geometry matches the restored size.
    setInlineScale(state, state.scale);

    modal.classList.add('is-closing');
    const remove = () => modal.remove();
    modal.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 260);

    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  activeModal = { close };

  // Fit synchronously — appending the panel has already forced layout, and
  // deferring to a frame would leave the diagram untransformed in a window that
  // is not currently painting.
  reset();
  btnClose.focus({ preventScroll: true });
  // Re-fit once more after the first frame, in case web fonts or a scrollbar
  // shifted the stage's measured size.
  requestAnimationFrame(() => {
    if (!closed && Math.abs(view.scale - fit.scale) < 0.005) reset();
  });
  setTimeout(() => hints.classList.add('is-faded'), 2800);
}

/** Normalize wheel deltas across line/page/pixel modes. */
function normalizeDelta(event: WheelEvent): number {
  const { deltaY, deltaMode } = event;
  if (deltaMode === 1) return deltaY * 16; // lines
  if (deltaMode === 2) return deltaY * 400; // pages
  return deltaY;
}
