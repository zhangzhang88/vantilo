import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import { resolveBrowserAddress } from '../model/browser-address';
import type { BrowserTabInfo } from './workspace-tabs';

export function IsolatedBrowserSurface({ tab, onNavigate, onBack, onForward, onReload, onBounds, onVisible }: {
  tab: BrowserTabInfo; onNavigate: (url: string) => Promise<{ ok: boolean; reason?: string }>;
  onBack: () => void; onForward: () => void; onReload: () => void;
  onBounds: (bounds: { x: number; y: number; width: number; height: number }) => void; onVisible: (visible: boolean) => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  const addressField = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(tab.url);
  const [inputError, setInputError] = useState('');
  useLayoutEffect(() => setAddress(tab.url), [tab.url]);
  useLayoutEffect(() => {
    const target = view.current;
    if (!target) return;
    const sync = () => { const rect = target.getBoundingClientRect(); onBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }); onVisible(Boolean(tab.url && !tab.error)); };
    sync(); const observer = new ResizeObserver(sync); observer.observe(target); window.addEventListener('resize', sync);
    return () => { observer.disconnect(); window.removeEventListener('resize', sync); onVisible(false); };
  }, [tab.id, tab.url, tab.error, onBounds, onVisible]);
  async function submit(event: FormEvent) {
    event.preventDefault(); const destination = resolveBrowserAddress(address);
    if (!destination) { setInputError('请输入有效网址或搜索内容。'); return; }
    setInputError(''); const result = await onNavigate(destination);
    if (!result.ok) setInputError(explainBlock(result.reason));
  }
  const problem = tab.error?.kind === 'blocked' ? explainBlock(tab.error.reason)
    : tab.error?.kind === 'failed' ? `${tab.error.description} (${tab.error.code})`
      : tab.error?.kind === 'crashed' ? '网页意外停止，请重新加载。' : inputError;
  return <section className="browser-workspace" aria-label="独立浏览器">
    <form className="browser-toolbar" onSubmit={submit}>
      <button type="button" className="browser-icon-button" aria-label="后退" disabled={!tab.canGoBack} onClick={onBack}>‹</button>
      <button type="button" className="browser-icon-button" aria-label="前进" disabled={!tab.canGoForward} onClick={onForward}>›</button>
      <button type="button" className="browser-icon-button" aria-label="重新加载" onClick={onReload}>{tab.loading ? '↻' : '⟳'}</button>
      <input ref={addressField} className="browser-address" aria-label="网页地址" placeholder="搜索或输入网址" value={address} onChange={event => setAddress(event.target.value)} />
      <button type="submit" className="browser-go">前往</button>
    </form>
    {tab.loading && <div className="browser-loading" role="status">正在加载网页…</div>}
    <div ref={view} className="browser-viewport">
      {!tab.url ? <div className="browser-start"><div className="browser-start-intro"><GlobeGrid /><h1>搜索或打开网页</h1><p>网页将在隔离的浏览区域中显示。</p><button type="button" className="browser-start-action" onClick={() => addressField.current?.focus()}>输入网址</button></div>
        <section className="browser-tool-placeholder"><h2>工具</h2><div className="browser-tool-grid"><button type="button" disabled><span className="browser-tool-symbol">⌘</span><span><strong>创建网页</strong><small>即将支持</small></span></button><button type="button" disabled><span className="browser-tool-symbol">▱</span><span><strong>浏览工作区文件</strong><small>即将支持</small></span></button></div></section>
      </div> : problem ? <div className="browser-error" role="alert"><GlobeGrid /><h2>{tab.error?.kind === 'blocked' ? '此地址已被拦截' : tab.error?.kind === 'crashed' ? '网页意外停止' : '无法加载此网页'}</h2><p>{problem}</p><button type="button" className="browser-start-action" onClick={onReload}>重试</button></div> : null}
    </div>
  </section>;
}

function explainBlock(reason?: string) {
  if (reason === 'loopback') return '出于安全考虑，不能访问本机或回环地址。';
  if (reason === 'app-origin') return '不能在网页区域中打开应用内部页面。';
  if (reason === 'scheme') return '仅允许 HTTP 和 HTTPS 地址。';
  return '地址无效或不允许访问。';
}
