const { z } = require('zod');
const { DOMParser } = require('@xmldom/xmldom');

const SearchInput = z.object({ query: z.string().trim().max(120).default(''), topic: z.string().max(80).optional(), page: z.number().int().min(1).max(1000).default(1) }).strict();
const DetailInput = z.object({ id: z.number().int().positive() }).strict();
const AcquireInput = z.object({ id: z.number().int().positive(), filename: z.string().trim().min(1).max(180), categoryId: z.string().max(64).default('uncategorized') }).strict();
const API = 'https://gutendex.com/books/';
const SIZE_LIMIT = 64 * 1024 * 1024;
const TIMEOUT = 25000;
const ATOM_NS = 'http://www.w3.org/2005/Atom';
const OFFICIAL = 'https://www.gutenberg.org';
const isEpubLink = (value, id) => typeof value === 'string' &&
  new RegExp('^https://www\\.gutenberg\\.org/ebooks/' + id + '\\.(?:epub3?\\.images|epub\\.noimages)$', 'i').test(value);
const isEpubRedirect = (value, id) => {
  try {
    const url = new URL(value);
    return url.origin === OFFICIAL && !url.search && !url.hash &&
      new RegExp('^/cache/epub/' + id + '/pg' + id + '(?:-images-3|-images|-noimages)?\\.epub$', 'i').test(url.pathname);
  } catch { return false; }
};
const stripHtml = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
function normalizeBook(book) {
  const formats = book.formats || {};
  const epub = Object.entries(formats).find(([type, url]) => type.toLowerCase().includes('epub') && isEpubLink(url, book.id));
  const cover = formats['image/jpeg'];
  return { id: book.id, title: String(book.title || ''), authors: (book.authors || []).map(x => String(x.name || '')), subjects: (book.subjects || []).map(stripHtml), bookshelves: (book.bookshelves || []).map(stripHtml), languages: book.languages || [], downloadCount: Number(book.download_count) || 0, formats: Object.keys(formats).filter(key => /epub/i.test(key)), epubUrl: epub?.[1] || null, coverUrl: typeof cover === 'string' && /^https:\/\//.test(cover) ? cover : null, sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}` };
}
function createGutenbergService({ fetchImpl = fetch, fetchBookList = async () => [], importEpub = async () => { throw new Error('书架导入服务不可用'); } } = {}) {
  const headers = accept => ({ 'User-Agent': 'Vantilo/0.1 (macOS EPUB reader; https://github.com/zhangzhang88/vantilo)', Accept: accept });
  async function get(url, accept = 'application/json') {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT), headers: headers(accept) });
    if (!response.ok) throw new Error(`书目请求失败（${response.status}）`);
    return response;
  }
  // The Gutenberg OPDS entry is an official, user-requested source. It avoids
  // blocking curated books on the independent Gutendex server's availability.
  async function officialDetail(id) {
    const response = await get(`${OFFICIAL}/ebooks/${id}.opds`, 'application/atom+xml');
    const xml = await response.text();
    if (xml.length > 2 * 1024 * 1024) throw new Error('官方书目响应过大');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const entries = Array.from(document.getElementsByTagNameNS(ATOM_NS, 'entry'));
    const links = entries.flatMap(entry => Array.from(entry.getElementsByTagNameNS(ATOM_NS, 'link')));
    const epubLinks = links.filter(link => link.getAttribute('type') === 'application/epub+zip' &&
      isEpubLink(link.getAttribute('href'), id));
    const preferred = epubLinks.find(link => link.getAttribute('href')?.includes('.epub3.images')) || epubLinks[0];
    if (!entries.length || !preferred) throw new Error('官方书目未提供可识别的 EPUB');
    const entry = preferred.closest ? preferred.closest('entry') : entries.find(item => Array.from(item.getElementsByTagNameNS(ATOM_NS, 'link')).includes(preferred));
    const item = entry || entries[0];
    const title = item.getElementsByTagNameNS(ATOM_NS, 'title')[0]?.textContent?.trim();
    if (!title) throw new Error('官方书目缺少书名');
    const authors = Array.from(item.getElementsByTagNameNS(ATOM_NS, 'author'))
      .map(author => author.getElementsByTagNameNS(ATOM_NS, 'name')[0]?.textContent?.trim()).filter(Boolean);
    const cover = links.find(link => link.getAttribute('type') === 'image/jpeg' &&
      /^https:\/\/www\.gutenberg\.org\/cache\/epub\/\d+\/pg\d+\.cover\.(?:small|medium)\.jpg$/i.test(link.getAttribute('href') || ''));
    return { id, title, authors, subjects: [], bookshelves: [], languages: ['en'], downloadCount: 0,
      formats: ['application/epub+zip'], epubUrl: preferred.getAttribute('href'), coverUrl: cover?.getAttribute('href') || null,
      sourceUrl: `${OFFICIAL}/ebooks/${id}` };
  }
  async function getOfficialEpub(url, id) {
    if (!isEpubLink(url, id)) throw new Error('EPUB 下载地址不属于该书的官方来源');
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), headers: headers('application/epub+zip') });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('EPUB 重定向缺少地址');
        const next = new URL(location, current).href;
        if (!isEpubRedirect(next, id)) throw new Error('EPUB 重定向地址不受信任');
        current = next; continue;
      }
      if (!response.ok) throw new Error(`EPUB 下载失败（${response.status}）`);
      return response;
    }
    throw new Error('EPUB 重定向次数过多');
  }
  async function search(raw) {
    const input = SearchInput.parse(raw);
    const url = new URL(API); url.searchParams.set('page', String(input.page));
    if (input.query) url.searchParams.set('search', input.query);
    if (input.topic) url.searchParams.set('topic', input.topic);
    const response = await get(url);
    const data = await response.json();
    return { count: Number(data.count) || 0, next: typeof data.next === 'string' && data.next.startsWith(API) ? input.page + 1 : null, previous: input.page > 1 ? input.page - 1 : null, books: (data.results || []).map(normalizeBook) };
  }
  async function detail(raw) {
    const { id } = DetailInput.parse(raw);
    return officialDetail(id);
  }
  async function acquire(raw) {
    const input = AcquireInput.parse(raw);
    const book = await detail({ id: input.id });
    if (!book.epubUrl) throw new Error('Project Gutenberg 未提供可识别的 EPUB 下载格式');
    const existing = (await fetchBookList()).find(item => item.id === `gutenberg-${input.id}` || item.title?.trim().toLowerCase() === book.title.trim().toLowerCase());
    if (existing) return { status: 'duplicate', bookId: existing.id, book, title: book.title };
    const response = await getOfficialEpub(book.epubUrl, input.id);
    const mime = (response.headers.get('content-type') || '').toLowerCase();
    const length = Number(response.headers.get('content-length'));
    if (!mime.includes('epub') && !mime.includes('zip') && !mime.includes('octet-stream')) throw new Error('下载响应不是 EPUB 文件：'+mime);
    if (Number.isFinite(length) && length > SIZE_LIMIT) throw new Error('EPUB 超过 64 MB 安全上限');
    if (!response.body) throw new Error('EPUB 下载内容为空');
    const chunks = []; let total = 0;
    for await (const chunk of response.body) { total += chunk.length; if (total > SIZE_LIMIT) throw new Error('EPUB 超过 64 MB 安全上限'); chunks.push(Buffer.from(chunk)); }
    const data = Buffer.concat(chunks);
    if (data.length < 100 || data.subarray(0, 2).toString() !== 'PK') throw new Error('下载文件不完整或不是 ZIP/EPUB 格式');
    const filename = input.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.epub$/i, '') + '.epub';
    return Promise.resolve().then(async () => {
      const imported = await importEpub({ filename, categoryId: input.categoryId, data });
      return { ...imported, book, title: book.title };
    });
  }
  return { search, detail, acquire };
}
module.exports = { createGutenbergService, normalizeBook, SearchInput, DetailInput, AcquireInput, SIZE_LIMIT };
