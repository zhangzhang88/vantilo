import { describe, expect, it, vi } from "vitest";
import { ChineseAudioPlayer } from "./chinese-audio-player";
class FakeAudio extends EventTarget {
  currentTime = 0; duration = 30; playbackRate = 1;
  onended: (() => void) | null = null; onerror: (() => void) | null = null; ontimeupdate: (() => void) | null = null;
  play = vi.fn(async () => { this.dispatchEvent(new Event("loadedmetadata")); });
  pause = vi.fn(); removeAttribute = vi.fn(); load = vi.fn();
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(synthesize = vi.fn(async (_text: string, _signal: AbortSignal) => new Blob(["ID3audio"]))) {
  const audios: FakeAudio[] = [], phase = vi.fn(), position = vi.fn(), revoke = vi.fn();
  let id = 0;
  const player = new ChineseAudioPlayer({ indices: [0, 1, 2], getText: async index => `第${index}段中文。`, synthesize,
    phase, position, createUrl: () => `blob:${id++}`, revokeUrl: revoke,
    audio: () => { const audio = new FakeAudio(); audios.push(audio); return audio as unknown as HTMLAudioElement; } });
  return { player, audios, phase, position, revoke, synthesize };
}
describe("Chinese paragraph playback", () => {
  it("starts before the whole chapter is ready and prepares at most two chunks ahead", async () => {
    const f = fixture(); const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 }); await flush();
    expect(f.audios).toHaveLength(1); expect(f.audios[0].play).toHaveBeenCalledTimes(1);
    expect(f.synthesize).toHaveBeenCalledTimes(3);
    f.audios[0].onended?.(); await flush(); expect(f.audios).toHaveLength(2);
    f.audios[1].onended?.(); await flush(); f.audios[2].onended?.(); await run;
    expect(f.phase).toHaveBeenLastCalledWith("complete"); expect(f.revoke).toHaveBeenCalledTimes(3);
    expect(f.position).toHaveBeenLastCalledWith(expect.objectContaining({ paragraphIndex: 2 }), 0, true);
  });
  it("pauses, resumes, changes speed and cancels without reporting playback failure", async () => {
    const f = fixture(); const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 }); await flush();
    f.audios[0].currentTime = 4; f.audios[0].ontimeupdate?.();
    f.player.pause(); expect(f.phase).toHaveBeenLastCalledWith("paused");
    f.player.setRate(1.25); expect(f.audios[0].playbackRate).toBe(1.25);
    f.player.resume(); expect(f.audios[0].play).toHaveBeenCalledTimes(2);
    f.player.stop(); await run;
    expect(f.phase.mock.calls.some(call => call[0] === "error")).toBe(false);
    expect(f.revoke).toHaveBeenCalledTimes(3);
    expect(f.synthesize.mock.calls.every(call => call[1].aborted)).toBe(true);
  });
  it("resumes a matching segment at its audio position and resets changed wording", async () => {
    const f = fixture();
    let run = f.player.start({ paragraphIndex: 1, chunkIndex: 0, chunkText: "第1段中文。", seconds: 6 }); await flush();
    expect(f.audios[0].currentTime).toBe(6); f.player.stop(); await run;
    run = f.player.start({ paragraphIndex: 1, chunkIndex: 4, chunkText: "旧译文。", seconds: 6 }); await flush();
    expect(f.audios[1].currentTime).toBe(0); f.player.stop(); await run;
  });
  it("does not interrupt the current audio when a prefetched request fails", async () => {
    const f = fixture(vi.fn(async (text: string, _signal: AbortSignal) => { if (text.startsWith("第1")) throw new Error("网络中断"); return new Blob(["ID3audio"]); }));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 }); await flush();
    expect(f.phase).toHaveBeenLastCalledWith("playing");
    f.audios[0].onended?.(); await run;
    expect(f.phase).toHaveBeenLastCalledWith("error", "网络中断");
  });
  it("keeps the next chunk as the resume point when paused between generated chunks", async () => {
    let resolve!: (value: Blob) => void;
    const f = fixture(vi.fn((text: string, _signal: AbortSignal) => text.startsWith("第1") ? new Promise<Blob>(done => { resolve = done; }) : Promise.resolve(new Blob(["ID3audio"]))));
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 }); await flush();
    f.audios[0].currentTime = 20; f.audios[0].onended?.(); await flush();
    f.player.pause();
    expect(f.position).toHaveBeenLastCalledWith(expect.objectContaining({ paragraphIndex: 1, chunkIndex: 0 }), 0, false);
    f.player.stop(); resolve(new Blob(["ID3audio"])); await run;
  });
  it("aborts late generation and never creates stale object URLs after leaving", async () => {
    let resolve!: (value: Blob) => void;
    const f = fixture(vi.fn((_text: string, _signal: AbortSignal) => new Promise<Blob>(done => { resolve = done; })));
    const run = f.player.start({ paragraphIndex: 2, chunkIndex: 0 }); await flush();
    f.player.stop(); resolve(new Blob(["ID3audio"])); await run;
    expect(f.audios).toHaveLength(0); expect(f.revoke).not.toHaveBeenCalled();
  });
});
