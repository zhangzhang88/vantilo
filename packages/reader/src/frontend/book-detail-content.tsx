import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { loadBookDetailTab, saveBookDetailTab, type BookDetailTab } from "./navigation-state";
import type { ReaderDocumentView } from "./reading-document-view";

export function BookDetailTabs({ bookId, lessonCount, lessonsLoading, lessons, children }: {
  bookId: string; lessonCount: number; lessonsLoading: boolean; lessons: ReactNode; children: ReactNode;
}) {
  const id = useId();
  const [choice, setChoice] = useState(() => loadBookDetailTab(bookId));
  const selected = choice ?? (!lessonsLoading && lessonCount > 0 ? "lessons" : "chapters");
  const tabs: BookDetailTab[] = ["lessons", "chapters"];
  const activate = (tab: BookDetailTab) => { setChoice(tab); saveBookDetailTab(bookId, tab); };
  return <section className="book-detail-content">
    <div className="book-detail-tabs" role="tablist" aria-label="书籍内容">
      {tabs.map(tab => <button key={tab} type="button" role="tab" id={`${id}-${tab}-tab`} aria-controls={`${id}-${tab}-panel`}
        aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1}
        onClick={() => activate(tab)} onKeyDown={event => {
          const next = event.key === "Home" ? "lessons" : event.key === "End" ? "chapters"
            : ["ArrowLeft", "ArrowRight"].includes(event.key) ? tabs[(tabs.indexOf(tab) + 1) % 2] : undefined;
          if (!next) return;
          event.preventDefault(); activate(next); document.getElementById(`${id}-${next}-tab`)?.focus();
        }}>{tab === "lessons" ? <>精选阅读 <span>{lessonCount}</span></> : "原书目录"}</button>)}
    </div>
    {tabs.map(tab => <div key={tab} role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} hidden={selected !== tab} tabIndex={0}>
      {selected === tab ? tab === "lessons" ? lessons : children : null}
    </div>)}
  </section>;
}

function LessonActions({ title, onDelete }: { title: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    action.current?.focus();
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return <div className="book-lesson-actions" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button className="book-lesson-more" ref={trigger} aria-label={`更多操作：${title}`} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(current => !current)}>⋯</button>
    {open && <div className="book-lesson-menu" id={id}>
      <button className="book-lesson-delete" ref={action} aria-label={`删除精选阅读：${title}`} onClick={() => {
        setOpen(false); trigger.current?.focus(); onDelete();
      }}>删除文章</button>
    </div>}
  </div>;
}

export function BookLessonsList({ documents, loading, error, onRetry, onOpen, onDelete, newLessonId, onHighlightShown }: {
  documents: ReaderDocumentView[]; loading: boolean; error: string; onRetry: () => void;
  onOpen: (id: string) => void; onDelete: (id: string) => void; newLessonId?: string; onHighlightShown: () => void;
}) {
  const [highlighted, setHighlighted] = useState(newLessonId);
  useEffect(() => {
    if (!newLessonId) return;
    setHighlighted(newLessonId); onHighlightShown();
  }, [newLessonId, onHighlightShown]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => setHighlighted(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [highlighted]);
  return <section className="book-lessons-content" data-testid="book-lessons-section" aria-label="精选阅读">
    {loading ? <p className="book-lessons-message" role="status">正在加载精选阅读…</p> : error ? <div className="book-lessons-message" role="alert"><p>{error}</p><button className="text-button" onClick={onRetry}>重新加载精选阅读</button></div>
      : !documents.length ? <p className="book-lessons-message muted-text">还没有精选阅读。与 Codex 讨论选题，确认保存后会出现在这里。</p>
      : <div className="book-lessons-list">{documents.map(item => <div className={`book-lesson-row${highlighted === item.id ? " is-new" : ""}`} key={item.id}>
        <button className="book-lesson-card" data-testid={`book-lesson-${item.id}`} onClick={() => onOpen(item.id)}>
          <h3>{item.title}</h3><p>{item.summaryZh}</p>
          <div className="book-lesson-meta"><span>{item.wordCount} 词</span><span aria-hidden="true">·</span><span>{item.progress >= 100 ? "已读完" : item.progress > 0 ? `已读 ${item.progress}%` : "未读"}</span>{highlighted === item.id && <span className="book-lesson-new">刚保存</span>}</div>
        </button>
        <LessonActions title={item.title} onDelete={() => onDelete(item.id)} />
      </div>)}</div>}
  </section>;
}
