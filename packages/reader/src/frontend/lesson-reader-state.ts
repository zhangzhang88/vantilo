import { bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity";
import type { ReadingPositionAnchor } from "./reader-state";
import { clampProgress } from "./reader-state";

export const LESSON_READER_STATE_KEY = "magazine-reader:lesson-reading:v1";
export interface LessonReaderState {
  version: 1;
  progress: Record<string, number>;
  positions: Record<string, ReadingPositionAnchor>;
}

export function loadLessonReaderState(storage: Pick<Storage, "getItem">): LessonReaderState {
  const empty: LessonReaderState = { version: 1, progress: {}, positions: {} };
  try {
    const value = JSON.parse(storage.getItem(LESSON_READER_STATE_KEY) ?? "null");
    if (value?.version !== 1) return empty;
    return {
      version: 1,
      progress: Object.fromEntries(Object.entries(value.progress ?? {}).filter(([key, progress]) => key.startsWith("reading:lesson:") && typeof progress === "number" && Number.isFinite(progress)).map(([key, progress]) => [key, clampProgress(progress as number)])),
      positions: Object.fromEntries(Object.entries(value.positions ?? {}).filter(([key, position]) => {
        const anchor = position as ReadingPositionAnchor | null;
        return key.startsWith("reading:lesson:") && anchor && Number.isInteger(anchor.paragraphIndex) && anchor.paragraphIndex >= 0
          && typeof anchor.paragraphText === "string" && anchor.paragraphText.length > 0 && Number.isFinite(anchor.viewportOffset);
      })) as Record<string, ReadingPositionAnchor>,
    };
  } catch { return empty; }
}

export function saveLessonReaderState(storage: Pick<Storage, "setItem">, state: LessonReaderState): void {
  storage.setItem(LESSON_READER_STATE_KEY, JSON.stringify(state));
}

export const lessonReadingKey = (bookId: string, lessonId: string) => bookLessonReadingDocumentIdentity(bookId, lessonId).documentId;
