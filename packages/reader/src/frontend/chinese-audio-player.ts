import { splitChineseSpeech } from "./chinese-listening-state";

export interface SpeechCursor { paragraphIndex: number; chunkIndex: number; chunkText?: string; seconds?: number; }
export type SpeechPhase = "idle" | "loading" | "playing" | "paused" | "complete" | "error";
type Part = { cursor: SpeechCursor; text: string; next: SpeechCursor | null; url: string };
type Prepared = { part: Part } | { error: Error } | null;
interface Dependencies {
  indices: number[];
  getText: (index: number) => Promise<string>;
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob>;
  phase: (phase: SpeechPhase, error?: string) => void;
  position: (cursor: SpeechCursor, seconds: number, completed: boolean) => void;
  audio?: (url: string) => HTMLAudioElement;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
}

/** A bounded, disposable playback session. No audio is written to persistent storage. */
export class ChineseAudioPlayer {
  private controller?: AbortController;
  private currentAudio?: HTMLAudioElement;
  private urls = new Set<string>();
  private paused = false;
  private wake?: () => void;
  private current?: SpeechCursor;
  private rate = 1;
  constructor(private dependencies: Dependencies) {}
  setRate(rate: number) { this.rate = rate; if (this.currentAudio) this.currentAudio.playbackRate = rate; }
  pause() {
    if (!this.controller) return;
    this.paused = true;
    this.currentAudio?.pause();
    this.reportPosition();
    this.dependencies.phase("paused");
  }
  resume() {
    if (!this.controller || !this.paused) return;
    this.paused = false;
    this.wake?.();
    this.wake = undefined;
    if (this.currentAudio) {
      const controller = this.controller;
      this.dependencies.phase("playing");
      void this.currentAudio.play().catch(error => {
        if (this.controller === controller && !controller.signal.aborted) { this.stop(); this.dependencies.phase("error", error instanceof Error ? error.message : "请再次点击播放"); }
      });
    } else this.dependencies.phase("loading");
  }
  private reportPosition(completed = false) {
    if (this.current) this.dependencies.position(this.current, this.currentAudio?.currentTime ?? this.current.seconds ?? 0, completed);
  }
  stop() {
    this.reportPosition();
    this.controller?.abort();
    this.controller = undefined;
    this.wake?.(); this.wake = undefined;
    if (this.currentAudio) {
      this.currentAudio.onended = this.currentAudio.onerror = this.currentAudio.ontimeupdate = null;
      this.currentAudio.pause(); this.currentAudio.removeAttribute("src"); this.currentAudio.load();
      this.currentAudio = undefined;
    }
    for (const url of this.urls) (this.dependencies.revokeUrl ?? URL.revokeObjectURL)(url);
    this.urls.clear();
    this.current = undefined;
    this.paused = false;
  }
  async start(cursor: SpeechCursor) {
    this.stop();
    const controller = new AbortController(); this.controller = controller;
    const signal = controller.signal;
    const valid = () => !signal.aborted;
    this.dependencies.phase("loading");
    const prepare = async (position: SpeechCursor): Promise<Prepared> => {
      try {
        const chunks = splitChineseSpeech(await this.dependencies.getText(position.paragraphIndex));
        if (!valid()) return null;
        if (!chunks.length) throw new Error("这一段没有可朗读的中文。");
        const chunkIndex = position.chunkText && chunks[position.chunkIndex] !== position.chunkText ? 0 : Math.min(position.chunkIndex, chunks.length - 1);
        const text = chunks[chunkIndex];
        const nextParagraph = this.dependencies.indices[this.dependencies.indices.indexOf(position.paragraphIndex) + 1];
        const next = chunkIndex + 1 < chunks.length ? { paragraphIndex: position.paragraphIndex, chunkIndex: chunkIndex + 1 }
          : nextParagraph !== undefined ? { paragraphIndex: nextParagraph, chunkIndex: 0 } : null;
        const blob = await this.dependencies.synthesize(text, signal);
        if (!valid()) return null;
        const url = (this.dependencies.createUrl ?? URL.createObjectURL)(blob); this.urls.add(url);
        return { part: { cursor: { ...position, chunkIndex, chunkText: text, seconds: chunkIndex === position.chunkIndex && (!position.chunkText || position.chunkText === text) ? position.seconds : 0 }, text, next, url } };
      } catch (error) { return valid() ? { error: error instanceof Error ? error : new Error("语音准备失败，请重试。") } : null; }
    };
    const advance = (item: Promise<Prepared>) => item.then(result => result && "part" in result && result.part.next ? prepare(result.part.next) : null);
    try {
      let current = prepare(cursor);
      let ahead = advance(current);
      let following = advance(ahead);
      while (valid()) {
        const result = await current;
        if (!valid() || !result) break;
        if ("error" in result) throw result.error;
        const part = result.part;
        this.current = part.cursor;
        if (this.paused) await new Promise<void>(resolve => { this.wake = resolve; });
        if (!valid()) return;
        const audio = (this.dependencies.audio ?? (url => new Audio(url)))(part.url);
        this.currentAudio = audio; audio.playbackRate = this.rate;
        if ((part.cursor.seconds ?? 0) > 0) {
          audio.addEventListener("loadedmetadata", () => {
            if (valid() && Number.isFinite(audio.duration)) audio.currentTime = Math.min(part.cursor.seconds!, Math.max(0, audio.duration - .1));
          }, { once: true });
        }
        audio.ontimeupdate = () => { if (valid()) this.reportPosition(); };
        this.dependencies.phase("playing"); this.reportPosition();
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            signal.removeEventListener("abort", abort);
            audio.onended = audio.onerror = null;
            error ? reject(error) : resolve();
          };
          const abort = () => finish();
          signal.addEventListener("abort", abort, { once: true });
          audio.onended = () => finish();
          audio.onerror = () => finish(new Error("音频播放失败，请重试。"));
          void audio.play().catch(error => finish(error instanceof Error ? error : new Error("请再次点击播放。")));
        });
        if (!valid()) return;
        audio.ontimeupdate = null;
        this.reportPosition(!part.next);
        this.currentAudio = undefined;
        (this.dependencies.revokeUrl ?? URL.revokeObjectURL)(part.url); this.urls.delete(part.url);
        if (!part.next) { this.controller = undefined; this.current = undefined; this.dependencies.phase("complete"); return; }
        this.current = { ...part.next, seconds: 0 };
        this.reportPosition();
        current = ahead; ahead = following; following = advance(following);
        if (!this.paused) this.dependencies.phase("loading");
      }
    } catch (error) {
      if (valid()) { this.stop(); this.dependencies.phase("error", error instanceof Error ? error.message : "朗读失败，请重试。"); }
    }
  }
}
