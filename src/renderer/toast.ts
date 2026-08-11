/** Brief, non-blocking status messages at the bottom of the window. */

const root = () => document.getElementById('toast-root');

export interface ToastOptions {
  /** Styles it as a failure rather than a neutral notice. */
  error?: boolean;
  duration?: number;
}

export function toast(message: string, { error = false, duration = 2600 }: ToastOptions = {}): void {
  const host = root();
  if (!host) return;

  const element = document.createElement('div');
  element.className = error ? 'toast error' : 'toast';
  element.textContent = message;
  host.append(element);

  setTimeout(() => {
    element.classList.add('leaving');
    element.addEventListener('animationend', () => element.remove(), { once: true });
    setTimeout(() => element.remove(), 400);
  }, duration);
}
