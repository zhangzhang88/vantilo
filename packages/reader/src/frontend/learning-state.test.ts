import { describe, expect, it } from "vitest";
import { material } from "../../tests/fixtures/learning";
import { resumeStageLearningProgress, restartStageLearning, learningStageSummary, setVocabularySkipped, openVocabularySelection, beginAssemblySelection, openAssemblySelection, assemblyDraftFor, showAssemblyCompletion, typingDraftFor, setTypingWord, checkTypingAssembly, assemblyQueue, checkAssembly, completeLearning, continueLearning, currentLearningItem, currentWordIndex, LEARNING_PROGRESS_KEY, loadLearningProgress, moveAssembly, newLearningProgress, normalizeLearningAnswer, placeAssemblyTile, recordLearningAction, restartLearning, resumeLearningProgress, saveLearningProgress, setAssemblySkipped, startLearning, vocabularyDefaults, withdrawAssemblyTile, type LearningProgress } from "./learning-state";
import type { AssemblyStep } from "../shared/learning-material";
import type { SavedSelection } from "./selection-state";
import { buildUserDataBackup, parseUserDataBackup, serializeUserDataBackup } from "./user-data-backup";
const saved = (text: string, familiarity: SavedSelection["familiarity"]): SavedSelection => ({ id: text, articleTitle: "test", text, context: "context", paragraphIndex: 0, createdAt: "2026-10-16T00:00:00Z", familiarity });
const memory = () => { const data = new Map<string,string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => { data.set(k,v); } }; };
const assemblyStart = (): LearningProgress => ({ ...newLearningProgress(material,[]), selectedVocabularyIds: [], phase: "assembly", assemblyCurrentId: material.sentences[0].steps[0].id });
function finishVocabulary(p: LearningProgress) { const item = currentLearningItem(material,p); if (!item || !("answerTokens" in item)) return p; let next = p; for (const token of item.answerTokens) next = recordLearningAction(material,next,"answer",token.text); return next; }
function finishAssembly(p: LearningProgress) { const step = currentLearningItem(material,p) as AssemblyStep; let next = p; for (const id of step.assembly.correctOrder) next = placeAssemblyTile(material,next,id); return checkAssembly(material,next); }

