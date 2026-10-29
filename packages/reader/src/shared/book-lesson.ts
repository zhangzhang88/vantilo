import type { BookResearchReport } from "./book-research.js";
export interface LessonEvidence { chapterId: string; paragraphIndex: number; }
export interface BookLessonDraft {
  topicKey?: string;
  titleZh: string;
  teaserZh: string;
  english: string;
  explanationZh: string;
  keywords: string[];
  evidence: LessonEvidence[];
  wordCount: number;
  adaptation: "AI 简易英文改写，非原著引文";
}
export interface BookLesson extends BookLessonDraft {
  id: string;
  bookId: string;
  bookTitle: string;
  sourceFingerprint: string;
  createdAt: string;
}
export interface PrepChatMessage { role: "user" | "assistant"; text: string; research?: BookResearchReport; paragraphIndexes?: number[]; }

export function lessonParagraphs(lesson: Pick<BookLessonDraft, "english">): string[] {
  return lesson.english.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
}
