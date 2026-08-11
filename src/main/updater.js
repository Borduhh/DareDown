'use strict';
/**
 * Update checking, kept opt-in.
 *
 * DareDown's whole point is that it does not talk to the network, so this is off
 * unless the reader turns it on, and even then it only reaches GitHub's release
 * feed. A manual check from the Help menu is always allowed, because that is an
 * explicit request rather than background behaviour.
 *
 * Worth knowing where this sits relative to the offline guarantee:
 * electron-updater talks over Node's https module, not Chromium's network stack,
 * so it does not pass through the `webRequest` block in index.js. That block
 * exists to keep an untrusted Markdown document from phoning home from the
 * renderer, which is a different job and still holds. The updater is the one
 * deliberate exception, and it lives in the main process where no document can
 * reach it.
 */
const { app } = require('electron');

/** @typedef {import('../types/bridge.js').UpdateStatus} UpdateStatus */

/** @type {((status: UpdateStatus) => void) | null} */
let publish = null;
let wired = false;
/** Guards against two checks overlapping and double-reporting. */
let inFlight = false;

/** @param {UpdateStatus} status */
function report(status) {
  if (publish) publish(status);
}

function updater() {
  // Required lazily: importing electron-updater pulls in its whole HTTP stack,
  // and a reader who never enables updates should not pay for it at startup.
  // eslint-disable-next-line global-require
  return require('electron-updater').autoUpdater;
}

/** Attach the event handlers once, the first time a check is requested. */
function wire() {
  if (wired) return;
  wired = true;
  const au = updater();

  // Fetch as soon as something is found, but never restart on its own — the
  // reader decides when to lose their place in a document.
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.allowDowngrade = false;

  au.on('checking-for-update', () => report({ state: 'checking' }));
  au.on('update-not-available', () => {
    inFlight = false;
    report({ state: 'current', version: app.getVersion() });
  });
  au.on('update-available', (info) => report({ state: 'available', version: info?.version }));
  au.on('download-progress', (progress) =>
    report({ state: 'downloading', percent: Math.round(progress?.percent ?? 0) })
  );
  au.on('update-downloaded', (info) => {
    inFlight = false;
    report({ state: 'ready', version: info?.version });
  });
  au.on('error', (err) => {
    inFlight = false;
    report({
      state: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Wire the status channel. Called once at startup; no network happens here.
 *
 * @param {(status: UpdateStatus) => void} onStatus
 */
function configure(onStatus) {
  publish = onStatus;
}

/**
 * Ask GitHub whether there is a newer release.
 *
 * @returns {Promise<void>}
 */
async function check() {
  // Unpackaged builds have no app-update.yml, and electron-updater fails with a
  // confusing ENOENT rather than saying so.
  if (!app.isPackaged) {
    report({
      state: 'unsupported',
      message: 'Updates are only available in an installed build.',
    });
    return;
  }
  if (inFlight) return;
  inFlight = true;
  wire();
  try {
    await updater().checkForUpdates();
  } catch (err) {
    inFlight = false;
    report({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

/** Restart into the downloaded update. */
function install() {
  if (!app.isPackaged) return;
  updater().quitAndInstall();
}

module.exports = { configure, check, install };
