export type GutenbergBook = {
  id: number; title: string; authors: string[]; subjects: string[]; bookshelves: string[];
  languages: string[]; downloadCount: number; formats: string[]; epubUrl: string | null;
  coverUrl: string | null; sourceUrl: string;
};
export type GutenbergPage = { count: number; next: number | null; previous: number | null; books: GutenbergBook[] };
export type GutenbergSearch = { query?: string; topic?: string; page?: number };
const ROOT = 'https://gutendex.com/books/';
function isEpubUrl(value: unknown, id: number): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://www.gutenberg.org' && !url.search && !url.hash &&
      new RegExp('^/ebooks/' + id + '\\.(?:epub3?\\.images|epub\\.noimages)$', 'i').test(url.pathname);
  } catch { return false; }
}
function safeBook(value: unknown): GutenbergBook {
  if (!value || typeof value !== 'object') throw new Error('在线书目数据格式无效');
  const book = value as Record<string, unknown>;
  if (!Number.isSafeInteger(book.id) || (book.id as number) <= 0 || typeof book.title !== 'string') throw new Error('在线书目缺少有效的 Gutenberg ID 或书名');
  const authors = Array.isArray(book.authors) ? book.authors.map((item: any) => String(item?.name || '')).filter(Boolean) : [];
  const subjects = Array.isArray(book.subjects) ? book.subjects.map(String) : [];
  const bookshelves = Array.isArray(book.bookshelves) ? book.bookshelves.map(String) : [];
  const formats = Array.isArray(book.formats) ? book.formats.map(String) : [];
  const id = book.id as number;
  const epubUrl = isEpubUrl(book.epubUrl, id) ? book.epubUrl : null;
  const coverUrl = typeof book.coverUrl === 'string' && /^https:\/\/www\.gutenberg\.org\//.test(book.coverUrl) ? book.coverUrl : null;
  return { id, title: book.title, authors, subjects, bookshelves, languages: Array.isArray(book.languages) ? book.languages.map(String) : [], downloadCount: Number(book.downloadCount) || 0, formats, epubUrl, coverUrl, sourceUrl: `https://www.gutenberg.org/ebooks/${id}` };
}
export function adaptGutenbergPage(value: unknown): GutenbergPage {
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).books)) throw new Error('在线书目列表格式无效');
  return { count: Math.max(0, Number((value as any).count) || 0), next: Number.isSafeInteger((value as any).next) ? (value as any).next : null, previous: Number.isSafeInteger((value as any).previous) ? (value as any).previous : null, books: (value as any).books.map(safeBook) };
}
export async function searchGutenberg(input: GutenbergSearch = {}, fetchImpl: typeof fetch = fetch): Promise<GutenbergPage> {
  const url = new URL(ROOT); const page = input.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('页码无效');
  url.searchParams.set('page', String(page));
  if (input.query?.trim()) url.searchParams.set('search', input.query.trim().slice(0, 120));
  if (input.topic) url.searchParams.set('topic', input.topic.slice(0, 80));
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(25000), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`在线书目暂不可用（${response.status}）`);
  const body = await response.json() as any;
  const nextUrl = typeof body.next === 'string' ? new URL(body.next) : null;
  const prevUrl = typeof body.previous === 'string' ? new URL(body.previous) : null;
  if ((nextUrl && nextUrl.origin + nextUrl.pathname !== ROOT) || (prevUrl && prevUrl.origin + prevUrl.pathname !== ROOT)) throw new Error('在线书目分页来源无效');
  return adaptGutenbergPage({ count: body.count, next: nextUrl ? Number(nextUrl.searchParams.get('page')) : null, previous: prevUrl ? Number(prevUrl.searchParams.get('page')) : null, books: body.results?.map((item: any) => ({ id: item.id, title: item.title, authors: item.authors, subjects: item.subjects, bookshelves: item.bookshelves, languages: item.languages, downloadCount: item.download_count, formats: Object.keys(item.formats || {}), epubUrl: Object.entries(item.formats || {}).find(([type, address]) => /epub/i.test(type) && isEpubUrl(address, item.id))?.[1] || null, coverUrl: item.formats?.['image/jpeg'] || null })) });
}
export async function getGutenbergDetail(id: number, fetchImpl: typeof fetch = fetch): Promise<GutenbergBook> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Gutenberg ID 无效');
  const response = await fetchImpl(`${ROOT}${id}`, { signal: AbortSignal.timeout(25000), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`书籍详情暂不可用（${response.status}）`);
  const raw = await response.json() as any;
  if (raw.id !== id) throw new Error('书籍详情 ID 不匹配');
  return safeBook({ id: raw.id, title: raw.title, authors: raw.authors, subjects: raw.subjects, bookshelves: raw.bookshelves, languages: raw.languages, downloadCount: raw.download_count, formats: Object.keys(raw.formats || {}), epubUrl: Object.entries(raw.formats || {}).find(([type, address]) => /epub/i.test(type) && isEpubUrl(address, raw.id))?.[1] || null, coverUrl: raw.formats?.['image/jpeg'] });
}
