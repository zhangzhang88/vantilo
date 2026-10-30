import { useEffect, useState, useSyncExternalStore } from "react";
import { getReaderStorage } from "./reader-storage";

// The upstream Reader compatibility panel still imports this symbol, but Vantilo
// no longer exposes Reader-wide exports. The desktop data-management panel is
// replaced with the vocabulary-only backup flow by the Vantilo build adapter.
export function downloadReaderBackup(): never {
  void getReaderStorage();
  throw new Error("Vantilo 当前仅支持词汇备份，请前往设置中的“数据管理”。");
}

export function StorageNotice() {
  const storage = getReaderStorage();
  const status = useSyncExternalStore(storage.subscribe, storage.getSnapshot);
  useEffect(() => {
    if (!status.pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.pendingCount]);
  if (!status.pendingCount && !status.readFailed) return null;
  return <aside role="alert" data-testid="storage-notice" style={{ position: "fixed", bottom: 12, left: 12, right: 12, zIndex: 10000, padding: 16, background: "var(--surface, #fff8e8)", color: "var(--text, #332c22)", border: "2px solid #b45a25", borderRadius: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
    <span>{status.pendingCount ? "部分内容尚未保存到本机，当前会话仍保留。请重试保存；刷新或关闭可能丢失。" : "无法读取本机保存的数据，请检查存储权限。"}</span>
    {status.pendingCount > 0 && <button onClick={() => storage.retry()}>重试保存</button>}
  </aside>;
}
