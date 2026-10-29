export type GameSound = "typing" | "correct" | "error";

type ToneAudioContext = Pick<AudioContext, "currentTime" | "destination" | "createOscillator" | "createGain">;

const toneSettings: Record<GameSound, { frequency: number; duration: number }> = {
  typing: { frequency: 420, duration: 0.045 },
  correct: { frequency: 660, duration: 0.12 },
  error: { frequency: 180, duration: 0.16 },
};

export function playGameTone(context: ToneAudioContext, sound: GameSound, active: Set<OscillatorNode>) {
  const { frequency, duration } = toneSettings[sound];
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime;
  const end = start + duration;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.07, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.onended = () => active.delete(oscillator);
  active.add(oscillator);
  oscillator.start(start);
  oscillator.stop(end);
  return oscillator;
}

export function stopGameTones(active: Set<OscillatorNode>) {
  for (const oscillator of active) {
    try { oscillator.stop(); } catch { /* The tone may already have ended. */ }
  }
  active.clear();
}
