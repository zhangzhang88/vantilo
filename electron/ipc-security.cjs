const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');

const PACKAGED_RENDERER_PATH = path.resolve(__dirname, '../dist/index.html');
const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:5173';

function isTrustedPageUrl(input, { packaged, rendererPath = PACKAGED_RENDERER_PATH } = {}) {
  if (typeof input !== 'string' || !input || typeof packaged !== 'boolean') return false;
  let parsed;
  try { parsed = new URL(input); } catch { return false; }

  if (!packaged) {
    return input.startsWith(`${DEVELOPMENT_ORIGIN}/`) && parsed.protocol === 'http:' &&
      parsed.origin === DEVELOPMENT_ORIGIN && !parsed.username && !parsed.password;
  }

  if (parsed.protocol !== 'file:' || parsed.hostname !== '' || parsed.username || parsed.password ||
      parsed.search || parsed.hash) return false;
  try {
    const expectedPath = path.resolve(rendererPath);
    const expectedUrl = pathToFileURL(expectedPath).href;
    // Require the canonical URL spelling as well as the exact decoded filesystem path.
    // This rejects encoded aliases and URL forms that normalize through traversal.
    return parsed.href === expectedUrl && input === parsed.href &&
      path.resolve(fileURLToPath(parsed)) === expectedPath;
  } catch {
    return false;
  }
}

function isTrustedSender(event, { win, packaged, rendererPath = PACKAGED_RENDERER_PATH } = {}) {
  if (!win || event?.sender !== win.webContents || event?.senderFrame !== win.webContents.mainFrame) return false;
  return isTrustedPageUrl(event.senderFrame.url, { packaged, rendererPath });
}

module.exports = { isTrustedSender, isTrustedPageUrl, PACKAGED_RENDERER_PATH, DEVELOPMENT_ORIGIN };
