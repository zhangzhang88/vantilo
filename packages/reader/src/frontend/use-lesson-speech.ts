import { useCallback, useEffect, useRef, useState } from "react";
import { LEARNING_VOICES, type LearningVoiceId } from "../shared/learning-audio";
import type { LearningMaterial } from "../shared/learning-material";
import type { LearningAudioManifest, LearningVoiceAudio } from "../shared/learning-audio";
import { ChineseStreamingAudioPlayer } from "./chinese-streaming-audio-player";
import { getEnglishSpeechClipCache } from "./selection-speech-clips";

const noClips: NonNullable<LearningMaterial["audio"]>["clips"] = [];

/** Saved lessons use cached audio; temporary ordered practice streams its own exact text. */
export function useLessonSpeech(material: LearningMaterial, voice: LearningVoiceId = LEARNING_VOICES[0].id) {
  const current = useRef<HTMLAudioElement | null>(null), finish = useRef<(() => void) | null>(null);
  const streaming = useRef<ChineseStreamingAudioPlayer | null>(null);
  const [error,setError] = useState("");
  const [prepared,setPrepared] = useState<LearningVoiceAudio | null>(null);
  const cancelSpeech = useCallback(() => { streaming.current?.stop(); streaming.current = null; current.current?.pause(); if (current.current) { current.current.onended = null; current.current.onerror = null; } current.current = null; finish.current?.(); finish.current = null; },[]);
  useEffect(() => cancelSpeech,[cancelSpeech]);
  const saved = material.audio?.voices?.find(item => item.voice === voice) ?? (material.audio?.voice === voice ? material.audio : null);
  const clips = prepared?.voice === voice ? prepared.clips : saved?.clips ?? noClips;
  useEffect(() => {
    setPrepared(null);
    if (material.stage === "vocabulary" || material.generator.engine === "basic-source" || material.generator.engine === "ordered-preview") { setError(""); return; }
    if (saved?.status === "ready") { setError(""); return; }
    const controller = new AbortController();
    setError("正在准备当前音色的 Qwen3-TTS 缓存，完成后即可朗读。");
    const endpoint = `/api/books/${encodeURIComponent(material.source.bookId)}/lessons/${encodeURIComponent(material.source.lessonId)}/learning-audio`;
    const inspect = async () => {
      try {
        const response = await fetch(`${endpoint}?voice=${encodeURIComponent(voice)}`, { signal: controller.signal });
        if (!response.ok) return;
        const partial = await response.json() as LearningAudioManifest;
        if (!controller.signal.aborted) {
          setPrepared(partial.voices?.find(item => item.voice === voice) ?? partial);
          if (partial.status === "ready") setError("");
        }
      } catch { /* The generating POST below reports the final error. */ }
    };
    void inspect();
    const interval = window.setInterval(() => void inspect(), 1800);
    void fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice }), signal: controller.signal,
    }).then(async response => {
      const value = await response.json() as LearningAudioManifest & { error?: string };
      if (!response.ok) throw new Error(value.error || "课程语音生成失败");
      return value;
    }).then(manifest => {
      if (controller.signal.aborted) return;
      const chosen = manifest.voices?.find(item => item.voice === voice) ?? manifest;
      setPrepared(chosen);
      setError(chosen.status === "ready" ? "" : manifest.error || "当前音色部分音频尚未准备好，请重新选择音色重试。");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "课程语音准备失败"); })
      .finally(() => window.clearInterval(interval));
    return () => { controller.abort(); window.clearInterval(interval); };
  },[voice, material.materialVersion, material.source.bookId, material.source.lessonId, saved?.status]);
  const hasSpeech = useCallback((text: string) => material.generator.engine === "ordered-preview" ? !!text.trim() : !!clips.some(clip => clip.text === text),[clips,material.generator.engine]);
  const speakOnce = useCallback((text: string): Promise<boolean> => {
    cancelSpeech();
    if (material.generator.engine === "ordered-preview") {
      let complete = false;
      const player = new ChineseStreamingAudioPlayer({ indices: [0], getText: async () => text,
        splitText: value => [value], synthesize: (value,signal) => getEnglishSpeechClipCache().stream(value,voice,signal),
        phase: (phase,detail) => { if (phase === "complete") complete = true; if (phase === "error") setError(detail || "朗读播放失败，可以重试。"); }, position: () => {} });
      streaming.current = player; setError("");
      return player.start({ paragraphIndex: 0,chunkIndex: 0 }).then(() => { if (streaming.current === player) streaming.current = null; return complete; });
    }
    const clip = clips.find(item => item.text === text);
    if (!clip || !/^\/api\/learning-audio\/[a-f0-9]{64}\.wav$/.test(clip.url)) { setError("这段 Qwen3-TTS 朗读尚未准备好，请稍后重试。"); return Promise.resolve(false); }
    setError("");
    return new Promise<boolean>(resolve => {
      const audio = new Audio(clip.url); current.current = audio;
      const timer = window.setTimeout(() => { setError("朗读播放超时，可以重试。"); audio.pause(); done(false); },45000);
      const done = (success: boolean) => { window.clearTimeout(timer); if (current.current === audio) { current.current = null; finish.current = null; } audio.onended = null; audio.onerror = null; resolve(success); };
      finish.current = () => done(false); audio.onended = () => done(true); audio.onerror = () => { setError("本地朗读播放失败，可以重试。"); done(false); };
      void audio.play().catch(() => { if (current.current === audio) setError("请点击播放发音以启用朗读。"); done(false); });
    });
  },[clips,cancelSpeech,material.generator.engine,voice]);
  return { speakOnce,cancelSpeech,hasSpeech,error };
}
