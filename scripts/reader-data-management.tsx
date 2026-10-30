import { useEffect, useRef, useState } from "react";
import { freezeReaderStorageKeys, writeFrozenReaderStorageKeys } from "./reader-storage";
import {
  buildVocabularyBackupData,
  captureVocabularyStorageRaw,
  currentVocabularySummary,
  findMissingVocabularySources,
  mergeVocabularyData,
  MAX_VOCABULARY_BACKUP_BYTES,
  parseVocabularyBackup,
  restoreVocabularyDataTransaction,
  VOCABULARY_STORAGE_KEYS,
  type VocabularyBackupV1,
  type VocabularyMergePreview,
} from "./vocabulary-backup";

type LastBackup = { createdAt: string; name: string; size: number; sha256: string; vocabularyCount: number };
type BackupResult = { name: string; size: number; sha256: string; vocabularyCount: number };
type PendingRestore = { fileName: string; backup: VocabularyBackupV1; preview: VocabularyMergePreview; expectedRaw: Record<string, string | null>; sourceCheck: { status: "checked"; missingDocumentIds: string[]; documentCount: number } | { status: "unavailable" } };
const RESTORE_NOTICE_KEY = "vantilo-vocabulary-restore-notice-v1";
const RESTORE_REQUEST_KEY = "vantilo-vocabulary-restore-request-v1";
const RESTORE_PHASE_KEY = "vantilo-vocabulary-restore-phase-v1";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}
function formatSize(bytes: number): string { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export function DataManagementPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeBackupRef = useRef<string | null>(null);
  const releaseBackupFreezeRef = useRef<(() => void) | null>(null);
  const releaseRestoreFreezeRef = useRef<(() => void) | null>(null);
  const [token, setToken] = useState<string | null>(() => (window as Window & { __vantiloGrowthToken?: string }).__vantiloGrowthToken ?? null);
  const [vocabularyCount, setVocabularyCount] = useState(() => {
    try { return currentVocabularySummary(window.localStorage).vocabularyCount; } catch { return null; }
  });
  const [lastBackup, setLastBackup] = useState<LastBackup | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [phase, setPhase] = useState("IDLE");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [restoreConfirmationOpen, setRestoreConfirmationOpen] = useState(false);
  const [restoreRequestId, setRestoreRequestId] = useState<string | null>(null);
  const [restorePhase, setRestorePhase] = useState(() => {
    try { return sessionStorage.getItem(RESTORE_PHASE_KEY) === "COMPLETED" ? "COMPLETED" : "IDLE"; } catch { return "IDLE"; }
  });
  const [restoreResultRequestId, setRestoreResultRequestId] = useState(() => {
    try { return sessionStorage.getItem(RESTORE_REQUEST_KEY) || ""; } catch { return ""; }
  });
  const [restoreNotice, setRestoreNotice] = useState(() => {
    try { const value = sessionStorage.getItem(RESTORE_NOTICE_KEY); sessionStorage.removeItem(RESTORE_NOTICE_KEY); return value || ""; } catch { return ""; }
  });
  const [error, setError] = useState<string | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(() => Boolean((window as Window & { __vantiloVocabularyRecoveryRequired?: string }).__vantiloVocabularyRecoveryRequired));
  const busy = Boolean(requestId) || Boolean(releaseRestoreFreezeRef.current);

  useEffect(() => {
    const refreshToken = () => setToken((window as Window & { __vantiloGrowthToken?: string }).__vantiloGrowthToken ?? null);
    window.addEventListener("vantilo:growth-token", refreshToken);
    refreshToken();
    return () => window.removeEventListener("vantilo:growth-token", refreshToken);
  }, []);

  useEffect(() => {
    if (window.parent === window || !token) return;
    window.parent.postMessage({ type: "vantilo:vocabulary-backup-status-request", token }, "*");
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object" || event.data.token !== token) return;
      const data = event.data;
      if (data.type === "vantilo:vocabulary-backup-freeze" && data.requestId === activeBackupRef.current) {
        try {
          releaseBackupFreezeRef.current?.();
          releaseBackupFreezeRef.current = freezeReaderStorageKeys(VOCABULARY_STORAGE_KEYS);
          const snapshot = buildVocabularyBackupData(window.localStorage);
          window.parent.postMessage({ type: "vantilo:vocabulary-backup-snapshot", token, requestId: data.requestId, snapshot }, "*");
        } catch (cause) {
          window.parent.postMessage({ type: "vantilo:vocabulary-backup-error", token, requestId: data.requestId, message: cause instanceof Error ? cause.message : "无法安全读取词汇数据。" }, "*");
        }
        return;
      }
      if (data.type === "vantilo:vocabulary-backup-resume" && data.requestId === activeBackupRef.current) {
        releaseBackupFreezeRef.current?.(); releaseBackupFreezeRef.current = null;
        activeBackupRef.current = null; setRequestId(null);
        try { setVocabularyCount(currentVocabularySummary(window.localStorage).vocabularyCount); } catch { setVocabularyCount(null); }
        return;
      }
      if (data.type === "vantilo:vocabulary-backup-unfreeze" && data.requestId === activeBackupRef.current) {
        // Main has accepted an immutable snapshot. Keep the backup UI busy, but
        // don't block new learning writes while that snapshot is written to disk.
        releaseBackupFreezeRef.current?.(); releaseBackupFreezeRef.current = null;
        return;
      }
      if (data.type === "vantilo:vocabulary-backup-last-status") {
        const item = data.lastBackup;
        if (item && typeof item.createdAt === "string" && typeof item.name === "string" && Number.isSafeInteger(item.size) && typeof item.sha256 === "string" && Number.isSafeInteger(item.vocabularyCount)) setLastBackup(item);
        else setLastBackup(null);
        return;
      }
      if (data.type === "vantilo:vocabulary-backup-status" && data.requestId === activeBackupRef.current) {
        if (typeof data.phase === "string") setPhase(data.phase);
        if (typeof data.progress === "number") setProgress(Math.max(0, Math.min(100, data.progress)));
        if (typeof data.message === "string") setMessage(data.message);
        if (data.phase === "COMPLETED" && data.result) {
          setBackupResult(data.result);
          const record = { ...data.result, createdAt: new Date().toISOString() };
          setLastBackup(record);
        }
        if (["FAILED", "CANCELLED"].includes(data.phase)) {
          setBackupResult(null);
          if (data.phase === "FAILED") setError(data.message || "词汇备份失败。");
        }
        if (data.terminal === true && ["FAILED", "CANCELLED"].includes(data.phase)) {
          releaseBackupFreezeRef.current?.(); releaseBackupFreezeRef.current = null;
          activeBackupRef.current = null; setRequestId(null);
        }
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      releaseBackupFreezeRef.current?.(); releaseBackupFreezeRef.current = null;
      releaseRestoreFreezeRef.current?.(); releaseRestoreFreezeRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const recovery = (window as Window & { __vantiloVocabularyRecoveryRequired?: string }).__vantiloVocabularyRecoveryRequired;
    if (recovery) { setRecoveryRequired(true); setError(`词汇恢复事务需要处理：${recovery}。本机词汇写入已暂停。`); }
  }, []);

  function startBackup() {
    if (requestId || recoveryRequired) return;
    const nextId = globalThis.crypto?.randomUUID?.();
    if (!nextId || !token || window.parent === window) { setError("桌面词汇备份通道未就绪，请重新打开阅读空间后重试。"); return; }
    setError(null); setBackupResult(null); setProgress(0); setMessage("请选择备份保存位置"); setPhase("PREPARING");
    activeBackupRef.current = nextId; setRequestId(nextId);
    window.parent.postMessage({ type: "vantilo:vocabulary-backup-start", token, requestId: nextId }, "*");
  }

  function cancelBackup() {
    if (!requestId || !token) return;
    setPhase("CANCELLING"); setMessage("正在取消备份…");
    window.parent.postMessage({ type: "vantilo:vocabulary-backup-cancel", token, requestId }, "*");
  }

  function revealBackup() {
    if (token) window.parent.postMessage({ type: "vantilo:vocabulary-backup-reveal", token }, "*");
  }

  function openLibrary() {
    if (window.parent !== window) window.parent.postMessage({ type: "vantilo:navigate", target: "library" }, "*");
  }

  async function chooseRestoreFile(file?: File) {
    setPending(null); setRestoreMessage(""); setError(null);
    if (!file) return;
    if (file.size > MAX_VOCABULARY_BACKUP_BYTES) { setError("词汇备份文件超过 25 MB，未读取。"); if (inputRef.current) inputRef.current.value = ""; return; }
    try {
      const serialized = await file.text();
      const backup = await parseVocabularyBackup(serialized);
      const raw = captureVocabularyStorageRaw(window.localStorage);
      const current = buildVocabularyBackupData(window.localStorage);
      const preview = mergeVocabularyData(current, backup.data).preview;
      let sourceCheck: PendingRestore["sourceCheck"] = { status: "unavailable" };
      try {
        const [booksResponse, issuesResponse] = await Promise.all([fetch("/api/books"), fetch("/api/issues")]);
        if (!booksResponse.ok || !issuesResponse.ok) throw new Error("来源目录暂不可用");
        const books: unknown = await booksResponse.json(); const issues: unknown = await issuesResponse.json();
        if (!Array.isArray(books) || !Array.isArray(issues)) throw new Error("来源目录格式无效");
        const bookIds = new Set(books.flatMap(item => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? [(item as { id: string }).id] : []));
        const issueIds = new Set(issues.flatMap(item => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? [(item as { id: string }).id] : []));
        sourceCheck = { status: "checked", ...findMissingVocabularySources(backup.data, bookIds, issueIds) };
      } catch { /* Source availability is informational; preserve vocabulary references when offline. */ }
      setPending({ fileName: file.name, backup, preview, expectedRaw: raw, sourceCheck });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法验证词汇备份文件。"); }
    finally { if (inputRef.current) inputRef.current.value = ""; }
  }

  function requestRestoreConfirmation() {
    if (!pending || busy || recoveryRequired) return;
    const nextId = globalThis.crypto?.randomUUID?.();
    if (!nextId) { setError("无法建立本次恢复请求编号，请重新打开阅读空间后重试。"); return; }
    setError(null); setRestoreMessage(""); setRestoreRequestId(nextId); setRestorePhase("AWAITING_CONFIRMATION"); setRestoreConfirmationOpen(true);
  }

  function cancelRestoreConfirmation() {
    setRestoreConfirmationOpen(false); setRestorePhase("CANCELLED");
  }

  function commitRestore() {
    if (!pending || !restoreRequestId || !restoreConfirmationOpen || busy || recoveryRequired) return;
    const transactionId = restoreRequestId;
    setRestoreConfirmationOpen(false);
    setError(null); setRestoreMessage("正在安全合并词汇…"); setRestorePhase("RESTORING");
    try {
      releaseRestoreFreezeRef.current = freezeReaderStorageKeys(VOCABULARY_STORAGE_KEYS);
      const result = restoreVocabularyDataTransaction(window.localStorage, pending.backup.data, writeFrozenReaderStorageKeys, pending.expectedRaw, transactionId);
      // The transaction and verification are synchronous in this Renderer. Once
      // committed, new learning writes are safe and must survive the page reload.
      releaseRestoreFreezeRef.current?.();
      releaseRestoreFreezeRef.current = null;
      let notice = result.recoveryJournalPending ? "词汇已合并；恢复日志将在重新启动时安全清理。" : `恢复完成：新增 ${result.preview.newVocabularyCount} 条词汇，合并 ${result.preview.mergeableRecords} 条记录。`;
      if (pending.sourceCheck.status === "checked" && pending.sourceCheck.missingDocumentIds.length) notice += ` 本机未找到 ${pending.sourceCheck.missingDocumentIds.length} 个书籍或杂志来源；词汇和关联已保留，可在书库重新导入原文件。`;
      if (pending.sourceCheck.status === "unavailable") notice += " 来源目录未能检查；所有来源关联均已保留，若原书籍或杂志缺失，可在书库重新导入。";
      let reloadAfterSuccess = true;
      try { sessionStorage.setItem(RESTORE_NOTICE_KEY, notice); sessionStorage.setItem(RESTORE_REQUEST_KEY, transactionId); sessionStorage.setItem(RESTORE_PHASE_KEY, "COMPLETED"); }
      catch { reloadAfterSuccess = false; /* Keep the completed state in this view if sessionStorage is unavailable. */ }
      setRestoreNotice(notice); setRestoreResultRequestId(transactionId);
      setRestorePhase("COMPLETED");
      setRestoreMessage(reloadAfterSuccess ? `${notice} 正在重新加载…` : notice);
      if (reloadAfterSuccess) window.setTimeout(() => window.location.reload(), 700);
    } catch (cause) {
      const recovery = (window as Window & { __vantiloVocabularyRecoveryRequired?: string }).__vantiloVocabularyRecoveryRequired;
      if (recovery) { setRestorePhase("RECOVERY_REQUIRED"); setRecoveryRequired(true); setError(`恢复失败且自动回滚未能确认：${recovery}。恢复点已保留，词汇写入已锁定。`); }
      else { setRestorePhase("FAILED"); releaseRestoreFreezeRef.current?.(); releaseRestoreFreezeRef.current = null; setRestoreMessage(""); setError(cause instanceof Error ? cause.message : "词汇恢复失败，现有词汇未修改。"); }
    }
  }

  const preview = pending?.preview;
  const statusText = ({
    PREPARING: "请选择备份保存位置", FREEZING: "正在暂停词汇写入并创建快照", WRITING: "正在写入并校验备份", CANCELLING: "正在取消备份…", COMPLETED: "备份完成，校验通过", FAILED: "备份失败", CANCELLED: "备份已取消",
  }[phase] || message);

  return <section className="settings-card data-management-card" data-testid="vocabulary-backup-panel" data-restore-phase={restorePhase} data-restore-request-id={restoreRequestId || restoreResultRequestId || undefined}>
    <div className="settings-card-heading">
      <div><span>Data management</span><h2>词汇备份与恢复</h2></div>
      <small>只备份词汇、保存的语境释义、熟悉度、复习记录和必要来源信息。电子书、EPUB、杂志、文章全文、阅读进度、设置、Agent、Codex、Chromium 数据及 API 凭据均不包含在内。</small>
    </div>
    {recoveryRequired && <div className="data-management-error" role="alert">词汇恢复事务尚未安全解决，已暂停词汇写入。请保留原始数据并联系支持，不要清除 Reader 数据。</div>}
    <div className="data-management-actions">
      <div className="data-management-action">
        <div><strong>备份个人词汇</strong><span>当前词汇：{vocabularyCount === null ? "无法读取" : `${vocabularyCount} 条`} · 生成一个带完整性校验的小型 JSON 文件。</span></div>
        <button className="primary-button" data-testid="vocabulary-backup-start" disabled={busy || recoveryRequired} onClick={startBackup}>{requestId ? "备份进行中…" : "选择位置并备份"}</button>
      </div>
      <div className="data-management-action">
        <div><strong>恢复词汇</strong><span>验证备份并预览合并结果；默认合并，不覆盖本机已有词汇或个人笔记。</span></div>
        <input ref={inputRef} className="data-backup-input" data-testid="vocabulary-backup-input" type="file" accept=".json,application/json" onChange={event => void chooseRestoreFile(event.target.files?.[0])} />
        <button className="text-button data-backup-choose" disabled={busy || recoveryRequired} onClick={() => inputRef.current?.click()}>选择词汇备份文件</button>
      </div>
    </div>
    {requestId && <div className="reader-backup-progress" data-testid="vocabulary-backup-progress">
      <strong role="status">{message || statusText}</strong>
      {phase !== "FREEZING" && <><progress max={100} value={progress} /><span>{progress}%</span></>}
      {phase === "FREEZING" && <button className="text-button" onClick={cancelBackup}>取消备份</button>}
    </div>}
    {lastBackup && <p className="muted-text" data-testid="vocabulary-backup-last">上次备份：{formatDate(lastBackup.createdAt)} · {lastBackup.name} · {lastBackup.vocabularyCount} 条词汇 · {formatSize(lastBackup.size)}</p>}
    {backupResult && <div className="reader-backup-success" data-testid="vocabulary-backup-success" role="status">
      <strong>词汇备份完成，SHA-256 校验通过</strong><span>{backupResult.name} · {backupResult.vocabularyCount} 条词汇 · {formatSize(backupResult.size)}</span>
      <code>SHA-256：{backupResult.sha256}</code><button className="text-button" onClick={revealBackup}>在 Finder 中显示</button>
    </div>}
    {restoreMessage && <p role="status" className="muted-text">{restoreMessage}</p>}
    {restoreNotice && <p role="status" className="muted-text" data-testid="vocabulary-restore-result" data-request-id={restoreResultRequestId || undefined}>{restoreNotice}{/(本机未找到|来源目录)/.test(restoreNotice) && <> <button className="text-button" type="button" onClick={openLibrary}>前往书库重新导入</button></>}</p>}
    {pending && preview && <div className="data-backup-preview" data-testid="vocabulary-restore-preview">
      <div className="data-backup-preview-heading"><div><strong>{pending.fileName}</strong><span>已验证 SHA-256 · 备份版本 {pending.backup.backupFormatVersion} · 创建于 {formatDate(pending.backup.createdAt)}</span></div>
        <button className="primary-button" data-testid="vocabulary-restore-confirm" disabled={busy || recoveryRequired} onClick={requestRestoreConfirmation}>确认合并恢复</button></div>
      <div className="data-backup-preview-grid">
        <div><span>备份词汇</span><strong>{preview.backupVocabularyCount}</strong></div><div><span>当前词汇</span><strong>{preview.currentVocabularyCount}</strong></div><div><span>预计新增</span><strong>{preview.newVocabularyCount}</strong></div>
        <div><span>已有词汇</span><strong>{preview.existingVocabularyCount}</strong></div><div><span>可合并记录</span><strong>{preview.mergeableRecords}</strong></div><div><span>冲突字段（保留本机用户内容）</span><strong>{preview.conflictCount}</strong></div>
        <div><span>不兼容记录</span><strong>{preview.incompatibleCount}</strong></div>
      </div>
      {pending.sourceCheck.status === "checked" && pending.sourceCheck.missingDocumentIds.length > 0 && <div className="data-management-error" role="status"><p>本机尚未找到 {pending.sourceCheck.missingDocumentIds.length} / {pending.sourceCheck.documentCount} 个来源。恢复后仍会保留关联词汇；可重新导入原书籍或杂志。</p><button className="text-button" type="button" onClick={openLibrary}>前往书库重新导入</button></div>}
      {pending.sourceCheck.status === "unavailable" && <div className="settings-help" role="status"><p>暂时无法检查本机书库；恢复仍会保留来源名称和内部 ID，不会创建空书籍或删除词汇。</p><button className="text-button" type="button" onClick={openLibrary}>前往书库查看或重新导入</button></div>}
      <p className="settings-help">词汇按来源文档、段落、词形和位置匹配。重复导入不会重复增加学习次数；本机熟悉度和笔记优先保留。找不到原书籍或杂志时，来源记录仍会保留，不会重新创建空书籍。</p>
    </div>}
    {restoreConfirmationOpen && pending && preview && <div className="data-backup-confirmation-backdrop">
      <div className="data-backup-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="vocabulary-restore-dialog-title" aria-describedby="vocabulary-restore-dialog-summary" data-request-id={restoreRequestId || undefined}>
        <h3 id="vocabulary-restore-dialog-title">确认合并恢复</h3>
        <p id="vocabulary-restore-dialog-summary">将合并“{pending.fileName}”中的词汇：备份 {preview.backupVocabularyCount} 条，本机 {preview.currentVocabularyCount} 条，预计新增 {preview.newVocabularyCount} 条，可合并 {preview.mergeableRecords} 条记录，字段冲突 {preview.conflictCount} 处。现有笔记和熟悉度优先保留。{pending.sourceCheck.status === "checked" ? ` 本机未找到来源 ${pending.sourceCheck.missingDocumentIds.length} / ${pending.sourceCheck.documentCount} 个；关联记录仍会保留。` : " 来源目录暂不可用，所有来源关联仍会保留。"}</p>
        <div className="data-backup-confirmation-actions">
          <button className="text-button" type="button" data-testid="vocabulary-restore-cancel" onClick={cancelRestoreConfirmation}>取消</button>
          <button className="primary-button" type="button" data-testid="vocabulary-restore-commit" onClick={commitRestore}>开始合并恢复</button>
        </div>
      </div>
    </div>}
    {error && <div className="data-management-error" role="alert">{error}</div>}
    <p className="settings-help">来源信息只保留名称、内部 ID、段落位置和最多 320 个字符的短语境。恢复后如果原书籍或杂志不在本机，相关词汇与来源关联仍会保留，可重新导入原文件。</p>
  </section>;
}
