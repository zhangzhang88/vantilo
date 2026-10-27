import React from 'react';
import './magazine-reader-module.css';

export type MagazineSyncState = { enabled: boolean; status: 'idle' | 'checking' | 'error'; message: string; importedCount: number; failedCount: number; lastAttemptAt?: string | null; lastSuccessAt?: string | null };

export type MagazineReaderStatus = 'idle' | 'starting' | 'ready' | 'error';

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
  visible?: boolean;
}) {
  const frameRef=React.useRef<HTMLIFrameElement>(null);
  const origin=new URL(MAGAZINE_READER_URL).origin;
  const navigate=React.useCallback(()=>{
    if(navigationRequest)frameRef.current?.contentWindow?.postMessage({type:'vantilo:navigate',target:navigationRequest.target},origin);
  },[navigationRequest,origin]);
  React.useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.source!==frameRef.current?.contentWindow||event.origin!==origin)return;
      if(event.data?.type==='vantilo:reader-ready')navigate();
      if(event.data?.type==='vantilo:open-environment-settings')onSetup?.();
    };
    window.addEventListener('message',receive);return ()=>window.removeEventListener('message',receive);
  },[origin,navigate,onSetup]);
  React.useEffect(()=>{if(status==='ready')navigate();},[status,navigate]);
  return (
    <section className="magazine-reader-module" aria-label="Magazine Reader" hidden={!visible}>
      {status === 'ready' ? (
        <iframe
          ref={frameRef}
          onLoad={navigate}
          className="magazine-reader-frame"
          title="Magazine Reader"
          src={MAGAZINE_READER_URL}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          referrerPolicy="no-referrer"
        />
      ) : status === 'error' ? (
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