describe("Worm preparation lifecycle and authored assembly", () => {
  it("skips only consistently known words and permits lesson overrides", () => {
    expect(vocabularyDefaults(material,[saved("Evidence",5)])).toEqual(["v:1"]);
    expect(vocabularyDefaults(material,[saved("evidence",5),saved("evidence",2)])).toEqual(["v:0","v:1"]);
    expect(vocabularyDefaults(material,[saved("evidence",0)])).toEqual(["v:0","v:1"]);
    expect(startLearning(newLearningProgress(material,[saved("evidence",5),saved("careful",5)])).phase).toBe("vocabulary-complete");
  });
  it("keeps lesson vocabulary overrides and accumulated errors through selection without touching the other stage", () => {
    const storage = memory(); let p = startLearning(newLearningProgress(material,[saved("evidence",5)]));
    p = recordLearningAction(material,p,"answer","wrong"); const results = p.vocabulary, assembly = p.assembly;
    p = openVocabularySelection(p); expect(p.phase).toBe("vocabulary-selection"); expect(p.draft).toBeUndefined();
    expect(setVocabularySkipped(material,p,"invalid",true)).toBe(p);
    p = setVocabularySkipped(material,p,"v:0",false); p = setVocabularySkipped(material,p,"v:1",true);
    expect(p.selectedVocabularyIds).toEqual(["v:0"]); expect(p.vocabulary).toEqual(results); expect(p.assembly).toBe(assembly);
    saveLearningProgress(storage,p); p = resumeLearningProgress(storage,material,[]);
    expect(p.phase).toBe("vocabulary-selection"); expect(p.selectedVocabularyIds).toEqual(["v:0"]);
    p = setVocabularySkipped(material,p,"v:0",true); expect(startLearning(p).phase).toBe("vocabulary-complete");
    p = setVocabularySkipped(material,p,"v:1",false); p = startLearning(p);
    expect(currentLearningItem(material,p)?.id).toBe("v:1"); expect(p.reviewVocabularyIds).toEqual([]); expect(p.vocabulary["v:1"].errors).toBe(1);
  });
  it("locks a correct word in a multiword lexical target and retries only the incorrect word", () => {
    const source = structuredClone(material); source.vocabulary[0] = { ...source.vocabulary[0], answerText: "Good evidence", answerTokens: [{ text: "Good", start: 0, end: 4 }, { text: "evidence", start: 5, end: 13 }] };
    let p = startLearning({ ...newLearningProgress(source,[]), selectedVocabularyIds: ["v:0"] });
    p = recordLearningAction(source,p,"answer","good"); expect(currentWordIndex(source,p)).toBe(1);
    p = recordLearningAction(source,p,"answer","wrong"); expect(p.vocabulary["v:0"].lockedWords).toEqual([0]); expect(currentWordIndex(source,p)).toBe(1);
    p = recordLearningAction(source,p,"answer","evidence"); expect(p.phase).toBe("vocabulary-complete"); expect(p.vocabulary["v:0"].correct).toBe(true);
  });
  it("retries errors in place and completes one round even after explicit help", () => {
    const storage = memory();
    let p = startLearning(newLearningProgress(material,[saved("evidence",5)]));
    p = recordLearningAction(material,p,"answer","wrong"); p = recordLearningAction(material,p,"hint");
    expect(p.phase).toBe("vocabulary"); expect(currentLearningItem(material,p)?.id).toBe("v:1"); expect(p.vocabulary["v:1"].correct).toBe(false);
    p = finishVocabulary(p);
    expect(p.phase).toBe("vocabulary-complete"); expect(p.reviewVocabularyIds).toEqual([]); expect(p.vocabularyReview).toEqual({});
    expect(p.vocabulary["v:1"]).toMatchObject({ attempts: 2, errors: 1, hints: 1, correct: true });
    expect(startLearning(p).phase).toBe("vocabulary-complete");
    saveLearningProgress(storage,p); expect(resumeLearningProgress(storage,material,[]).phase).toBe("vocabulary-complete");
    const repeated = restartStageLearning(material,p); expect(repeated.runId).not.toBe(p.runId); expect(repeated.vocabulary).toEqual({});
    expect(startLearning(repeated).phase).toBe("vocabulary");
  });
  it("retires a saved automatic review round without losing historical results or changing assembly drafts", () => {
    const storage = memory();
    let p = startLearning({ ...newLearningProgress(material,[saved("evidence",5)]),practiceStage: "vocabulary" as const,stageStartedAt: material.createdAt });
    p = recordLearningAction(material,p,"answer","wrong"); p = finishVocabulary(p);
    const historical: LearningProgress = { ...p,phase: "vocabulary-review",stageTotal: 2,reviewVocabularyIds: ["v:1"],vocabularyReview: { "v:1": { attempts: 1,errors: 1,hints: 0,correct: false,skipped: false } },draft: { phase: "vocabulary-review",itemId: "v:1",wordIndex: 0,value: "care" } };
    const assembly = { ...setTypingWord(material,assemblyStart(),0,"a"),practiceStage: "assembly" as const };
    saveLearningProgress(storage,historical); saveLearningProgress(storage,assembly);
    expect(learningStageSummary(historical,"vocabulary")).toMatchObject({ complete: true,percent: 100,done: 1,total: 1 });
    const restored = resumeStageLearningProgress(storage,material,[],"vocabulary");
    expect(restored).toMatchObject({ phase: "vocabulary-complete",stageTotal: 1,vocabulary: historical.vocabulary,vocabularyReview: historical.vocabularyReview,reviewVocabularyIds: ["v:1"] });
    expect(restored.draft).toBeUndefined(); expect(loadLearningProgress(storage).at(-1)).toEqual(assembly);
    const unfinished = { ...historical,selectedVocabularyIds: ["v:0","v:1"] }; saveLearningProgress(storage,unfinished);
    const resumed = resumeStageLearningProgress(storage,material,[],"vocabulary");
    expect(resumed.phase).toBe("vocabulary"); expect(currentLearningItem(material,resumed)?.id).toBe("v:0");
    expect(learningStageSummary(resumed,"vocabulary")).toMatchObject({ complete: false,percent: 50,done: 1,total: 2 });
  });
  it("keeps Codex-authored phrase tiles intact and does not prefill known structures", () => {
    let p = assemblyStart(); p = moveAssembly(material,finishAssembly(p),"next"); p = moveAssembly(material,finishAssembly(p),"next");
    const step = currentLearningItem(material,p) as AssemblyStep;
    expect(step.assembly.tiles.map(t => t.text)).toEqual(["supports","a careful claim"]);
    expect(step.assembly.tiles[1]).toMatchObject({ role: "known", fromStepId: material.sentences[0].steps[0].id });
    expect(assemblyDraftFor(step,p).slots).toEqual([null,null]);
  });
  it("checks a complete arrangement, locks correct positions, retains errors and restores them after refresh", () => {
    const storage = memory(); let p = assemblyStart();
    p = placeAssemblyTile(material,p,"careful"); p = placeAssemblyTile(material,p,"a"); p = placeAssemblyTile(material,p,"claim");
    const before = p; expect(placeAssemblyTile(material,p,"claim")).toBe(before);
    p = checkAssembly(material,p); expect(p.assemblyDraft).toMatchObject({ slots: ["careful","a","claim"], lockedSlots: [2], submitted: true });
    expect(p.assembly[material.sentences[0].steps[0].id]).toMatchObject({ attempts: 1, errors: 1, correct: false });
    expect(withdrawAssemblyTile(material,p,2)).toBe(p);
    saveLearningProgress(storage,p); p = resumeLearningProgress(storage,material,[]); expect(p.assemblyDraft?.slots).toEqual(["careful","a","claim"]);
    p = withdrawAssemblyTile(material,p,0); p = withdrawAssemblyTile(material,p,1); p = placeAssemblyTile(material,p,"a"); p = placeAssemblyTile(material,p,"careful"); p = checkAssembly(material,p);
    expect(p.assemblyDraft?.lockedSlots).toEqual([0,1,2]); expect(p.assembly[material.sentences[0].steps[0].id].correct).toBe(true);
    expect(currentLearningItem(material,p)?.id).toBe(material.sentences[0].steps[0].id); // completion reading precedes Next
  });
  it("withdraws an unchecked tile without leaving artificial blanks in the chosen sequence", () => {
    let p = placeAssemblyTile(material,assemblyStart(),"careful"); p = placeAssemblyTile(material,p,"claim"); p = withdrawAssemblyTile(material,p,0);
    expect(p.assemblyDraft?.slots).toEqual(["claim",null,null]);
    p = placeAssemblyTile(material,p,"a"); expect(p.assemblyDraft?.slots).toEqual(["claim","a",null]);
  });
  it("requires explicit Next after each success, supports repeat/previous and reaches exact Target", () => {
    let p = assemblyStart(); expect(moveAssembly(material,p,"next")).toBe(p);
    p = finishAssembly(p); p = moveAssembly(material,p,"repeat"); expect(p.assembly[material.sentences[0].steps[0].id].correct).toBe(false); expect(p.assemblyDraft).toBeUndefined();
    p = moveAssembly(material,finishAssembly(p),"next"); expect(currentLearningItem(material,p)?.id).toBe(material.sentences[0].steps[1].id);
    p = moveAssembly(material,p,"previous"); expect(currentLearningItem(material,p)?.id).toBe(material.sentences[0].steps[0].id); expect(p.assembly[material.sentences[0].steps[0].id].correct).toBe(false); p = moveAssembly(material,finishAssembly(p),"next");
    for (let n=0;n<4 && p.phase === "assembly";n++) p = moveAssembly(material,finishAssembly(p),"next");
    expect(p.phase).toBe("assembly-complete"); expect(completeLearning(p).phase).toBe("assembly-complete");
    p = completeLearning(continueLearning(p,material)); expect(p.phase).toBe("completed");
  });
  it("preserves force-practice precedence, inherited lexical skips and the final-Bridge guard", () => {
    const source = structuredClone(material); source.sentences[0].steps[1].vocabularyId = "v:0";
    let p: LearningProgress = { ...newLearningProgress(source,[]), selectedVocabularyIds: [] };
    expect(assemblyQueue(source,p).inherited.has(source.sentences[0].steps[1].id)).toBe(true);
    p = setAssemblySkipped(p,source.sentences[0].steps[1].id,false); expect(assemblyQueue(source,p).active.some(s => s.id === source.sentences[0].steps[1].id)).toBe(true);
    p = { ...p, assemblyPracticeIds: [], skippedAssemblyIds: source.sentences[0].steps.map(s => s.id) };
    expect(assemblyQueue(source,p).active.map(s => s.kind)).toEqual(["bridge","target"]);
    expect([...assemblyQueue(source,p).restored]).toEqual([source.sentences[0].steps[2].id]);
  });
  it("retains V1 and prior runs in backups without modifying familiarity or review schedules", () => {
    const storage = memory(), vocabulary = [saved("evidence",5)], before = JSON.stringify(vocabulary);
    storage.setItem("existing-review-schedule","unchanged");
    const old = { version: 1, materialId: material.id, materialVersion: "old", phase: "completed", selectedVocabularyIds: [], vocabulary: {}, assembly: {}, startedAt: material.createdAt, updatedAt: material.createdAt, completedAt: material.createdAt };
    storage.setItem(LEARNING_PROGRESS_KEY,JSON.stringify({ version: 1, items: [old] }));
    const p = startLearning(newLearningProgress(material,vocabulary)); saveLearningProgress(storage,p); const repeated = restartLearning(material,p); saveLearningProgress(storage,repeated);
    expect(repeated.runId).not.toBe(p.runId); expect(loadLearningProgress(storage)).toHaveLength(3);
    expect(resumeLearningProgress(storage,{ ...material, materialVersion: "new" },vocabulary).phase).toBe("intro");
    expect(storage.getItem("existing-review-schedule")).toBe("unchanged"); expect(JSON.stringify(vocabulary)).toBe(before);
    const backup = parseUserDataBackup(serializeUserDataBackup(buildUserDataBackup(storage))); expect((backup.data[LEARNING_PROGRESS_KEY] as { items: unknown[] }).items).toHaveLength(3);
  });
  it("rejects corrupt IDs, forged completion and bogus locked positions without scheduling review", () => {
    const storage = memory(); storage.setItem(LEARNING_PROGRESS_KEY,"invalid"); expect(loadLearningProgress(storage)).toEqual([]);
    const p = { ...newLearningProgress(material,[]), phase: "completed" as const, completedAt: material.createdAt }; saveLearningProgress(storage,p); expect(resumeLearningProgress(storage,material,[]).phase).toBe("vocabulary");
    let active = startLearning(newLearningProgress(material,[])); active = recordLearningAction(material,active,"hint"); active = finishVocabulary(active); active = finishVocabulary(active); active = { ...active, phase: "assembly", reviewVocabularyIds: [] }; saveLearningProgress(storage,active); expect(resumeLearningProgress(storage,material,[]).phase).toBe("assembly");
    saveLearningProgress(storage,{ ...active,selectedVocabularyIds: ["invalid"] }); expect(resumeLearningProgress(storage,material,[]).phase).toBe("intro");
    saveLearningProgress(storage,{ ...active,vocabulary: { ...active.vocabulary,"v:0": { ...active.vocabulary["v:0"],lockedWords: [99] } } }); expect(resumeLearningProgress(storage,material,[]).phase).toBe("intro");
    const bad = { ...assemblyStart(), assemblyDraft: { itemId: material.sentences[0].steps[0].id, slots: ["careful","a","claim"], lockedSlots: [0], submitted: true } }; saveLearningProgress(storage,bad); expect(resumeLearningProgress(storage,material,[]).assemblyDraft).toBeUndefined();
  });
  it("keeps old input/word-bank evidence as history but restarts incompatible assembly progress", () => {
    const storage = memory(), p = { ...assemblyStart(), assemblyMode: "word-bank-v1" as const };
    saveLearningProgress(storage,p); expect(resumeLearningProgress(storage,material,[])).toMatchObject({ phase: "assembly-selection", assemblyMode: "typing-game-v1", assembly: {} });
  });
  it("preserves negation and hyphens and cannot complete assembly with an arbitrary sentence string", () => {
    expect(normalizeLearningAnswer("don't")).not.toBe(normalizeLearningAnswer("do")); expect(normalizeLearningAnswer("well-being")).not.toBe(normalizeLearningAnswer("well being"));
    const p = assemblyStart(); expect(recordLearningAction(material,p,"answer",material.sentences[0].steps[0].english)).toBe(p);
  });
});


