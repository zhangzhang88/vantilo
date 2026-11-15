import { useState } from "react";
import { AUDIOBOOK_RATES, AUDIOBOOK_SLEEP_MINUTES, type AudiobookAction, type AudiobookSnapshot } from "../shared/audiobook-bridge";
import { CHINESE_AUDIOBOOK_VOICES, isChineseAudiobookVoice } from "../shared/qwen-tts-voices";
import "./audiobook-dock.css";

const statusLabels = { idle: "待播放", loading: "正在缓冲", playing: "正在朗读", paused: "已暂停", complete: "已听完", error: "播放失败" };

export function AudiobookDock({ state, send }: {
  state: AudiobookSnapshot;
  send: (action: AudiobookAction) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const playing = state.phase === "playing" || state.phase === "loading";
  const chapter = state.chapters.find(item => item.id === state.chapterId);
  const subtitle = state.sourceLabel ?? chapter?.title;
  const status = statusLabels[state.phase];
  const progress = state.paragraphCount ? (state.paragraphNumber / state.paragraphCount) * 100 : 0;
  function returnToText(type: "return" | "return-original") {
    setExpanded(false);
    send({ type });
  }

  return <section className="audiobook-dock" aria-label="听书播放器" data-phase={state.phase}
    onKeyDown={event => { if (event.key === "Escape") setExpanded(false); }}>
    {expanded && <section className="audiobook-dock-settings" aria-label="听书设置">
      <strong className="audiobook-dock-settings-heading">播放设置</strong>
      {state.chapters.length > 1 && <label className="audiobook-dock-chapters">章节<select value={state.chapterId}
        onChange={event => send({ type: "chapter", id: event.target.value })}>
        {state.chapters.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
      </select></label>}
      <label>倍速<select value={state.rate} onChange={event => send({ type: "rate", value: Number(event.target.value) })}>
        {AUDIOBOOK_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
      </select></label>
      <label>音色<select value={state.voice} onChange={event => {
        const value = event.target.value;
        if (isChineseAudiobookVoice(value)) send({ type: "voice", value });
      }}>
        {CHINESE_AUDIOBOOK_VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
      </select></label>
      <label>睡眠定时<select value={state.sleepMinutes} onChange={event => send({ type: "sleep", minutes: Number(event.target.value) })}>
        {AUDIOBOOK_SLEEP_MINUTES.map(minutes => <option key={minutes} value={minutes}>{minutes ? `${minutes} 分钟` : "关闭"}</option>)}
      </select></label>
    </section>}
    {state.error && <p className="audiobook-dock-error" role="alert">{state.error}</p>}
    <div className="audiobook-dock-row">
      <div className="audiobook-dock-book">
        {state.cover ? <img className="audiobook-dock-cover" src={state.cover} alt="" />
          : <span className="audiobook-dock-cover" aria-hidden="true">{state.title.slice(0, 1) || "书"}</span>}
        <div className="audiobook-dock-copy">
          <strong title={state.title}>{state.title}</strong>
          <small title={subtitle}>{subtitle ? `${subtitle} · ` : ""}{state.mode === "translation" ? "中文译文 · " : ""}{status}</small>
        </div>
      </div>
      <div className="audiobook-dock-transport">
        <button type="button" aria-label="后退 15 秒" title="后退最多 15 秒，限已生成的音频"
          disabled={!chapter || state.phase === "complete"} onClick={() => send({ type: "jump", seconds: -15 })}>−15</button>
        <button type="button" className="audiobook-dock-play" aria-label={playing ? "暂停朗读" : "播放朗读"} disabled={!chapter}
          onClick={() => send({ type: "toggle" })}>{playing ? "Ⅱ" : "▶"}</button>
        <button type="button" aria-label="前进 15 秒" title="前进最多 15 秒，限已生成的音频"
          disabled={!chapter || state.phase === "complete"} onClick={() => send({ type: "jump", seconds: 15 })}>+15</button>
      </div>
      <div className="audiobook-dock-actions">
        {state.mode === "translation" &&
          <button type="button" className="audiobook-dock-source" disabled={!chapter} onClick={() => returnToText("return")}>回到译文</button>}
        <button type="button" className="audiobook-dock-source" disabled={!chapter} onClick={() => returnToText("return-original")}>{state.returnToBilingual ? "回到中英对照" : "回到原文"}</button>
        <button type="button" aria-label={expanded ? "收起播放设置" : "展开播放设置"} aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>{expanded ? "⌄" : "⌃"}</button>
        <button type="button" className="audiobook-dock-close" aria-label="关闭播放器" title="停止播放并关闭播放器"
          onClick={() => send({ type: "close" })}>×</button>
      </div>
    </div>
    <div className="audiobook-dock-progress" role="progressbar" aria-label="朗读段落进度"
      aria-valuemin={0} aria-valuemax={Math.max(1, state.paragraphCount)} aria-valuenow={state.paragraphNumber}>
      <span style={{ width: `${progress}%` }} />
    </div>
  </section>;
}
