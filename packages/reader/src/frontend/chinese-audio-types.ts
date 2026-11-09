/** Persisted by the Chinese audiobook view; also used by the reply-reading player. */
export interface SpeechCursor {
  paragraphIndex: number;
  chunkIndex: number;
  chunkText?: string;
  seconds?: number;
}
export type SpeechPhase = "idle" | "loading" | "playing" | "paused" | "complete" | "error";