describe("original TypingGame state", () => {
  it("selection keeps the current item or resumes at its next surviving neighbour like applyPhase2Queue", () => {
    let p = assemblyStart(), steps = material.sentences[0].steps;
    p = moveAssembly(material,showAssemblyCompletion(material,p),"next");
    p = openAssemblySelection(showAssemblyCompletion(material,p));
    expect(p.assemblyCurrentId).toBe(steps[1].id); expect(p.assemblyReadingId).toBeUndefined();
    expect(beginAssemblySelection(material,p).assemblyCurrentId).toBe(steps[1].id);
    p = setAssemblySkipped(p,steps[1].id,true);
    expect(beginAssemblySelection(material,p).assemblyCurrentId).toBe(steps[2].id);
    expect(beginAssemblySelection(material,p).typingDraft).toBeUndefined();
    p = { ...p,assemblyCurrentId: steps[0].id,skippedAssemblyIds: steps.slice(0,-1).map(step => step.id) };
    expect(beginAssemblySelection(material,p).assemblyCurrentId).toBe(steps[2].id); // last Bridge guard
  });
  it("previous reopens answered items for fresh input, wraps first to last and preserves accumulated errors", () => {
    const storage = memory(), first = material.sentences[0].steps[0]; let p = assemblyStart();
    p = checkTypingAssembly(material,setTypingWord(material,p,0,"x"));
    for (const [i,token] of first.typingTokens!.entries()) p = setTypingWord(material,p,i,token.text);
    p = moveAssembly(material,checkTypingAssembly(material,p),"next");
    p = moveAssembly(material,showAssemblyCompletion(material,p),"previous");
    expect(currentLearningItem(material,p)?.id).toBe(first.id);
    expect(p.assemblyReadingId).toBeUndefined(); expect(p.typingDraft).toBeUndefined();
    expect(p.assembly[first.id]).toMatchObject({ correct: false, skipped: false, attempts: 2, errors: 1 });
    expect(typingDraftFor(first,p)).toMatchObject({ inputs: ["","",""], lockedWords: [], submitted: false });
    saveLearningProgress(storage,p); p = resumeLearningProgress(storage,material,[]);
    expect(p.assemblyReadingId).toBeUndefined(); p = setTypingWord(material,p,0,"a"); expect(p.typingDraft?.inputs[0]).toBe("a");
    p = moveAssembly(material,p,"previous"); expect(currentLearningItem(material,p)?.id).toBe(assemblyQueue(material,p).active.at(-1)!.id);
    expect(p.typingDraft).toBeUndefined(); expect(p.assemblyReadingId).toBeUndefined();
  });
  it("uses the right-arrow reading then next lifecycle without awarding correct answers", () => {
    const storage = memory(), first = material.sentences[0].steps[0];
    let p = assemblyStart();
    p = showAssemblyCompletion(material,p);
    expect(p.assemblyReadingId).toBe(first.id);
    expect(p.assembly[first.id]).toMatchObject({ correct: false, skipped: false, hints: 1, attempts: 0, errors: 0 });
    expect(showAssemblyCompletion(material,p)).toBe(p);
    saveLearningProgress(storage,p); p = resumeLearningProgress(storage,material,[]);
    expect(p.assemblyReadingId).toBe(first.id);
    const backup = parseUserDataBackup(serializeUserDataBackup(buildUserDataBackup(storage)));
    expect((backup.data[LEARNING_PROGRESS_KEY] as { items: LearningProgress[] }).items.at(-1)?.assemblyReadingId).toBe(first.id);
    p = moveAssembly(material,p,"repeat");
    expect(p.assemblyReadingId).toBeUndefined(); expect(p.assembly[first.id]).toMatchObject({ correct: false, skipped: false });
    p = checkTypingAssembly(material,setTypingWord(material,p,0,"x"));
    p = showAssemblyCompletion(material,p); expect(p.assembly[first.id]).toMatchObject({ errors: 1, attempts: 1, correct: false });
    p = moveAssembly(material,p,"next");
    expect(p.assemblyReadingId).toBeUndefined(); expect(currentLearningItem(material,p)?.id).toBe(material.sentences[0].steps[1].id);
    expect(p.assembly[first.id]).toMatchObject({ correct: false, skipped: true, attempts: 1, errors: 1 });
    while (p.phase === "assembly") p = moveAssembly(material,showAssemblyCompletion(material,p),"next");
    expect(p.phase).toBe("assembly-complete"); expect(Object.values(p.assembly).every(r => !r.correct && r.skipped)).toBe(true);
    saveLearningProgress(storage,p); expect(resumeLearningProgress(storage,material,[]).phase).toBe("assembly-complete");
    expect(learningStageSummary(p,"assembly").percent).toBe(100);
  });
  it("finishes after the last reading even when a previously visited item was restarted", () => {
    const storage = memory(); let p = assemblyStart();
    while (currentLearningItem(material,p)?.id !== material.sentences[0].steps.at(-1)!.id) p = moveAssembly(material,showAssemblyCompletion(material,p),"next");
    p = moveAssembly(material,p,"previous"); p = moveAssembly(material,p,"repeat");
    // Selection can return to the remaining last item, as in the original game cursor.
    p = { ...p, assemblyCurrentId: material.sentences[0].steps.at(-1)!.id };
    p = moveAssembly(material,showAssemblyCompletion(material,p),"next");
    expect(p.phase).toBe("assembly-complete"); saveLearningProgress(storage,p);
    expect(resumeLearningProgress(storage,material,[]).phase).toBe("assembly-complete");
  });

  it("checks the whole item, keeps wrong inputs, locks correct words and restores the draft", () => {
    const storage = memory(), id = material.sentences[0].steps[0].id; let p = assemblyStart();
    p = setTypingWord(material,p,0,"a"); p = setTypingWord(material,p,1,"wrong"); p = setTypingWord(material,p,2,"claim");
    expect(p.assembly[id]).toBeUndefined(); p = checkTypingAssembly(material,p);
    expect(p.typingDraft).toMatchObject({ inputs: ["a","wrong","claim"], lockedWords: [0,2], currentWordIndex: 1, submitted: true });
    expect(p.assembly[id]).toMatchObject({ correct: false, errors: 1 }); expect(setTypingWord(material,p,0,"x")).toBe(p);
    saveLearningProgress(storage,p); p = resumeLearningProgress(storage,material,[]); expect(typingDraftFor(material.sentences[0].steps[0],p).inputs).toEqual(["a","wrong","claim"]);
    p = setTypingWord(material,p,1,"careful"); p = checkTypingAssembly(material,p); expect(p.assembly[id].correct).toBe(true); expect(currentLearningItem(material,p)?.id).toBe(id);
    p = moveAssembly(material,p,"repeat"); expect(p.typingDraft).toBeUndefined(); expect(p.assembly[id].correct).toBe(false);
  });
  it("finishes every authored word before explicit Next and rejects forged locked drafts", () => {
    let p = assemblyStart();
    for (const step of material.sentences[0].steps) {
      expect(moveAssembly(material,p,"next")).toBe(p);
      for (const [i,token] of step.typingTokens!.entries()) p = setTypingWord(material,p,i,token.text);
      p = checkTypingAssembly(material,p); expect(p.assembly[step.id].correct).toBe(true); p = moveAssembly(material,p,"next");
    }
    expect(p.phase).toBe("assembly-complete");
    const storage = memory(); p = { ...assemblyStart(), typingDraft: { itemId: material.sentences[0].steps[0].id, inputs: ["wrong","",""], lockedWords: [0], submitted: true, currentWordIndex: 0 } }; saveLearningProgress(storage,p); expect(resumeLearningProgress(storage,material,[]).typingDraft).toBeUndefined();
  });
  it("migrates vocabulary evidence when adding Codex-authored input positions without crediting old tile answers", () => {
    const storage = memory(); let p = startLearning(newLearningProgress(material,[])); p = finishVocabulary(p); p = finishVocabulary(p); p = { ...p, phase: "assembly", assemblyMode: "authored-tiles-v1" }; saveLearningProgress(storage,p);
    const upgraded = { ...material, materialVersion: "typing-version", typingFromMaterialVersion: material.materialVersion };
    const next = resumeLearningProgress(storage,upgraded,[]); expect(next.phase).toBe("assembly-selection"); expect(next.vocabulary).toEqual(p.vocabulary); expect(next.runId).not.toBe(p.runId); expect(next.assembly).toEqual({}); expect(loadLearningProgress(storage)).toHaveLength(1);
  });
});


