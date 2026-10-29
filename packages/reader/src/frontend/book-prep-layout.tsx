import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const STORAGE_KEY = "magazine-reader:book-prep-split:v1";
const DEFAULT_SHARE = 0.42;
const HANDLE_WIDTH = 14;
const MIN_LEFT = 320;
const MIN_PREP = 325;

function loadShare(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const value = saved === null ? NaN : Number(saved);
    if (Number.isFinite(value) && value > 0 && value < 1) return value;
  } catch { /* Layout still works when browser storage is unavailable. */ }
  return DEFAULT_SHARE;
}

export function BookPrepLayout({ children, prep, global = false, reader = false }: { children: ReactNode; prep?: ReactNode; global?: boolean; reader?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(loadShare);
  const latestShare = useRef(share);
  const pointer = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const available = Math.max(width - HANDLE_WIDTH, MIN_LEFT + MIN_PREP);
  const minimum = MIN_PREP / available;
  const maximum = 1 - MIN_LEFT / available;
  const effectiveShare = Math.min(maximum, Math.max(minimum, share));
  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, String(latestShare.current)); } catch { /* Optional preference. */ }
  };
  const update = (value: number) => {
    const next = Math.min(maximum, Math.max(minimum, value));
    latestShare.current = next;
    setShare(next);
  };
  const endDrag = () => {
    if (pointer.current === null) return;
    pointer.current = null;
    setDragging(false);
    save();
  };

  return (
    <div ref={container} data-testid="book-prep-layout"
      className={`book-prep-layout${prep ? "" : " book-prep-layout--single"}${global ? " global-assistant-layout" : ""}${reader ? " is-reader-workspace" : ""}${dragging ? " is-resizing" : ""}`}
      style={{ "--prep-share": effectiveShare } as CSSProperties}>
      {children}
      {prep && <>
        <div className="book-prep-divider" role="separator" tabIndex={0}
          aria-label="调整 Codex 备课宽度" aria-orientation="vertical" aria-controls="book-prep-region"
          aria-valuemin={Math.round(minimum * 100)} aria-valuemax={Math.round(maximum * 100)}
          aria-valuenow={Math.round(effectiveShare * 100)} aria-valuetext={`Codex 备课占 ${Math.round(effectiveShare * 100)}%`}
          title="左右拖动调整宽度，双击恢复默认；也可使用左右方向键"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            pointer.current = event.pointerId;
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (pointer.current !== event.pointerId || !container.current) return;
            const rect = container.current.getBoundingClientRect();
            update((rect.right - event.clientX - HANDLE_WIDTH / 2) / (rect.width - HANDLE_WIDTH));
          }}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
          onDoubleClick={() => { update(DEFAULT_SHARE); save(); }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.025;
            const next = event.key === "ArrowLeft" ? effectiveShare + step
              : event.key === "ArrowRight" ? effectiveShare - step
              : event.key === "Home" ? minimum : event.key === "End" ? maximum : null;
            if (next === null) return;
            event.preventDefault(); update(next); save();
          }}><span aria-hidden="true" /></div>
        <div id="book-prep-region" className="book-prep-region">{prep}</div>
      </>}
    </div>
  );
}
