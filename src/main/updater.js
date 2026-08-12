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
/** Attempts still available for the check in flight; read by the error handler. */
let retriesLeft = 0;

/** @param {UpdateStatus} status */
function report(status) {
  if (publish) publish(status);
}

/**
 * Conditions where trying again is likely to succeed.
 *
 * The one that prompted this list is net::ERR_HTTP2_SERVER_REFUSED_STREAM:
 * GitHub declines a stream *without processing it*, usually on a connection it
 * is winding down, and RFC 7540 says that code is specifically safe to retry.
 * electron-updater will not do it for us — its retryOnServerError covers only
 * HTTP 5xx and EPIPE, and a Chromium net:: error is neither, so one momentary
 * refusal became a hard failure.
 */
const TRANSIENT = [
  'ERR_HTTP2_', // REFUSED_STREAM, PING_FAILED, PROTOCOL_ERROR
  'ERR_CONNECTION_',
  'ERR_NETWORK_CHANGED',
  'ERR_TIMED_OUT',
  'ERR_ABORTED',
  'ERR_SOCKET_NOT_CONNECTED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'socket hang up',
];

/** @param {unknown} err */
function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {unknown} err */
function isTransient(err) {
  const text = errorText(err);
  return TRANSIENT.some((code) => text.includes(code));
}

/**
 * Turn a network failure into something a reader can act on. The raw code still
 * goes to the console, where it is useful; ERR_HTTP2_SERVER_REFUSED_STREAM in a
 * toast is not.
 *
 * @param {unknown} err
 */
function humanMessage(err) {
  const text = errorText(err);
  if (isTransient(err) || text.includes('ERR_NAME_NOT_RESOLVED') || text.includes('ENOTFOUND')) {
    return 'Could not reach GitHub. Check your connection and try again.';
  }
  if (text.includes('404')) {
    return 'No update information was published for this release.';
  }
  return text;
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // checkForUpdates() both emits this and rejects. While retries remain, stay
    // quiet and let the loop in check() try again — otherwise the reader sees an
    // error toast for a failure we are about to recover from.
    console.warn('[updates]', errorText(err));
    if (retriesLeft > 0 && isTransient(err)) return;
    inFlight = false;
    report({ state: 'error', message: humanMessage(err) });
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

  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    retriesLeft = ATTEMPTS - attempt;
    try {
      await updater().checkForUpdates();
      return;
    } catch (err) {
      if (retriesLeft > 0 && isTransient(err)) {
        // Rising backoff, and a fresh connection next time, which is what
        // actually clears a refused HTTP/2 stream.
        await delay(attempt * 800);
        continue;
      }
      inFlight = false;
      report({ state: 'error', message: humanMessage(err) });
      return;
    }
  }
}

/** Restart into the downloaded update. */
function install() {
  if (!app.isPackaged) return;
  updater().quitAndInstall();
}

module.exports = { configure, check, install, isTransient, humanMessage };
