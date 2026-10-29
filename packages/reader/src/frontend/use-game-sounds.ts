import { useCallback, useEffect, useRef } from "react";
import { playGameTone, stopGameTones, type GameSound } from "./game-sounds";

export function useGameSounds(enabled = true) {
  const context = useRef<AudioContext | null>(null);
  const active = useRef(new Set<OscillatorNode>());

  useEffect(() => () => {
    stopGameTones(active.current);
    if (context.current && context.current.state !== "closed") void context.current.close();
    context.current = null;
  }, []);

  const play = useCallback((sound: GameSound) => {
    if (!enabled || typeof window === "undefined" || !window.AudioContext) return;
    const audio = context.current ?? (context.current = new window.AudioContext());
    if (audio.state === "suspended") void audio.resume();
    playGameTone(audio, sound, active.current);
  }, [enabled]);

  const playTypingSound = useCallback(() => play("typing"), [play]);
  const playCorrectSound = useCallback(() => play("correct"), [play]);
  const playErrorSound = useCallback(() => play("error"), [play]);
  const stopAllSounds = useCallback(() => stopGameTones(active.current), []);
  return { playTypingSound, playCorrectSound, playErrorSound, stopAllSounds };
}
