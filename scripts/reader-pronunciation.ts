// Vantilo Reader pronunciation. Youdao online recording is attempted for an
// English headword; if it does not start promptly, use only the matching
// installed macOS speech voice. No arbitrary URL or accent substitution.
export type VantiloEnglishAccent = "us" | "uk";

const YOUDAO_AUDIO_ORIGIN = "https://dict.youdao.com";
const ONLINE_AUDIO_TIMEOUT_MS = 1500;
let playbackGeneration = 0;
let activeAudio: HTMLAudioElement | null = null;

export function youdaoWordAudioUrl(word: string, accent: VantiloEnglishAccent): string | null {
  if (word.length > 100 || !/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(word)) return null;
  const type = accent === "us" ? "2" : "1";
  return YOUDAO_AUDIO_ORIGIN + "/dictvoice?audio=" + encodeURIComponent(word).replaceAll("\u0027", "%27") + "&type=" + type;
}

export function selectVantiloAccentVoice(
  voices: readonly SpeechSynthesisVoice[],
  accent: VantiloEnglishAccent,
): SpeechSynthesisVoice | null {
  const locale = accent === "us" ? "en-US" : "en-GB";
  const matching = voices.filter(voice =>
    voice.lang.replaceAll("_", "-").toLocaleLowerCase("en-US") === locale.toLocaleLowerCase("en-US"));
  if (!matching.length) return null;
  const natural = accent === "us" ? ["Samantha", "Eddy", "Flo"] : ["Daniel", "Eddy", "Flo"];
  const rank = (voice: SpeechSynthesisVoice) => {
    const index = natural.findIndex(name => voice.name === name || voice.name.startsWith(name + " ("));
    return index >= 0 ? index : natural.length;
  };
  return matching.slice().sort((left, right) => rank(left) - rank(right))[0] ?? null;
}

export async function waitForVantiloAccentVoice(
  synthesis: SpeechSynthesis,
  accent: VantiloEnglishAccent,
): Promise<SpeechSynthesisVoice | null> {
  const current = selectVantiloAccentVoice(synthesis.getVoices(), accent);
  if (current) return current;
  return await new Promise<SpeechSynthesisVoice | null>(resolve => {
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true;
      synthesis.removeEventListener("voiceschanged", onChange);
      clearTimeout(timeout);
      resolve(selectVantiloAccentVoice(synthesis.getVoices(), accent));
    };
    const onChange = () => {
      if (selectVantiloAccentVoice(synthesis.getVoices(), accent)) complete();
    };
    const timeout = setTimeout(complete, 1200);
    synthesis.addEventListener("voiceschanged", onChange);
    onChange();
  });
}

function stopPreviousPronunciation(): number {
  const generation = ++playbackGeneration;
  if (activeAudio) {
    try { activeAudio.pause(); activeAudio.removeAttribute("src"); activeAudio.load(); } catch {}
    activeAudio = null;
  }
  window.speechSynthesis?.cancel();
  return generation;
}

async function attemptYoudaoAudio(url: string, generation: number): Promise<boolean> {
  let audio: HTMLAudioElement;
  try { audio = new Audio(url); } catch { return false; }
  activeAudio = audio;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    // Audio.play resolves when playback starts; don't stall on slow networks.
    // Invoke play immediately in the original click gesture; postponing it to
    // a microtask can lose autoplay permission on some Chromium versions.
    const started = generation === playbackGeneration
      ? Promise.resolve(audio.play()).then(() => true, () => false)
      : Promise.resolve(false);
    const deadline = new Promise<false>(resolve => {
      timeout = setTimeout(() => { timedOut = true; resolve(false); }, ONLINE_AUDIO_TIMEOUT_MS);
    });
    const success = await Promise.race([started, deadline]);
    if (!success || generation !== playbackGeneration) {
      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch {}
      if (activeAudio === audio) activeAudio = null;
      return false;
    }
    return true;
  } catch {
    if (activeAudio === audio) activeAudio = null;
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (timedOut) {
      // A late play resolution must not overlap the native TTS fallback.
      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch {}
    }
  }
}

export async function playWordPronunciation(
  text: string,
  _dictionary: { usAudioUrl?: string; ukAudioUrl?: string } | undefined,
  accent: VantiloEnglishAccent,
): Promise<boolean> {
  const word = text.trim();
  if (!word || word.length > 160) return false;
  const generation = stopPreviousPronunciation();
  // Build the URL from a validated word, never an arbitrary dictionary URL.
  const youdao = youdaoWordAudioUrl(word, accent);
  if (youdao && await attemptYoudaoAudio(youdao, generation)) return true;
  if (generation !== playbackGeneration) return false;

  const synthesis = window.speechSynthesis;
  if (!synthesis || !window.SpeechSynthesisUtterance) return false;
  const voice = await waitForVantiloAccentVoice(synthesis, accent);
  if (generation !== playbackGeneration) return false;
  if (!voice) {
    console.warn("所选英语口音的系统语音不可用", accent);
    return false;
  }
  const utterance = new window.SpeechSynthesisUtterance(word);
  utterance.lang = accent === "us" ? "en-US" : "en-GB";
  utterance.voice = voice;
  synthesis.speak(utterance);
  return true;
}