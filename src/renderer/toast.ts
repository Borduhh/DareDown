/**
 * Non-blocking status messages in the bottom-right corner.
 *
 * Every notice waits to be dismissed. A message that vanishes on a timer is a
 * message the reader may never have seen — and one carrying a button is worse,
 * since the thing to click leaves before it can be clicked. So there is no
 * timer here at all: notices stack, each carries a close button, and the
 * reader clears them when they have been read.
 *
 * They pile rather than queue: the newest sits in front and the ones behind it
 * show only an edge, so the corner can say "three things happened" without
 * spending three notices' worth of window on it. Only the front card is
 * interactive — dismissing it brings the next one forward, so the pile is
 * cleared from the top down.
 *
 * The front card sizes itself to its message, growing leftwards from the corner
 * so it stays on one line; the cards behind take that same width, which is what
 * makes the pile read as a stack rather than a ragged heap. Past the maximum
 * width the message is chopped with an ellipsis rather than wrapping.
 */

const root = () => document.getElementById('toast-root');

/** Beyond this the oldest is dropped, so an unattended pile cannot fill the window. */
const MAX_VISIBLE = 4;

/** How much of each card behind the front one stays visible, in pixels. */
const PEEK = 9;
/** Cards further back are drawn slightly smaller, which is what reads as depth. */
const SCALE_STEP = 0.045;
/** Deeper than this and a card is held at zero opacity rather than crowding the edge. */
const MAX_PEEKING = 3;

export interface ToastAction {
  label: string;
  /** Return false to keep the toast open; anything else dismisses it. */
  onClick(): void | boolean;
}

export interface ToastOptions {
  /** Styles it as a failure rather than a neutral notice. */
  error?: boolean;
  actions?: ToastAction[];
}

export interface ToastHandle {
  /**
   * Dismiss the notice. Pass true to take it out of the DOM at once instead of
   * fading it: a fading card still occupies its slot, so anything that replaces
   * one in place has to remove it outright or the two visibly overlap.
   */
  close(immediate?: boolean): void;
}

interface Entry {
  handle: ToastHandle;
  element: HTMLElement;
}

/** Every toast currently on screen, oldest first. */
const live: Entry[] = [];

/** Position the pile: newest in front, each one behind it offset and inset. */
function layout(): void {
  const front = live[live.length - 1]?.element;
  if (!front) return;

  // Measure the front card at its natural width, then pin every card to it.
  // Pinning rather than leaving the front auto is what lets width animate when
  // a card is promoted, and it keeps the ones behind from poking out.
  //
  // offsetWidth, not getBoundingClientRect: a card being promoted still carries
  // the scale of the depth it is leaving, and a scaled rect would hand back a
  // width 4.5% short. The spare pixel covers offsetWidth's rounding — landing a
  // fraction under is enough to ellipsise a message that actually fits.
  front.style.width = '';
  const stackWidth = front.offsetWidth + 1;

  for (let depth = 0; depth < live.length; depth += 1) {
    const entry = live[live.length - 1 - depth];
    if (!entry) continue;
    const { element } = entry;

    element.style.width = `${stackWidth}px`;
    element.style.transform = `translateY(${-depth * PEEK}px) scale(${1 - depth * SCALE_STEP})`;
    element.style.opacity = depth < MAX_PEEKING ? '1' : '0';
    element.style.zIndex = String(100 - depth);
    // Only the front card can be clicked; the rest are edges until promoted.
    element.style.pointerEvents = depth === 0 ? 'auto' : 'none';
  }
}

export function toast(
  message: string,
  { error = false, actions = [] }: ToastOptions = {}
): ToastHandle {
  const host = root();
  if (!host) return { close: () => {} };

  const element = document.createElement('div');
  element.className = error ? 'toast error' : 'toast';
  // Entry state; the first layout pass transitions out of it.
  element.style.opacity = '0';
  element.style.transform = 'translateX(14px)';

  const label = document.createElement('span');
  label.className = 'toast-message';
  label.textContent = message;
  // Chopped messages are still readable on hover.
  label.title = message;
  element.append(label);

  let closed = false;

  const handle: ToastHandle = {
    close(immediate = false) {
      if (closed) return;
      closed = true;
      const index = live.findIndex((entry) => entry.handle === handle);
      if (index !== -1) live.splice(index, 1);

      if (immediate) {
        element.remove();
      } else {
        element.style.pointerEvents = 'none';
        element.style.opacity = '0';
        element.style.transform = 'translateX(12px)';
        setTimeout(() => element.remove(), 220);
      }
      // Close the gap as it goes, rather than after it has faded.
      layout();
    },
  };

  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      if (action.onClick() !== false) handle.close();
    });
    element.append(button);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'toast-close';
  dismiss.title = 'Dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => handle.close());
  element.append(dismiss);

  host.append(element);
  live.push({ handle, element });
  while (live.length > MAX_VISIBLE) live[0]?.handle.close();

  requestAnimationFrame(() => layout());
  return handle;
}

/** Close everything on screen — used before showing a fresh sequence. */
export function clearToasts(): void {
  for (const entry of [...live]) entry.handle.close();
}
