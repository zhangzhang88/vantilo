import { useLessonSpeech } from "./use-lesson-speech";
import { LearningListeningMode } from "./learning-listening-mode";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LearningMaterial } from "../shared/learning-material";
import { assemblyQueue, continueLearning, setAssemblySkipped, type LearningProgress } from "./learning-state";
import { useGamePreferences } from "./use-game-preferences";
import { LearningGameSettings, LearningGameSettingsButton } from "./learning-game-settings";
/** Original Phase2SelectionContainer, group details, item copy and fixed actions. */
export function AssemblySelection({ material,progress,update,exit }: { material: LearningMaterial; progress: LearningProgress; update: (next: LearningProgress) => void; exit: () => void }) {
  const queue = useMemo(() => assemblyQueue(material,progress),[material,progress.selectedVocabularyIds,progress.skippedAssemblyIds,progress.assemblyPracticeIds]), { preferences,changePreferences,theme } = useGamePreferences(), [settings,setSettings] = useState(false), [listening,setListening] = useState(false);
  const { speakOnce,cancelSpeech,hasSpeech } = useLessonSpeech(material,preferences.voice);
  useEffect(() => { const root = document.getElementById("root"), inert = root?.inert, overflow = document.body.style.overflow; if (root) root.inert = true; document.body.style.overflow = "hidden"; return () => { if (root) root.inert = inert ?? false; document.body.style.overflow = overflow; }; },[]);
  return createPortal(<div className="worm-game" data-theme={theme} data-background={preferences.background} role="dialog" aria-modal="true" aria-label="本课组装选择">
    <header className="worm-game-header"><div className="worm-game-meta"><button aria-label="返回阶段选择" onClick={exit}>〈</button><strong title={material.titleZh}>句子组装</strong></div><div className="worm-game-tools"><LearningGameSettingsButton expanded={settings} open={() => setSettings(true)} /></div></header>
    <main className="worm-selection-content"><section className="worm-phase2-selection" aria-labelledby="phase2-selection-title">
      <div className="worm-selection-intro"><p>PROGRESSIVE ASSEMBLY</p><h2 id="phase2-selection-title">本课组装练习</h2><p>勾选你已经熟悉、这节课不需要练的脚手架。最终目标会保留，必要的桥接步骤也会由系统保留。</p></div>
      <div className="worm-selection-list">{material.sentences.map(sentence => <details className="learning-assembly-group worm-selection-group" key={sentence.id} open><summary><span className="worm-selection-heading"><span className="worm-selection-label">Source sentence {sentence.id}</span><span className="worm-selection-source" lang="en">{sentence.english}</span></span></summary><div className="worm-selection-items">{[...sentence.steps].sort((a,b) => ({ anchor: 0,bridge: 1,target: 2 })[a.kind] - ({ anchor: 0,bridge: 1,target: 2 })[b.kind]).map(step => {
        const restored = queue.restored.has(step.id), inherited = queue.inherited.has(step.id), canSkip = step.kind !== "target";
        const copy = <><span className="worm-selection-copy"><span className="worm-selection-target" lang="en">{step.english}</span>{material.audio?.pronunciations?.[step.id] && <span className="worm-selection-meta">{material.audio.pronunciations[step.id]}</span>}<span className="worm-selection-meta">{step.meaningZh}</span><span className="worm-selection-kind">{step.kind}</span></span><span className="worm-selection-skip">{canSkip ? <input type="checkbox" aria-label={`${step.english} 本课跳过`} checked={queue.skipped.has(step.id)} disabled={restored} onChange={event => update(setAssemblySkipped(progress,step.id,event.target.checked))} /> : <span aria-hidden="true">✓</span>}<span>{restored ? "系统保留" : inherited ? "来自共享词汇状态" : canSkip ? "本课跳过" : "最终目标"}</span>{restored && <span className="worm-selection-status">为保持组装连贯，系统保留</span>}</span></>;
        return canSkip ? <label key={step.id} className="worm-selection-item" data-restored={restored}>{copy}</label> : <div key={step.id} className="worm-selection-item">{copy}</div>;
      })}</div></details>)}</div>
      <div className="worm-selection-actions"><button onClick={() => update(continueLearning(progress,material))}>开始组装练习 <span aria-hidden="true">〉</span></button></div>
    </section></main>
    {settings && <LearningGameSettings preferences={preferences} change={patch => { cancelSpeech(); changePreferences(patch); }} close={() => setSettings(false)} listen={() => { cancelSpeech(); setSettings(false); setListening(true); }} />}
    {listening && <LearningListeningMode material={material} queue={queue.active} speakOnce={speakOnce} cancelSpeech={cancelSpeech} hasSpeech={hasSpeech} exit={() => { cancelSpeech(); setListening(false); }} />}
  </div>,document.body);
}
