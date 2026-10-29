import { useEffect, useState } from "react";
import type { BookSummary } from "../shared/book-data-contract";
import { fetchBook, fetchBookLessons } from "./api";
import { buildBookSearchDocuments, searchBookDocuments, type BookSearchDocument } from "./book-library-search-model";
import { isDocumentReadLater, type ReadLaterState } from "./read-later-state";
import type { ReadingEntry } from "./reading-entry";
export function BookLibrarySearch({ books, query, kind, readLaterState, onOpen, onToggle }: {
  books: BookSummary[]; query: string; kind: "all" | "books" | "lessons"; readLaterState: ReadLaterState;
  onOpen: (entry: ReadingEntry) => void; onToggle: (entry: ReadingEntry) => void;
}) {
  const [documents, setDocuments] = useState<BookSearchDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const hasQuery = Boolean(query.trim());
  const bookIds = books.map((book) => book.id).join("|");
  useEffect(() => {
    if (!hasQuery) return;
    let active = true;
    let cursor = 0;
    const found: BookSearchDocument[] = [];
    const failed: string[] = [];
    const ids = books.map((book) => book.id);
    setLoading(true); setFailures([]); setDocuments([]);
    async function work() {
      while (active && cursor < ids.length) {
        const id = ids[cursor++];
        const [book, lessons] = await Promise.allSettled([fetchBook(id), fetchBookLessons(id)]);
        if (!active) return;
        try {
          if (book.status === "fulfilled") found.push(...buildBookSearchDocuments(book.value, lessons.status === "fulfilled" ? lessons.value : []));
          if (book.status === "rejected" || lessons.status === "rejected") failed.push(id);
        } catch { failed.push(id); }
        setDocuments([...found]);
      }
    }
    // Only local content is read, on demand, with at most two books in flight.
    void Promise.all([work(), work()]).then(() => { if (active) { setDocuments(found); setFailures(failed); setLoading(false); } });
    return () => { active = false; };
  }, [hasQuery, bookIds, revision]);
  const results = searchBookDocuments(documents, query, kind);
  if (!hasQuery) return null;
  return <section aria-label="电子书与精选搜索结果" data-testid="book-library-search-results">
    <h2>{kind === "books" ? "电子书章节" : kind === "lessons" ? "精选阅读" : "电子书与精选阅读"} · {results.length} 项匹配</h2>
    {loading && <p role="status">正在搜索本地电子书与精选阅读…</p>}
    {failures.length > 0 && <p role="alert">有 {failures.length} 本书未能完整搜索。<button className="text-button" onClick={() => setRevision((value) => value + 1)}>重试搜索书籍</button></p>}
    {!loading && !failures.length && !results.length && <p className="muted-text">电子书与精选阅读中暂无匹配内容。</p>}
    {results.slice(0, 100).map((item) => <div className="search-result-card" key={item.document.documentId}>
      <button className="search-result-main" onClick={() => onOpen(item)}><div className="search-result-meta">{item.category} · {item.sourceTitle}</div><h2>{item.title}</h2><p>{item.snippet}</p><span className="search-result-open">打开阅读 →</span></button>
      <button className="icon-button search-read-later-button" aria-label={`${isDocumentReadLater(readLaterState, item) ? "移出" : "加入"}稍后阅读：${item.title}`} onClick={() => onToggle(item)}>{isDocumentReadLater(readLaterState, item) ? "★" : "☆"}</button>
    </div>)}
    {results.length > 100 && <p className="muted-text">先显示前 100 项匹配，请缩小关键词范围。</p>}
  </section>;
}
