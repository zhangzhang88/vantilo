import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { compatibleReasoningEffort, nextMenuItemIndex } from '../model/codex-models';
import codexIcon from './vendor-icons/codex.svg';

export type CodexPickerModel = {
  id: string; displayName: string; description: string; isDefault: boolean; defaultEffort: string | null;
  efforts: { id: string; description: string }[];
};
export type CatalogState = 'loading' | 'ready' | 'error';

export function CodexModelPicker({ models, modelId, effort, state, error, disabled, onChange, onRetry }: {
  models: readonly CodexPickerModel[]; modelId: string | null; effort: string | null; state: CatalogState; error?: string | null;
  disabled: boolean; onChange: (modelId: string | null, effort: string | null) => void; onRetry: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState<CSSProperties>({});
  const model = models.find(item => item.id === modelId);
  const defaultModel = models.find(item => item.isDefault);
  const activeModel = modelId === null ? defaultModel : model;
  const unknownModel = state === 'ready' && modelId !== null && !model;
  const label = model?.displayName ?? (modelId ? modelId : '目录默认模型');

  useLayoutEffect(() => {
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not([disabled]), [data-catalog-retry]:not([disabled])')?.focus());
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', dismissOutside); };
  }, [open]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }
  function chooseModel(id: string | null) {
    if (id === null) { onChange(null, null); close(); return; }
    const next = models.find(item => item.id === id);
    if (!next) return;
    onChange(id, compatibleReasoningEffort(next, effort));
    close();
  }
  function chooseEffort(next: string | null) {
    if (modelId !== null && !model) return;
    onChange(modelId, next);
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
    <button ref={trigger} type="button" className="codex-picker-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={`Codex 模型设置：${label}${effort ? ` · ${effort}` : ''}`} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <img className="codex-picker-mark" src={codexIcon} alt="" aria-hidden="true" /><span className="codex-picker-label">Codex · {label}{effort ? ` · ${effort}` : ''}</span><span className="codex-picker-arrow" aria-hidden="true">⌄</span>
    </button>
    {unknownModel && <div className="model-recovery-warning" role="alert">
      <span>历史会话模型“{modelId}”当前不可用。</span>
      <button type="button" disabled={disabled} onClick={() => onChange(null, null)}>恢复目录默认模型</button>
    </div>}
    {open && <div ref={panel} className="codex-picker-menu" role="menu" aria-label="Codex 模型与推理强度" style={geometry} onKeyDown={navigateMenu}>
      <div className="picker-section-label">模型目录</div>
      {state === 'loading' && <div className="picker-message" role="status">正在加载 Codex 模型目录…</div>}
      {state === 'error' && <div className="picker-message picker-error" role="alert"><span>加载模型目录失败：{error || '未知错误'}</span><button data-catalog-retry type="button" onClick={onRetry}>重试</button></div>}
      {state === 'ready' && models.length === 0 && <div className="picker-message" role="status">Codex 当前未提供可用模型。</div>}
      <button type="button" role="menuitemradio" aria-checked={modelId === null} className="picker-option" onClick={() => chooseModel(null)}>
        <span><strong>模型目录默认</strong><small>使用 Codex 实时模型目录标记的默认模型</small></span>{modelId === null && <span className="picker-check" aria-hidden="true">✓</span>}
      </button>
      {models.map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={modelId === item.id} className="picker-option" onClick={() => chooseModel(item.id)}>
        <span><strong>{item.displayName}{item.isDefault ? ' · 默认' : ''}</strong><small>{item.description}</small></span>{modelId === item.id && <span className="picker-check" aria-hidden="true">✓</span>}
      </button>)}
      {activeModel && activeModel.efforts.length > 0 && <>
        <div className="picker-section-label picker-effort-heading">推理强度 · {modelId === null ? '目录默认模型' : activeModel.displayName}</div>
        <button type="button" role="menuitemradio" aria-checked={effort === null} className="picker-option" disabled={!activeModel.defaultEffort} onClick={() => chooseEffort(null)}>
          <span><strong>模型目录默认强度</strong><small>{activeModel.defaultEffort ? `模型目录提供的默认推理强度：${activeModel.defaultEffort}` : '目录未提供可用默认强度；请选择明确强度'}</small></span>{effort === null && <span className="picker-check" aria-hidden="true">✓</span>}
        </button>
        {activeModel.efforts.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={effort === option.id} className="picker-option" onClick={() => chooseEffort(option.id)}>
          <span><strong>{option.id}</strong><small>{option.description}</small></span>{effort === option.id && <span className="picker-check" aria-hidden="true">✓</span>}
        </button>)}
      </>}
    </div>}
  </div>;
}
