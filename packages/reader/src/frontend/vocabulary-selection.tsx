import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LearningMaterial } from "../shared/learning-material";
import { getReaderStorage } from "./reader-storage";
import { loadSavedSelections } from "./selection-state";
import { setVocabularySkipped, startLearning, vocabularyDefaults, type LearningProgress } from "./learning-state";
import { LearningGameSettings, LearningGameSettingsButton, LearningIcon } from "./learning-game-settings";
import { useGamePreferences } from "./use-game-preferences";
/** Course2ClozePrototype vocabulary selection, adapted only to saved Magazine Reader words. */
export function VocabularySelection({ material,progress,update,exit,reset }: { material: LearningMaterial; progress: LearningProgress; update: (next: LearningProgress) => void; exit: () => void; reset: () => void }) {
  const { preferences,changePreferences,theme } = useGamePreferences(), [settings,setSettings] = useState(false), region = useRef<HTMLDivElement>(null);
  const defaults = vocabularyDefaults(material,loadSavedSelections(getReaderStorage()));
  useEffect(() => { const root = document.getElementById("root"), inert = root?.inert, overflow = document.body.style.overflow; if (root) root.inert = true; document.body.style.overflow = "hidden"; region.current?.querySelector("button")?.focus(); return () => { if (root) root.inert = inert ?? false; document.body.style.overflow = overflow; }; },[]);
  return createPortal(<div ref={region} className="vocabulary-game worm-game" data-theme={theme} data-background={preferences.background} data-phase="vocabulary-selection" role="dialog" aria-modal="true" aria-label="本课词汇选择" onKeyDown={event => {
    if (settings || event.key !== "Tab") return;
    const controls = region.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'), first = controls?.[0], last = controls?.[controls.length - 1];
    if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="vocabulary-game-header"><div><button aria-label="返回阶段选择" onClick={exit}><LearningIcon name="back" />返回</button><span className="vocabulary-game-context" title={material.titleZh}>本课 · 词汇准备</span></div><div><LearningGameSettingsButton expanded={settings} open={() => setSettings(true)} /><button onClick={reset}><LearningIcon name="reset" />重置</button></div></header>
    <section className="worm-vocabulary-selection" aria-labelledby="vocabulary-selection-title">
      <div className="worm-vocabulary-selection-intro"><p className="worm-vocabulary-selection-eyebrow">LEXICAL PREPARATION</p><h2 id="vocabulary-selection-title">本课词汇准备</h2><p>勾选你已经很熟悉、本课不需要练的词。</p></div>
      <div className="worm-vocabulary-selection-list" role="list">{material.vocabulary.map(word => <label className="worm-vocabulary-selection-item" role="listitem" key={word.id}>
        <span className="worm-vocabulary-selection-copy"><span className="worm-vocabulary-selection-target" lang="en">{word.text}</span>{(word.pronunciation ?? material.audio?.pronunciations?.[word.id]) && <span className="worm-vocabulary-selection-pronunciation">{word.pronunciation ?? material.audio?.pronunciations?.[word.id]}</span>}<span className="worm-vocabulary-selection-meaning">{word.meaningZh}</span></span>
        <span className="worm-vocabulary-selection-skip"><input type="checkbox" aria-label={`${word.text}：本课跳过`} checked={!progress.selectedVocabularyIds.includes(word.id)} onChange={event => update(setVocabularySkipped(material,progress,word.id,event.target.checked))} /><span>{defaults.includes(word.id) ? "本课跳过" : "跨课程已掌握 · 本课跳过"}</span></span>
      </label>)}</div>
      <div className="worm-vocabulary-selection-actions"><button onClick={() => update(startLearning(progress))}>开始练习<LearningIcon name="next" /></button></div>
    </section>
    {settings && <LearningGameSettings preferences={preferences} change={changePreferences} close={() => setSettings(false)} />}
  </div>,document.body);
}
