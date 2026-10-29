import { useEffect, useRef } from "react";
import { LEARNING_VOICES } from "../shared/learning-audio";
import type { LearningGamePreferences } from "./learning-game-preferences";
export function LearningIcon({ name }: { name: "sound" | "palette" | "sun" | "moon" | "monitor" | "headphones" | "close" | "settings" | "back" | "next" | "reset" }) {
  const paths = { settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l1 3 3-1 2 3-2 3 2 3-2 3-3-1-1 3h-4l-1-3-3 1-2-3 2-3-2-3 2-3 3 1Z", back: "m12 5-7 7 7 7M5 12h14", next: "M5 12h14m-7-7 7 7-7 7", reset: "M3 3v6h6M3 9a9 9 0 1 1 1 9", sound: "m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14", palette: "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-4-5-6-9-6ZM7 10h.01M9 6h.01M14 6h.01M17 9h.01", sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1", moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z", monitor: "M3 3h18v14H3V3Zm9 14v4m-5 0h10", headphones: "M3 14v-2a9 9 0 0 1 18 0v2M3 13h4v8H3v-8Zm14 0h4v8h-4v-8Z", close: "m6 6 12 12M6 18 18 6" };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
/** Original 44px SettingsButton with an 18px vector icon on every game page. */
export function LearningGameSettingsButton({ expanded,open }: { expanded: boolean; open: () => void }) {
  return <button type="button" className="worm-settings-trigger" aria-label="打开练习设置" aria-expanded={expanded} onClick={open}><LearningIcon name="settings" /></button>;
}
/** TypingGame SettingsDialog and VoiceSelector, using the host's saved local audio. */
export function LearningGameSettings({ preferences,change,close,listen }: { preferences: LearningGamePreferences; change: (patch: Partial<Omit<LearningGamePreferences,"version">>) => void; close: () => void; listen?: () => void }) {
  const dialog = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; closeButton.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; },[]);
  return <div className="worm-settings-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={event => {
    event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") { const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select'), first = controls?.[0], last = controls?.[controls.length - 1]; if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); } }
  }}><section ref={dialog} className="worm-settings-dialog" role="dialog" aria-modal="true" aria-label="练习设置">
    <header className="worm-settings-header"><h2>设置</h2><button ref={closeButton} aria-label="关闭设置" onClick={close}><LearningIcon name="close" /></button></header>
    <div className="worm-settings-content">
      <div className="worm-settings-title"><h3>声音</h3><p>选择练习时使用的朗读声音{listen ? "，或切换到连续听力模式。" : "。"}</p></div>
      <section className="worm-setting-group"><h4>朗读声音</h4><p>每次播放会优先使用本地缓存音频。</p><div className="worm-settings-action-row"><label className="worm-voice-selector">请选择朗读声音：<select value={preferences.voice} onChange={event => change({ voice: event.target.value as LearningGamePreferences["voice"] })}>{LEARNING_VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</select></label></div></section>
      {listen && <section className="worm-setting-group"><h4>听力模式</h4><p>从本课第一句开始连续播放，每句播放两遍。</p><div className="worm-settings-action-row"><button className="worm-settings-action" onClick={listen}><LearningIcon name="headphones" />进入听力模式</button></div></section>}
      <p className="worm-global-theme-note">外观统一使用全局主题，可在主导航的「设置」中调整。</p>
    </div>
  </section></div>;
}
