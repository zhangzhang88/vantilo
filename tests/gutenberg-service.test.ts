import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const { createGutenbergService } = createRequire(import.meta.url)('../electron/gutenberg-service.cjs');
const EPUB_URL = 'https://www.gutenberg.org/ebooks/215.epub3.images';
const FILE_URL = 'https://www.gutenberg.org/cache/epub/215/pg215-images-3.epub';
const ATOM = 'http://www.w3.org/2005/Atom';
const xml = (body: string) => new Response(body, { headers: { 'content-type': 'application/atom+xml' } });
const searchEntry = (id = 215, title = 'The call of the wild', author = 'Jack London') =>
  '<entry><id>https://www.gutenberg.org/ebooks/' + id + '.opds</id><title>' + title +
  '</title><content type="text">' + author + '</content><link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/' + id + '.opds"/></entry>';
const searchFeed = (entries: string[], next = true, totalResults = 125) =>
  '<feed xmlns="' + ATOM + '" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">' +
  '<id>https://www.gutenberg.org/ebooks/search.opds/</id>' +
  (next ? '<link rel="next" href="/ebooks/search.opds/?query=wild&amp;start_index=26"/>' : '') +
  '<opensearch:totalResults>' + totalResults + '</opensearch:totalResults>' + entries.join('') + '</feed>';
const detailFeed = (id = 215, epubUrl = EPUB_URL) =>
  '<feed xmlns="' + ATOM + '" xmlns:dcterms="http://purl.org/dc/terms/"><entry>' +
  '<id>urn:gutenberg:' + id + ':2</id><title>The call of the wild</title>' +
  '<author><name>London, Jack</name></author><category term="Adventure stories"/>' +
  '<category term="Dogs -- Fiction"/>' +
  '<link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="' + epubUrl + '"/>' +
  '<link rel="http://opds-spec.org/image" type="image/jpeg" href="https://www.gutenberg.org/cache/epub/' + id + '/pg' + id + '.cover.medium.jpg"/>' +
  '</entry></feed>';
const gutendexBook = () => ({
  id: 215, title: 'The Call of the Wild', authors: [{ name: 'Jack London' }],
  subjects: ['Adventure stories'], bookshelves: [], languages: ['en'], download_count: 20,
  formats: { 'application/epub+zip': EPUB_URL }
});

describe('Gutenberg service', () => {
  it('searches the official OPDS catalog, parses author metadata, and advances using OPDS pagination', async () => {
    const fetch = vi.fn(async (_url: unknown) => xml(searchFeed([
      '<entry><id>https://www.gutenberg.org/ebooks/authors/search.opds/?query=wild</id><title>Authors</title></entry>',
      searchEntry()
    ])));
    const service = createGutenbergService({ fetchImpl: fetch });
    const result = await service.search({ query: 'wild', topic: 'adventure survival', page: 2 });
    const requestUrl = new URL(String(fetch.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe('/ebooks/search.opds/');
    expect(requestUrl.searchParams.get('query')).toBe('wild adventure survival');
    expect(requestUrl.searchParams.get('start_index')).toBe('26');
    expect(result).toMatchObject({ count: 125, next: 3, previous: 1 });
    expect(result.books).toHaveLength(1);
    expect(result.books[0]).toMatchObject({
      id: 215, title: 'The call of the wild', authors: ['Jack London'],
      epubUrl: null, sourceUrl: 'https://www.gutenberg.org/ebooks/215'
    });
  });

  it('falls back to Gutendex when the official OPDS response is invalid', async () => {
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url).includes('www.gutenberg.org')) return new Response('<html>temporarily unavailable</html>');
      return new Response(JSON.stringify({ count: 1, next: null, results: [gutendexBook()] }), {
        headers: { 'content-type': 'application/json' }
      });
    });
    const service = createGutenbergService({ fetchImpl: fetch });
    const result = await service.search({ query: 'wild', page: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetch.mock.calls[1][0])).hostname).toBe('gutendex.com');
    expect(result.books[0]).toMatchObject({ id: 215, title: 'The Call of the Wild', epubUrl: EPUB_URL });
  });

  it('returns a valid empty OPDS result without making an unnecessary fallback request', async () => {
    const fetch = vi.fn(async () => xml(searchFeed([], false, 0)));
    const result = await createGutenbergService({ fetchImpl: fetch }).search({ query: 'no-such-book' });
    expect(result.books).toEqual([]);
    expect(result.next).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('loads official detail metadata, including real OPDS categories and EPUB link', async () => {
    const fetch = vi.fn(async () => xml(detailFeed()));
    const service = createGutenbergService({ fetchImpl: fetch });
    const detail = await service.detail({ id: 215 });
    expect(detail).toMatchObject({
      id: 215, title: 'The call of the wild', authors: ['London, Jack'],
      epubUrl: EPUB_URL, coverUrl: 'https://www.gutenberg.org/cache/epub/215/pg215.cover.medium.jpg'
    });
    expect(detail.subjects).toContain('Adventure stories');
    expect(detail.subjects).toContain('Dogs -- Fiction');
    await expect(service.detail({ id: 0 })).rejects.toThrow();
  });

  it('rejects an EPUB URL that does not match the requested official Gutenberg book', async () => {
    const service = createGutenbergService({
      fetchImpl: vi.fn(async () => xml(detailFeed(215, 'https://evil.test/book.epub')))
    });
    await expect(service.detail({ id: 215 })).rejects.toThrow(/未提供/);
  });

  it('follows a verified official EPUB redirect and imports through the existing shelf importer once', async () => {
    const zip = Buffer.alloc(256); zip.write('PK');
    const imported = vi.fn(async () => ({ status: 'imported', bookId: 'book-id' }));
    const fetch = vi.fn(async (url: unknown, options: any) => {
      if (String(url).endsWith('.opds')) return xml(detailFeed());
      if (String(url) === EPUB_URL) {
        expect(options.redirect).toBe('manual');
        return new Response(null, { status: 302, headers: { location: FILE_URL } });
      }
      if (String(url) === FILE_URL) return new Response(new Uint8Array(zip), { headers: { 'content-type': 'application/epub+zip' } });
      throw new Error('Unexpected URL');
    });
    const service = createGutenbergService({ fetchImpl: fetch, fetchBookList: async () => [], importEpub: imported });
    const result = await service.acquire({ id: 215, filename: 'Wild: Book', categoryId: 'uncategorized' });
    expect(imported).toHaveBeenCalledOnce();
    expect(imported).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'Wild_ Book.epub', data: expect.any(Buffer)
    }));
    expect(result.status).toBe('imported');

    const duplicate = createGutenbergService({
      fetchImpl: vi.fn(async () => xml(detailFeed())),
      fetchBookList: async () => [{ id: 'existing', title: 'The call of the wild' }],
      importEpub: imported
    });
    expect((await duplicate.acquire({ id: 215, filename: 'Book', categoryId: 'uncategorized' })).status).toBe('duplicate');
    expect(imported).toHaveBeenCalledOnce();
  });

  it('rejects an off-site download redirect even when the official feed advertises the book', async () => {
    const service = createGutenbergService({
      fetchImpl: vi.fn(async (url: unknown) => String(url).endsWith('.opds')
        ? xml(detailFeed())
        : new Response(null, { status: 302, headers: { location: 'https://evil.test/malicious.epub' } }))
    });
    await expect(service.acquire({ id: 215, filename: 'Wild', categoryId: 'uncategorized' })).rejects.toThrow(/不受信任/);
  });
});
