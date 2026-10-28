import React from 'react';
import './reader-onboarding.css';
type ModelHealth = {ready:boolean;status:string};
type ModelProgress = {completedBytes:number;totalBytes:number;file:string};
type ReaderModelInfo = {
  selected:boolean;modelName:string;modelPath:string|null;active:boolean;helperAvailable:boolean;health:ModelHealth;
  hardware:{supported:boolean;memoryGiB:number;warning:string|null};
  disk:{availableBytes:number;freshInstallBytes:number};
  model:{id?:string;label?:string;bytes:number;license:string};
};

export type ReaderSetupCheck = {
  dictionary: 'bilingual' | 'english-only' | 'unavailable';
  hardware: { appleSilicon: boolean; memoryGiB: number };
  localAi: 'not-integrated';
  modelSetupPreview?: boolean;
  readerQwenIntegrated?: boolean;
};
type ReaderSetupApi = {
  checkReaderSetup: () => Promise<ReaderSetupCheck>;
  openDictionaryApp: () => Promise<{ opened: boolean; error?: string }>;
  viewLocalModelInfo: () => Promise<void>;
  inspectLocalModel?: () => Promise<ReaderModelInfo>;
  chooseLocalModel?: () => Promise<{canceled:boolean;result?:{health:ModelHealth}}>;
  recheckLocalModel?: () => Promise<ModelHealth>;
  installLocalModel?: () => Promise<{canceled?:boolean;health?:ModelHealth}>;
  cancelLocalModel?: () => Promise<{canceled:boolean}>;
  onLocalModelProgress?: (callback:(progress:ModelProgress)=>void) => () => void;
};