describe("independent practice stages", () => {
  it("selects newly added words and restores either the original or intermediate vocabulary version correctly", () => {
    const old = startLearning(resumeStageLearningProgress(memory(),material,[],"vocabulary"));
    const completed = finishVocabulary(finishVocabulary(old));
    const extra = { ...material.vocabulary[0],id: "v:2",text: "support",sourceText: "supports",answerText: "supports",answerTokens: [{ text: "supports",start: 0,end: 8 }] };
    const revised = { ...material,materialVersion: "expanded-vocabulary",vocabulary: [...material.vocabulary,extra],vocabularyRevision: { fromMaterialVersion: "intermediate-single-word",replacedIds: [],addedIds: ["v:2"],detachedLinks: [],history: [{ fromMaterialVersion: material.materialVersion,replacedIds: ["v:0"],addedIds: ["v:2"],detachedLinks: [] }],review: { approved: true as const,summaryZh: "覆盖全文单词。" } } };
    for (const version of [material.materialVersion,"intermediate-single-word"]) {
      const storage = memory(); saveLearningProgress(storage,{ ...completed,materialVersion: version });
      const next = resumeStageLearningProgress(storage,revised,[],"vocabulary");
      expect(next.phase).toBe("vocabulary-selection"); expect(next.selectedVocabularyIds).toContain("v:2");
      expect(next.vocabulary["v:1"]).toEqual(completed.vocabulary["v:1"]);
      if (version === "intermediate-single-word") expect(next.vocabulary["v:0"]).toEqual(completed.vocabulary["v:0"]);
      else expect(next.vocabulary["v:0"]).toBeUndefined();
      expect(loadLearningProgress(storage)).toHaveLength(1);
    }
  });
  it("replaces a legacy phrase result without losing other vocabulary or assembly drafts and inherited skips", () => {
    const storage = memory();
    const legacy = structuredClone(material);
    legacy.vocabulary[0] = { ...legacy.vocabulary[0],text: "Good evidence",sourceText: "Good evidence",answerText: "Good evidence",answerTokens: [{ text: "Good",start: 0,end: 4 },{ text: "evidence",start: 5,end: 13 }] };
    legacy.sentences[0].steps[1].vocabularyId = "v:0";
    let vocabulary = startLearning(resumeStageLearningProgress(storage,legacy,[],"vocabulary"));
    vocabulary = finishVocabulary(vocabulary); vocabulary = finishVocabulary(vocabulary);
    saveLearningProgress(storage,vocabulary);
    let assembly = continueLearning(resumeStageLearningProgress(storage,legacy,[],"assembly"),legacy);
    assembly = setTypingWord(legacy,assembly,0,"a");
    assembly = { ...assembly,selectedVocabularyIds: ["v:1"],assemblyElapsedSeconds: 25 };
    saveLearningProgress(storage,assembly);
    const next = { ...material,materialVersion: "single-word-upgrade",vocabularyRevision: { fromMaterialVersion: material.materialVersion,replacedIds: ["v:0"],detachedLinks: [{ stepId: material.sentences[0].steps[1].id,vocabularyId: "v:0" }],review: { approved: true as const,summaryZh: "单词题可用。" } } };
    const first = resumeStageLearningProgress(storage,next,[],"vocabulary");
    expect(first.phase).toBe("vocabulary-selection"); expect(first.vocabulary["v:0"]).toBeUndefined();
    expect(first.vocabulary["v:1"]).toEqual(vocabulary.vocabulary["v:1"]);
    const second = resumeStageLearningProgress(storage,next,[],"assembly");
    expect(second.typingDraft).toEqual(assembly.typingDraft); expect(second.assembly).toEqual(assembly.assembly);
    expect(second.assemblyElapsedSeconds).toBe(25); expect(second.phase).toBe("assembly");
    expect(second.skippedAssemblyIds).toContain(material.sentences[0].steps[1].id);
    expect(loadLearningProgress(storage)).toEqual([vocabulary,assembly]);
  });
  it("preserves vocabulary work after an assembly revision and never reuses old positional answers or skips", () => {
    const storage = memory();
    let vocabulary = startLearning(resumeStageLearningProgress(storage,material,[],"vocabulary"));
    vocabulary = { ...vocabulary, draft: { phase: "vocabulary", itemId: material.vocabulary[0].id, wordIndex: 0, value: "ev" } };
    saveLearningProgress(storage,vocabulary);
    let assembly = continueLearning(resumeStageLearningProgress(storage,material,[],"assembly"),material);
    assembly = setTypingWord(material,assembly,0,"a");
    assembly = { ...assembly, skippedAssemblyIds: [material.sentences[0].steps[1].id], assemblyPracticeIds: [material.sentences[0].steps[0].id], assemblyElapsedSeconds: 30 };
    saveLearningProgress(storage,assembly);
    const revised = { ...material, materialVersion: "revised-assembly", assemblyFromMaterialVersion: material.materialVersion };
    const restoredVocabulary = resumeStageLearningProgress(storage,revised,[],"vocabulary");
    expect(restoredVocabulary.draft).toEqual(vocabulary.draft);
    expect(restoredVocabulary.vocabulary).toEqual(vocabulary.vocabulary);
    expect(restoredVocabulary.selectedVocabularyIds).toEqual(vocabulary.selectedVocabularyIds);
    const restoredAssembly = resumeStageLearningProgress(storage,revised,[],"assembly");
    expect(restoredAssembly.phase).toBe("assembly-selection");
    expect(restoredAssembly.assembly).toEqual({}); expect(restoredAssembly.typingDraft).toBeUndefined();
    expect(restoredAssembly.skippedAssemblyIds).toEqual([]); expect(restoredAssembly.assemblyPracticeIds).toEqual([]);
    expect(restoredAssembly.stageStartedAt).toBeUndefined(); expect(restoredAssembly.assemblyElapsedSeconds).toBeUndefined();
    expect(loadLearningProgress(storage)).toEqual([vocabulary,assembly]);
  });
  it("starts and restores stage two without any stage one answers", () => {
    const storage = memory(); let assembly = resumeStageLearningProgress(storage,material,[],"assembly");
    expect(assembly.phase).toBe("assembly-selection"); expect(assembly.vocabulary).toEqual({});
    assembly = continueLearning(assembly,material); assembly = setTypingWord(material,assembly,0,"a"); saveLearningProgress(storage,assembly);
    const restored = resumeStageLearningProgress(storage,material,[],"assembly"); expect(restored.phase).toBe("assembly"); expect(restored.typingDraft?.inputs[0]).toBe("a");
    const vocabulary = resumeStageLearningProgress(storage,material,[],"vocabulary"); expect(vocabulary.phase).toBe("vocabulary-selection"); expect(vocabulary.vocabulary).toEqual({});
  });
  it("keeps both drafts independent when switching and when restarting only stage one", () => {
    const storage = memory(); let vocabulary = startLearning(resumeStageLearningProgress(storage,material,[],"vocabulary"));
    const target = currentLearningItem(material,vocabulary)!; vocabulary = { ...vocabulary, draft: { phase: "vocabulary", itemId: target.id, wordIndex: 0, value: "ev" } }; saveLearningProgress(storage,vocabulary);
    let assembly = continueLearning(resumeStageLearningProgress(storage,material,[],"assembly"),material); assembly = setTypingWord(material,assembly,0,"a"); saveLearningProgress(storage,assembly);
    expect(resumeStageLearningProgress(storage,material,[],"vocabulary").draft?.value).toBe("ev"); expect(resumeStageLearningProgress(storage,material,[],"assembly").typingDraft?.inputs[0]).toBe("a");
    const before = JSON.stringify(assembly), again = restartStageLearning(material,vocabulary); saveLearningProgress(storage,again);
    expect(again.runId).not.toBe(vocabulary.runId); expect(again.vocabulary).toEqual({}); expect(again.draft).toBeUndefined();
    expect(JSON.stringify(resumeStageLearningProgress(storage,material,[],"assembly"))).toBe(before); expect(loadLearningProgress(storage)).toHaveLength(3);
  });
  it("completes and repeats stage two while stage one remains unstarted", () => {
    const storage = memory(), vocabulary = resumeStageLearningProgress(storage,material,[],"vocabulary"); saveLearningProgress(storage,vocabulary);
    let assembly = continueLearning(resumeStageLearningProgress(storage,material,[],"assembly"),material);
    for (const step of material.sentences[0].steps) { for (const [i,token] of step.typingTokens!.entries()) assembly = setTypingWord(material,assembly,i,token.text); assembly = moveAssembly(material,checkTypingAssembly(material,assembly),"next"); }
    saveLearningProgress(storage,assembly); expect(resumeStageLearningProgress(storage,material,[],"assembly").phase).toBe("assembly-complete");
    expect(learningStageSummary(assembly,"assembly").percent).toBe(100); expect(learningStageSummary(vocabulary,"vocabulary").percent).toBe(0);
    const again = restartStageLearning(material,assembly); saveLearningProgress(storage,again); expect(again.phase).toBe("assembly-selection"); expect(again.assembly).toEqual({});
    expect(resumeStageLearningProgress(storage,material,[],"vocabulary")).toEqual(vocabulary); expect(loadLearningProgress(storage)).toHaveLength(3);
  });
  it("retains completed stage one while repeating it, with old combined history left intact", () => {
    const storage = memory(); let combined = startLearning(newLearningProgress(material,[])); combined = finishVocabulary(combined); combined = finishVocabulary(combined); saveLearningProgress(storage,combined);
    const first = resumeStageLearningProgress(storage,material,[],"vocabulary"), second = resumeStageLearningProgress(storage,material,[],"assembly"); saveLearningProgress(storage,first); saveLearningProgress(storage,second);
    expect(first.phase).toBe("vocabulary-complete"); expect(second.phase).toBe("assembly-selection"); expect(continueLearning(first,material)).toBe(first);
    expect(learningStageSummary(first,"vocabulary").percent).toBe(100); const again = restartStageLearning(material,first); saveLearningProgress(storage,again);
    expect(learningStageSummary(again,"vocabulary").percent).toBe(0); expect(resumeStageLearningProgress(storage,material,[],"assembly")).toEqual(second); expect(loadLearningProgress(storage)).toHaveLength(4);
  });
});
