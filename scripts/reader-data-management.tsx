import { useRef, useState } from "react";
import { getReaderStorage } from "./reader-storage";
import { downloadReaderBackup } from "./storage-notice";
import {
  clearUserData, parseUserDataBackup, restoreUserDataBackup, summarizeUserDataBackup,
  type UserDataBackupSummary, type UserDataBackupV1,
} from "./user-data-backup";

interface PendingBackup { fileName: string; backup: UserDataBackupV1; summary: UserDataBackupSummary }
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

export function DataManagementPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [confirmation, setConfirmation] = useState<"restore" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function exportBackup() {
    try { downloadReaderBackup(); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "导出备份失败。"); }
  }
  async function chooseBackup(file: File | undefined) {
    setPending(null); setConfirmation(null); setError(null);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) { setError("备份文件超过 25 MB，未读取。"); if (inputRef.current) inputRef.current.value = ""; return; }
    try {
      const backup = parseUserDataBackup(await file.text());
      setPending({ fileName: file.name, backup, summary: summarizeUserDataBackup(backup) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取备份文件。"); }
    finally { if (inputRef.current) inputRef.current.value = ""; }
  }
  function applyAction() {
    if (!confirmation || (confirmation === "restore" && !pending)) return;
    if (getReaderStorage().getSnapshot().pendingCount) {
      setError("有尚未保存的阅读内容，请先导出备份并重试保存，再进行此操作。");
      setConfirmation(null); return;
    }
    try {
      if (confirmation === "restore" && pending) restoreUserDataBackup(window.localStorage, pending.backup);
      else if (confirmation === "clear") clearUserData(window.localStorage);
      getReaderStorage().discardPending();
      window.location.reload();
    } catch (cause) {
      setConfirmation(null);
      setError(cause instanceof Error ? cause.message : "操作失败，请检查本机存储空间和权限。");
    }
  }
  const date = (value: string) => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("zh-CN", { hour12: false }) : value; };
  return <section className="settings-card data-management-card">
    <div className="settings-card-heading">
      <div><span>Data management</span><h2>数据管理</h2></div>
      <small>备份包含本机的阅读进度、笔记、词汇、阅读偏好和部分翻译缓存。EPUB、中文目录缓存、API 服务与密钥、ChatGPT 登录及 Agent 会话不包含在内。</small>
    </div>
    <div className="data-management-actions">
      <div className="data-management-action"><div><strong>导出阅读备份</strong><span>保存备份文件，可在另一台安装 Vantilo 的电脑上恢复；书籍需另行导入。</span></div><button className="primary-button" onClick={exportBackup}>导出阅读备份</button></div>
      <div className="data-management-action"><div><strong>恢复阅读备份</strong><span>选择并预览备份，再确认覆盖本机对应的阅读数据。</span></div><input ref={inputRef} className="data-backup-input" data-testid="data-backup-input" type="file" accept=".json,application/json" onChange={event => void chooseBackup(event.target.files?.[0])} /><button className="text-button data-backup-choose" onClick={() => inputRef.current?.click()}>选择备份文件</button></div>
    </div>
    {pending && <div className="data-backup-preview" data-testid="data-backup-preview"><div className="data-backup-preview-heading"><div><strong>{pending.fileName}</strong><span>导出于 {date(pending.summary.exportedAt)} · {pending.summary.categoryCount} 类数据</span></div><button className="primary-button" onClick={() => { setError(null); setConfirmation("restore"); }}>恢复这个备份</button></div><div className="data-backup-preview-grid">{pending.summary.entries.map(entry => <div key={entry.key}><span>{entry.label}</span><strong>{entry.count}</strong></div>)}{!pending.summary.entries.length && <span className="muted-text">备份没有数据项；恢复后对应的阅读数据将为空。</span>}</div></div>}
    {error && <div className="data-management-error" role="alert">{error}</div>}
    <div className="data-danger-zone"><div><strong>清除阅读与学习记录</strong><span>清除进度、笔记、词汇、阅读偏好和此备份包含的缓存；书籍、中文目录缓存、API 设置和 Agent 会话会保留。建议先导出备份。</span></div><button className="text-button data-clear-button" onClick={() => { setError(null); setConfirmation("clear"); }}>清除阅读数据</button></div>
    {confirmation && <div className="data-backup-preview" role="alertdialog" aria-modal="false" aria-labelledby="data-action-title"><div className="data-backup-preview-heading"><div><strong id="data-action-title">{confirmation === "restore" ? "确认恢复阅读备份？" : "确认清除阅读与学习记录？"}</strong><span>{confirmation === "restore" ? `将用“${pending?.fileName}”覆盖本机对应记录，备份中没有的项目会被清空。` : "清除后无法撤销；请确认已保存需要保留的备份。"}</span></div><div><button className="text-button" onClick={() => setConfirmation(null)}>取消</button><button className="primary-button" onClick={applyAction}>{confirmation === "restore" ? "确认恢复" : "确认清除"}</button></div></div></div>}
  </section>;
}
