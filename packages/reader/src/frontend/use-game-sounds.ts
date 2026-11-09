import { useCallback, useEffect, useRef } from "react";
import { playGameTone, stopGameTones, type GameSound } from "./game-sounds";
declare const __VANTILO_ORIGINAL_GAME_SOUNDS__: boolean;
const originalGameSoundsEnabled = () => typeof __VANTILO_ORIGINAL_GAME_SOUNDS__ !== 'undefined' && __VANTILO_ORIGINAL_GAME_SOUNDS__;
const originalSounds: GameSound[] = ['typing','correct','error'];


export function useGameSounds(enabled = true) {
  const context = useRef<AudioContext | null>(null);
  const active = useRef(new Set<OscillatorNode>());
  const generation = useRef(0);
  const media = useRef<Partial<Record<GameSound,HTMLAudioElement>>>({});
  const pendingSuccessSounds = useRef(new Set<() => void>());
  useEffect(() => {
    if (!originalGameSoundsEnabled()) return;
    for (const sound of originalSounds) {
      const audio = new Audio(`/worm/${sound}.mp3`);
      audio.preload = 'auto';
      media.current[sound] = audio;
    }
    return () => {
      for (const sound of originalSounds) {
        const audio = media.current[sound];
        audio?.pause();
        delete media.current[sound];
      }
    };
  }, []);


  useEffect(() => () => {
    generation.current++;
    stopGameTones(active.current);
    const audio = context.current;
    context.current = null;
    if (audio && audio.state !== "closed") void audio.close().catch(() => {});
  }, []);

  const play = useCallback((sound: GameSound) => {
    if (!enabled || typeof window === "undefined") return;
    const original = media.current[sound];
    if (original) {
      try {
        original.pause();
        original.currentTime = 0;
        void original.play().catch(() => {}); // Never interrupt practice if the device rejects playback.
      } catch { /* Audio errors must not block typing or submission. */ }
      return;
    }

    const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      let audio = context.current;
      if (!audio || audio.state === "closed") audio = context.current = new AudioContextClass();
      const activeGeneration = generation.current;
      const playWhenReady = () => {
        if (context.current !== audio || generation.current !== activeGeneration || !enabled || audio.state !== "running") return;
        try { playGameTone(audio, sound, active.current); } catch { /* Sound failure must not stop typing. */ }
      };
      // A newly created AudioContext may be suspended by Chromium's autoplay policy.
      // Scheduling a 45ms tone *before* resume can silently expire on some macOS sessions.
      if (audio.state === "suspended") void audio.resume().then(playWhenReady).catch(() => {});
      else playWhenReady();
    } catch { /* Audio hardware or browser support must never break the exercise. */ }
  }, [enabled]);


  /** Complete the original success MP3 before starting a new spoken sentence. */
  const playCorrectSoundAndWait = useCallback((): Promise<void> => {
    if (!enabled || typeof window === "undefined") return Promise.resolve();
    const original = media.current.correct;
    if (!original) {
      play("correct");
      return new Promise(resolve => { window.setTimeout(resolve, 140); });
    }
    return new Promise<void>(resolve => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        original.removeEventListener("ended", done);
        original.removeEventListener("error", done);
        pendingSuccessSounds.current.delete(done);
        resolve();
      };
      const timeout = window.setTimeout(done, 3000);
      pendingSuccessSounds.current.add(done);
      original.addEventListener("ended", done, { once: true });
      original.addEventListener("error", done, { once: true });
      try {
        original.pause();
        original.currentTime = 0;
        void original.play().catch(done);
      } catch { done(); }
    });
  }, [enabled, play]);
  useEffect(() => () => { for (const complete of [...pendingSuccessSounds.current]) complete(); }, []);

  const playTypingSound = useCallback(() => play("typing"), [play]);
  const playCorrectSound = useCallback(() => play("correct"), [play]);
  const playErrorSound = useCallback(() => play("error"), [play]);
  const stopAllSounds = useCallback(() => {
    for (const complete of [...pendingSuccessSounds.current]) complete();
    for (const sound of originalSounds) {
      const audio = media.current[sound];
      if (audio) { audio.pause(); audio.currentTime = 0; }
    }
    stopGameTones(active.current);
  }, []);
  return { playTypingSound, playCorrectSound, playCorrectSoundAndWait, playErrorSound, stopAllSounds };
}
