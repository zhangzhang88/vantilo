import { describe, expect, it } from 'vitest';
import { assertNoEpubEntries, epubEntries } from '../scripts/package-artifact-policy.mjs';

describe('public package content policy', () => {
  it('counts EPUB entries case-insensitively and ignores directory entries', () => {
    expect(epubEntries(['Vantilo.app/Contents/Resources/app/reader/seed/', 'BOOK.EPUB', 'fixture.epub/'])).toEqual(['BOOK.EPUB']);
  });

  it('accepts ZIP entry lists without EPUBs', () => {
    expect(assertNoEpubEntries(['Vantilo.app/Contents/Info.plist', 'Vantilo.app/Contents/Resources/app/reader/web/index.html'])).toBe(0);
  });

  it('fails closed if any EPUB is present', () => {
    expect(() => assertNoEpubEntries(['Vantilo.app/reader/seed/book.epub'])).toThrow(/must not contain EPUB/);
  });
});
