import { useCallback, useEffect, useRef, useState } from "react";
import { LEARNING_VOICES, type LearningVoiceId } from "../shared/learning-audio";
import type { LearningMaterial } from "../shared/learning-material";

const noClips: NonNullable<LearningMaterial["audio"]>["clips"] = [];

/** Practice only plays pre-generated local audio. No TTS generation or browser voice substitution. */
export function useLessonSpeech(material: LearningMaterial, voice: LearningVoiceId = LEARNING_VOICES[0].id) {
  const current = useRef<HTMLAudioElement | null>(null), finish = useRef<(() => void) | null>(null);
  const [error,setError] = useState("");
  const cancelSpeech = useCallback(() => { current.current?.pause(); if (current.current) { current.current.onended = null; current.current.onerror = null; } current.current = null; finish.current?.(); finish.current = null; },[]);
  useEffect(() => cancelSpeech,[cancelSpeech]);
  const clips = material.audio?.voices?.find(item => item.voice === voice)?.clips ?? (material.audio?.voice === voice ? material.audio.clips : noClips);
  const hasSpeech = useCallback((text: string) => !!clips.some(clip => clip.text === text),[clips]);
  const speakOnce = useCallback((text: string): Promise<boolean> => {
    cancelSpeech(); const clip = clips.find(item => item.text === text);
    if (!clip || !/^\/api\/learning-audio\/[a-f0-9]{64}\.mp3$/.test(clip.url)) { setError("这段朗读尚未准备好，请在阶段选择页补齐朗读音频。"); return Promise.resolve(false); }
    setError("");
    return new Promise<boolean>(resolve => {
      const audio = new Audio(clip.url); current.current = audio;
      const timer = window.setTimeout(() => { setError("朗读播放超时，可以重试。"); audio.pause(); done(false); },45000);
      const done = (success: boolean) => { window.clearTimeout(timer); if (current.current === audio) { current.current = null; finish.current = null; } audio.onended = null; audio.onerror = null; resolve(success); };
      finish.current = () => done(false); audio.onended = () => done(true); audio.onerror = () => { setError("本地朗读播放失败，可以重试。"); done(false); };
      void audio.play().catch(() => { if (current.current === audio) setError("请点击播放发音以启用朗读。"); done(false); });
    });
  },[clips,cancelSpeech]);
  return { speakOnce,cancelSpeech,hasSpeech,error };
}
