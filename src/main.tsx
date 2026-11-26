import '@react-spectrum/s2/page.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from '@react-spectrum/s2';
import { MagazineReaderModule, isReaderAppearance, type MagazineReaderStatus, type MagazineSyncState, type ReaderAppearance } from './ui/magazine-reader-module';
import { ReaderOnboarding, type OnboardingCustomApiDraft, type OnboardingCustomApiSettings, type ReaderSetupCheck, type TtsInstallStatus } from './ui/reader-onboarding';
import './ui/design-tokens.css';
import './style.css';
import './ui/macos-shell.css';
import './ui/global-appearance.css';

type VocabularyBackupEvent = {
  type: 'freeze' | 'unfreeze' | 'resume' | 'status';
  requestId: string;
  phase?: string;
  progress?: number;
  message?: string;
  result?: { name: string; size: number; sha256: string; vocabularyCount: number };
};

type RuntimeApi = {
  startMagazineReader: () => Promise<{ ready: boolean }>;
  getMagazineReaderStatus: () => Promise<{ status: string; error: string | null; sync?: MagazineSyncState }>;
  syncMagazineReader: () => Promise<{ accepted: boolean }>;
  startVocabularyBackup: (requestId: string) => Promise<{ canceled?: boolean; completed?: boolean; name?: string; size?: number; sha256?: string; vocabularyCount?: number }>;
  submitVocabularyBackupSnapshot: (requestId: string, snapshot: unknown) => Promise<{ accepted: boolean }>;
  cancelVocabularyBackup: (requestId: string) => Promise<{ canceled: boolean }>;
  revealVocabularyBackup: () => Promise<{ shown: boolean }>;
  getVocabularyBackupStatus: () => Promise<{ lastBackup: { createdAt: string; name: string; path: string; size: number; sha256: string; vocabularyCount: number } | null }>;
  onVocabularyBackupEvent: (callback: (event: VocabularyBackupEvent) => void) => () => void;
  getReaderSetupState: () => Promise<{ show: boolean }>;
  checkReaderSetup: () => Promise<ReaderSetupCheck>;
  finishReaderSetup: (decision: 'finished' | 'skipped') => Promise<{ show: boolean }>;
  openDictionaryApp: () => Promise<{ opened: boolean; error?: string }>;
  getTtsInstallStatus?: () => Promise<TtsInstallStatus>;
  installTtsModel?: (options: { consent: true; mirror?: boolean }) => Promise<TtsInstallStatus>;
  cancelTtsInstall?: () => Promise<TtsInstallStatus>;
  removeTtsModel?: () => Promise<TtsInstallStatus>;
  onTtsInstallUpdated?: (callback: (event: { installed: boolean }) => void) => () => void;
  getCustomApiSettings?: () => Promise<OnboardingCustomApiSettings>;
  saveCustomApiSettings?: (config: OnboardingCustomApiDraft) => Promise<OnboardingCustomApiSettings>;
  testCustomApiSettings?: (config: OnboardingCustomApiDraft) => Promise<{ ok?: boolean; message?: string }>;
  listCustomApiModels?: (config: Partial<OnboardingCustomApiDraft> & { baseUrl: string }) => Promise<{ models: string[] }>;
  onCustomApiUpdated?: (callback: (event: { configured: boolean }) => void) => () => void;
  onSystemSuspended?: (callback: () => void) => () => void;
};

const HOST_APPEARANCE_STORAGE_KEY = 'vantilo-host-appearance-v1';
function loadHostAppearance(): ReaderAppearance {
  try {
    const raw = localStorage.getItem(HOST_APPEARANCE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isReaderAppearance(parsed)) return parsed;
    }
  } catch { /* ignore storage errors */ }
  return { theme: 'night', fontSize: 16, fontFamily: 'sans' };
}

