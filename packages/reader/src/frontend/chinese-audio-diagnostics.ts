import type { ChineseAudioDiagnosticEvent } from "./chinese-streaming-audio-player";

/** Session-only, bounded playback diagnostics. No speech, translations, API
 * addresses, keys, reference recordings, or identifying document fields.
 * Inspect from the local Reader webview's sessionStorage when troubleshooting.
 * This never uploads telemetry. */
export const CHINESE_AUDIO_DIAGNOSTICS_KEY = "magazine-reader:chinese-audio-diagnostics:v1";
const MAX_EVENTS = 96;
type SavedEvent = ChineseAudioDiagnosticEvent & { at: number };
const VALID_EVENTS = new Set<ChineseAudioDiagnosticEvent["event"]>([
  "start", "first_pcm", "chunk_ready", "startup_ready", "low_buffer", "buffer_recovered", "complete", "error",
]);

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(1_000_000, value)) * 100) / 100
    : undefined;
}

/** Record a whitelisted, numeric-only event; recording failures cannot affect
 * audio playback. Keep the last 96 events for this tab, capped by overwrite. */
export function recordChineseAudioDiagnostic(input: ChineseAudioDiagnosticEvent): void {
  try {
    if (!VALID_EVENTS.has(input.event) || typeof sessionStorage === "undefined") return;
    const old = JSON.parse(sessionStorage.getItem(CHINESE_AUDIO_DIAGNOSTICS_KEY) ?? "[]") as unknown;
    const history: SavedEvent[] = Array.isArray(old) ? old.slice(-MAX_EVENTS + 1) : [];
    const next: SavedEvent = {
      at: Date.now(),
      event: input.event,
      paragraphIndex: numeric(input.paragraphIndex) ?? 0,
      chunkIndex: numeric(input.chunkIndex) ?? 0,
      elapsedMs: numeric(input.elapsedMs) ?? 0,
    };
    for (const field of ["availableSeconds", "targetSeconds", "completedChunks", "generationMs", "rtf"] as const) {
      const value = numeric(input[field]);
      if (value !== undefined) next[field] = value;
    }
    history.push(next);
    sessionStorage.setItem(CHINESE_AUDIO_DIAGNOSTICS_KEY, JSON.stringify(history));
  } catch {
    // Browser privacy modes / disabled storage must not affect speech.
  }
}
