import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const { createGutenbergService } = createRequire(import.meta.url)('../electron/gutenberg-service.cjs');
const EPUB_URL = 'https://www.gutenberg.org/ebooks/215.epub3.images';
const FILE_URL = 'https://www.gutenberg.org/cache/epub/215/pg215-images-3.epub';
const atom = (epubUrl = EPUB_URL) => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><entry>
<title>The call of the wild</title><author><name>London, Jack</name></author>
<link type="application/epub+zip" rel="http://opds-spec.org/acquisition" href="${epubUrl}"/>
</entry></feed>`;
const book = () => ({ id: 215, title: 'The Call of the Wild', authors: [{ name: 'Jack London' }],
  subjects: ['Adventure stories'], bookshelves: [], languages: ['en'], download_count: 20,
  formats: { 'application/epub+zip': EPUB_URL } });
const xml = (text = atom()) => new Response(text, { headers: { 'content-type': 'application/atom+xml' } });

describe('Gutenberg service', () => {
  it('uses Gutendex only for search and official OPDS metadata for book details', async () => {
    const fetch = vi.fn(async (url: unknown) => String(url).endsWith('.opds')
      ? xml() : new Response(JSON.stringify({ count: 1, results: [book()] }), { headers: { 'content-type': 'application/json' } }));
    const svc = createGutenbergService({ fetchImpl: fetch });
    const result = await svc.search({ query: 'wild', page: 1 });
    expect(result.books[0]).toMatchObject({ id: 215, epubUrl: EPUB_URL });
    expect(String(fetch.mock.calls[0][0])).toContain('gutendex.com/books/');
    expect(await svc.detail({ id: 215 })).toMatchObject({ title: 'The call of the wild', epubUrl: EPUB_URL });
    expect(String(fetch.mock.calls[1][0])).toBe('https://www.gutenberg.org/ebooks/215.opds');
    await expect(svc.detail({ id: 0 })).rejects.toThrow();
    await expect(createGutenbergService({ fetchImpl: vi.fn(async () => xml(atom('https://evil.test/book.epub'))) })
      .detail({ id: 215 })).rejects.toThrow(/未提供/);
  });

  it('follows one verified official EPUB redirect and delegates to the existing importer', async () => {
    const zip = Buffer.alloc(256); zip.write('PK');
    const imported = vi.fn(async () => ({ status: 'imported', bookId: 'book-id' }));
    const fetch = vi.fn(async (url: unknown, options: any) => {
      if (String(url).endsWith('.opds')) return xml();
      if (String(url) === EPUB_URL) {
        expect(options.redirect).toBe('manual');
        return new Response(null, { status: 302, headers: { location: FILE_URL } });
      }
      if (String(url) === FILE_URL) return new Response(new Uint8Array(zip), { headers: { 'content-type': 'application/epub+zip' } });
      throw new Error('Unexpected URL');
    });
    const svc = createGutenbergService({ fetchImpl: fetch, fetchBookList: async () => [], importEpub: imported });
    const result = await svc.acquire({ id: 215, filename: 'Wild: Book', categoryId: 'uncategorized' });
    expect(imported).toHaveBeenCalledOnce();
    expect(imported).toHaveBeenCalledWith(expect.objectContaining({ filename: 'Wild_ Book.epub', data: expect.any(Buffer) }));
    expect(result.status).toBe('imported');
    const duplicate = createGutenbergService({ fetchImpl: vi.fn(async () => xml()),
      fetchBookList: async () => [{ id: 'existing', title: 'The Call of the Wild' }], importEpub: imported });
    expect((await duplicate.acquire({ id: 215, filename: 'Book', categoryId: 'uncategorized' })).status).toBe('duplicate');
    expect(imported).toHaveBeenCalledOnce();
  });

  it('rejects an off-site download redirect even from an official entry', async () => {
    const svc = createGutenbergService({ fetchImpl: vi.fn(async (url: unknown) => String(url).endsWith('.opds')
      ? xml() : new Response(null, { status: 302, headers: { location: 'https://evil.test/malicious.epub' } })) });
    await expect(svc.acquire({ id: 215, filename: 'Wild', categoryId: 'uncategorized' })).rejects.toThrow(/不受信任/);
  });
});
