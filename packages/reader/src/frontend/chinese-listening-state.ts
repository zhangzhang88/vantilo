import type { ReaderDocumentView } from "./reading-document-view";

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
  updatedAt?: number;
}
type ReadStorage = Pick<Storage, "getItem">;
export function validListeningPosition(value: unknown): value is ChineseListeningPosition {
  if (!value || typeof value !== "object") return false;
  const item = value as ChineseListeningPosition;
  return typeof item.documentId === "string" && !!item.documentId && typeof item.sourceText === "string"
    && Number.isInteger(item.paragraphIndex) && item.paragraphIndex >= 0
    && Number.isInteger(item.chunkIndex) && item.chunkIndex >= 0 && typeof item.chunkText === "string"
    && Number.isFinite(item.seconds) && item.seconds >= 0 && item.seconds <= 86_400
    && (item.updatedAt === undefined || (Number.isFinite(item.updatedAt) && item.updatedAt >= 0))
    && [.75, 1, 1.25, 1.5].includes(item.rate) && typeof item.completed === "boolean";
}
export function loadChineseListeningRecords(storage: ReadStorage, key = CHINESE_LISTENING_KEY): ChineseListeningPosition[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter(validListeningPosition).slice(0, 100) : [];
  } catch { return []; }
}
export function saveChineseListeningPosition(storage: ReadStorage & Pick<Storage, "setItem">, position: ChineseListeningPosition, key = CHINESE_LISTENING_KEY) {
  storage.setItem(key, JSON.stringify([position, ...loadChineseListeningRecords(storage, key).filter(item => item.documentId !== position.documentId)].slice(0, 100)));
}
export function resolveChineseListeningPosition(records: ChineseListeningPosition[], documentId: string, paragraphs: string[]) {
  const saved = records.find(item => item.documentId === documentId);
  if (!saved) return undefined;
  if (paragraphs[saved.paragraphIndex] === saved.sourceText) return saved;
  const matches = paragraphs.flatMap((text, index) => text === saved.sourceText ? [index] : []);
  return matches.length === 1 ? { ...saved, paragraphIndex: matches[0] } : undefined;
}

const standaloneDate = /^[·•・]?\s*[0-9]{4}年\s*[0-9]{1,2}月\s*[0-9]{1,2}日[。.]?$/u;
const pageNumber = /^(?:第\s*[0-9]+\s*[页頁]|Page\s+[0-9]+)$/iu;
const sourceLabel = /^(?:[▲▼△▽]\s*)?(?:资料来源|資料來源|图表来源|圖表來源|Sources?)\s*:/iu;

export function narratableParagraphIndexes(article: Pick<ReaderDocumentView, "paragraphs" | "tables" | "visuals">): number[] {
  const excluded = new Set([
    ...(article.tables ?? []).flatMap(table => table.captionParagraphIndexes),
    ...(article.visuals ?? []).flatMap(visual => [...visual.coveredParagraphIndexes, ...visual.captionParagraphIndexes]),
  ]);
  const playable: number[] = [];
  for (const [index, text] of article.paragraphs.entries()) {
    if (excluded.has(index) || !/\p{L}/u.test(text)) continue;
    const line = text.normalize("NFKC").trim();
    if (pageNumber.test(line) || sourceLabel.test(line) || (!playable.length && standaloneDate.test(line))) continue;
    playable.push(index);
  }
  return playable;
}

const sentenceEnd = /[。！？!?；;…\n]/u;
const clauseEnd = /[，、：,:]/u;
const closingPunctuation = /[」』”’）》】〉）)\]"']/u;
const numeric = /[0-9０-９]/u;

export function splitChineseSpeech(text: string, limit = 130): string[] {
  if (!text.trim() || !Number.isInteger(limit) || limit < 1) return [];
  const characters = Array.from(text);
  const chunks: string[] = [];
  const minimum = Math.ceil(limit / 2);
  let start = 0;
  while (start + limit < characters.length) {
    const maximum = start + limit;
    let sentence = 0, clause = 0;
    for (let i = start + minimum - 1; i < maximum; i++) {
      const character = characters[i];
      const next = characters[i + 1];
      const atSentenceEnd = sentenceEnd.test(character)
        || (character === "." && (/\s/u.test(next) || closingPunctuation.test(next)));
      const withinNumber = (character === "," || character === "，" || character === ":" || character === "：")
        && numeric.test(characters[i - 1]) && numeric.test(next);
      if (!atSentenceEnd && (!clauseEnd.test(character) || withinNumber)) continue;

      // Keep closing quotes and runs of punctuation with the sentence or clause.
      let end = i + 1;
      while (end < maximum && (closingPunctuation.test(characters[end]) || sentenceEnd.test(characters[end]))) end++;
      if (!closingPunctuation.test(characters[end]) && !sentenceEnd.test(characters[end])) {
        if (atSentenceEnd) sentence = end;
        else clause = end;
      }
      i = end - 1;
    }
    const end = sentence || clause || maximum;
    chunks.push(characters.slice(start, end).join(""));
    start = end;
  }
  chunks.push(characters.slice(start).join(""));
  return chunks.filter(chunk => chunk.trim());
}

/** Older split points can land inside a new chunk. Replay from its beginning
 * because the saved seconds refer to audio synthesized from different text. */
export function resolveSpeechChunk(chunks: string[], position: { chunkIndex: number; chunkText?: string; seconds?: number }) {
  const { chunkIndex, chunkText, seconds = 0 } = position;
  if (!chunkText || chunks[chunkIndex] === chunkText) {
    return { chunkIndex: Math.max(0, Math.min(chunkIndex, chunks.length - 1)), seconds };
  }
  const text = chunks.join("");
  const offset = text.indexOf(chunkText);
  if (offset !== -1 && text.indexOf(chunkText, offset + 1) === -1) {
    let end = 0;
    for (const [index, chunk] of chunks.entries()) {
      end += chunk.length;
      if (end > offset) return { chunkIndex: index, seconds: chunk === chunkText ? seconds : 0 };
    }
  }
  return { chunkIndex: 0, seconds: 0 };
}
