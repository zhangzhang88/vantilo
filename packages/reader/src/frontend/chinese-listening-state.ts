export const CHINESE_LISTENING_KEY = "magazine-reader-chinese-listening-v1";
export interface ChineseListeningPosition {
  documentId: string;
  paragraphIndex: number;
  sourceText: string;
  chunkIndex: number;
  chunkText: string;
  seconds: number;
  rate: number;
  completed: boolean;
}
type ReadStorage = Pick<Storage, "getItem">;
export function validListeningPosition(value: unknown): value is ChineseListeningPosition {
  if (!value || typeof value !== "object") return false;
  const item = value as ChineseListeningPosition;
  return typeof item.documentId === "string" && !!item.documentId && typeof item.sourceText === "string"
    && Number.isInteger(item.paragraphIndex) && item.paragraphIndex >= 0
    && Number.isInteger(item.chunkIndex) && item.chunkIndex >= 0 && typeof item.chunkText === "string"
    && Number.isFinite(item.seconds) && item.seconds >= 0 && item.seconds <= 86_400
    && [.75, 1, 1.25, 1.5].includes(item.rate) && typeof item.completed === "boolean";
}
export function loadChineseListeningRecords(storage: ReadStorage): ChineseListeningPosition[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(CHINESE_LISTENING_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(validListeningPosition).slice(0, 100) : [];
  } catch { return []; }
}
export function saveChineseListeningPosition(storage: ReadStorage & Pick<Storage, "setItem">, position: ChineseListeningPosition) {
  storage.setItem(CHINESE_LISTENING_KEY, JSON.stringify([position, ...loadChineseListeningRecords(storage).filter(item => item.documentId !== position.documentId)].slice(0, 100)));
}
export function resolveChineseListeningPosition(records: ChineseListeningPosition[], documentId: string, paragraphs: string[]) {
  const saved = records.find(item => item.documentId === documentId);
  if (!saved) return undefined;
  if (paragraphs[saved.paragraphIndex] === saved.sourceText) return saved;
  const matches = paragraphs.flatMap((text, index) => text === saved.sourceText ? [index] : []);
  return matches.length === 1 ? { ...saved, paragraphIndex: matches[0] } : undefined;
}

/** Bound long unpunctuated Chinese as well as normal sentences; omit no content. */
export function splitChineseSpeech(text: string, limit = 130): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/gu) ?? []) {
    for (const character of sentence) {
      current += character;
      if (Array.from(current).length >= limit) { chunks.push(current); current = ""; }
    }
    if (Array.from(current).length >= limit / 2) { chunks.push(current); current = ""; }
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter(chunk => chunk.trim());
}
