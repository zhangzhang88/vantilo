import React from 'react';
import './magazine-reader-module.css';
import { BookDiscovery } from '../reader/book-discovery';

export type MagazineSyncState = { enabled: boolean; status: 'idle' | 'checking' | 'error'; message: string; importedCount: number; failedCount: number; lastAttemptAt?: string | null; lastSuccessAt?: string | null };

export type MagazineReaderStatus = 'idle' | 'starting' | 'ready' | 'error';
export type ReaderAppearance = { theme: 'paper'|'sepia'|'green'|'blue'|'night'; fontSize: number; fontFamily: 'serif'|'sans' };
export function isReaderAppearance(value: unknown): value is ReaderAppearance {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.theme === 'string' && ['paper','sepia','green','blue','night'].includes(item.theme)
    && typeof item.fontSize === 'number' && Number.isInteger(item.fontSize) && item.fontSize >= 12 && item.fontSize <= 24
    && (item.fontFamily === 'serif' || item.fontFamily === 'sans');
}

const MAGAZINE_READER_URL = 'http://127.0.0.1:5175/';

export function MagazineReaderModule({
  navigationRequest,
  status,
  error,
  onRetry,
  onBack,
  syncState,
  onSync,
  onSetup,
  onAppearanceChange,
  visible = true,
}: {
  navigationRequest?: {target:'settings'|'library';sequence:number};
  status: MagazineReaderStatus;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
  syncState?: MagazineSyncState | null;
  onSync?: () => void;
  onSetup?: () => void;
  onAppearanceChange?: (appearance: ReaderAppearance) => void;
  visible?: boolean;
}) {
  const frameRef=React.useRef<HTMLIFrameElement>(null);
  const [discoveryOpen,setDiscoveryOpen]=React.useState(false);
  const origin=new URL(MAGAZINE_READER_URL).origin;
  const navigate=React.useCallback(()=>{
    if(navigationRequest)frameRef.current?.contentWindow?.postMessage({type:'vantilo:navigate',target:navigationRequest.target},origin);
  },[navigationRequest,origin]);
  React.useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.source!==frameRef.current?.contentWindow||event.origin!==origin)return;
      if(event.data?.type==='vantilo:reader-ready')navigate();
      if(event.data?.type==='vantilo:open-environment-settings')onSetup?.();
      if(event.data?.type==='vantilo:open-discovery')setDiscoveryOpen(true);
      if(event.data?.type==='vantilo:reader-appearance' && isReaderAppearance(event.data)) {
        onAppearanceChange?.({theme:event.data.theme,fontSize:event.data.fontSize,fontFamily:event.data.fontFamily});
      }
    };
    window.addEventListener('message',receive);return ()=>window.removeEventListener('message',receive);
  },[origin,navigate,onSetup,onAppearanceChange]);
  React.useEffect(()=>{if(status==='ready')navigate();},[status,navigate]);
  return (
    <section className="magazine-reader-module" aria-label="Magazine Reader" hidden={!visible}>
      {discoveryOpen ? <BookDiscovery onBack={()=>setDiscoveryOpen(false)} onOpenShelf={()=>{setDiscoveryOpen(false);frameRef.current?.contentWindow?.postMessage({type:'vantilo:navigate',target:'library'},origin);}}/> : status === 'ready' ? <iframe
          ref={frameRef}
          onLoad={navigate}
          className="magazine-reader-frame"
          title="Magazine Reader"
          src={MAGAZINE_READER_URL}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          referrerPolicy="no-referrer"
        /> : status === 'error' ? (
        <div className="magazine-reader-state" role="alert">
          <h2>无法打开 Magazine Reader</h2>
          <p className="magazine-reader-error">{error || '阅读模块启动失败。'}</p>
          <div className="magazine-reader-state-actions">
            <button type="button" onClick={onRetry}>重试</button>
          </div>
        </div>
      ) : (
        <div className="magazine-reader-state" role="status" aria-live="polite">
          <span className="magazine-reader-spinner" aria-hidden="true" />
          <h2>正在启动阅读空间…</h2>
          <p>正在连接本机 Magazine Reader 服务，请稍候。</p>
        </div>
      )}
    </section>
  );
}