function App() {
  const [appearance, setAppearance] = React.useState<ReaderAppearance>(loadHostAppearance);
  const handleAppearanceChange = React.useCallback((next: ReaderAppearance) => {
    setAppearance(prev => {
      if (prev.theme === next.theme && prev.fontSize === next.fontSize && prev.fontFamily === next.fontFamily) return prev;
      try { localStorage.setItem(HOST_APPEARANCE_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const isDarkTheme = appearance.theme === 'night' || appearance.theme === 'blue';

  const [readerDestination, setReaderDestination] = React.useState<{ target: 'settings' | 'library' | 'practice'; sequence: number } | undefined>({ target: 'library', sequence: 0 });
  const [activeSection, setActiveSection] = React.useState<'magazine-reader' | 'practice' | 'settings'>('magazine-reader');
  const [audiobookTarget, setAudiobookTarget] = React.useState<HTMLElement | null>(null);
  const [magazineReaderStatus, setMagazineReaderStatus] = React.useState<MagazineReaderStatus>('idle');
  const [magazineReaderError, setMagazineReaderError] = React.useState<string | null>(null);
  const [magazineSyncState, setMagazineSyncState] = React.useState<MagazineSyncState | null>(null);
  const [readerSetupOpen, setReaderSetupOpen] = React.useState(false);

  const startReader = React.useCallback(async (force = false) => {
    setMagazineReaderStatus(current => {
      if (!force && (current === 'ready' || current === 'starting')) return current;
      return 'starting';
    });
    setMagazineReaderError(null);
    try {
      if (!window.vantilo) throw new Error('Electron IPC 桥接不可用，请从 Vantilo 桌面应用打开阅读空间。');
      await window.vantilo.startMagazineReader();
      setMagazineReaderStatus('ready');
    } catch (reason) {
      setMagazineReaderStatus('error');
      setMagazineReaderError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const openReaderDestination = React.useCallback((target: 'settings' | 'library' | 'practice') => {
    setActiveSection(target === 'settings' ? 'settings' : target === 'practice' ? 'practice' : 'magazine-reader');
    setReaderDestination(previous => ({ target, sequence: (previous?.sequence ?? 0) + 1 }));
    if (magazineReaderStatus !== 'ready' && magazineReaderStatus !== 'starting') void startReader();
  }, [magazineReaderStatus, startReader]);

  const showAudiobookOriginal = React.useCallback(() => {
    setReaderSetupOpen(false);
    setActiveSection('magazine-reader');
    setReaderDestination(undefined);
  }, []);

  React.useEffect(() => {
    void startReader();
  }, [startReader]);

  React.useEffect(() => {
    let live = true;
    const getState = window.vantilo?.getReaderSetupState;
    if (getState) void getState().then(state => {
      if (live && state.show) setReaderSetupOpen(true);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === '1') { event.preventDefault(); openReaderDestination('library'); return; }
      if (event.key === '2') { event.preventDefault(); openReaderDestination('practice'); return; }
      if (event.key === ',') { event.preventDefault(); openReaderDestination('settings'); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openReaderDestination]);

  React.useEffect(() => {
    if (magazineReaderStatus !== 'ready' || !window.vantilo) return;
    let disposed = false;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const state = await window.vantilo!.getMagazineReaderStatus();
        if (!disposed && state.sync) setMagazineSyncState(state.sync);
        if (!disposed && state.status !== 'ready') {
          setMagazineReaderError(state.error || '阅读服务已停止，请重试。');
          setMagazineReaderStatus('error');
        }
      } catch {
        if (!disposed) {
          setMagazineReaderError('无法连接阅读服务，请重试。');
          setMagazineReaderStatus('error');
        }
      } finally { pending = false; }
    }, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [magazineReaderStatus]);

  async function syncMagazineReader() {
    if (!window.vantilo) return;
    setMagazineSyncState(previous => previous ? { ...previous, status: 'checking', message: '正在检查四种杂志的新刊…' } : null);
    try { await window.vantilo.syncMagazineReader(); }
    catch { setMagazineSyncState(previous => previous ? { ...previous, status: 'error', message: '检查更新失败，请稍后重试' } : null); }
  }

  async function dismissReaderSetup(decision: 'finished' | 'skipped') {
    try { await window.vantilo!.finishReaderSetup(decision); }
    finally { setReaderSetupOpen(false); }
  }

  return (
    <Provider colorScheme={isDarkTheme ? 'dark' : 'light'} background="base">
      <main data-vantilo-theme={appearance.theme} className="vantilo-macos-shell">
        <div className="app-titlebar">
          <div className="app-titlebar-leading">
            <span className="app-window-mark" aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M3.2 3.5h4.1c.9 0 1.4.4 1.7 1 .3-.6.8-1 1.7-1h4.1v9.2h-4.1c-.8 0-1.3.3-1.7.9-.4-.6-.9-.9-1.7-.9H3.2V3.5Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
                <path d="M9 4.5v8.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </span>
            <span className="app-window-title" aria-hidden="true">Vantilo</span>
          </div>
          <div className="app-titlebar-actions">
            <button
              type="button"
              className={`app-titlebar-settings ${activeSection === 'settings' ? 'is-active' : ''}`}
              aria-label="设置"
              aria-pressed={activeSection === 'settings'}
              title="设置  ⌘,"
              onClick={() => openReaderDestination('settings')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m10 3-.6 2.2-2 .9-2-.7-2 3.4 1.6 1.6v2.3L3.4 15l2 3.4 2-.7 2 .9.6 2.4h4l.6-2.4 2-.9 2 .7 2-3.4-1.6-2.3v-2.3L20.6 9l-2-3.4-2 .7-2-.9L14 3Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>设置</span>
            </button>
          </div>
        </div>
        <div className="workspace-sheet workspace-sheet-reader">
          <MagazineReaderModule
            navigationRequest={readerDestination}
            visible
            status={magazineReaderStatus}
            error={magazineReaderError}
            onRetry={() => void startReader(true)}
            onBack={() => openReaderDestination('library')}
            syncState={magazineSyncState}
            onSync={() => void syncMagazineReader()}
            onSetup={() => setReaderSetupOpen(true)}
            onAppearanceChange={handleAppearanceChange}
            audiobookTarget={audiobookTarget}
            onShowReader={showAudiobookOriginal}
          />
        </div>
        <div ref={setAudiobookTarget} className="vantilo-audiobook-slot" />
        {readerSetupOpen && window.vantilo && (
          <ReaderOnboarding
            api={window.vantilo}
            onDismiss={dismissReaderSetup}
            onStartReader={async () => { await dismissReaderSetup('finished'); openReaderDestination('library'); }}
          />
        )}
      </main>
    </Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
declare global { interface Window { vantilo?: RuntimeApi } }
