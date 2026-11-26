import { useEffect, useState } from "react";
import type { BookRecord } from "../shared/book-data-contract";
import type { BookTocChineseTitles } from "../shared/book-toc-chinese";
import {
  buildTranslatedBookEpub,
  inspectBookExportEngines,
  loadBookExportAssets,
  loadBookTranslationRecordsForEngine,
  resolveBookTranslationsForExport,
  triggerEpubDownload,
  type BookExportEngineChoice,
  type BookExportEngineReadiness,
  type BookExportMode,
  type BuiltBookEpub,
} from "./book-translation-export";
import { isListeningTranslationEngine } from "./chinese-translation-reuse";
import { getReaderStorage } from "./reader-storage";
import type { ReaderCollectionView } from "./reading-document-view";

export interface BookExportSource {
  book: BookRecord;
  collection: ReaderCollectionView;
  tocTitles?: BookTocChineseTitles;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function BookExportPanel({
  book,
  collection,
  tocTitles,
  refreshKey,
}: BookExportSource & { refreshKey?: string }) {
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState("");
  const [engines, setEngines] = useState<BookExportEngineReadiness[]>([]);
  const [engineId, setEngineId] = useState("");
  const [mode, setMode] = useState<BookExportMode>("zh");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [lastResult, setLastResult] = useState<Pick<BuiltBookEpub, "filename" | "chapterCount" | "imageCount"> | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const nextController = new AbortController();
      controller = nextController;
      setChecking(true);
      setCheckError("");
      setExportError("");

      void (async () => {
        let available: BookExportEngineChoice[] = [];
        try {
          const response = await fetch("/api/vantilo-translation/engines", { cache: "no-store", signal: nextController.signal });
          if (response.ok) {
            const data: { engines?: BookExportEngineChoice[] } = await response.json();
            available = (data.engines ?? []).filter(engine => isListeningTranslationEngine(engine.id));
          }
        } catch {
          if (nextController.signal.aborted) return;
          // Offline or unconfigured engines should not prevent exporting already-cached translations.
        }

        if (nextController.signal.aborted) return;
        const inspected = await inspectBookExportEngines(book, collection, getReaderStorage(), available, tocTitles);
        if (nextController.signal.aborted) return;

        setEngines(inspected);
        const readyList = inspected.filter(item => item.ready);
        setEngineId(current => {
          if (current && readyList.some(item => item.engineId === current)) return current;
          return readyList[0]?.engineId ?? inspected[0]?.engineId ?? "";
        });
      })().catch(error => {
        if (!nextController.signal.aborted) setCheckError(errorMessage(error, "无法检查全书译文状态，请重试。"));
      }).finally(() => {
        if (!nextController.signal.aborted) setChecking(false);
      });
    };
    load();
    window.addEventListener("vantilo-custom-api-updated", load);
    return () => {
      controller?.abort();
      window.removeEventListener("vantilo-custom-api-updated", load);
    };
  }, [book, collection, tocTitles, refreshKey]);

  const readyEngines = engines.filter(item => item.ready);
  const selectedReady = readyEngines.find(item => item.engineId === engineId) ?? readyEngines[0];
  const bestProgress = engines[0];

  async function handleExport() {
    if (!selectedReady || exporting) return;
    setExporting(true);
    setExportError("");
    setLastResult(null);
    setExportStatus("正在读取全书译文…");
    try {
      const storage = getReaderStorage();
      const records = await loadBookTranslationRecordsForEngine(collection, selectedReady.engineId, storage);
      const resolved = resolveBookTranslationsForExport(book, collection, records, tocTitles);
      if (!resolved.readiness.ready) {
        throw new Error(`全书译文尚未完整（还差 ${resolved.readiness.remainingChapters} 章），请先完成「翻译全书」。`);
      }

      setExportStatus("正在打包封面与插图…");
      const assets = await loadBookExportAssets(book);

      setExportStatus("正在生成 EPUB 文件…");
      const epub = await buildTranslatedBookEpub(book, resolved, {
        mode,
        tocTitles,
        engineLabel: selectedReady.label,
      }, assets);

      triggerEpubDownload(epub);
      setLastResult({
        filename: epub.filename,
        chapterCount: epub.chapterCount,
        imageCount: epub.imageCount,
      });
      setExportStatus("");
    } catch (error) {
      setExportError(errorMessage(error, "导出 EPUB 失败，请重试。"));
      setExportStatus("");
    } finally {
      setExporting(false);
    }
  }

  return <div className="issue-translation-options book-export-panel" aria-label="导出译文 EPUB">
    {checking && <small role="status">正在检查全书译文完整度…</small>}
    {!checking && checkError && <small role="alert">{checkError}</small>}
    {!checking && !checkError && selectedReady && <>
      {readyEngines.length > 1
        ? <label>译文来源模型
          <select value={selectedReady.engineId} onChange={event => {
            setEngineId(event.target.value);
            setLastResult(null);
            setExportError("");
          }} disabled={exporting}>
            {readyEngines.map(item => <option key={item.engineId} value={item.engineId}>{item.label}</option>)}
          </select>
        </label>
        : <small role="status">全书译文已就绪 · {selectedReady.label}（{selectedReady.totalChapters}/{selectedReady.totalChapters} 章，100%）</small>}
      <label>导出内容
        <select value={mode} onChange={event => {
          setMode(event.target.value as BookExportMode);
          setLastResult(null);
          setExportError("");
        }} disabled={exporting}>
          <option value="zh">纯中文译文</option>
          <option value="bilingual">中英双语对照</option>
        </select>
      </label>
      <small className="book-export-hint">导出标准 EPUB（含目录{book.cover ? "、封面" : ""}与插图），可导入 Apple Books、微信读书、Kindle 等阅读器。</small>
      {exportStatus && <small role="status">{exportStatus}</small>}
      {lastResult && <small role="status">已导出：{lastResult.filename}（{lastResult.chapterCount} 章{lastResult.imageCount ? `，含 ${lastResult.imageCount} 张图片` : ""}）</small>}
      {exportError && <small role="alert">{exportError}</small>}
      <button type="button" className="primary-button" disabled={exporting} onClick={() => { void handleExport(); }}>
        {exporting ? "正在生成 EPUB…" : "导出 EPUB"}
      </button>
    </>}
    {!checking && !checkError && !selectedReady && <>
      <small role="status">{bestProgress && bestProgress.translatedTargets > 0
        ? `全书译文尚未完成（${bestProgress.label}：已完成 ${bestProgress.completedChapters}/${bestProgress.totalChapters} 章，约 ${Math.min(99, Math.floor((bestProgress.translatedTargets / Math.max(1, bestProgress.totalTargets)) * 100))}%，还差 ${bestProgress.remainingChapters} 章）。请先完成「翻译全书」，待 100% 译完后即可导出 EPUB。`
        : "尚未完成全书翻译。请先点击「翻译全书」，待整书 100% 译完后即可导出 EPUB。"}</small>
      <button type="button" className="primary-button" disabled>导出 EPUB</button>
    </>}
  </div>;
}
