import { VocabularySelection } from "./vocabulary-selection";
import { AssemblySelection } from "./assembly-selection";
import { VocabularyPreparationGame } from "./vocabulary-preparation-game";
import { AssemblyTypingGame } from "./assembly-typing-game";
import { LearningStageCompletion } from "./learning-stage-completion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BookLesson } from "../shared/book-lesson";
import { type LearningMaterial } from "../shared/learning-material";
import { getReaderStorage } from "./reader-storage";
import { loadSavedSelections } from "./selection-state";
import { lessonParagraphs } from "../shared/book-lesson";
import { learningSourceSentences, learningVocabularyCoverage } from "../shared/learning-material";
import { bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity";
import { fetchCachedLearningMaterial, translateParagraph } from "./api";
import { findSentenceTranslation, loadSentenceTranslations, saveSentenceTranslations, sentenceTranslationTarget, upsertSentenceTranslation, type SentenceTranslationRecord } from "./sentence-translation-state";
import { LEARNING_ACTIVE_KEY, assemblyQueue, completeLearning, continueLearning, loadLearningProgress, restartStageLearning, resumeStageLearningProgress, learningStageSummary, saveLearningProgress, startLearning, type LearningProgress, type LearningStage } from "./learning-state";

const STAGE_SESSION_KEY = "magazine-reader:learning-stage-view:v1";
type StageView = LearningStage | "stages";
function restoredStageView(lessonId: string): StageView | null {
  try { const saved = JSON.parse(sessionStorage.getItem(STAGE_SESSION_KEY) ?? "null"); return saved?.lessonId === lessonId && ["vocabulary","assembly","stages"].includes(saved.stage) ? saved.stage : null; } catch { return null; }
}
function stageRecords(lesson: BookLesson): Partial<Record<LearningStage,LearningProgress>> {
  const records = loadLearningProgress(getReaderStorage()).filter((p): p is LearningProgress => p.version === 2 && p.materialId === `learning:${lesson.bookId}:${lesson.id}`);
  return { vocabulary: records.filter(p => p.practiceStage === "vocabulary").at(-1), assembly: records.filter(p => p.practiceStage === "assembly").at(-1) };
}
function StagePicker({ stages, open }: { stages: Partial<Record<LearningStage,LearningProgress>>; open: (stage: LearningStage, restart?: boolean) => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); },[]);
  return <section className="learning-stage-picker" aria-label="选择练习阶段">
    <header><div><p>LEARNING PATH</p><h2 ref={title} tabIndex={-1}>选择练习阶段</h2></div><span>两个阶段分别保存进度</span></header>
    <div className="learning-stage-cards">{(["vocabulary","assembly"] as const).map((stage,index) => {
      const summary = learningStageSummary(stages[stage],stage), name = stage === "vocabulary" ? "词汇准备" : "完整句练习";
      const action = summary.complete ? stage === "vocabulary" ? "再次练习词汇准备" : "再次练习完整句" : `${summary.started ? "继续" : "开始"}${name}`;
      const subtitle = summary.complete ? "本阶段已完成，可以随时再练一轮。" : summary.started ? "从上次保存的位置继续。" : stage === "vocabulary" ? "先熟悉本篇文章中的重点词汇。" : "直接练习完整句子，词汇阶段无需先完成。";
      const firstComplete = learningStageSummary(stages.vocabulary,"vocabulary").complete, recommended = stage === "vocabulary" ? !firstComplete : firstComplete && !summary.complete;
      return <article className={`learning-stage-card${recommended ? " is-recommended" : ""}`} key={stage} data-testid={`learning-stage-${stage}`}>
        <div className="learning-stage-copy"><span className="learning-stage-number" aria-hidden="true">0{index + 1}</span><div><p>{index === 0 ? "第一阶段" : "第二阶段"} · {name}</p><h3>{action}</h3><span>{subtitle}</span></div></div>
        <div className="learning-stage-progress-copy"><span>阶段进度</span><strong>{summary.percent}%</strong></div>
        <div className="learning-stage-progress" role="progressbar" aria-label={`${name}阶段进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent}><span style={{ width: `${summary.percent}%` }} /></div>
        <div className="learning-stage-actions">{summary.started && !summary.complete && <button className="learning-stage-restart" aria-label={`从头练习${name}`} onClick={() => open(stage,true)}>从头练习</button>}<button className="learning-stage-start" aria-label={action} onClick={() => open(stage,summary.complete)}><span>{action}</span><span aria-hidden="true">→</span></button></div>
      </article>;
    })}</div>
  </section>;
}

function translationRecordsFromMaterial(lesson: BookLesson, material: LearningMaterial): SentenceTranslationRecord[] {
  const translations = new Map<string,string>();
  material.sentences.forEach(sentence => translations.set(sentence.id,sentence.translationZh));
  material.vocabulary.forEach(item => { if (!translations.has(item.sentenceId)) translations.set(item.sentenceId,item.sentenceMeaningZh); });
  const paragraphs = lessonParagraphs(lesson);
  return learningSourceSentences(lesson.english).flatMap(sentence => {
    const translationZh = translations.get(sentence.id)?.trim();
    if (!translationZh) return [];
    return [{
      ...sentenceTranslationTarget({ document: bookLessonReadingDocumentIdentity(lesson.bookId,lesson.id),paragraphIndex: sentence.paragraphIndex,startOffset: sentence.startOffset,sourceText: sentence.english,paragraphContext: paragraphs[sentence.paragraphIndex] }),
      translationZh,
      model: material.generator.model ?? "Codex（实际模型未报告）",
      provider: "learning-material" as const,
      generatedAt: material.createdAt,
    }];
  });
}

function BilingualLessonSource({ lesson, material }: { lesson: BookLesson; material: LearningMaterial | null }) {
  const storage = getReaderStorage();
  const sentences = learningSourceSentences(lesson.english);
  const [records, setRecords] = useState<SentenceTranslationRecord[]>(() => loadSentenceTranslations(storage));
  const recordsRef = useRef(records);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const cachedMaterialRef = useRef<LearningMaterial | null>(material);
  const materialLookupDoneRef = useRef(Boolean(material));
  const [error, setError] = useState("");
  recordsRef.current = records;
  if (material && cachedMaterialRef.current !== material) {
    cachedMaterialRef.current = material;
    materialLookupDoneRef.current = true;
  }

  async function loadTranslations() {
    if (loadingRef.current) return;
    const paragraphs = lessonParagraphs(lesson);
    const targetFor = (sentence: ReturnType<typeof learningSourceSentences>[number]) => sentenceTranslationTarget({
      document: bookLessonReadingDocumentIdentity(lesson.bookId,lesson.id),paragraphIndex: sentence.paragraphIndex,startOffset: sentence.startOffset,sourceText: sentence.english,paragraphContext: paragraphs[sentence.paragraphIndex],
    });
    if (sentences.every(sentence => findSentenceTranslation(recordsRef.current,targetFor(sentence)))) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      if (!materialLookupDoneRef.current) {
        try { cachedMaterialRef.current = (await fetchCachedLearningMaterial(lesson.bookId,lesson.id)).material; }
        catch { cachedMaterialRef.current = null; }
        materialLookupDoneRef.current = true;
      }
      const cachedMaterial = cachedMaterialRef.current;
      if (cachedMaterial) {
        let next = recordsRef.current;
        for (const record of translationRecordsFromMaterial(lesson,cachedMaterial)) {
          if (!findSentenceTranslation(next,record)) next = upsertSentenceTranslation(next,record);
        }
        if (next !== recordsRef.current) {
          recordsRef.current = next;
          setRecords(next);
          saveSentenceTranslations(storage,next);
        }
      }
      for (const sentence of sentences) {
        const target = targetFor(sentence);
        if (findSentenceTranslation(recordsRef.current, target)) continue;
        const result = await translateParagraph({
          mode: "sentence",
          paragraphContext: paragraphs[sentence.paragraphIndex],
          text: sentence.english,
          contextBefore: paragraphs[sentence.paragraphIndex - 1],
          contextAfter: paragraphs[sentence.paragraphIndex + 1],
        });
        const record: SentenceTranslationRecord = {
          ...target,
          translationZh: result.translation,
          expressions: result.expressions,
          model: result.model,
          provider: result.provider,
          generatedAt: new Date().toISOString(),
        };
        const next = upsertSentenceTranslation(recordsRef.current, record);
        recordsRef.current = next;
        setRecords(next);
        saveSentenceTranslations(storage, next);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "译文加载失败，请重试。");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function toggleSource() {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadTranslations();
  }

  return <details className="learning-brief-source" open={expanded}>
    <summary onClick={(event) => { event.preventDefault(); toggleSource(); }}><span>查看本篇中英对照</span><span aria-hidden="true">⌄</span></summary>
    <div className="learning-brief-bilingual-list">
      {sentences.map((sentence) => {
        const target = sentenceTranslationTarget({ document: bookLessonReadingDocumentIdentity(lesson.bookId, lesson.id), paragraphIndex: sentence.paragraphIndex, startOffset: sentence.startOffset, sourceText: sentence.english, paragraphContext: lessonParagraphs(lesson)[sentence.paragraphIndex] });
        const translation = findSentenceTranslation(records, target)?.translationZh;
        return <article className="learning-brief-bilingual-pair" key={sentence.id}>
          <p className="learning-brief-source-english">{sentence.english}</p>
          <p className="learning-brief-source-chinese">{translation ?? (loading || loadingRef.current ? "正在加载本句译文…" : "译文暂不可用")}</p>
        </article>;
      })}
      {error && <div className="learning-brief-source-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadTranslations()}>重试翻译</button></div>}
    </div>
  </details>;
}

export function LessonLearning({ lesson, children }: { lesson: BookLesson; children: (openLearning: () => void) => ReactNode }) {
  const storage = getReaderStorage(), [active,setActive] = useState(() => storage.getItem(LEARNING_ACTIVE_KEY) === lesson.id && restoredStageView(lesson.id) !== null), [view,setView] = useState<StageView>(() => restoredStageView(lesson.id) ?? "stages"), [material,setMaterial] = useState<LearningMaterial | null>(null), [stages,setStages] = useState<Partial<Record<LearningStage,LearningProgress>>>(() => stageRecords(lesson)), [error,setError] = useState(""), [retry,setRetry] = useState(0), [preparingAudio,setPreparingAudio] = useState(false), [audioError,setAudioError] = useState("");
  const intent = useRef<{ stage: LearningStage; restart?: boolean } | null>(view === "stages" ? null : { stage: view });
  const progress = view === "stages" ? undefined : stages[view];
  useEffect(() => () => { sessionStorage.removeItem(STAGE_SESSION_KEY); },[lesson.id]);
  useEffect(() => { if (active) sessionStorage.setItem(STAGE_SESSION_KEY,JSON.stringify({ lessonId: lesson.id, stage: view })); else sessionStorage.removeItem(STAGE_SESSION_KEY); },[active,view,lesson.id]);
  useEffect(() => {
    if (!active || view === "stages" || (material && material.vocabulary.length >= learningVocabularyCoverage(lesson.english).minimum && material.vocabulary.every(word => word.answerTokens.length === 1) && material.sentences.every(sentence => sentence.steps.every(step => step.typingTokens?.length)))) return;
    const controller = new AbortController(); setError("");
    void fetch(`/api/books/${encodeURIComponent(lesson.bookId)}/lessons/${encodeURIComponent(lesson.id)}/learning-material`, { method: "POST", signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "学习材料准备失败"); return value as LearningMaterial; }).then(value => {
      if (controller.signal.aborted) return;
      if (value.vocabulary?.some(word => word.answerTokens?.length !== 1)) throw new Error("第一阶段需要单词题，当前旧短语材料尚未升级，请重新准备");
      if (value.vocabulary?.length < learningVocabularyCoverage(lesson.english).minimum) throw new Error("第一阶段单词准备不足，请重新准备本篇词汇");
      if (value.sentences?.some(sentence => sentence.steps.some(step => !step.typingTokens?.length)) || value.schemaVersion !== 3 || value.generator?.engine !== "codex-prep" || value.source.lessonId !== lesson.id || value.source.bookFingerprint !== lesson.sourceFingerprint || value.english !== lesson.english) throw new Error("学习材料来源或版本已变化，请重新打开精选内容");
      const next = { vocabulary: resumeStageLearningProgress(storage,value,loadSavedSelections(storage),"vocabulary"), assembly: resumeStageLearningProgress(storage,value,loadSavedSelections(storage),"assembly") };
      if (intent.current) { const { stage,restart } = intent.current; next[stage] = restart ? restartStageLearning(value,next[stage]) : { ...next[stage], stageStartedAt: next[stage].stageStartedAt ?? new Date().toISOString() }; }
      for (const record of Object.values(next)) saveLearningProgress(storage,record);
      setMaterial(value); setStages(next); intent.current = null;
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "准备失败"); });
    return () => controller.abort();
  },[active,view,material,lesson,retry,storage]);
  function update(next: LearningProgress) {
    const stage = next.practiceStage ?? (view === "stages" ? "vocabulary" : view);
    const saved = { ...next, practiceStage: stage, stageTotal: material ? stage === "assembly" ? assemblyQueue(material,next).active.length : next.selectedVocabularyIds.length : next.stageTotal };
    saveLearningProgress(storage,saved); setStages(previous => ({ ...previous, [stage]: saved }));
  }
  function open(stage: LearningStage, restart = false) {
    setView(stage); setActive(true); storage.setItem(LEARNING_ACTIVE_KEY,lesson.id);
    const previous = stages[stage];
    if (material && previous) { update(restart ? restartStageLearning(material,previous) : { ...previous, stageStartedAt: previous.stageStartedAt ?? new Date().toISOString() }); }
    else { intent.current = { stage,restart }; setRetry(value => value + 1); }
  }
  function chooseStages() { intent.current = null; setView("stages"); }
  function exit() { storage.setItem(LEARNING_ACTIVE_KEY,""); setActive(false); setView("stages"); }
  function returnToReading() {
    if (material && progress && ["assembly-complete", "meaning"].includes(progress.phase)) update(completeLearning(continueLearning(progress, material)));
    exit();
  }
  function openLearning() { intent.current = null; storage.setItem(LEARNING_ACTIVE_KEY,lesson.id); setActive(true); setView("stages"); }
  const reader = children(openLearning);
  async function retryAudio() {
    if (!material || preparingAudio) return; setPreparingAudio(true); setAudioError("");
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(lesson.bookId)}/lessons/${encodeURIComponent(lesson.id)}/learning-material`,{ method: "POST" }); const value = await response.json() as LearningMaterial & { error?: string };
      if (!response.ok || value.materialVersion !== material.materialVersion) throw new Error(value.error || "材料版本已变化，请重新进入课程");
      setMaterial(previous => previous ? { ...previous,audio: value.audio } : previous);
    } catch (error) { setAudioError(error instanceof Error ? error.message : "朗读准备失败"); } finally { setPreparingAudio(false); }
  }
  const audioNotice = material?.audio?.status === "partial" ? <div className="learning-audio-notice"><p role="status">{audioError || material.audio.error}</p><button className="text-button" disabled={preparingAudio} onClick={() => void retryAudio()}>{preparingAudio ? "正在准备朗读…" : "补齐朗读音频"}</button></div> : null;
  if (!active) return <div className="lesson-reading-content">{reader}</div>;
  if (view === "stages") return <section className="learning-stage-screen" aria-label="本篇练习">
    <header className="learning-brief-hero">
      <button className="learning-brief-back" onClick={exit}><span aria-hidden="true">←</span>返回阅读</button>
      <h1>{lesson.titleZh}</h1>
    </header>
    <StagePicker stages={stages} open={open} />
    <details className="learning-stage-reference"><summary>查看文章与练习说明</summary><article className="learning-brief-content">
      <section className="learning-brief-section learning-brief-summary"><p>THE BIG PICTURE</p><h2>这篇文章在讲什么</h2><div>{lesson.teaserZh}</div></section>
      <section className="learning-brief-section"><p>CORE IDEA</p><h2>背景解读</h2><div>{lesson.explanationZh}</div></section>
      {lesson.keywords.length > 0 && <section className="learning-brief-section"><p>FOCUS WORDS</p><h2>本篇重点词汇</h2><ul className="learning-brief-keywords">{lesson.keywords.map((word,index) => <li key={`${word}-${index}`}><span>{String(index + 1).padStart(2,"0")}</span><strong>{word}</strong></li>)}</ul></section>}
      <section className="learning-brief-section"><p>HOW TO LEARN</p><h2>怎么学这一篇</h2><ol className="learning-brief-tips"><li><span>01</span><div>两个练习阶段可以任选其一，也可以按自己的需要分别练习。</div></li><li><span>02</span><div>词汇准备只练一轮；答错可在当前题重试，答完所选单词即完成，也可以自行再次练习。</div></li><li><span>03</span><div>完整句练习从词汇或短语开始，逐步重建原句；不需要先完成词汇准备。</div></li></ol></section>
      <BilingualLessonSource lesson={lesson} material={material} />
    </article></details>
    {audioNotice}
  </section>;
  if (!material || !progress || material.vocabulary.length < learningVocabularyCoverage(lesson.english).minimum || material.vocabulary.some(word => word.answerTokens.length !== 1) || material.sentences.some(sentence => sentence.steps.some(step => !step.typingTokens?.length))) return <section className="learning-panel" aria-label="英语学习"><h2>准备这篇精选内容的学习材料</h2>{error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry(r => r + 1)}>重新准备</button></div> : <p role="status">正在准备本课教材与朗读音频，首次准备可能需要几分钟。完成后的练习直接使用已保存材料和本地音频。</p>}<button className="text-button" onClick={chooseStages}>返回阶段选择</button><button className="text-button" onClick={exit}>返回阅读</button></section>;
  const repeat = () => update(restartStageLearning(material,progress));
  if (["vocabulary-complete", "assembly-complete", "meaning", "completed"].includes(progress.phase)) {
    const stage = progress.phase === "vocabulary-complete" ? "vocabulary" : "assembly";
    const assemblySummary = learningStageSummary(stages.assembly, "assembly");
    return <LearningStageCompletion title={lesson.titleZh} stage={stage} total={learningStageSummary(progress, stage).total} progress={progress} exit={returnToReading} repeat={repeat}
      next={stage === "vocabulary" ? { label: assemblySummary.complete ? "再次练习完整句" : assemblySummary.started ? "继续句子练习" : "练习句子", open: () => open("assembly", assemblySummary.complete) } : undefined} />;
  }
  if (progress.phase === "vocabulary-selection") return <VocabularySelection key={progress.runId} material={material} progress={progress} update={update} exit={chooseStages} reset={() => { const next = restartStageLearning(material,progress); update(next.selectedVocabularyIds.length ? startLearning(next) : next); }} />;
  if (progress.phase === "vocabulary" || progress.phase === "vocabulary-review") return <VocabularyPreparationGame key={progress.runId} material={material} progress={progress} update={update} exit={chooseStages} reset={() => update(startLearning(restartStageLearning(material,progress)))} />;
  if (progress.phase === "assembly-selection") return <AssemblySelection key={progress.runId} material={material} progress={progress} update={update} exit={chooseStages} />;
  if (progress.phase === "assembly") return <AssemblyTypingGame key={progress.runId} material={material} progress={progress} update={update} exit={chooseStages} />;
  const selectionProgress = { ...progress, phase: view === "assembly" ? "assembly-selection" as const : "vocabulary-selection" as const };
  return view === "assembly"
    ? <AssemblySelection key={progress.runId} material={material} progress={selectionProgress} update={update} exit={chooseStages} />
    : <VocabularySelection key={progress.runId} material={material} progress={selectionProgress} update={update} exit={chooseStages} reset={() => update(restartStageLearning(material, progress))} />;
}
