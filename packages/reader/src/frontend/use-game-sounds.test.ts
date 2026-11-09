// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useGameSounds } from "./use-game-sounds";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function suspendedAudioFixture() {
  const oscillators: Array<{
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    stop: ReturnType<typeof vi.fn>;
    onended: null | (() => void);
  }> = [];
  let resumeNow: (() => void) | undefined;
  class FakeAudioContext {
    state: AudioContextState = "suspended";
    currentTime = 3;
    destination = {};
    resume = vi.fn(() => new Promise<void>(resolve => {
      resumeNow = () => { this.state = "running"; resolve(); };
    }));
    close = vi.fn(async () => { this.state = "closed"; });
    createOscillator = vi.fn(() => {
      const oscillator = {
        type: "sine", frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void),
      };
      oscillators.push(oscillator);
      return oscillator;
    });
    createGain = vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }));
  }
  const audio = new FakeAudioContext();
  vi.stubGlobal("AudioContext", function AudioContextFixture() { return audio; });
  return { audio, oscillators, resume: async () => { expect(resumeNow).toBeDefined(); resumeNow!(); await Promise.resolve(); } };
}

describe("game sound playback in Chromium", () => {
  it("resumes suspended audio before scheduling the initial typing tone and preserves correct/error tones", async () => {
    const { audio, oscillators, resume } = suspendedAudioFixture();
    const { result, unmount } = renderHook(() => useGameSounds(true));
    act(() => { result.current.playTypingSound(); });
    expect(audio.resume).toHaveBeenCalledTimes(1);
    expect(audio.createOscillator).not.toHaveBeenCalled();
    await act(resume);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(420,3);
    act(() => { result.current.playCorrectSound(); result.current.playErrorSound(); });
    expect(oscillators).toHaveLength(3);
    expect(oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(660,3);
    expect(oscillators[2].frequency.setValueAtTime).toHaveBeenCalledWith(180,3);
    act(() => { result.current.stopAllSounds(); });
    expect(oscillators.every(sound => sound.stop.mock.calls.length >= 2)).toBe(true);
    unmount();
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("does not play a delayed tone after the exercise unmounts", async () => {
    const { audio, resume } = suspendedAudioFixture();
    const { result, unmount } = renderHook(() => useGameSounds());
    act(() => { result.current.playTypingSound(); });
    unmount();
    await act(resume);
    expect(audio.createOscillator).not.toHaveBeenCalled();
  });

  it("uses the exact original MP3 paths in both development and packaged Reader builds", () => {
    const created: Array<{ src:string; currentTime:number; play:ReturnType<typeof vi.fn>;pause:ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal("__VANTILO_ORIGINAL_GAME_SOUNDS__",true);
    vi.stubGlobal("Audio",function LocalSound(src:string) {
      const audio={src,currentTime:0,preload:"",play:vi.fn(async()=>{}),pause:vi.fn()};
      created.push(audio);
      return audio;
    });
    const { result,unmount } = renderHook(()=>useGameSounds(true));
    expect(created.map(audio=>audio.src)).toEqual([
      "/worm/typing.mp3","/worm/correct.mp3","/worm/error.mp3",
    ]);
    act(()=>{result.current.playTypingSound();result.current.playCorrectSound();result.current.playErrorSound();});
    expect(created.every(audio=>audio.play.mock.calls.length===1)).toBe(true);
    act(()=>result.current.stopAllSounds());
    expect(created.every(audio=>audio.pause.mock.calls.length>=2)).toBe(true);
    unmount();
  });

  it("waits for the exact original correct MP3 to finish before resolving", async()=>{
    type LocalAudio={src:string;play:ReturnType<typeof vi.fn>;pause:ReturnType<typeof vi.fn>;
      currentTime:number;preload:string;addEventListener:(type:string,fn:()=>void)=>void;
      removeEventListener:(type:string,fn:()=>void)=>void;emit:(name:string)=>void};
    const created:LocalAudio[]=[];
    vi.stubGlobal("__VANTILO_ORIGINAL_GAME_SOUNDS__",true);
    vi.stubGlobal("Audio",function LocalSound(src:string){
      const events=new Map<string,Set<()=>void>>();
      const audio:LocalAudio={src,currentTime:0,preload:"",play:vi.fn(async()=>{}),pause:vi.fn(),
        addEventListener:(type,fn)=>{if(!events.has(type))events.set(type,new Set());events.get(type)!.add(fn);},
        removeEventListener:(type,fn)=>events.get(type)?.delete(fn),
        emit:(name)=>{for(const fn of [...(events.get(name)??[])])fn();}};
      created.push(audio);return audio;
    });
    const {result,unmount}=renderHook(()=>useGameSounds(true));
    let resolved=false;
    let playing!:Promise<void>;
    act(()=>{playing=result.current.playCorrectSoundAndWait();void playing.then(()=>{resolved=true;});});
    expect(created[1].src).toBe("/worm/correct.mp3");
    expect(created[1].play).toHaveBeenCalledOnce();
    await act(async()=>{await Promise.resolve();});
    expect(resolved).toBe(false);
    await act(async()=>{created[1].emit("ended");await playing;});
    expect(resolved).toBe(true);
    unmount();
  });

  it("does not interrupt typing when the audio output is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    const { result } = renderHook(() => useGameSounds());
    expect(() => act(() => { result.current.playTypingSound(); result.current.playErrorSound(); })).not.toThrow();
  });
});
