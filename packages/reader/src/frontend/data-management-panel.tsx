import { useRef, useState } from "react";
import { getReaderStorage } from "./reader-storage";
import { downloadReaderBackup } from "./storage-notice";
import {
  clearUserData,
  parseUserDataBackup,
  restoreUserDataBackup,
  summarizeUserDataBackup,
  type UserDataBackupSummary,
  type UserDataBackupV1,
} from "./user-data-backup";

interface PendingBackup {
  fileName: string;
  backup: UserDataBackupV1;
  summary: UserDataBackupSummary;
}

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

function displayBackupTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

export function DataManagementPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [error, setError] = useState<string | null>(null);

  function exportBackup() {
    try {
      downloadReaderBackup();
      setError(null);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出备份失败。");
    }
  }

  async function chooseBackup(file: File | undefined) {
    setPending(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setError("备份文件超过 25 MB，未读取。");
      return;
    }
    try {
      const backup = parseUserDataBackup(await file.text());
      setPending({ fileName: file.name, backup, summary: summarizeUserDataBackup(backup) });
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "无法读取备份文件。");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function restoreBackup() {
    if (!pending) return;
    if (getReaderStorage().getSnapshot().pendingCount) {
      setError("有尚未保存的内容，请先导出当前备份并重试保存，再恢复其他备份。");
      return;
    }
    const confirmed = window.confirm(`确定恢复 ${pending.fileName} 吗？\n\n这会用备份快照覆盖当前浏览器中的 Magazine Reader 阅读与学习数据；EPUB 和 AI 服务配置不会变化。`);
    if (!confirmed) return;
    try {
      restoreUserDataBackup(window.localStorage, pending.backup);
      getReaderStorage().discardPending();
      window.location.reload();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复备份失败。");
    }
  }

  function clearReadingData() {
    const first = window.confirm("确定清除当前浏览器中的全部 Magazine Reader 阅读数据吗？\n\n包括阅读位置、偏好、稍后阅读、历史、笔记、词汇、复习日程和翻译缓存。EPUB 与 AI 服务配置不会删除。建议先导出备份。");
    if (!first) return;
    const final = window.confirm("最后确认：清除后无法撤销，除非你已经有备份文件。\n\n仍然要清除吗？");
    if (!final) return;
    try {
      clearUserData(window.localStorage);
      getReaderStorage().discardPending();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清除失败，请检查浏览器权限。");
    }
  }

  return (
    <section className="settings-card data-management-card">
      <div className="settings-card-heading">
        <div><span>Data management</span><h2>数据管理</h2></div>
        <small>备份只包含当前浏览器里的 Magazine Reader 阅读与学习数据；不包含 EPUB、API Key 或服务端 AI 配置。</small>
      </div>

      <div className="data-management-actions">
        <div className="data-management-action">
          <div><strong>导出备份</strong><span>生成一个版本化 JSON 快照，可用于换浏览器或换电脑后恢复。</span></div>
          <button className="primary-button" onClick={exportBackup}>导出备份 JSON</button>
        </div>
        <div className="data-management-action">
          <div><strong>恢复备份</strong><span>先选择文件并校验、预览；只有再次确认后才会覆盖当前浏览器数据。</span></div>
          <input ref={inputRef} className="data-backup-input" data-testid="data-backup-input" type="file" accept=".json,application/json" onChange={(event) => void chooseBackup(event.target.files?.[0])} />
          <button className="text-button data-backup-choose" onClick={() => inputRef.current?.click()}>选择备份文件</button>
        </div>
      </div>

      {pending && (
        <div className="data-backup-preview" data-testid="data-backup-preview">
          <div className="data-backup-preview-heading">
            <div><strong>{pending.fileName}</strong><span>导出于 {displayBackupTime(pending.summary.exportedAt)} · {pending.summary.categoryCount} 类数据</span></div>
            <button className="primary-button" onClick={restoreBackup}>恢复这个备份</button>
          </div>
          <div className="data-backup-preview-grid">
            {pending.summary.entries.map((entry) => <div key={entry.key}><span>{entry.label}</span><strong>{entry.count}</strong></div>)}
            {!pending.summary.entries.length && <span className="muted-text">这个备份没有已保存的数据项，将恢复为空状态。</span>}
          </div>
        </div>
      )}

      {error && <div className="data-management-error" role="alert">{error}</div>}

      <div className="data-danger-zone">
        <div><strong>清除全部本地阅读数据</strong><span>只清除本应用 allowlist 中的浏览器数据，不碰 EPUB、AI Provider 配置或其他 localStorage key。</span></div>
        <button className="text-button data-clear-button" onClick={clearReadingData}>清除阅读数据</button>
      </div>
    </section>
  );
}
