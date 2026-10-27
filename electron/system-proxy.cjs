const { execFileSync } = require('node:child_process');
const { isIP } = require('node:net');

// scutil exposes only the active macOS proxy configuration, not proxy credentials.
function proxyEnvironment(output) {
  if (typeof output !== 'string' || output.length > 32768) return {};
  const value = key => output.match(new RegExp('^\\s*' + key + '\\s*:\\s*(.*?)\\s*$', 'm'))?.[1];
  const proxy = (prefix, scheme) => {
    if (value(prefix + 'Enable') !== '1') return null;
    const host = value(prefix + 'Proxy'), port = value(prefix + 'Port');
    if (!host || !port || !/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) return null;
    if (!isIP(host) && (!/^[a-zA-Z0-9.-]{1,253}$/.test(host) || host.startsWith('.') || host.endsWith('.'))) return null;
    return `${scheme}://${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
  };
  const http = proxy('HTTP', 'http'), https = proxy('HTTPS', 'http'), socks = proxy('SOCKS', 'socks5h');
  const result = {};
  if (http || socks) result.HTTP_PROXY = http || socks;
  if (https || socks) result.HTTPS_PROXY = https || socks;
  if (socks) result.ALL_PROXY = socks;
  if (Object.keys(result).length) {
    const block = output.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/)?.[1] || '';
    const exceptions = [...block.matchAll(/^\s*\d+\s*:\s*([^\s]+)\s*$/gm)].map(match => match[1]);
    const safe = exceptions.filter(item => /^[a-zA-Z0-9.*:_-]{1,253}$/.test(item)).map(item => item.startsWith('*.') ? item.slice(1) : item);
    result.NO_PROXY = [...new Set(['localhost', '127.0.0.1', '::1', ...safe])].join(',');
  }
  return result;
}
function systemProxyEnvironment({ platform = process.platform, read = () => execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 2000, maxBuffer: 32768, stdio: ['ignore', 'pipe', 'ignore'] }) } = {}) {
  if (platform !== 'darwin') return {};
  try { return proxyEnvironment(read()); } catch { return {}; }
}
module.exports = { proxyEnvironment, systemProxyEnvironment };
