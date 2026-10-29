import { LearningGameSettings, LearningGameSettingsButton } from "./learning-game-settings";
import { useGamePreferences } from "./use-game-preferences";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { learningSourceSentences, wholeWordSpans, type LearningMaterial, type LearningVocabulary } from "../shared/learning-material";
import { currentLearningItem, currentWordIndex, practiceMap, openVocabularySelection, recordLearningAction, type LearningProgress } from "./learning-state";
import { useGameSounds } from "./use-game-sounds";
import { useLessonSpeech } from "./use-lesson-speech";

function maskOccurrences(context: string, target: string) {
  let result = context;
  for (const start of wholeWordSpans(context,target).reverse()) result = result.slice(0,start) + "（同一表达）" + result.slice(start + target.length);
  return result;
}
/** Course2ClozePrototype's PreparationPrompt, translation card, header and guided lifecycle. */
export function VocabularyPreparationGame({ material,progress,update,exit,reset }: { material: LearningMaterial; progress: LearningProgress; update: (next: LearningProgress) => void; exit: () => void; reset: () => void }) {
  const item = currentLearningItem(material,progress) as LearningVocabulary, index = currentWordIndex(material,progress), map = practiceMap(progress), tokens = item.answerTokens;
  const input = useRef<HTMLInputElement>(null), region = useRef<HTMLDivElement>(null), live = useRef(true), pending = useRef(false), advanceAudioId = useRef(0);
  const [revealed,setRevealed] = useState(false), [wrong,setWrong] = useState(false), [settings,setSettings] = useState(false), [transitioning,setTransitioning] = useState(false), [fontSize] = useState(40);
  const autoplay = true, sounds = true, { preferences,changePreferences,theme } = useGamePreferences();
  const { playTypingSound } = useGameSounds(sounds), { speakOnce,cancelSpeech,hasSpeech,error } = useLessonSpeech(material,preferences.voice);
  const locked = new Set(progress[map][item.id]?.lockedWords ?? []), draft = progress.draft?.itemId === item.id && progress.draft.wordIndex === index && progress.draft.phase === progress.phase ? progress.draft.value : "";
  const source = learningSourceSentences(material.english).find(sentence => sentence.id === item.sentenceId)!, offset = wholeWordSpans(source.english,item.sourceText)[item.occurrence];
  const queue = progress.phase === "vocabulary-review" ? progress.reviewVocabularyIds : progress.selectedVocabularyIds, position = queue.filter(id => progress[map][id]?.correct).length + 1;
  useEffect(() => {
    live.current = true; const root = document.getElementById("root"), overflow = document.body.style.overflow, inert = root?.inert;
    document.body.style.overflow = "hidden"; if (root) root.inert = true;
    return () => { live.current = false; document.body.style.overflow = overflow; if (root) root.inert = inert ?? false; };
  },[]);
  useEffect(() => { setRevealed(false); setWrong(false); input.current?.focus(); },[item.id,index,progress.phase]);
  useEffect(() => { if (!wrong) return; const timer = setTimeout(() => setWrong(false),3000); return () => clearTimeout(timer); },[wrong]);
  useEffect(() => { if (!revealed) return; const timer = setTimeout(() => { setRevealed(false); input.current?.focus(); },3000); return () => clearTimeout(timer); },[revealed]);
  useEffect(() => { if (!settings) input.current?.focus(); },[settings]);
  function reveal() { if (revealed || transitioning) return; update(recordLearningAction(material,progress,"hint")); setRevealed(true); setWrong(false); if (hasSpeech(item.answerText)) void speakOnce(item.answerText); input.current?.blur(); }
  function submit() {
    if (!draft.trim() || revealed || pending.current) return;
    const next = recordLearningAction(material,progress,"answer",draft), incorrect = (next[map][item.id]?.errors ?? 0) > (progress[map][item.id]?.errors ?? 0);
    setWrong(incorrect);
    const completedTarget = next[map][item.id]?.correct && !progress[map][item.id]?.correct;
    if (completedTarget && autoplay && hasSpeech(source.english)) {
      const requestId = ++advanceAudioId.current; pending.current = true; setTransitioning(true);
      void speakOnce(source.english).finally(() => { if (live.current && advanceAudioId.current === requestId) { pending.current = false; setTransitioning(false); update(next); } });
    } else { update(next); input.current?.focus(); }
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === "Tab") {
      const container = settings ? region.current?.querySelector(".worm-settings-dialog") : region.current;
      const controls = container?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([readonly])'), first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
    }
    if (settings) return;
    if (event.ctrlKey && event.key === "'") { event.preventDefault(); void speakOnce(source.english); }
    if (event.ctrlKey && event.key === ";") { event.preventDefault(); if (revealed) { setRevealed(false); input.current?.focus(); } else reveal(); }
  }
  return createPortal(<div ref={region} className="vocabulary-game worm-game" data-theme={theme} data-background={preferences.background} data-phase={progress.phase} role="dialog" aria-modal="true" aria-label="词汇准备游戏" onKeyDown={keyboard}>
    <header className="vocabulary-game-header"><div><button onClick={exit} aria-label="返回阶段选择">← <span>返回</span></button><span className="vocabulary-game-context" title={material.titleZh}>本课 · 词汇准备</span></div><div><LearningGameSettingsButton expanded={settings} open={() => setSettings(true)} /><button onClick={reset}>↻ <span>重置</span></button></div></header>
    <div className="vocabulary-game-body"><section className="vocabulary-game-card" aria-label="词汇准备练习">
      <div className="vocabulary-game-prompt"><div className="vocabulary-game-heading"><p>{progress.phase === "vocabulary-review" ? "LEXICAL PREPARATION · 重点复习" : "LEXICAL PREPARATION · 先回忆，再继续"}</p><button onClick={() => { advanceAudioId.current++; pending.current = false; cancelSpeech(); update(openVocabularySelection(progress)); }}>调整本课词汇</button></div>
        <p className="learning-cloze vocabulary-game-sentence" lang="en" style={{ fontSize: `${fontSize}px` }}>{maskOccurrences(source.english.slice(0,offset),item.sourceText)}<span className="vocabulary-game-target">{tokens.map((token,i) => <Fragment key={i}>{item.answerText.slice(i ? tokens[i-1].end : 0,token.start)}{locked.has(i) ? <span className="vocabulary-game-slot is-locked" data-testid="locked-word">{token.text}</span> : i === index ? <input ref={input} aria-label="当前缺失词" title="空格或回车检查；空输入时回车或右箭头查看答案" style={{ width: `${Math.max(3.5,Math.min(token.text.length + .5,18))}ch` }} className={`vocabulary-game-slot${wrong ? " is-wrong" : ""}`} value={revealed || transitioning ? token.text : draft} readOnly={revealed || transitioning} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={event => { playTypingSound(); setWrong(false); update({ ...progress, draft: { phase: progress.phase,itemId: item.id,wordIndex: index,value: event.target.value.slice(0,200) } }); }} onKeyDown={event => {
          if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
          if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (draft.trim()) submit(); else if (event.key === "Enter") reveal(); }
          if (event.key === "ArrowRight" && !draft.trim()) { event.preventDefault(); reveal(); }
          if (event.key === "ArrowLeft" && revealed) { event.preventDefault(); setRevealed(false); input.current?.focus(); }
        }} /> : <span className="vocabulary-game-slot is-pending" style={{ width: `${Math.max(3.5,Math.min(token.text.length + .5,18))}ch` }} />}{i === tokens.length - 1 && item.answerText.slice(token.end)}</Fragment>)}</span>{maskOccurrences(source.english.slice(offset + item.sourceText.length),item.sourceText)}</p>
      </div>
      <div className="vocabulary-game-translation"><div><span>当前词义</span><div>{(item.pronunciation ?? material.audio?.pronunciations?.[item.id]) && <p className="vocabulary-game-pronunciation">{item.pronunciation ?? material.audio?.pronunciations?.[item.id]}</p>}{revealed && <p data-testid="revealed-answer">{item.answerText}</p>}<strong>{item.meaningZh}</strong></div></div><div className="learning-sentence-meaning"><span>整句句意</span><p>{item.sentenceMeaningZh}</p></div></div>
      <div className="vocabulary-game-feedback" role="status">{wrong ? "还不对，再试一次。答案不会自动出现。" : revealed ? "答案显示三秒后收起，请继续回忆。" : transitioning ? "听完原句后继续。" : ""}</div>
    </section><div className="vocabulary-game-progress"><span>{progress.phase === "vocabulary-review" ? "重点复习" : "准备"}</span><div role="progressbar" aria-label="词汇准备进度" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={position}><span style={{ width: `${position / queue.length * 100}%` }} /></div><strong>{position} / {queue.length}</strong></div>{error && <p className="vocabulary-game-audio-error">{error}</p>}</div>
    {settings && <LearningGameSettings preferences={preferences} change={patch => { cancelSpeech(); changePreferences(patch); }} close={() => setSettings(false)} />}
  </div>,document.body);
}
