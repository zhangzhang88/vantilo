export type ReaderReturnSource = "search" | "bookmarks" | "history" | "notes" | "vocabulary";

export interface ReaderReturnTarget {
  page: ReaderReturnSource;
  label: string;
  detail?: string;
}

const READER_RETURN_LABELS: Record<ReaderReturnSource, string> = {
  search: "搜索",
  bookmarks: "稍后阅读",
  history: "阅读历史",
  notes: "笔记",
  vocabulary: "词汇",
};

export function createReaderReturnTarget(source: ReaderReturnSource, detail?: string): ReaderReturnTarget {
  const normalizedDetail = detail?.trim();
  return {
    page: source,
    label: READER_RETURN_LABELS[source],
    ...(normalizedDetail ? { detail: normalizedDetail } : {}),
  };
}