export function ReaderOnboarding({ api, onDismiss, onStartReader }: {
  api: ReaderSetupApi;
  onDismiss: (decision: 'finished' | 'skipped') => Promise<void>;
  onStartReader?: () => Promise<void>;
}) {
  const [status, setStatus] = React.useState<ReaderSetupCheck | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [model, setModel] = React.useState<ReaderModelInfo|null>(null);
  const [modelBusy,setModelBusy] = React.useState(false);
  const [installing,setInstalling] = React.useState(false);
  const [progress,setProgress] = React.useState<ModelProgress|null>(null);
  const readerQwenAvailable = Boolean(status?.hardware.appleSilicon && status.readerQwenIntegrated);
  React.useEffect(() => {
    return api.onLocalModelProgress?.(value=>setProgress(value));
  },[api]);
  const dialogRef = React.useRef<HTMLElement>(null);
  const savedFocus = React.useRef<HTMLElement | null>(null);

  const check = React.useCallback(async () => {
    setBusy(true); setError('');
    try {
      const next = await api.checkReaderSetup();
      setStatus(next);
      if (next.hardware.appleSilicon && next.modelSetupPreview && api.inspectLocalModel) setModel(await api.inspectLocalModel());
    }
    catch { setStatus(null); setError('检测阅读环境失败。可以继续使用应用，稍后再试。'); }
    finally { setBusy(false); }
  }, [api]);
  React.useEffect(() => {
    savedFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    void check();
    return () => { savedFocus.current?.isConnected && savedFocus.current.focus(); };
  }, [check]);
  async function openDictionary() {
    try {
      const result = await api.openDictionaryApp();
      if (!result.opened) setError(result.error || '未能打开系统词典，请手动打开「词典」App。');
    } catch { setError('未能打开系统词典，请手动打开「词典」App。'); }
  }
  async function modelInfo() {
    try { await api.viewLocalModelInfo(); }
    catch { setError('暂时无法打开模型介绍页面。'); }
  }
  async function modelAction(action:'choose'|'check'|'install') {
    setError('');setModelBusy(true);
    if(action==='install') {setInstalling(true);setProgress(null);}
    try {
      if(action==='choose') await api.chooseLocalModel?.();
      if(action==='check') await api.recheckLocalModel?.();
      if(action==='install') await api.installLocalModel?.();
      if(api.inspectLocalModel) setModel(await api.inspectLocalModel());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地模型操作失败，请检查文件或稍后再试。');
    } finally {setModelBusy(false);setInstalling(false);}
  }
  return (
    <div className="reader-onboarding-backdrop">
      <section ref={dialogRef} tabIndex={-1} className="reader-onboarding" role="dialog" aria-modal="true" aria-labelledby="reader-setup-title"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); void onDismiss('skipped'); return; }
          if (event.key !== 'Tab') return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const first = buttons[0], last = buttons.at(-1);
          if (!first || !last) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }}>
        <div className="reader-onboarding-heading"><span className="reader-onboarding-eyebrow">VANTILO · FIRST RUN</span>
          <h2 id="reader-setup-title">准备你的阅读环境</h2>
          <p>先检查系统词典和本地模型支持情况。设置可跳过，也可稍后重新打开。</p>
        </div>
        <div className="reader-onboarding-step">
          <div className="reader-onboarding-step-title"><span>01</span><strong>macOS 系统词典</strong>
            <small role="status">{busy ? '检测中' : !status ? '尚未检测' : status.dictionary === 'bilingual' ? '已检测到中文释义' : status.dictionary === 'english-only' ? '只有英文释义' : '未检测到可用词条'}</small>
          </div>
          <p>{status?.dictionary === 'bilingual' ? '现在可以在 Reader 中使用本机英汉词典。' :
            '在 Mac「词典」App 的菜单「词典 → 设置」中启用英汉词典，等待系统下载完成，然后返回重新检测。也可以使用英文词典。'}</p>
          <div className="reader-onboarding-actions"><button type="button" onClick={() => void openDictionary()}>打开系统词典</button>
            <button type="button" onClick={() => void check()} disabled={busy}>重新检测</button></div>
        </div>
        <div className="reader-onboarding-step">
          <div className="reader-onboarding-step-title"><span>02</span><strong>AI 模型（可选）</strong><small>{status?.hardware.appleSilicon === false ? '使用自定义 API' : readerQwenAvailable ? '本地模型已接入 Reader' : status?.modelSetupPreview ? '独立预览 · 原生验证' : '应用内安装尚未开放'}</small></div>
          <p>{status?.hardware ? `${status.hardware.appleSilicon ? 'Apple Silicon' : '当前设备不是 Apple Silicon'} · ${status.hardware.memoryGiB} GB 内存。 ` : ''}
            {readerQwenAvailable
              ? '当前预览版已接入本地 Qwen 点词语境释义。选择并验证已有模型后，可直接打开 Reader；也可跳过模型，仅使用系统词典。模型在线下载和公开发行签名公证仍需独立验证。'
              : status?.hardware?.appleSilicon === false
                ? 'Intel 版本通过自定义云端或局域网 API 使用模型，不运行本地 Qwen。'
                : status?.modelSetupPreview
                  ? '当前隔离预览支持原生 Swift MLX 健康检查及需确认的模型下载，但此版本未接入 Reader 点词。'
                  : '正式 Vantilo 尚未开放本地模型安装和 Reader Qwen 点词功能。'}</p>

          {status?.hardware.appleSilicon && status.modelSetupPreview && <div className="reader-onboarding-model-preview">
            <p role="status">{modelBusy && !installing ? '正在验证模型…' :
              model?.health.ready ? (readerQwenAvailable ? '本机文件与 Swift 推理验证通过，可进入 Reader 自动点词释义。' : '本机 Swift 推理健康检查已通过（此预览未接入 Reader）。') :
              model?.selected ? (readerQwenAvailable ? '已选择模型；本次尚未验证。进入 Reader 后首次点词会自动校验，请留意加载提示。' : '已选择模型，但尚未通过本机 Swift 推理健康检查。') :
              '尚未选择本地模型。可采用已有模型，也可手动确认下载。'}
              {model && !model.helperAvailable ? ' 当前安装包缺少本地推理运行时。' : ''}
            </p>
            {model && <p>当前可用空间约 {(model.disk.availableBytes/1024**3).toFixed(1)} GiB；
              首次下载需要约 {(model.disk.freshInstallBytes/1024**3).toFixed(1)} GiB（含预留）。</p>}
            {model?.selected && model.modelPath && <div className="reader-onboarding-model-selection">
              <p><strong>当前模型：</strong>{model.modelName}</p>
              <p><strong>模型位置：</strong><code title={model.modelPath}>{model.modelPath}</code></p>
              <p><strong>验证状态：</strong>{model.health.ready ? '文件校验与本机推理通过' : '尚未通过完整推理验证'}</p>
            </div>}
            <div className="reader-onboarding-actions">
              <button type="button" disabled={modelBusy} onClick={() => void modelAction('choose')}>选择已有 Qwen 模型</button>
              <button type="button" disabled={modelBusy || !model?.selected} onClick={() => void modelAction('check')}>重新验证模型</button>
              <button type="button" disabled={modelBusy || !model?.hardware.supported || model.disk.availableBytes < model.disk.freshInstallBytes} onClick={() => void modelAction('install')}>确认后下载约 3GB</button>
              {installing && <button type="button" onClick={() => void api.cancelLocalModel?.()}>取消下载</button>}
            </div>
            {progress && <p role="status">下载：{(progress.completedBytes/1024**2).toFixed(1)} / {(progress.totalBytes/1024**2).toFixed(1)} MiB</p>}
          </div>}
          {status?.hardware.appleSilicon && <div className="reader-onboarding-actions"><button type="button" onClick={() => void modelInfo()}>查看 Qwen 模型详情（非安装）</button></div>}
        </div>
        <div className="reader-onboarding-step">
          <div className="reader-onboarding-step-title"><span>03</span><strong>开始阅读</strong><small>无须等待本地模型</small></div>
          <p>{status?.hardware?.appleSilicon === false ? 'Intel 版本可使用已配置的自定义云端或局域网 API；系统词典可独立使用。' : readerQwenAvailable ? 'Reader 已可在选词后自动给出本地 Qwen 的当前语境释义；未选择模型时仍可查看系统词典。登录 ChatGPT 后，可另外使用 Agent 进行深度讨论。' : '系统词典可独立使用。登录 ChatGPT 后，可通过现有 Agent 进行深度解释。'}</p>
        </div>
        {error && <p className="reader-onboarding-error" role="alert">{error}</p>}
        <div className="reader-onboarding-footer">
          <button type="button" onClick={() => void onDismiss('skipped')}>稍后设置</button>
          <button type="button" className="reader-onboarding-primary" onClick={() => void (readerQwenAvailable && onStartReader ? onStartReader() : onDismiss('finished'))}>{readerQwenAvailable && onStartReader ? '开始阅读' : '进入 Vantilo'}</button>
        </div>
      </section>
    </div>
  );
}
