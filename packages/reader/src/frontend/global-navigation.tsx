import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Page } from "./navigation-state";

export interface NavigationItem { id: Page | "recent"; label: string; icon: string; count?: number; }
const primaryIds = ["library", "books", "articles", "vocabulary", "review"];
const secondaryIds = ["recent", "history", "bookmarks", "notes"];

function NavIcon({ name }: { name: "search" | "settings" | "more" | "menu" }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "search" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : name === "settings" ? <><path d="m10 3-.6 2.2-2 .9-2-.7-2 3.4 1.6 1.6v2.3L3.4 15l2 3.4 2-.7 2 .9.6 2.4h4l.6-2.4 2-.9 2 .7 2-3.4-1.6-2.3v-2.3L20.6 9l-2-3.4-2 .7-2-.9L14 3Z" /><circle cx="12" cy="12" r="3" /></> : name === "menu" ? <path d="M4 6h16M4 12h16M4 18h16" /> : <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>}
  </svg>;
}

export function GlobalNavigation({ items, page, loading, onNavigate, compact = false, assistantOpen, onToggleAssistant }: {
  items: NavigationItem[]; page: Page; loading: boolean; onNavigate: (id: Page | "recent") => void; compact?: boolean;
  assistantOpen?: boolean; onToggleAssistant?: () => void;
}) {
  const [menu, setMenu] = useState<"all" | "more" | null>(null);
  const [position, setPosition] = useState({ top: 50, right: 12 });
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const active = (id: NavigationItem["id"]) => id === "library" ? ["library", "publication", "issue"].includes(page)
    : id === "books" ? ["books", "book", "book-reader", "lesson-reader"].includes(page) : id === page;
  const navigate = (id: NavigationItem["id"]) => { setMenu(null); onNavigate(id); };
  const toggle = (kind: "all" | "more", button: HTMLButtonElement) => { trigger.current = button; setMenu(current => current === kind ? null : kind); };
  const positionPopup = () => {
    if (!trigger.current?.isConnected) return;
    const box = trigger.current.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= innerHeight) { setMenu(null); return; }
    const width = popup.current?.getBoundingClientRect().width ?? 248;
    const top = box.bottom + 8, right = Math.max(12, Math.min(innerWidth - box.right, innerWidth - width - 12));
    setPosition(current => current.top === top && current.right === right ? current : { top, right });
  };
  useLayoutEffect(() => {
    if (!menu) return;
    positionPopup();
  }, [menu]);
  useEffect(() => { setMenu(null); }, [page]);
  useEffect(() => {
    const breakpoint = matchMedia("(max-width: 640px)");
    const close = () => setMenu(null);
    breakpoint.addEventListener("change", close);
    return () => breakpoint.removeEventListener("change", close);
  }, []);
  useEffect(() => {
    if (!menu) return;
    popup.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setMenu(null); };
    let frame = 0;
    const scroll = (event: Event) => {
      if (popup.current?.contains(event.target as Node)) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(positionPopup);
    };
    const resize = () => setMenu(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenu(null); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", scroll, true); window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", resize); };
  }, [menu]);
  const renderItem = (item: NavigationItem, inMenu = false) => <button key={item.id} className={`global-nav-link${active(item.id) ? " is-active" : ""}`}
    aria-label={item.label} aria-current={active(item.id) ? "page" : undefined} disabled={item.id === "recent" && loading} onClick={() => navigate(item.id)}>
    {inMenu && <span className="global-nav-item-icon" aria-hidden="true">{item.icon}</span>}<span>{item.label}</span>
    {typeof item.count === "number" && item.count > 0 && (inMenu || item.id === "review") && <span className="global-nav-count">{item.count}</span>}
  </button>;
  const menuItems = items.filter(item => menu === "all" || secondaryIds.includes(item.id));
  return <header className={compact ? "reader-global-navigation reader-focus-hidden" : "global-header"}>
    <nav ref={root} className={`global-navigation${compact ? " is-compact" : ""}`} aria-label="主导航" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) setMenu(null);
    }}>
      {!compact && <>
        <button className="global-nav-logo" aria-label="Magazine Reader 首页" title="Magazine Reader" onClick={() => navigate("library")}>ER</button>
        <div className="global-nav-primary">{items.filter(item => primaryIds.includes(item.id)).map(item => renderItem(item))}</div>
        <div className="global-nav-utilities">
          <button className={`global-nav-icon${page === "search" ? " is-active" : ""}`} aria-label="搜索" title="搜索" onClick={() => navigate("search")}><NavIcon name="search" /></button>
          <button className={`global-nav-icon${items.some(item => secondaryIds.includes(item.id) && active(item.id)) ? " is-active" : ""}`} aria-label="更多导航" title="更多" aria-expanded={menu === "more"} aria-controls={menu === "more" ? popupId : undefined} onClick={event => toggle("more", event.currentTarget)}><NavIcon name="more" /></button>
          <button className={`global-nav-icon${page === "settings" ? " is-active" : ""}`} aria-label="设置" title="设置" onClick={() => navigate("settings")}><NavIcon name="settings" /></button>
        </div>
      </>}
      {onToggleAssistant && <button className={`global-nav-icon global-nav-assistant${assistantOpen ? " is-active" : ""}`} aria-label="Codex 助手" title={assistantOpen ? "收起 Codex 助手" : "打开 Codex 助手"} aria-pressed={assistantOpen} onClick={onToggleAssistant}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="m9 9-2 2 2 2m6-4 2 2-2 2"/></svg></button>}
      <button className="global-nav-icon global-nav-mobile" aria-label="主菜单" title="主菜单" aria-expanded={menu === "all"} aria-controls={menu === "all" ? popupId : undefined} onClick={event => toggle("all", event.currentTarget)}><NavIcon name="menu" /></button>
      {menu && createPortal(<div className="global-nav-popup" id={popupId} ref={popup} style={{ top: position.top, right: position.right, maxHeight: `calc(100dvh - ${position.top + 12}px)` }} aria-label={menu === "all" ? "所有导航入口" : "更多导航入口"} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget) && !root.current?.contains(event.relatedTarget)) setMenu(null);
      }} onKeyDown={event => {
        event.stopPropagation();
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault(); buttons[next]?.focus();
      }}>{menuItems.map(item => renderItem(item, true))}</div>, document.body)}
    </nav>
  </header>;
}
