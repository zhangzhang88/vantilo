import { useEffect, useRef, useState } from "react";
import {
  AUDIOBOOK_RATES,
  DEFAULT_AUDIOBOOK_SMART_SKIP,
  type AudiobookAction,
  type AudiobookSmartSkip,
  type AudiobookSnapshot,
} from "../shared/audiobook-bridge";
import { CHINESE_AUDIOBOOK_VOICES } from "../shared/qwen-tts-voices";
import "./audiobook-dock.css";

const statusLabels = { idle: "待播放", loading: "正在缓冲", playing: "正在朗读", paused: "已暂停", complete: "已听完", error: "播放失败" };

type DockPanel = "settings" | "voice" | "rate" | null;

const SMART_SKIP_ITEMS: Array<{
  key: keyof AudiobookSmartSkip;
  label: string;
  example: string;
}> = [
  { key: "tables", label: "表格", example: "| ABC | 123 |" },
  { key: "urls", label: "网址", example: "site.com/..." },
  { key: "parentheses", label: "圆括号", example: "(一些文本)" },
  { key: "brackets", label: "方括号", example: "[一些文本] 【一些文本】" },
  { key: "braces", label: "大括号", example: "{一些文本}" },
];

function SmartSkipIcon({ kind }: { kind: keyof AudiobookSmartSkip }) {
  switch (kind) {
    case "tables":
      return (
        <svg className="audiobook-skip-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2.75" y="4" width="14.5" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M2.75 8.25H17.25M2.75 12H17.25M7.75 8.25V16M12.25 8.25V16" stroke="currentColor" strokeWidth="1.45" />
        </svg>
      );
    case "urls":
      return (
        <svg className="audiobook-skip-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M8.5 11.5L11.5 8.5M7 13L5.6 14.4C4.5 15.5 2.7 15.5 1.6 14.4C0.5 13.3 0.5 11.5 1.6 10.4L3.8 8.2C4.9 7.1 6.7 7.1 7.8 8.2M13 7L14.4 5.6C15.5 4.5 17.3 4.5 18.4 5.6C19.5 6.7 19.5 8.5 18.4 9.6L16.2 11.8C15.1 12.9 13.3 12.9 12.2 11.8"
            transform="translate(0.5 0.5) scale(0.95)" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
        </svg>
      );
    case "parentheses":
      return <span className="audiobook-skip-glyph" aria-hidden="true">( )</span>;
    case "brackets":
      return <span className="audiobook-skip-glyph" aria-hidden="true">[ ]</span>;
    case "braces":
      return <span className="audiobook-skip-glyph" aria-hidden="true">{"{ }"}</span>;
  }
}

function formatRateLabel(rate: number): string {
  return Number.isInteger(rate) ? `${rate.toFixed(1)}x` : `${rate}x`;
}

