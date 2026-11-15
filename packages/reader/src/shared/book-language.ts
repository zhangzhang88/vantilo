import type { BookChapter } from "./book-data-contract.js";

export const BOOK_LANGUAGE_LABELS = {
  zh: "中文",
  en: "英文",
  mixed: "中英双语",
  unknown: "未识别",
} as const;
export type BookLanguage = keyof typeof BOOK_LANGUAGE_LABELS;

export function isBookLanguage(value: unknown): value is BookLanguage {
  return typeof value === "string" && Object.hasOwn(BOOK_LANGUAGE_LABELS, value);
}

export function classifyBookLanguage(book: {
  language?: string | null;
  languages?: string[];
  chapters?: Pick<BookChapter, "role" | "paragraphs">[];
}): BookLanguage {
  const tags = (book.languages ?? [book.language ?? ""]).flatMap(tag => tag.trim().split(/[,;\/\s]+/));
  const chinese = tags.some(tag => /^(?:zh|zho|chi|cmn|yue)(?:[-_]|$)|^(?:中文|简体中文|繁體中文|繁体中文|汉语|漢語|chinese)$/i.test(tag));
  const english = tags.some(tag => /^(?:en|eng)(?:[-_]|$)|^(?:英文|英语|英語|english)$/i.test(tag));
  if (chinese && english) return "mixed";
  const chapters = book.chapters ?? [];
  const numbered = chapters.filter(chapter => chapter.role === "chapter");
  const body = numbered.length >= 2 ? numbered : chapters.filter(chapter =>
    chapter.role === "chapter" || chapter.role === "supplement");
  const sample = sampleEvenly(body, 10).map(chapter =>
    sampleEvenly(chapter.paragraphs, 10).map(paragraph => paragraph.slice(0, 600)).join(" ")
  ).join(" ");

  const han = sample.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = sample.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  const words = sample.toLowerCase().match(/[a-z]+/g) ?? [];
  const englishMarkers = words.filter(word => ENGLISH_MARKERS.has(word));
  const clearlyEnglish = words.length >= 80 && latin / letters >= 0.94
    && englishMarkers.length >= words.length * 0.08 && new Set(englishMarkers).size >= 5;
  const likelyChinese = han >= (english ? 100 : 20) && han / letters >= 0.75
    && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sample);

  if (clearlyEnglish) return "en";
  if (likelyChinese || chinese) return "zh";
  return english ? "en" : "unknown";
}

const ENGLISH_MARKERS = new Set([
  "the", "and", "that", "with", "from", "have", "was", "were",
  "they", "which", "this", "there", "you", "will", "their", "would",
]);

function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) =>
    items[Math.round(index * (items.length - 1) / (limit - 1))]);
}
