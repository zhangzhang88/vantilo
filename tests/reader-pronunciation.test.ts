import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  playWordPronunciation, selectVantiloAccentVoice, waitForVantiloAccentVoice, youdaoWordAudioUrl,
} from '../scripts/reader-pronunciation';

function voice(name: string, lang: string, isDefault = false) {
  return { name, lang, default: isDefault, localService: true, voiceURI: name } as SpeechSynthesisVoice;
}
function harness(voices: SpeechSynthesisVoice[], playImpl: () => Promise<void> = async () => { throw Error("offline"); }) {
  const speak = vi.fn();
  const cancel = vi.fn();
  let current = [...voices];
  const callbacks = new Set<() => void>();
  const synthesis = {
    getVoices: () => [...current], speak, cancel,
    addEventListener: vi.fn((_name: string, callback: () => void) => callbacks.add(callback)),
    removeEventListener: vi.fn((_name: string, callback: () => void) => callbacks.delete(callback)),
  };
  class Utterance {
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    constructor(public text: string) {}
  }
  const instances: Array<{
    url: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn>;
  }> = [];
  const makeAudio = vi.fn().mockImplementation(function(url: string) {
    const audio = {
      url, play: vi.fn(playImpl), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(),
    };
    instances.push(audio);
    return audio;
  });
  vi.stubGlobal('window', { speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance });
  vi.stubGlobal('Audio', makeAudio);
  return {
    synthesis, speak, cancel, instances, makeAudio,
    updateVoices(next: SpeechSynthesisVoice[]) {
      current = [...next];
      for (const callback of callbacks) callback();
    },
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Reader US/UK independent pronunciation', () => {
  const us = voice('Samantha', 'en-US');
  const uk = voice('Daniel', 'en-GB');
  it('chooses a matching region voice, never the system default of another accent', () => {
    const voices = [voice('Bad News', 'en-US', true), uk, voice('Boing', 'en-US'), us];
    expect(selectVantiloAccentVoice(voices, 'us')).toBe(us);
    expect(selectVantiloAccentVoice(voices, 'uk')).toBe(uk);
    expect(selectVantiloAccentVoice([us], 'uk')).toBeNull();
    expect(selectVantiloAccentVoice([uk], 'us')).toBeNull();
  });

  it('constructs fixed, encoded Youdao URLs per accent, rejecting untrusted document words', () => {
    expect(youdaoWordAudioUrl('imposed', 'us')).toBe('https://dict.youdao.com/dictvoice?audio=imposed&type=2');
    expect(youdaoWordAudioUrl('imposed', 'uk')).toBe('https://dict.youdao.com/dictvoice?audio=imposed&type=1');
    expect(youdaoWordAudioUrl("don't", 'us')).toBe("https://dict.youdao.com/dictvoice?audio=don%27t&type=2");
    expect(youdaoWordAudioUrl('hello world', 'us')).toBeNull();
    expect(youdaoWordAudioUrl('https://evil.test/a', 'uk')).toBeNull();
    expect(youdaoWordAudioUrl('a?type=1', 'us')).toBeNull();
  });

  it.each(['us','uk'] as const)('plays online %s recording first without native TTS or a default accent', async accent => {
    for (const defaultAccent of ['us','uk'] as const) {
      const preference = { pronunciationAccent: defaultAccent };
      const h = harness([us,uk], async () => {});
      // Dictionary is considered untrusted and cannot override the fixed URL.
      const result = await playWordPronunciation('imposed', {
        usAudioUrl: 'https://attacker.test/unsafe', ukAudioUrl: 'https://attacker.test/unsafe',
      }, accent);
      expect(result).toBe(true);
      expect(h.instances.at(-1)?.url).toBe(youdaoWordAudioUrl('imposed',accent));
      expect(h.speak).not.toHaveBeenCalled();
      expect(preference.pronunciationAccent).toBe(defaultAccent);
      vi.unstubAllGlobals();
    }
  });

  it.each(['us','uk'] as const)('on online %s failure speaks the matching Mac voice, independent of the preference', async accent => {
    for (const defaultAccent of ['us','uk'] as const) {
      const readerPreference = { pronunciationAccent: defaultAccent };
      const h = harness([us,uk]);
      const success = await playWordPronunciation('imposed', {usAudioUrl:'',ukAudioUrl:''}, accent);
      expect(success).toBe(true);
      expect(h.instances.at(-1)?.pause).toHaveBeenCalled();
      expect(h.speak).toHaveBeenCalledOnce();
      const utterance = h.speak.mock.calls[0]![0] as {voice: SpeechSynthesisVoice;lang:string;text:string};
      expect(utterance.voice.lang).toBe(accent === 'us' ? 'en-US' : 'en-GB');
      expect(utterance.lang).toBe(utterance.voice.lang);
      expect(utterance.text).toBe('imposed');
      expect(readerPreference.pronunciationAccent).toBe(defaultAccent);
      vi.unstubAllGlobals();
    }
  });

  it('fails over to local TTS after a short online timeout and stops remote playback', async () => {
    vi.useFakeTimers();
    const h = harness([us,uk], () => new Promise<void>(() => {}));
    const result = playWordPronunciation('imposed', undefined, 'uk');
    await vi.advanceTimersByTimeAsync(1550);
    expect(await result).toBe(true);
    expect(h.instances.at(-1)?.pause).toHaveBeenCalled();
    expect(h.speak).toHaveBeenCalledOnce();
    expect(h.speak.mock.calls[0]![0].voice).toBe(uk);
  });

  it('only speaks the last click when the earlier remote request finishes late', async () => {
    let resolveFirst!: () => void;
    let count = 0;
    const h = harness([us,uk], () => {
      count++;
      if (count === 1) return new Promise<void>(resolve => { resolveFirst = resolve; });
      return Promise.reject(new Error('offline'));
    });
    const first = playWordPronunciation('imposed', undefined, 'us');
    await Promise.resolve();
    await Promise.resolve();
    const second = playWordPronunciation('imposed', undefined, 'uk');
    expect(await second).toBe(true);
    resolveFirst();
    expect(await first).toBe(false);
    expect(h.speak).toHaveBeenCalledOnce();
    expect(h.speak.mock.calls[0]![0].voice).toBe(uk);
    expect(h.instances[0]?.pause).toHaveBeenCalled();
  });

  it('waits for Chromium to asynchronously load voices', async () => {
    const h = harness([]);
    const pending = waitForVantiloAccentVoice(h.synthesis as unknown as SpeechSynthesis, 'uk');
    h.updateVoices([us]);
    h.updateVoices([us,uk]);
    expect(await pending).toBe(uk);
    expect(h.synthesis.addEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
    expect(h.synthesis.removeEventListener).toHaveBeenCalled();
  });

  it('does not substitute the wrong locale when only the other region voice exists', async () => {
    const h = harness([us]);
    vi.useFakeTimers();
    const result = playWordPronunciation('imposed', undefined, 'uk');
    await vi.advanceTimersByTimeAsync(1600);
    expect(await result).toBe(false);
    expect(h.speak).not.toHaveBeenCalled();
  });

  it('does not send an arbitrary phrase or URL over the network', async () => {
    const h = harness([us,uk]);
    expect(await playWordPronunciation('two words', undefined, 'us')).toBe(true);
    expect(h.makeAudio).not.toHaveBeenCalled();
    expect(h.speak).toHaveBeenCalledOnce();
  });
});
