import { useEffect, useState, useSyncExternalStore } from "react";
import { getReaderStorage } from "./reader-storage";
import { buildUserDataBackup, serializeUserDataBackup, userDataBackupFilename } from "./user-data-backup";

export function downloadReaderBackup() {
  const backup = buildUserDataBackup(getReaderStorage());
  const url = URL.createObjectURL(new Blob([serializeUserDataBackup(backup)], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = userDataBackupFilename(backup.exportedAt);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function StorageNotice() {
  const storage = getReaderStorage();
  const status = useSyncExternalStore(storage.subscribe, storage.getSnapshot);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!status.pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.pendingCount]);
  if (!status.pendingCount && !status.readFailed) return null;
  return <aside role="alert" data-testid="storage-notice" style={{ position: "fixed", bottom: 12, left: 12, right: 12, zIndex: 10000, padding: 16, background: "var(--surface, #fff8e8)", color: "var(--text, #332c22)", border: "2px solid #b45a25", borderRadius: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
    <span>{status.pendingCount ? "部分内容尚未保存到浏览器，当前会话仍保留。请重试或先导出备份，刷新或关闭可能丢失。" : "无法读取浏览器保存的数据，请检查浏览器存储权限。"}</span>
    {status.pendingCount > 0 && <button onClick={() => storage.retry()}>重试保存</button>}
    <button onClick={() => { try { downloadReaderBackup(); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败"); } }}>导出当前备份</button>
    {error && <span>{error}</span>}
  </aside>;
}
