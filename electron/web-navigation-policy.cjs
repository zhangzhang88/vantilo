const { isIP } = require('node:net');
const SEARCH_URL = 'https://www.google.com/search?q=';

function localAddress(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '0.0.0.0') return true;
  const literal = normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized;
  const family = isIP(literal);
  if (family === 4) return Number(literal.split('.')[0]) === 127;
  if (family !== 6) return false;
  if (literal === '::' || literal === '::1') return true;
  const dottedMapped = literal.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped && isIP(dottedMapped[1]) === 4) return Number(dottedMapped[1].split('.')[0]) === 127;
  return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/i.test(literal);
}

function validateWebNavigation(input, { appOrigins = [] } = {}) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 8192) return { ok: false, reason: 'invalid' };
  let target;
  try { target = new URL(input); } catch { return { ok: false, reason: 'invalid' }; }
  if (!['http:', 'https:'].includes(target.protocol)) return { ok: false, reason: 'scheme' };
  if (!target.hostname || target.username || target.password) return { ok: false, reason: 'invalid' };
  if (appOrigins.includes(target.origin)) return { ok: false, reason: 'app-origin' };
  if (localAddress(target.hostname)) return { ok: false, reason: 'loopback' };
  return { ok: true, url: target.href };
}

function allowSubresource(input, appOrigins = []) {
  let resource;
  try { resource = new URL(input); } catch { return false; }
  if (resource.protocol === 'http:' || resource.protocol === 'https:') return validateWebNavigation(input, { appOrigins }).ok;
  if (resource.protocol === 'ws:' || resource.protocol === 'wss:') {
    const webOrigin = resource.origin.replace(/^ws/, 'http');
    return !localAddress(resource.hostname) && !appOrigins.includes(webOrigin);
  }
  return ['data:', 'blob:', 'about:'].includes(resource.protocol);
}

function addressFromText(input) {
  const query = typeof input === 'string' ? input.trim() : '';
  if (!query || query.length > 2048) return null;
  const hostLike = /^(localhost|\[[\da-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#]|$)/i.test(query);
  if (!hostLike && !/^[a-z][a-z\d+.-]*:/i.test(query)) return SEARCH_URL + encodeURIComponent(query);
  try {
    const target = new URL(/^[a-z][a-z\d+.-]*:/i.test(query) ? query : `https://${query}`);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return null;
    return target.href;
  } catch { return null; }
}

function sanitizeViewportRect(input) {
  if (!input || typeof input !== 'object') return null;
  const { x, y, width, height } = input;
  if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000)) return null;
  const rect = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  return rect.width < 0 || rect.height < 0 ? null : rect;
}

function validWebTabKey(value) { return typeof value === 'string' && /^web_[A-Za-z0-9_-]{1,60}$/.test(value); }

module.exports = {
  checkBrowserUrl: validateWebNavigation,
  isBrowserRequestAllowed: allowSubresource,
  isLoopbackHost: localAddress,
  resolveBrowserAddress: addressFromText,
  parseBrowserBounds: sanitizeViewportRect,
  isBrowserTabId: validWebTabKey,
};
