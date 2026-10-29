import { describe, expect, it, vi } from "vitest";
import { playGameTone, stopGameTones } from "./game-sounds";

function audioFixture() {
  const oscillators: Array<Record<string, any>> = [];
  const gains: Array<Record<string, any>> = [];
  const destination = {};
  const context = {
    currentTime: 3,
    destination,
    createOscillator: vi.fn(() => {
      const oscillator = { type: "", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) };
      oscillators.push(oscillator);
      return oscillator as unknown as OscillatorNode;
    }),
    createGain: vi.fn(() => {
      const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      gains.push(gain);
      return gain as unknown as GainNode;
    }),
  };
  return { context, oscillators, gains };
}

describe("original synthesized typing-game sounds", () => {
  it.each([
    ["typing", 420, 0.045],
    ["correct", 660, 0.12],
    ["error", 180, 0.16],
  ] as const)("schedules the %s tone without external media", (sound, frequency, duration) => {
    const { context, oscillators, gains } = audioFixture();
    const active = new Set<OscillatorNode>();
    const oscillator = playGameTone(context, sound, active);

    expect(oscillators[0].type).toBe("sine");
    expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(frequency, 3);
    expect(oscillators[0].start).toHaveBeenCalledWith(3);
    expect(oscillators[0].stop).toHaveBeenCalledWith(3 + duration);
    expect(gains[0].gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 3 + duration);
    expect(oscillators[0].connect).toHaveBeenCalledWith(gains[0]);
    expect(gains[0].connect).toHaveBeenCalledWith(context.destination);
    expect(active.has(oscillator)).toBe(true);
    oscillators[0].onended?.();
    expect(active.size).toBe(0);
  });

  it("stops and clears active tones safely", () => {
    const { context, oscillators } = audioFixture();
    const active = new Set<OscillatorNode>();
    playGameTone(context, "typing", active);
    stopGameTones(active);
    expect(oscillators[0].stop).toHaveBeenCalledTimes(2);
    expect(active.size).toBe(0);
  });
});
