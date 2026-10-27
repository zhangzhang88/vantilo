const { isTrustedPageUrl } = require('./ipc-security.cjs');
// Fixed origin for the owned Reader module; this is not a general browser address.
const MAGAZINE_READER_WEB_URL = 'http://127.0.0.1:5175/';

function isReaderUrl(input) {
  try {
    const url = new URL(input);
    return input.startsWith(MAGAZINE_READER_WEB_URL) && url.origin === new URL(MAGAZINE_READER_WEB_URL).origin && !url.username && !url.password;
  } catch { return false; }
}

function installReaderNavigation(webContents, options) {
  const allowed = (url, main) => main ? isTrustedPageUrl(url, options) : isReaderUrl(url);
  // Electron 45 exposes navigation fields on the event itself (not a second argument).
  webContents.on('will-frame-navigate', event => {
    if (!allowed(event.url, event.isMainFrame)) event.preventDefault();
  });
  webContents.on('will-redirect', event => {
    if (!allowed(event.url, event.isMainFrame)) event.preventDefault();
  });
}

module.exports = { installReaderNavigation, isReaderUrl };