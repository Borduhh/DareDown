/** Brief, non-blocking status messages at the bottom of the window. */

const root = () => document.getElementById('toast-root');

export function toast(message, { error = false, duration = 2600 } = {}) {
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
