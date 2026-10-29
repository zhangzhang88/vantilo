import React, { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReadingDocumentVisual } from "../shared/book-data-contract";
import type { ReadingDocumentIdentity } from "../shared/reading-document-identity";
import { bookResourceUrl, bookSourceUrl } from "../shared/book-source-links";

function OriginalDialog({ bookId, chapterId, fragment, enlarge, close }: { bookId: string; chapterId: string; fragment: string; enlarge: boolean; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(enlarge ? 1.5 : 1);
  const scale = () => {
    const document = iframe.current?.contentDocument;
    if (document?.documentElement) {
      document.documentElement.style.zoom = String(zoom);
      if (fragment) document.getElementById(fragment)?.scrollIntoView({ block: "start" });
    }
  };
  useEffect(scale, [zoom]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    const element = dialog.current;
    element?.showModal(); document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = overflow; };
  }, []);
  return <dialog className="book-original-dialog" ref={dialog} aria-label="原书内容" onCancel={close}>
    <header><div><strong>原书内容</strong><small>保留原文图表与排版</small></div>
      <label>缩放 <select aria-label="原书缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[.75,1,1.25,1.5,2].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label>
      <a href={`/api/books/${encodeURIComponent(bookId)}/original-file`} download>下载原 EPUB</a>
      <button type="button" aria-label="关闭原书内容" onClick={close}>×</button>
    </header>
    {loading && <p className="book-original-status" role="status">正在打开原书…</p>}
    {failed ? <p className="book-original-status" role="alert">原书内容暂时无法打开，可以下载原 EPUB 查看。</p>
      : <iframe ref={iframe} title="原书章节" src={bookSourceUrl(bookId, chapterId, fragment)} sandbox="allow-same-origin" referrerPolicy="no-referrer"
          onError={() => { setFailed(true); setLoading(false); }} onLoad={event => {
            setLoading(false);
            const document = event.currentTarget.contentDocument;
            if (document && document.contentType !== "text/html") setFailed(true);
            else scale();
          }} />}
  </dialog>;
}

export function BookSourceButton({ identity, fragment = "", children, className = "", enlarge = false }: { identity: ReadingDocumentIdentity; fragment?: string; children?: ReactNode; className?: string; enlarge?: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => opener.current?.focus({ preventScroll: true })); };
  if (identity.kind !== "book-chapter") return null;
  return <><button ref={opener} type="button" className={className} title="查看原书内容，保留原文图表与排版" aria-label={typeof children === "string" ? children : "查看原书内容"} onClick={() => setOpen(true)}>{children ?? <>▧<span>原书</span></>}</button>
    {open && <OriginalDialog key={`${identity.documentId}:${fragment}`} bookId={identity.bookId} chapterId={identity.chapterId} fragment={fragment} enlarge={enlarge} close={close} />}</>;
}

export function BookVisual({ visual, identity, renderCaption }: { visual: ReadingDocumentVisual; identity: ReadingDocumentIdentity; renderCaption: (index: number) => ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (identity.kind !== "book-chapter") return null;
  const fallback = visual.kind === "original" || failed;
  const caption = (visual.captionText || visual.captionParagraphIndexes.length > 0) ? <figcaption lang="en">
    {visual.captionParagraphIndexes.map(index => <React.Fragment key={index}>{renderCaption(index)}</React.Fragment>)}
    {visual.captionText && <p>{visual.captionText}</p>}
  </figcaption> : null;
  return <figure className={`book-visual ${fallback ? "book-visual-original" : ""}`} data-book-visual={visual.id}>
    {visual.coveredParagraphIndexes.filter(index => !visual.captionParagraphIndexes.includes(index)).map(index => <span key={index} className="reading-paragraph-block book-visual-anchor" data-paragraph-index={index} aria-hidden="true" />)}
    {visual.captionPlacement === "before" && caption}
    {fallback ? <div className="book-visual-fallback"><span>{visual.reason === "unavailable-image" || failed ? "原书图片暂无法显示" : visual.reason === "formula" ? "原书公式" : "原书图形与排版"}</span>
      <BookSourceButton identity={identity} fragment={visual.originalFragment}>查看原书内容</BookSourceButton></div>
      : visual.images.map((image, index) => <div className="book-visual-image" key={index}>
          <img src={bookResourceUrl(identity.bookId, image.entryPath)} alt={image.alt} loading="lazy" onError={() => setFailed(true)} />
          <BookSourceButton identity={identity} fragment={visual.originalFragment} enlarge className="book-visual-enlarge">放大查看原图</BookSourceButton>
        </div>)}
    {visual.captionPlacement !== "before" && caption}
  </figure>;
}
