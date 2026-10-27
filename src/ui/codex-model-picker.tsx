import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { compatibleReasoningEffort, nextMenuItemIndex } from '../model/codex-models';
import './codex-model-picker.css';
import { createPortal } from 'react-dom';
import codexIcon from './vendor-icons/codex.svg';

export type CodexPickerModel = {
  id: string; displayName: string; description: string; isDefault: boolean; defaultEffort: string | null;
  efforts: { id: string; description: string }[];
};
export type CatalogState = 'loading' | 'ready' | 'error';

export function CodexModelPicker({ models, modelId, effort, state, error, disabled, onChange, onRetry, active = true }: {
  models: readonly CodexPickerModel[]; modelId: string | null; effort: string | null; state: CatalogState; error?: string | null;
  disabled: boolean; active?: boolean; onChange: (modelId: string | null, effort: string | null) => void; onRetry: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState<CSSProperties>({});
  const model = models.find(item => item.id === modelId);
  const defaults = models.filter(item => item.isDefault);
  const defaultModel = defaults.length === 1 ? defaults[0] : undefined;
  const activeModel = modelId === null ? defaultModel : model;
  const unknownModel = state === 'ready' && modelId !== null && !model;
  const label = activeModel?.displayName ?? (modelId || (state === 'loading' ? '正在加载模型' : '请选择模型'));
  const concreteEffort = effort ?? (activeModel?.efforts.some(option=>option.id===activeModel.defaultEffort) ? activeModel.defaultEffort : null);
  const effortLabel = concreteEffort || (activeModel ? activeModel.efforts.length ? '请选择思考强度' : '无需思考强度' : '');

  const menuOpen = open && active && !disabled;
  useEffect(() => { if (!active || disabled) setOpen(false); }, [active, disabled]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(1, Math.min(360, window.innerWidth - 16));
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setGeometry({ left, bottom: Math.max(8, window.innerHeight - rect.top + 8), width, maxHeight: Math.max(1, Math.min(560, window.innerHeight - 16)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not([disabled]), [data-catalog-retry]:not([disabled])')?.focus());
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', dismissOutside); };
  }, [menuOpen]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }
  function chooseModel(id: string | null) {
    const next = models.find(item => item.id === id);
    if (!next) return;
    onChange(id, compatibleReasoningEffort(next, concreteEffort) ?? (next.efforts.some(option=>option.id===next.defaultEffort) ? next.defaultEffort : null));
    close();
  }
  function chooseEffort(next: string | null) {
    if (!activeModel) return;
    onChange(activeModel.id, next);
    close();
  }
  function navigateMenu(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([disabled]), [data-catalog-retry]:not([disabled])') ?? [])];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextMenuItemIndex(event.key, current, items.length);
    if (next === null) return;
    event.preventDefault(); items[next]?.focus();
  }

  return <div className="codex-picker-root">
    <button ref={trigger} type="button" className="codex-picker-trigger" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Codex 模型设置：${label}${effortLabel ? ` · ${effortLabel}` : ''}`} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <img className="codex-picker-mark" src={codexIcon} alt="" aria-hidden="true" /><span className="codex-picker-label">Codex · {label}{effortLabel ? ` · ${effortLabel}` : ''}</span><span className="codex-picker-arrow" aria-hidden="true">⌄</span>
    </button>
    {unknownModel && <div className="model-recovery-warning" role="alert">
      <span>历史会话模型“{modelId}”当前不可用。</span>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}>选择可用模型</button>
    </div>}
    {menuOpen && createPortal(<div ref={panel} className="codex-picker-menu" role="menu" aria-label="Codex 模型与推理强度" style={geometry} onKeyDown={navigateMenu}>
      <div className="picker-section-label">模型目录</div>
      {state === 'loading' && <div className="picker-message" role="status">正在加载 Codex 模型目录…</div>}
      {state === 'error' && <div className="picker-message picker-error" role="alert"><span>加载模型目录失败：{error || '未知错误'}</span><button data-catalog-retry type="button" onClick={onRetry}>重试</button></div>}
      {state === 'ready' && models.length === 0 && <div className="picker-message" role="status">Codex 当前未提供可用模型。</div>}
      {models.map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={activeModel?.id === item.id} className="picker-option" onClick={() => chooseModel(item.id)}>
        <span><strong>{item.displayName}</strong><small>{item.description}</small></span>{activeModel?.id === item.id && <span className="picker-check" aria-hidden="true">✓</span>}
      </button>)}
      {activeModel && activeModel.efforts.length > 0 && <>
        <div className="picker-section-label picker-effort-heading">推理强度 · {activeModel.displayName}</div>
        {activeModel.efforts.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={concreteEffort === option.id} className="picker-option" onClick={() => chooseEffort(option.id)}>
          <span><strong>{option.id}</strong><small>{option.description}</small></span>{concreteEffort === option.id && <span className="picker-check" aria-hidden="true">✓</span>}
        </button>)}
      </>}
    </div>, document.body)}
  </div>;
}
