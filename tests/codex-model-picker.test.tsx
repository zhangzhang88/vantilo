// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { CodexModelPicker, type CodexPickerModel, type CatalogState } from '../src/ui/codex-model-picker';

const models: CodexPickerModel[] = [
  { id: 'model-a', displayName: 'Model A', description: 'Primary', isDefault: true, defaultEffort: 'low', efforts: [{ id: 'low', description: 'Quick' }, { id: 'high', description: 'Deep' }] },
  { id: 'model-b', displayName: 'Model B', description: 'Secondary', isDefault: false, defaultEffort: null, efforts: [{ id: 'low', description: 'Quick' }] },
];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ControlledPicker({ initialModel = null, initialEffort = null, catalogState = 'ready' as CatalogState, catalog = models, error = null, onRetry = vi.fn(), onChangeSpy = vi.fn() }: {
  initialModel?: string | null; initialEffort?: string | null; catalogState?: CatalogState; catalog?: CodexPickerModel[]; error?: string | null; onRetry?: () => void; onChangeSpy?: (id: string | null, effort: string | null) => void;
}) {
  const [modelId, setModelId] = useState(initialModel); const [effort, setEffort] = useState(initialEffort);
  return <CodexModelPicker models={catalog} modelId={modelId} effort={effort} state={catalogState} error={error} disabled={false} onRetry={onRetry}
    onChange={(id, nextEffort) => { onChangeSpy(id, nextEffort); setModelId(id); setEffort(nextEffort); }} />;
}

function openPicker() { fireEvent.click(screen.getByRole('button', { name: /Codex 模型设置/ })); return screen.getByRole('menu', { name: 'Codex 模型与推理强度' }); }

describe('Codex model picker UI', () => {
  it('shows loading, successful options, and an explicit empty catalog state', () => {
    const view = render(<ControlledPicker catalogState="loading" />); openPicker(); expect(screen.getByRole('status').textContent).toContain('正在加载');
    view.rerender(<ControlledPicker catalogState="ready" />); expect(screen.getByRole('menuitemradio', { name: /Model A/ })).not.toBeNull();
    view.rerender(<ControlledPicker catalogState="ready" catalog={[]} />); expect(screen.getByRole('status').textContent).toContain('未提供可用模型');
  });

  it('shows the failure reason and retries the catalog request', () => {
    const retry = vi.fn(); render(<ControlledPicker catalogState="error" error="连接超时" onRetry={retry} />); openPicker();
    expect(screen.getByRole('alert').textContent).toContain('连接超时'); fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
  });

  it('updates selected model and retains effort only when supported', () => {
    const onChange = vi.fn(); render(<ControlledPicker initialModel="model-a" initialEffort="high" onChangeSpy={onChange} />); openPicker();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Model B/ }));
    expect(onChange).toHaveBeenLastCalledWith('model-b', null);
    expect(screen.getByRole('button', { name: /Codex 模型设置：Model B/ }).getAttribute('aria-expanded')).toBe('false');
    openPicker(); expect(screen.getByRole('menuitemradio', { name: /Model B/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows concrete resolved values without default choices and persists explicit model/effort on selection',()=>{
    const onChange=vi.fn();render(<ControlledPicker onChangeSpy={onChange}/>);
    expect(screen.getByRole('button',{name:'Codex 模型设置：Model A · low'})).toBeTruthy();openPicker();
    expect(screen.queryByText('模型目录默认')).toBeNull();expect(screen.queryByText('模型目录默认强度')).toBeNull();
    expect(screen.getByRole('menuitemradio',{name:/Model A/}).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio',{name:/highDeep/}));expect(onChange).toHaveBeenLastCalledWith('model-a','high');
  });
  it('selects the named concrete model and its supported catalog effort when old effort is incompatible',()=>{
    const onChange=vi.fn();const catalog=[models[0]!,{...models[1]!,defaultEffort:'low'}];
    render(<ControlledPicker initialModel="model-a" initialEffort="high" catalog={catalog} onChangeSpy={onChange}/>);openPicker();
    fireEvent.click(screen.getByRole('menuitemradio',{name:/Model B/}));expect(onChange).toHaveBeenLastCalledWith('model-b','low');
    expect(screen.getByRole('button',{name:'Codex 模型设置：Model B · low'})).toBeTruthy();
  });
  it('asks for an explicit effort when the catalog does not declare one, without guessing',()=>{
    render(<ControlledPicker catalog={[{...models[0]!,defaultEffort:null}]}/>);openPicker();
    expect(screen.getByRole('button',{name:'Codex 模型设置：Model A · 请选择思考强度'})).toBeTruthy();
    expect(screen.queryByText('模型目录默认强度')).toBeNull();
    expect(screen.getByRole('menuitemradio',{name:/lowQuick/})).toBeTruthy();
  });
  it('keeps an unavailable historical model and offers actual choices without a silent reset',()=>{
    const onChange=vi.fn();render(<ControlledPicker initialModel="retired-model" initialEffort="high" onChangeSpy={onChange}/>);
    fireEvent.click(screen.getByRole('button',{name:'选择可用模型'}));expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitemradio',{name:/Model A/}));expect(onChange).toHaveBeenCalledWith('model-a','high');
  });

  it('isolates selections between separate conversation picker instances', () => {
    const { container } = render(<div><ControlledPicker initialModel="model-a" /><ControlledPicker initialModel={null} /></div>);
    const triggers = container.querySelectorAll<HTMLButtonElement>('.codex-picker-trigger');
    fireEvent.click(triggers[0]!); fireEvent.click(screen.getByRole('menuitemradio', { name: /Model B/ }));
    expect(triggers[0]?.getAttribute('aria-label')).toContain('Model B'); expect(triggers[1]?.getAttribute('aria-label')).toContain('Model A · low');
  });

  it('supports arrow/Home/End/Escape navigation, outside dismissal, and viewport-constrained placement', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 260 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 240, y: 50, top: 50, left: 240, right: 310, bottom: 80, width: 70, height: 30, toJSON: () => ({}) } as DOMRect);
    render(<ControlledPicker />); const menu = openPicker();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Model A/ })))
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Model B/ }));
    fireEvent.keyDown(menu, { key: 'End' }); expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /highDeep/ }));
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width)).toBeLessThanOrEqual(312);
    expect(Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(244);
    fireEvent.keyDown(menu, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull();
    openPicker(); fireEvent.pointerDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  });
});

it('removes the portal when its owner becomes inactive or disabled without focusing a hidden trigger',()=>{
  const props={models,modelId:'model-a',effort:'high',state:'ready' as const,disabled:false,onChange:vi.fn(),onRetry:vi.fn()};
  const view=render(<CodexModelPicker {...props}/>);openPicker();
  view.rerender(<CodexModelPicker {...props} active={false}/>);expect(screen.queryByRole('menu')).toBeNull();
  view.rerender(<CodexModelPicker {...props} active/>);expect(screen.queryByRole('menu')).toBeNull();
  openPicker();view.rerender(<CodexModelPicker {...props} disabled/>);expect(screen.queryByRole('menu')).toBeNull();
  view.rerender(<CodexModelPicker {...props}/>);expect(screen.queryByRole('menu')).toBeNull();
});
