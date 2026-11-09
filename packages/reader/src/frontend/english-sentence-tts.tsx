import { useEffect, useRef, useState } from "react";
import { ChineseStreamingAudioPlayer } from "./chinese-streaming-audio-player";
import type { SpeechPhase } from "./chinese-audio-types";
import { getReaderStorage } from "./reader-storage";
import { getEnglishSpeechClipCache } from "./selection-speech-clips";
import {
  DEFAULT_QWEN_TTS_ENGLISH_VOICE,
  isEnglishQwenTtsVoice,
  loadEnglishQwenTtsVoice,
  QWEN_TTS_ENGLISH_VOICES,
  saveEnglishQwenTtsVoice,
  type EnglishQwenTtsVoice,
} from "../shared/qwen-tts-voices";

/** An individual long English sentence may exceed the local API's 500-character limit. */
export function splitEnglishSentenceForTts(text: string, limit = 380): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const boundary = remaining.lastIndexOf(" ", limit);
    const end = boundary >= Math.floor(limit / 2) ? boundary : limit;
    const chunk = remaining.slice(0, end).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** One sentence only: no automatic next-sentence playback, translation or learning data writes. */
export function EnglishSentenceTts({ text }: { text: string }) {
  const [voice, setVoice] = useState<EnglishQwenTtsVoice>(() => loadEnglishQwenTtsVoice(getReaderStorage()));
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [error, setError] = useState("");
  const playerRef = useRef<ChineseStreamingAudioPlayer | null>(null);

  useEffect(() => {
    const stopForOtherAudio = () => { playerRef.current?.stop(); setPhase("idle"); setError(""); };
    window.addEventListener("magazine-reader:stop-english-sentence-audio", stopForOtherAudio);
    return () => {
      window.removeEventListener("magazine-reader:stop-english-sentence-audio", stopForOtherAudio);
      playerRef.current?.stop();
      playerRef.current = null;
    };
  }, [text]);

  function startPlayback(chosenVoice: EnglishQwenTtsVoice, regenerate: boolean) {
    playerRef.current?.stop();
    const cache = getEnglishSpeechClipCache();
    const player = new ChineseStreamingAudioPlayer({
      indices: [0],
      getText: async () => text,
      splitText: splitEnglishSentenceForTts,
      // On first playback, keep streaming for responsive first sound, while
      // caching only completed clips. Replay uses the finished cached PCM.
      synthesize: (chunk, signal) => cache.stream(chunk, chosenVoice, signal, regenerate),
      phase: (next, detail) => {
        if (playerRef.current !== player) return;
        setPhase(next); setError(detail ?? "");
      },
      position: () => {},
    });
    playerRef.current = player;
    setPhase("idle"); setError("");
    void player.start({ paragraphIndex: 0, chunkIndex: 0 });
  }

  function toggle(regenerate = false) {
    const player = playerRef.current;
    if (!regenerate && (phase === "playing" || phase === "loading")) { player?.pause(); return; }
    if (!regenerate && phase === "paused") { player?.resume(); return; }
    window.dispatchEvent(new Event("magazine-reader:stop-word-audio"));
    window.dispatchEvent(new Event("magazine-reader:stop-selection-speech"));
    window.dispatchEvent(new Event("magazine-reader:stop-reply-audio"));
    window.dispatchEvent(new Event("magazine-reader:pause-chinese-audio"));
    startPlayback(voice, regenerate);
  }

  function changeVoice(value: string) {
    if (!isEnglishQwenTtsVoice(value) || value === voice) return;
    const restart = phase === "playing" || phase === "loading";
    playerRef.current?.stop();
    setVoice(value);
    try { saveEnglishQwenTtsVoice(getReaderStorage(), value); }
    catch { /* Keep this session's choice without overwriting user data. */ }
    setPhase("idle"); setError("");
    if (restart) {
      window.dispatchEvent(new Event("magazine-reader:stop-word-audio"));
      window.dispatchEvent(new Event("magazine-reader:stop-selection-speech"));
      window.dispatchEvent(new Event("magazine-reader:stop-reply-audio"));
      window.dispatchEvent(new Event("magazine-reader:pause-chinese-audio"));
      startPlayback(value, false);
    }
  }

  const playing = phase === "playing" || phase === "loading";
  const label = playing ? "暂停英文朗读" : phase === "paused" ? "继续英文朗读" : phase === "complete" ? "重新朗读英文句子" : "朗读当前英文句子";
  return <div className="sentence-english-tts" aria-label="英文句子朗读">
    <button type="button" className="sentence-translation-toggle sentence-english-play" aria-label={label} onClick={event => toggle(event.altKey)}
      disabled={!text.trim()} title={label + "（按住 Option 点击可重新生成音频）"}>
      <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
      <span className="sentence-english-play-label">{phase === "loading" ? "准备中" : phase === "playing" ? "朗读中" : phase === "paused" ? "继续" : phase === "complete" ? "重播" : "朗读"}</span>
    </button>
    <label className="sentence-english-voice-label">
      <span>音色</span>
      <select aria-label="英文朗读音色" value={voice} onChange={event => changeVoice(event.target.value)}>
        {QWEN_TTS_ENGLISH_VOICES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {error && <span role="alert" className="sentence-english-tts-error">{error}</span>}
  </div>;
}
