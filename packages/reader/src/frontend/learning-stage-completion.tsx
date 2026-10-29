import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { LearningGameSettings, LearningGameSettingsButton, LearningIcon } from "./learning-game-settings";
import type { LearningProgress, LearningStage } from "./learning-state";
import { useGamePreferences } from "./use-game-preferences";

export function LearningStageCompletion({ title, stage, total, progress, exit, repeat, next }: {
  title: string;
  stage: LearningStage;
  total: number;
  progress: LearningProgress;
  exit: () => void;
  repeat: () => void;
  next?: { label: string; open: () => void };
}) {
  const region = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [settings, setSettings] = useState(false);
  const { preferences, changePreferences, theme } = useGamePreferences();
  const vocabulary = stage === "vocabulary";
  const results = vocabulary
    ? progress.selectedVocabularyIds.flatMap(id => progress.vocabulary[id] ? [progress.vocabulary[id]] : [])
    : Object.values(progress.assembly);
  const errors = results.reduce((sum, item) => sum + item.errors, 0);
  const hints = results.reduce((sum, item) => sum + item.hints, 0);

  useEffect(() => {
    const root = document.getElementById("root");
    const overflow = document.body.style.overflow;
    const inert = root?.inert;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    if (root) root.inert = true;
    heading.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (root) root.inert = inert ?? false;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  function keyboard(event: KeyboardEvent) {
    if (settings) return;
    if (event.key === "Escape") { event.preventDefault(); exit(); }
    if (event.key !== "Tab") return;
    const controls = region.current?.querySelectorAll<HTMLElement>("button:not(:disabled), summary");
    const first = controls?.[0], last = controls?.[controls.length - 1];
    if (event.shiftKey && (event.target === first || event.target === heading.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
  }

  return createPortal(
    <div ref={region} className="worm-game learning-stage-completion" data-theme={theme} data-background={preferences.background} role="dialog" aria-modal="true" aria-labelledby="learning-completion-heading" onKeyDown={keyboard}>
      <header className="worm-game-header">
        <div className="worm-game-meta"><button type="button" className="worm-game-icon" aria-label="退出练习" title="返回阅读" onClick={exit}><LearningIcon name="back" /></button><strong title={title}>{title}</strong></div>
        <LearningGameSettingsButton expanded={settings} open={() => setSettings(true)} />
      </header>
      <div className="learning-completion-content">
        <span className="learning-completion-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 12 4 4 8-8" /></svg></span>
        <h2 id="learning-completion-heading" ref={heading} tabIndex={-1}>{vocabulary ? "词汇准备完成" : "句子组装完成"}</h2>
        <p>{vocabulary ? `本轮已完成 ${total} 个单词。` : `本轮已完成 ${total} 项句子练习。`}</p>
        <div className="learning-completion-actions">
          {next ? <><button className="learning-completion-primary" onClick={next.open}>{next.label}<LearningIcon name="next" /></button><button onClick={exit}>返回阅读</button></> : <button className="learning-completion-primary" onClick={exit}>返回阅读<LearningIcon name="next" /></button>}
        </div>
        <button className="learning-completion-repeat" onClick={repeat}><LearningIcon name="reset" />{vocabulary ? "再次练习词汇准备" : "再次练习完整句"}</button>
        <details className="learning-completion-record"><summary>查看本轮记录</summary><p>错误 {errors} 次 · 提示 {hints} 次</p></details>
      </div>
      {settings && <LearningGameSettings preferences={preferences} change={changePreferences} close={() => setSettings(false)} />}
    </div>, document.body,
  );
}
