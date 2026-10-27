import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { installReaderNavigation, isReaderUrl } = require('../electron/magazine-reader-navigation.cjs');

describe('fixed Reader navigation', () => {
  it('permits only the fixed loopback origin without credentials', () => {
    expect(isReaderUrl('http://127.0.0.1:5175/')).toBe(true);
    expect(isReaderUrl('http://127.0.0.1:5175/books?id=1#chapter')).toBe(true);
    for (const url of ['https://example.com/', 'file:///etc/passwd', 'javascript:alert(1)',
      'http://localhost:5175/', 'http://127.0.0.1:5174/', 'http://127.0.0.1:5175.evil.test/',
      'http://user:password@127.0.0.1:5175/', 'about:blank', 'blob:http://127.0.0.1:5175/id']) {
      expect(isReaderUrl(url)).toBe(false);
    }
  });

  it('handles actual single-event Electron navigation and redirect signatures', () => {
    const contents = new EventEmitter();
    installReaderNavigation(contents, { packaged: false });
    for (const eventName of ['will-frame-navigate', 'will-redirect']) {
      for (const [url, isMainFrame, blocked] of [
        ['http://127.0.0.1:5175/', false, false],
        ['https://example.com/', false, true],
        ['http://127.0.0.1:5173/', false, true],
        ['http://127.0.0.1:5175/', true, true],
        ['http://127.0.0.1:5173/', true, false],
      ] as const) {
        const event = { url, isMainFrame, preventDefault: vi.fn() };
        contents.emit(eventName, event);
        expect(event.preventDefault).toHaveBeenCalledTimes(blocked ? 1 : 0);
      }
    }
  });
});
