import React from 'react';
import './reader-onboarding.css';

export type ReaderSetupCheck = {
  dictionary: 'bilingual' | 'english-only' | 'unavailable';
  hardware: { appleSilicon: boolean; memoryGiB: number };
  localAi: 'not-integrated';
};
type ReaderSetupApi = {
  checkReaderSetup: () => Promise<ReaderSetupCheck>;
  openDictionaryApp: () => Promise<{ opened: boolean; error?: string }>;
};

export function ReaderOnboarding({ api, onDismiss }: {
  api: ReaderSetupApi;
  onDismiss: (decision: 'finished' | 'skipped') => Promise<void>;
  onStartReader?: () => Promise<void>;
}) {
  const [status, setStatus] = React.useState<ReaderSetupCheck | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const dialogRef = React.useRef<HTMLElement>(null);
  const savedFocus = React.useRef<HTMLElement | null>(null);
  const check = React.useCallback(async () => {
    setBusy(true); setError('');
    try { setStatus(await api.checkReaderSetup()); }
    catch { setStatus(null); setError('检测阅读环境失败，可以继续使用应用，稍后再试。'); }
    finally { setBusy(false); }
  }, [api]);
  React.useEffect(() => {
    savedFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus(); void check();
    return () => { if (savedFocus.current?.isConnected) savedFocus.current.focus(); };
  }, [check]);
  async function openDictionary() {
    try { const result = await api.openDictionaryApp(); if (!result.opened) setError(result.error || '未能打开系统词典，请手动打开「词典」App。'); }
    catch { setError('未能打开系统词典，请手动打开「词典」App。'); }
  }
  return <div className="reader-onboarding-backdrop">
    <section ref={dialogRef} tabIndex={-1} className="reader-onboarding" role="dialog" aria-modal="true" aria-labelledby="reader-setup-title"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); void onDismiss('skipped'); return; }
        if (event.key !== 'Tab') return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const first=buttons[0],last=buttons.at(-1);
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="reader-onboarding-heading"><span className="reader-onboarding-eyebrow">VANTILO · READING</span><h2 id="reader-setup-title">阅读环境设置</h2><p>检查系统词典，并选择适合自己的翻译服务。</p></div>
      <div className="reader-onboarding-step">
        <div className="reader-onboarding-step-title"><strong>macOS 系统词典</strong><small role="status">{busy ? '检测中' : !status ? '尚未检测' : status.dictionary === 'bilingual' ? '已检测到中文释义' : status.dictionary === 'english-only' ? '只有英文释义' : '未检测到可用词条'}</small></div>
        <p>{status?.dictionary === 'bilingual' ? '现在可以在阅读时使用本机英汉词典。' : '可在 Mac「词典」App 的设置中启用英汉词典，然后返回重新检测。'}</p>
        <div className="reader-onboarding-actions"><button type="button" onClick={() => void openDictionary()}>打开系统词典</button><button type="button" onClick={() => void check()} disabled={busy}>重新检测</button></div>
      </div>
      <div className="reader-onboarding-step"><div className="reader-onboarding-step-title"><strong>翻译和语境解释</strong></div><p>在阅读设置的「自定义兼容 API」中添加 DeepSeek、MiniMax 或局域网模型服务；也可以使用已登录的 ChatGPT 模型。</p></div>
      {error && <p className="reader-onboarding-error" role="alert">{error}</p>}
      <div className="reader-onboarding-footer"><button type="button" onClick={() => void onDismiss('skipped')}>稍后设置</button><button type="button" className="reader-onboarding-primary" onClick={() => void onDismiss('finished')}>完成</button></div>
    </section>
  </div>;
}
