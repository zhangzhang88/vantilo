import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { resolveBrowserAddress as resolveUiBrowserAddress } from '../src/model/browser-address';
const require = createRequire(import.meta.url);
const { checkBrowserUrl, isBrowserRequestAllowed, isLoopbackHost, resolveBrowserAddress, parseBrowserBounds, isBrowserTabId } = require('../electron/web-navigation-policy.cjs');

describe('isolated browser URL and bounds policy', () => {
  it('allows ordinary HTTP(S) pages while rejecting unsafe schemes, credentials and app origins', () => {
    expect(checkBrowserUrl('https://example.com/path')).toEqual({ ok: true, url: 'https://example.com/path' });
    expect(checkBrowserUrl('file:///etc/passwd')).toMatchObject({ ok: false, reason: 'scheme' });
    expect(checkBrowserUrl('https://user:password@example.com')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkBrowserUrl('http://127.0.0.1:5173/')).toMatchObject({ ok: false, reason: 'loopback' });
    expect(checkBrowserUrl('http://127.0.0.1:5173/', { appOrigins: ['http://127.0.0.1:5173'] })).toMatchObject({ ok: false, reason: 'app-origin' });
    expect(checkBrowserUrl('https://vantilo.example/app', { appOrigins: ['https://vantilo.example'] })).toMatchObject({ ok: false, reason: 'app-origin' });
  });
  it('blocks local-network targets and their subresources, including normalized loopback forms', () => {
    for (const host of ['localhost', 'api.localhost', '127.0.0.1', '127.10.4.8', '0.0.0.0', '[::1]', '2130706433']) {
      expect(isLoopbackHost(new URL(`http://${host}`).hostname)).toBe(true);
      expect(checkBrowserUrl(`http://${host}/`)).toMatchObject({ ok: false, reason: 'loopback' });
    }
    expect(isBrowserRequestAllowed('http://127.0.0.1/private')).toBe(false);
    expect(isBrowserRequestAllowed('wss://localhost/socket')).toBe(false);
    expect(isBrowserRequestAllowed('https://example.com/image.png')).toBe(true);
    expect(isBrowserRequestAllowed('data:image/png;base64,AA')).toBe(true);
    expect(isBrowserRequestAllowed('file:///etc/passwd')).toBe(false);
  });
  it('resolves host-like input as URLs and other input as a search without accepting other protocols', () => {
    expect(resolveBrowserAddress('example.com/path')).toBe('https://example.com/path');
    expect(resolveBrowserAddress('hello world')).toBe('https://www.google.com/search?q=hello%20world');
    expect(resolveBrowserAddress('javascript:alert(1)')).toBeNull();
    expect(resolveBrowserAddress('https://user@example.com')).toBeNull();
    expect(resolveUiBrowserAddress('example.com/path')).toBe('https://example.com/path');
    expect(resolveUiBrowserAddress('hello world')).toBe('https://www.google.com/search?q=hello%20world');
    expect(resolveUiBrowserAddress('javascript:alert(1)')).toBeNull();
    expect(resolveUiBrowserAddress('https://user@example.com')).toBeNull();
  });
  it('validates renderer-provided bounds and opaque tab IDs', () => {
    expect(parseBrowserBounds({ x: 1.2, y: 2, width: 300.4, height: 200 })).toEqual({ x: 1, y: 2, width: 300, height: 200 });
    expect(parseBrowserBounds({ x: 0, y: 0, width: -1, height: 10 })).toBeNull();
    expect(parseBrowserBounds({ x: Infinity, y: 0, width: 1, height: 1 })).toBeNull();
    expect(isBrowserTabId('web_4_abc-123')).toBe(true);
    expect(isBrowserTabId('../web_4')).toBe(false);
  });
});