export function AudiobookDock({ state, send, onOpenTtsSetup }: {
  state: AudiobookSnapshot;
  send: (action: AudiobookAction) => void;
  onOpenTtsSetup?: () => void;
}) {
  const [openPanel, setOpenPanel] = useState<DockPanel>(null);
  const dockRef = useRef<HTMLElement>(null);
  const playing = state.phase === "playing" || state.phase === "loading";
  const chapter = state.chapters.find(item => item.id === state.chapterId);
  const subtitle = state.sourceLabel ?? chapter?.title;
  const status = statusLabels[state.phase];
  const progress = state.paragraphCount ? (state.paragraphNumber / state.paragraphCount) * 100 : 0;
  const chapterPercent = state.paragraphCount ? Math.round(progress) : undefined;
  const isArticle = state.progressScope === "article" || (state.progressScope === undefined && Boolean(state.sourceLabel));
  const progressLabel = state.progressPercent === undefined
    ? undefined
    : `${isArticle ? "本篇" : "全书"} ${state.progressPercent}%`;
  const chapterDetail = chapterPercent === undefined
    ? undefined
    : isArticle
      ? `第 ${state.paragraphNumber}/${state.paragraphCount} 段`
      : `本章 ${chapterPercent}%（第 ${state.paragraphNumber}/${state.paragraphCount} 段）`;
  const progressTitle = progressLabel === undefined
    ? undefined
    : isArticle
      ? (chapterDetail ? `${progressLabel}（${chapterDetail}）` : progressLabel)
      : (chapterDetail ? `${progressLabel} · ${chapterDetail}` : progressLabel);
  const activeVoice = CHINESE_AUDIOBOOK_VOICES.find(item => item.id === state.voice) ?? CHINESE_AUDIOBOOK_VOICES[0];
  const voiceInitial = activeVoice?.name.slice(0, 1) || "音";
  const smartSkip: AudiobookSmartSkip = state.smartSkip ?? DEFAULT_AUDIOBOOK_SMART_SKIP;
  const settingsOpen = openPanel === "settings";

  useEffect(() => {
    if (!openPanel) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (dockRef.current?.contains(event.target as Node)) return;
      setOpenPanel(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openPanel]);

  function togglePanel(panel: Exclude<DockPanel, null>) {
    setOpenPanel(current => current === panel ? null : panel);
  }
  function toggleSmartSkip(key: keyof AudiobookSmartSkip) {
    send({
      type: "smart-skip",
      settings: {
        ...smartSkip,
        [key]: !smartSkip[key],
      },
    });
  }
  function returnToText(type: "return" | "return-original") {
    setOpenPanel(null);
    send({ type });
  }

  return (
    <section
      ref={dockRef}
      className="audiobook-dock"
      aria-label="听书播放器"
      data-phase={state.phase}
      onKeyDown={event => { if (event.key === "Escape") setOpenPanel(null); }}
    >
      <div
        className="audiobook-dock-progress"
        role="progressbar"
        aria-label="朗读段落进度"
        title={chapterDetail}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, state.paragraphCount)}
        aria-valuenow={state.paragraphNumber}
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      {settingsOpen && (
        <section className="audiobook-dock-settings" aria-label="朗读设置" data-testid="audiobook-reading-settings">
          <div className="audiobook-dock-settings-header">
            <strong className="audiobook-dock-settings-heading">朗读设置</strong>
            <button
              type="button"
              className="audiobook-dock-settings-close"
              aria-label="关闭朗读设置"
              onClick={() => setOpenPanel(null)}
            >×</button>
          </div>

          <div className="audiobook-dock-settings-section">
            <div className="audiobook-dock-settings-kicker">智能跳过</div>
            <div className="audiobook-smart-skip-list">
              {SMART_SKIP_ITEMS.map((item) => {
                const enabled = smartSkip[item.key];
                return (
                  <div className="audiobook-smart-skip-row" key={item.key}>
                    <div className="audiobook-smart-skip-meta">
                      <span className="audiobook-smart-skip-icon-wrap">
                        <SmartSkipIcon kind={item.key} />
                      </span>
                      <div className="audiobook-smart-skip-copy">
                        <span className="audiobook-smart-skip-label">{item.label}</span>
                        <span className="audiobook-smart-skip-example">{item.example}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`智能跳过${item.label}`}
                      className={`audiobook-switch ${enabled ? "is-checked" : ""}`}
                      onClick={() => toggleSmartSkip(item.key)}
                    >
                      <span className="audiobook-switch-thumb" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {state.error && (
        <div className="audiobook-dock-error" role="alert">
          <span>{state.error}</span>
          {onOpenTtsSetup && (state.error.includes("尚未安装") || state.error.includes("Qwen3-TTS 尚未配置")) && (
            <button type="button" className="audiobook-dock-error-action" onClick={onOpenTtsSetup}>
              一键安装离线语音
            </button>
          )}
        </div>
      )}

      <div className="audiobook-dock-row">
        <div className="audiobook-dock-book">
          {state.cover ? <img className="audiobook-dock-cover" src={state.cover} alt="" />
            : <span className="audiobook-dock-cover" aria-hidden="true">{state.title.slice(0, 1) || "书"}</span>}
          <div className="audiobook-dock-copy">
            <div className="audiobook-dock-title-row">
              <strong title={state.title}>{state.title}</strong>
              {progressLabel && (
                <span className="audiobook-dock-percent" title={progressTitle} aria-label={progressTitle}>
                  {progressLabel}
                </span>
              )}
            </div>
            <small title={subtitle}>{subtitle ? `${subtitle} · ` : ""}{state.mode === "translation" ? "中文译文 · " : ""}{status}</small>
          </div>
        </div>

        <div className="audiobook-dock-transport">
          <div className="audiobook-dock-picker-anchor">
            <button
              type="button"
              className={`audiobook-dock-voice-chip ${openPanel === "voice" ? "is-active" : ""}`}
              aria-label={`切换朗读音色，当前${activeVoice?.name ?? state.voice}`}
              aria-expanded={openPanel === "voice"}
              title={`当前音色：${activeVoice?.name ?? state.voice}`}
              disabled={!chapter}
              onClick={() => togglePanel("voice")}
            >
              <span className="audiobook-dock-voice-avatar" aria-hidden="true">{voiceInitial}</span>
              <span className="audiobook-dock-voice-name">{activeVoice?.name ?? state.voice}</span>
            </button>
            {openPanel === "voice" && (
              <div className="audiobook-dock-popover is-voice" role="menu" aria-label="选择朗读音色" data-testid="audiobook-voice-picker">
                <div className="audiobook-dock-popover-title">朗读音色</div>
                {CHINESE_AUDIOBOOK_VOICES.map((voice) => {
                  const selected = voice.id === state.voice;
                  return (
                    <button
                      key={voice.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`audiobook-dock-popover-option ${selected ? "is-selected" : ""}`}
                      onClick={() => {
                        send({ type: "voice", value: voice.id });
                        setOpenPanel(null);
                      }}
                    >
                      <span>{voice.name}</span>
                      {selected && <span className="audiobook-dock-popover-check" aria-hidden="true">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            className="audiobook-dock-play"
            aria-label={playing ? "暂停朗读" : "播放朗读"}
            disabled={!chapter}
            onClick={() => send({ type: "toggle" })}
          >
            {playing ? (
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="5.5" y="4.5" width="3.2" height="11" rx="1.2" />
                <rect x="11.3" y="4.5" width="3.2" height="11" rx="1.2" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.8 4.6C6.1 4.2 5.2 4.7 5.2 5.5V14.5C5.2 15.3 6.1 15.8 6.8 15.4L15.1 10.9C15.8 10.5 15.8 9.5 15.1 9.1L6.8 4.6Z" />
              </svg>
            )}
          </button>

          <div className="audiobook-dock-picker-anchor">
            <button
              type="button"
              className={`audiobook-dock-rate-chip ${openPanel === "rate" ? "is-active" : ""}`}
              aria-label={`切换播放倍速，当前 ${state.rate} 倍速`}
              aria-expanded={openPanel === "rate"}
              title={`播放倍速：${formatRateLabel(state.rate)}`}
              disabled={!chapter}
              onClick={() => togglePanel("rate")}
            >
              {formatRateLabel(state.rate)}
            </button>
            {openPanel === "rate" && (
              <div className="audiobook-dock-popover is-rate" role="menu" aria-label="选择播放倍速" data-testid="audiobook-rate-picker">
                <div className="audiobook-dock-popover-title">播放倍速</div>
                {AUDIOBOOK_RATES.map((rate) => {
                  const selected = rate === state.rate;
                  return (
                    <button
                      key={rate}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`audiobook-dock-popover-option ${selected ? "is-selected" : ""}`}
                      onClick={() => {
                        send({ type: "rate", value: rate });
                        setOpenPanel(null);
                      }}
                    >
                      <span>{formatRateLabel(rate)}</span>
                      {selected && <span className="audiobook-dock-popover-check" aria-hidden="true">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="audiobook-dock-actions">
          {state.mode === "translation" && (
            <button type="button" className="audiobook-dock-source" disabled={!chapter} onClick={() => returnToText("return")}>
              回到译文
            </button>
          )}
          <button type="button" className="audiobook-dock-source" disabled={!chapter} onClick={() => returnToText("return-original")}>
            {state.mode === "original" ? "回到当前位置" : state.returnToBilingual ? "回到中英对照" : "回到原文"}
          </button>

          <button
            type="button"
            className={`audiobook-dock-icon-btn ${settingsOpen ? "is-active" : ""}`}
            aria-label={settingsOpen ? "收起播放设置" : "展开播放设置"}
            aria-expanded={settingsOpen}
            title="朗读设置（智能跳过）"
            onClick={() => togglePanel("settings")}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3.5 6.2H16.5M3.5 13.8H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="7.2" cy="6.2" r="2.1" fill="var(--dock-surface, #ffffff)" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="12.8" cy="13.8" r="2.1" fill="var(--dock-surface, #ffffff)" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>

          <button
            type="button"
            className="audiobook-dock-icon-btn audiobook-dock-close"
            aria-label="关闭播放器"
            title="停止播放并关闭播放器"
            onClick={() => send({ type: "close" })}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
