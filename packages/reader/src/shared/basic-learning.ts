import type { BookLesson } from "./book-lesson.js";
import { learningSourceSentences, learningTokens, wholeWordSpans } from "./learning-material.js";

export interface BasicWord { id: string; sentenceId: string; context: string; start: number; end: number; answer: string; }
export interface BasicSentence { id: string; english: string; tokens: { text: string; start: number; end: number }[]; }
export interface BasicMaterial {
  id: string; materialVersion: string; sourceVersion: string; title: string;
  words: BasicWord[]; defaultWordIds: string[]; sentences: BasicSentence[];
}

/** All answers and offsets come from the lesson text, never from a draft or a model. */
export function createBasicMaterial(lesson: BookLesson, sourceVersion: string, candidates: unknown[] = []): BasicMaterial {
  if (!lesson.english.trim() || lesson.english.length > 12000 || !sourceVersion) throw new Error("精选英文为空或超出基础练习范围");
  const sources = learningSourceSentences(lesson.english);
  const words: BasicWord[] = sources.flatMap(sentence => learningTokens(sentence.english).filter(token => token.text.length <= 100).map(token => ({
    id: `v:${sentence.id}:${token.start}`, sentenceId: sentence.id, context: sentence.english, start: token.start, end: token.end, answer: token.text,
  })));
  const sentences: BasicSentence[] = sources.flatMap(sentence => {
    const tokens = learningTokens(sentence.english);
    const chunks: BasicSentence[] = [];
    for (let index = 0; index < tokens.length; index += 100) {
      const start = index ? tokens[index].start : 0;
      const end = tokens[index + 100]?.start ?? sentence.english.length;
      const english = sentence.english.slice(start,end);
      chunks.push({ id: `${sentence.id}:basic:${index / 100}`, english, tokens: learningTokens(english) });
    }
    return chunks;
  });
  if (!words.length || !sentences.length) throw new Error("精选英文中没有可练习的单词");
  const preferred: BasicWord[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const surface = typeof item.sourceText === "string" ? item.sourceText : item.text;
    if (typeof item.sentenceId !== "string" || typeof surface !== "string") continue;
    const sentence = sources.find(source => source.id === item.sentenceId);
    if (!sentence) continue;
    const spans = wholeWordSpans(sentence.english,surface);
    const occurrence = item.occurrence === undefined && spans.length === 1 ? 0 : item.occurrence;
    if (!Number.isInteger(occurrence) || Number(occurrence) < 0) continue;
    const offset = spans[Number(occurrence)];
    const word = words.find(value => value.sentenceId === sentence.id && value.start === offset && value.answer === surface && value.end === offset + surface.length);
    if (word && (item.answerText === undefined || item.answerText === word.answer)) preferred.push(word);
  }
  const preferredCount = new Set(preferred.map(word => word.answer.toLocaleLowerCase("en-US"))).size;
  const selected: BasicWord[] = [], seen = new Set<string>();
  for (const word of [...preferred,...words.filter(item => item.answer.length >= 4),...words]) {
    const key = word.answer.toLocaleLowerCase("en-US");
    if (!seen.has(key)) { selected.push(word); seen.add(key); }
    if (selected.length >= Math.min(24, Math.max(12, preferredCount))) break;
  }
  return { id: `learning:basic:${lesson.bookId}:${lesson.id}`, materialVersion: `basic-v1:${sourceVersion}`, sourceVersion, title: lesson.titleZh, words, defaultWordIds: selected.map(word => word.id), sentences };
}
