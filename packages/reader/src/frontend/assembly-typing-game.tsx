import { LearningGameSettings, LearningGameSettingsButton } from "./learning-game-settings";
import { LearningListeningMode } from "./learning-listening-mode";
import { useGamePreferences } from "./use-game-preferences";
import { useGameSounds } from "./use-game-sounds";
import { useLessonSpeech } from "./use-lesson-speech";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AssemblyStep, LearningMaterial } from "../shared/learning-material";
import { assemblyQueue, checkTypingAssembly, currentLearningItem, focusTypingWord, moveAssembly, normalizeTypingAnswer, openAssemblySelection, recordLearningAction, showAssemblyCompletion, setTypingWord, typingDraftFor, type LearningProgress } from "./learning-state";

function Icon({ name }: { name: "back" | "next" | "book" | "settings" | "clock" }) {
  const paths = { back: "m14 6-6 6 6 6", next: "m10 6 6 6-6 6", book: "M12 5c-4-3-9-2-9-2v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Zm0 0v16", settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l1 3 3-1 2 3-2 3 2 3-2 3-3-1-1 3h-4l-1-3-3 1-2-3 2-3-2-3 2-3 3 1Z", clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3v6h5" };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

/** Layout and keyboard lifecycle adapted directly from Worm's TypingGame. */
export function AssemblyTypingGame({ material, progress, update, exit }: { material: LearningMaterial; progress: LearningProgress; update: (next: LearningProgress) => void; exit: () => void }) {
  const step = currentLearningItem(material,progress) as AssemblyStep;
  const tokens = step.typingTokens ?? [], draft = typingDraftFor(step,progress), correct = !!progress.assembly[step.id]?.correct;
  const reading = correct || progress.assemblyReadingId === step.id;
  const queue = useMemo(() => assemblyQueue(material,progress).active,[material,progress.selectedVocabularyIds,progress.skippedAssemblyIds,progress.assemblyPracticeIds]), index = queue.findIndex(item => item.id === step.id);
  const [answerMode,setAnswerMode] = useState(false), [revealed,setRevealed] = useState(false), [settings,setSettings] = useState(false), [listening,setListening] = useState(false);
  const fontSize = 30, audio = true, sounds = true;
  const { preferences,changePreferences,theme } = useGamePreferences();
  const { playTypingSound,playCorrectSound,playErrorSound,stopAllSounds } = useGameSounds(sounds);
  const { speakOnce,cancelSpeech,hasSpeech,error: audioError } = useLessonSpeech(material,preferences.voice);
  const [editingError,setEditingError] = useState<number | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]), region = useRef<HTMLDivElement>(null), latest = useRef({ progress, update });
  latest.current = { progress, update };
  const seconds = progress.assemblyElapsedSeconds ?? 0;
  const time = [Math.floor(seconds / 3600),Math.floor(seconds / 60) % 60,seconds % 60].map(value => String(value).padStart(2,"0")).join(":");

  useEffect(() => {
    const root = document.getElementById("root"), previousOverflow = document.body.style.overflow, previouslyInert = root?.inert;
    document.body.style.overflow = "hidden"; if (root) root.inert = true;
    return () => { document.body.style.overflow = previousOverflow; if (root) root.inert = previouslyInert ?? false;  };
  },[]);
  useEffect(() => {
    const timer = window.setInterval(() => { const current = latest.current; current.update({ ...current.progress, assemblyElapsedSeconds: (current.progress.assemblyElapsedSeconds ?? 0) + 1 }); },1000);
    return () => window.clearInterval(timer);
  },[]);
  useEffect(() => { setRevealed(answerMode); setEditingError(null); },[step.id,answerMode]);
  useEffect(() => {
    if (settings || listening) return;
    if (reading) region.current?.focus(); else inputs.current[draft.currentWordIndex]?.focus();
  },[step.id,draft.currentWordIndex,reading,settings,listening]);

  function speak() { void speakOnce(step.english); }
  useEffect(() => { cancelSpeech(); if (audio && hasSpeech(step.english)) void speakOnce(step.english); return cancelSpeech; },[step.id]);
  function submit() {
    if (reading) { update(moveAssembly(material,progress,"next")); return; }
    const next = checkTypingAssembly(material,progress); setEditingError(null); update(next);
    if (next.assembly[step.id]?.correct) { playCorrectSound(); if (audio && hasSpeech(step.english)) speak(); }
    else { playErrorSound(); window.requestAnimationFrame(() => inputs.current[next.typingDraft?.currentWordIndex ?? 0]?.focus()); }
  }
  function nextArrow() {
    if (reading) { update(moveAssembly(material,progress,"next")); return; }
    cancelSpeech(); setRevealed(false); setEditingError(null);
    update(showAssemblyCompletion(material,progress));
    if (audio && hasSpeech(step.english)) speak();
  }
  function toggleAnswer() { if (!revealed) update(recordLearningAction(material,progress,"hint")); setRevealed(!revealed); }
  function repeat() { stopAllSounds(); cancelSpeech(); if (audio && hasSpeech(step.english)) speak(); setRevealed(answerMode); setEditingError(null); update(moveAssembly(material,progress,"repeat")); window.requestAnimationFrame(() => inputs.current[0]?.focus()); }
  function focusWord(from: number, direction: number) {
    let target = from + direction;
    while (target >= 0 && target < tokens.length && draft.lockedWords.includes(target)) target += direction;
    if (target >= 0 && target < tokens.length) { update(focusTypingWord(material,progress,target)); inputs.current[target]?.focus(); }
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === "Tab") {
      const container = settings ? region.current?.querySelector(".worm-settings-dialog") : region.current;
      const controls = container?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([readonly])');
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
    }
    if (settings || listening) return;
    if (event.ctrlKey && event.key === ";") { event.preventDefault(); if (!event.repeat) reading ? repeat() : toggleAnswer(); return; }
    if (event.ctrlKey && event.key === "'") { event.preventDefault(); if (!event.repeat) speak(); return; }
    if (event.ctrlKey && event.key === "k") { event.preventDefault(); repeat(); return; }
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); if (!event.repeat) submit(); }
  }

  return createPortal(<div ref={region} role="dialog" aria-modal="true" aria-label="句子组装游戏" tabIndex={-1} className="worm-game" data-theme={theme} data-background={preferences.background} onKeyDown={keyboard}>
    <header className="worm-game-header">
      <div className="worm-game-meta"><button className="worm-game-icon" aria-label="返回阶段选择" title="返回阶段选择" onClick={exit}><Icon name="back" /></button><strong title={material.titleZh}>句子组装（{index + 1}/{queue.length}）</strong><span className="worm-game-time" aria-label="练习用时"><Icon name="clock" />{time}</span></div>
      <div className="worm-game-tools"><button className={`worm-game-icon${answerMode ? " is-active" : ""}`} aria-label={answerMode ? "关闭看答案模式" : "开启看答案模式"} aria-pressed={answerMode} onClick={() => { if (!answerMode) update(recordLearningAction(material,progress,"hint")); setAnswerMode(!answerMode); }}><Icon name="book" /></button><button onClick={() => { cancelSpeech(); stopAllSounds(); update(openAssemblySelection(progress)); }}>调整本课组装</button><LearningGameSettingsButton expanded={settings} open={() => setSettings(true)} /></div>
    </header>
    <div className="worm-game-progress" role="progressbar" aria-label="组装进度" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index + 1}><span style={{ width: `${(index + 1) / queue.length * 100}%` }} /></div>
    <main className="worm-game-content">
      {reading ? <div className="worm-game-completion" role="status"><p lang="en">{step.english}</p><p>{step.meaningZh}</p></div> : <>
        {revealed && <p className="worm-game-answer" lang="en" data-testid="revealed-answer">{step.english}</p>}
        <h1 className="worm-game-meaning">{step.meaningZh}</h1>
        <div className="worm-game-words" aria-label="逐词组装" style={{ fontSize: `${fontSize}px` }}>
          {tokens.map((token,i) => <span className="worm-game-word" key={`${step.id}:${i}`}>
            <input ref={element => { inputs.current[i] = element; }} aria-label={`第 ${i + 1} 个词`} data-testid="typing-word" data-word-index={i} value={draft.inputs[i]} maxLength={token.text.length} readOnly={draft.lockedWords.includes(i)} autoComplete="off" autoCapitalize="none" spellCheck={false} style={{ width: `${Math.max(token.text.length + .8,2.8)}ch` }} className={`${draft.inputs[i].trim() ? "has-input " : ""}${i === draft.currentWordIndex ? "is-current " : ""}${draft.lockedWords.includes(i) ? "is-locked" : draft.submitted ? "is-wrong" : ""}`} onFocus={() => { if (!draft.lockedWords.includes(i) && draft.currentWordIndex !== i) update(focusTypingWord(material,progress,i)); }} onChange={event => { playTypingSound(); update(setTypingWord(material,progress,i,event.target.value.replace(/[^\p{L}\p{N}'’+\-]/gu,""))); }} onKeyDown={event => {
              if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
              if (draft.submitted && event.key !== "Enter" && event.key !== "Tab" && (event.key === " " || editingError !== i)) {
                const firstWrong = tokens.findIndex((token,j) => normalizeTypingAnswer(draft.inputs[j]) !== normalizeTypingAnswer(token.text));
                if (firstWrong >= 0) { event.preventDefault(); setEditingError(firstWrong); update(setTypingWord(material,progress,firstWrong,"")); inputs.current[firstWrong]?.focus(); return; }
              }
              if (event.key === " " || event.key === "ArrowRight") { event.preventDefault(); focusWord(i,1); }
              else if (event.key === "ArrowLeft" || (event.key === "Backspace" && !draft.inputs[i])) { event.preventDefault(); focusWord(i,-1); }
            }} />
            <span className="worm-game-punctuation" aria-hidden="true">{step.english.slice(token.end,tokens[i + 1]?.start ?? step.english.length).trim()}</span>
          </span>)}
        </div>
        <p className="worm-game-feedback" role="status">{draft.submitted ? "正确的词已锁定，请修改其余词后再次提交。" : ""}</p>
      </>}
      {audioError && <p className="worm-game-feedback" role="status">{audioError}</p>}
    </main>
    <footer className="worm-game-footer"><button aria-label="上一项" onClick={() => update(moveAssembly(material,progress,"previous"))}><kbd><Icon name="back" /></kbd></button><div className="worm-game-shortcuts"><button onClick={speak}><kbd>Ctrl</kbd><kbd>'</kbd><span>播放发音</span></button><button onClick={submit}><kbd>Enter</kbd><span>{reading ? index === queue.length - 1 ? "完成组装练习" : "下一项" : "提交"}</span></button><button onClick={reading ? repeat : toggleAnswer}><kbd>Ctrl</kbd><kbd>;</kbd><span>{reading ? "再来一次" : revealed ? "隐藏答案" : "显示答案"}</span></button></div><button aria-label={reading ? "下一项" : "查看完整表达"} onClick={nextArrow}><kbd><Icon name="next" /></kbd></button></footer>
    {settings && <LearningGameSettings preferences={preferences} change={patch => { cancelSpeech(); changePreferences(patch); }} close={() => setSettings(false)} listen={() => { cancelSpeech(); stopAllSounds(); setSettings(false); setListening(true); }} />}
    {listening && <LearningListeningMode material={material} queue={queue} speakOnce={speakOnce} cancelSpeech={cancelSpeech} hasSpeech={hasSpeech} exit={() => { cancelSpeech(); setListening(false); }} />}
  </div>,document.body);
}
