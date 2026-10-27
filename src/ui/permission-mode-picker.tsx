import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import './permission-mode-picker.css';

export type PermissionMode = 'supervised' | 'accept-edits' | 'automatic' | 'full-access';
const MODES: ReadonlyArray<{id: PermissionMode; label: string; description: string}> = [
  {id: 'supervised', label: '监管', description: '执行工具操作前先请求许可'},
  // Write tools are temporarily unpublished until directory-race-safe writes are implemented.
  {id: 'automatic', label: '自动', description: '自动允许当前工作区只读工具操作（写入暂不可用）'},
];

export function PermissionModePicker({mode, disabled, onChange}: {mode: PermissionMode; disabled?: boolean; onChange: (mode: PermissionMode) => void}) {
  const trigger = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false); const [geometry, setGeometry] = useState<CSSProperties>({});
  const current = MODES.find(item => item.id === mode) ?? MODES[0]; const menuOpen = open && !disabled;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => { if (!menuOpen) return; const place = () => { const rect = trigger.current?.getBoundingClientRect(); if (!rect) return; const width = Math.min(360, window.innerWidth - 16); setGeometry({left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), bottom: Math.max(8, window.innerHeight - rect.top + 8), width, maxHeight: Math.max(1, Math.min(360, window.innerHeight - 16))}); }; place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true); return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); }; }, [menuOpen]);
  useEffect(() => { if (!menuOpen) return; const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus()); const dismiss = (event: PointerEvent) => { const target = event.target as Node; if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false); }; document.addEventListener('pointerdown', dismiss); return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', dismiss); }; }, [menuOpen]);
  function close() { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) { if (event.key === 'Escape') { event.preventDefault(); close(); return; } const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]; const index = items.indexOf(document.activeElement as HTMLButtonElement); if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return; event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
  return <div className="permission-mode-root"><button ref={trigger} type="button" className="permission-mode-button" aria-label="权限模式" aria-haspopup="menu" aria-expanded={menuOpen} disabled={disabled} onClick={() => setOpen(value => !value)}><span aria-hidden="true">✧</span><span>{current.label}</span><span aria-hidden="true">⌄</span></button>{menuOpen && createPortal(<div ref={panel} className="permission-mode-menu" role="menu" aria-label="权限模式" style={geometry} onKeyDown={onKeyDown}>{MODES.map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === mode} className="permission-mode-option" onClick={() => { onChange(item.id); close(); }}><span className="permission-mode-copy"><strong>{item.label}</strong><small>{item.description}</small></span>{item.id === mode && <span className="permission-mode-check" aria-hidden="true">✓</span>}</button>)}</div>, document.body)}</div>;
}