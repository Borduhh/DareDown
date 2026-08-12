/**
 * Non-blocking status messages at the bottom of the window.
 *
 * Two kinds, deliberately: passing notices that fade on their own, and ones
 * that wait. Anything the reader might need to act on — an update ready to
 * install, a failure worth reading — stays until dismissed, because a message
 * that disappears before it can be read or clicked may as well not exist.
 */

const root = () => document.getElementById('toast-root');

/** Beyond this, the oldest is dropped so a stack of sticky notices cannot fill the window. */
const MAX_VISIBLE = 4;

export interface ToastAction {
  label: string;
  /** Return false to keep the toast open; anything else dismisses it. */
  onClick(): void | boolean;
}

export interface ToastOptions {
  /** Styles it as a failure rather than a neutral notice. */
  error?: boolean;
  /** Milliseconds before it fades. Ignored when `persistent` is set. */
  duration?: number;
  /** Stay until dismissed. Implied by passing an action. */
  persistent?: boolean;
  actions?: ToastAction[];
}

export interface ToastHandle {
  close(): void;
}

/** Every toast currently on screen, oldest first. */
const live: ToastHandle[] = [];

export function toast(
  message: string,
  { error = false, duration = 2600, persistent = false, actions = [] }: ToastOptions = {}
): ToastHandle {
  const host = root();
  if (!host) return { close: () => {} };

  const element = document.createElement('div');
  element.className = error ? 'toast error' : 'toast';
  // A toast with a button has to be reachable, and the root is click-through.
  element.style.pointerEvents = 'auto';

  const label = document.createElement('span');
  label.className = 'toast-message';
  label.textContent = message;
  element.append(label);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const handle: ToastHandle = {
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      const index = live.indexOf(handle);
      if (index !== -1) live.splice(index, 1);
      element.classList.add('leaving');
      element.addEventListener('animationend', () => element.remove(), { once: true });
      // Belt and braces: if the animation never fires (reduced motion, a
      // backgrounded window), the node still goes.
      setTimeout(() => element.remove(), 400);
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

  const sticky = persistent || actions.length > 0;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'toast-close';
  dismiss.title = 'Dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => handle.close());
  element.append(dismiss);

  host.append(element);
  live.push(handle);
  while (live.length > MAX_VISIBLE) live[0]?.close();

  if (!sticky) timer = setTimeout(() => handle.close(), duration);
  return handle;
}

/** Close everything on screen — used before showing a fresh sequence. */
export function clearToasts(): void {
  for (const handle of [...live]) handle.close();
}
