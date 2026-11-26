import type { AudiobookPhase } from "../shared/audiobook-bridge";

export interface AudiobookProgressChapter {
  id: string;
  paragraphs: readonly string[];
  playable: readonly number[];
}

export interface AudiobookChapterMetrics {
  totalWeight: number;
  beforeParagraphWeight: ReadonlyMap<number, number>;
  isLastPlaylistChapter: boolean;
}

export interface AudiobookBookMetrics {
  totalWeight: number;
  beforeChapterWeight: ReadonlyMap<string, number>;
  chapterMetrics: ReadonlyMap<string, AudiobookChapterMetrics>;
}

export function audiobookParagraphWeight(text: string): number {
  const nonWhitespace = text.replace(/\s+/gu, "").length;
  return Math.max(1, nonWhitespace);
}

export function buildAudiobookBookMetrics(
  chapters: readonly AudiobookProgressChapter[],
  playlist: readonly AudiobookProgressChapter[],
): AudiobookBookMetrics {
  const playlistIds = new Set(playlist.map(chapter => chapter.id));
  const lastPlaylistId = playlist[playlist.length - 1]?.id;
  const beforeChapterWeight = new Map<string, number>();
  const chapterMetrics = new Map<string, AudiobookChapterMetrics>();

  let runningWeight = 0;
  for (const chapter of chapters) {
    beforeChapterWeight.set(chapter.id, runningWeight);
    if (!playlistIds.has(chapter.id)) continue;

    const beforeParagraphWeight = new Map<number, number>();
    let chapterWeight = 0;
    for (const paragraphIndex of chapter.playable) {
      beforeParagraphWeight.set(paragraphIndex, chapterWeight);
      chapterWeight += audiobookParagraphWeight(chapter.paragraphs[paragraphIndex] ?? "");
    }
    chapterMetrics.set(chapter.id, {
      totalWeight: chapterWeight,
      beforeParagraphWeight,
      isLastPlaylistChapter: chapter.id === lastPlaylistId,
    });
    runningWeight += chapterWeight;
  }

  return { totalWeight: runningWeight, beforeChapterWeight, chapterMetrics };
}

export function calculateAudiobookProgress(
  metrics: AudiobookBookMetrics,
  chapterId: string,
  paragraphIndex: number,
  phase: AudiobookPhase,
): number | undefined {
  if (metrics.totalWeight <= 0 || !chapterId) return undefined;
  const beforeChapter = metrics.beforeChapterWeight.get(chapterId);
  if (beforeChapter === undefined) return undefined;

  const current = metrics.chapterMetrics.get(chapterId);
  let completedWeight = beforeChapter;
  let finishedBook = false;

  if (current) {
    if (phase === "complete") {
      completedWeight += current.totalWeight;
      finishedBook = current.isLastPlaylistChapter;
    } else {
      const exact = current.beforeParagraphWeight.get(paragraphIndex);
      if (exact !== undefined) {
        completedWeight += exact;
      } else {
        let withinChapter = current.totalWeight;
        for (const [index, weightBefore] of current.beforeParagraphWeight) {
          if (index >= paragraphIndex) {
            withinChapter = weightBefore;
            break;
          }
        }
        completedWeight += withinChapter;
      }
    }
  } else if (phase === "complete" && beforeChapter >= metrics.totalWeight) {
    finishedBook = true;
  }

  if (finishedBook) return 100;
  const rounded = Math.round((completedWeight / metrics.totalWeight) * 100);
  return Math.max(0, Math.min(99, rounded));
}

export interface AudiobookChapterFollowInput {
  previous: { sessionId: number; bookId: string; chapterId: string } | null;
  current: { sessionId: number; bookId: string; chapterId: string; phase: AudiobookPhase };
  page: string;
  viewedBookId?: string;
  viewedChapterId?: string;
}

/** Auto-advance the open book reader chapter only when the user was already reading the chapter that just transitioned. */
export function shouldFollowAudiobookChapter({
  previous,
  current,
  page,
  viewedBookId,
  viewedChapterId,
}: AudiobookChapterFollowInput): boolean {
  if (!previous) return false;
  if (current.phase === "error") return false;
  if (previous.sessionId !== current.sessionId) return false;
  if (previous.bookId !== current.bookId) return false;
  if (previous.chapterId === current.chapterId) return false;
  if (page !== "book-reader") return false;
  if (viewedBookId !== current.bookId) return false;
  return viewedChapterId === previous.chapterId;
}
