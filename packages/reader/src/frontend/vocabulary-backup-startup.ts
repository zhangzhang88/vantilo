const JOURNAL_KEY = "vantilo-vocabulary-restore-journal-v1";
const DATA_KEYS = [
  "economist-reader-selections-v1",
  "economist-reader-word-context-v1",
  "magazine-reader-vocabulary-review-v1",
] as const;

export interface VocabularyJournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type RecoveryWindow = Window & { __vantiloVocabularyRecoveryRequired?: string };

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(), wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function blockVocabularyWrites(message: string): void {
  (window as RecoveryWindow).__vantiloVocabularyRecoveryRequired = message;
}

export function recoverVocabularyRestoreJournal(storage: VocabularyJournalStorage): { status: "none" | "rolled-back" | "committed-cleaned" } {
  try {
    const raw = storage.getItem(JOURNAL_KEY);
    if (raw === null) return { status: "none" };
    const journal = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(journal || {});
    const hasLegacyShape = exactKeys(journal || {}, ["version", "phase", "createdAt", "original"]);
    const hasRequestIdShape = exactKeys(journal || {}, ["version", "phase", "transactionId", "createdAt", "original"]);
    if (!journal || typeof journal !== "object" || Array.isArray(journal)
      || (!hasLegacyShape && !hasRequestIdShape)
      || (keys.includes("transactionId") && (typeof journal.transactionId !== "string" || !/^[0-9a-f-]{36}$/i.test(journal.transactionId)))
      || journal.version !== 1 || !["PREPARED", "COMMITTED"].includes(String(journal.phase))
      || typeof journal.createdAt !== "string" || !Number.isFinite(Date.parse(journal.createdAt))) {
      throw new Error("词汇恢复日志格式无效；日志和原始词汇数据已保留。");
    }
    if (journal.phase === "PREPARED") {
      const original = journal.original;
      if (!original || typeof original !== "object" || Array.isArray(original) || !exactKeys(original as Record<string, unknown>, DATA_KEYS)) {
        throw new Error("词汇恢复点缺少必要数据；日志和当前数据已保留。");
      }
      for (const key of DATA_KEYS) {
        const value = (original as Record<string, unknown>)[key];
        if (value !== null && typeof value !== "string") throw new Error(`词汇恢复点 ${key} 无效；原始数据已保留。`);
      }
      for (const key of DATA_KEYS) {
        const value = (original as Record<string, string | null>)[key];
        if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      }
      for (const key of DATA_KEYS) if (storage.getItem(key) !== (original as Record<string, string | null>)[key]) throw new Error("词汇恢复点回滚校验失败；事务日志仍保留。");
    }
    storage.removeItem(JOURNAL_KEY);
    return { status: journal.phase === "PREPARED" ? "rolled-back" : "committed-cleaned" };
  } catch (error) {
    if (typeof window !== "undefined") blockVocabularyWrites(error instanceof Error ? error.message : "词汇恢复事务无法安全处理");
    throw error;
  }
}

// This module is imported before App.tsx so an interrupted restore is rolled back
// before React can load or write any vocabulary record.
if (typeof window !== "undefined") {
  try { recoverVocabularyRestoreJournal(window.localStorage); }
  catch (error) { blockVocabularyWrites(error instanceof Error ? error.message : "词汇恢复事务无法安全处理"); }
}
