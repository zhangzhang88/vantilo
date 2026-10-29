import { useState, type ReactNode } from "react";
import type { ReadingEntryView } from "./global-reading";
import type { ReadingEntry } from "./reading-entry";
export function GlobalReadingList({ items, onOpen, onRemove, empty, history = false }: {
  items: Array<ReadingEntryView & { timestamp?: string }>;
  onOpen: (entry: ReadingEntry) => void;
  onRemove?: (entry: ReadingEntry) => void;
  empty: string;
  history?: boolean;
}) {
  const [filter, setFilter] = useState("全部");
  const visible = items.filter((item) => filter === "全部" || item.category === filter);
  return <>
    <div className="library-publication-tabs" aria-label="按内容类型筛选">{["全部", "期刊", "电子书", "精选阅读"].map((category) => <button key={category} aria-label={`筛选${category}内容`} aria-pressed={filter === category} className={filter === category ? "is-active" : ""} onClick={() => setFilter(category)}>{category}</button>)}</div>
    <div className="saved-list" data-testid={history ? "reading-history-list" : "global-read-later-list"}>
      {visible.length ? visible.map((item) => <div className={`saved-row ${history ? "history-row" : ""}`} key={item.key} data-document-id={item.key} data-last-opened-at={history ? item.timestamp : undefined}>
        <button className="saved-row-main" disabled={!item.available} onClick={() => onOpen(item.entry)}>
          <span className="saved-symbol">{history ? "◴" : "★"}</span>
          <span className="saved-copy"><strong>{item.title}</strong>{item.titleZh && <span>{item.titleZh}</span>}<small>{item.category} · {item.source}</small>
            <span className="saved-progress">阅读进度 {item.progress}%{item.timestamp ? ` · 最近打开 ${new Date(item.timestamp).toLocaleString()}` : ""}{!item.available ? " · 来源暂不可用，学习记录已保留" : ""}</span>
          </span><span>→</span>
        </button>
        {onRemove && <button className="icon-button saved-remove-button" aria-label={`移出稍后阅读：${item.title}`} onClick={() => onRemove(item.entry)}>×</button>}
      </div>) : <div className="empty-panel">{empty}</div>}
    </div>
  </>;
}
export function GlobalContinueCard({ item, onOpen, cover }: { item: ReadingEntryView; onOpen: (entry: ReadingEntry) => void; cover?: ReactNode }) {
  return <section className="continue-card" data-testid="continue-reading" data-document-id={item.key}>
    {cover}<div className="continue-copy"><div className="eyebrow">继续阅读 · {item.category === "期刊" ? item.source.split(" · ")[0] : item.category}</div><h2>{item.title}</h2>{item.titleZh && <div className="continue-title-zh">{item.titleZh}</div>}
      <p>{item.source}</p><div className="continue-progress"><div className="progress-track" aria-label={`阅读进度 ${item.progress}%`}><span style={{ width: `${item.progress}%` }} /></div><span>{item.progress}%</span></div>
      {!item.available && <p>来源暂不可用，阅读进度和学习记录已保留。</p>}
      <button className="primary-button" disabled={!item.available} onClick={() => onOpen(item.entry)}>继续阅读 →</button>
    </div>
  </section>;
}
