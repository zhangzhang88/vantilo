import type { AssemblyStep, LearningMaterial, LearningVocabulary } from "../shared/learning-material";
import { globalVocabularyTextKey } from "./global-vocabulary";
import { savedSelectionFamiliarity, type SavedSelection } from "./selection-state";

export const LEARNING_PROGRESS_KEY = "magazine-reader:learning-progress:v1";
export const LEARNING_ACTIVE_KEY = "magazine-reader:learning-active:v1";
export type LearningStage = "vocabulary" | "assembly";
export type LearningPhase = "intro" | "vocabulary-selection" | "vocabulary" | "vocabulary-review" | "vocabulary-complete" | "assembly-selection" | "assembly" | "assembly-complete" | "meaning" | "completed";
export interface PracticeResult { attempts: number; errors: number; hints: number; correct: boolean; skipped: boolean; lastAnswer?: string; lockedWords?: number[]; }
interface ProgressBase { materialId: string; materialVersion: string; selectedVocabularyIds: string[]; vocabulary: Record<string, PracticeResult>; assembly: Record<string, PracticeResult>; startedAt: string; updatedAt: string; completedAt?: string; }
export interface LegacyLearningProgress extends ProgressBase { version: 1; phase: "intro" | "vocabulary" | "assembly" | "meaning" | "completed"; }
export interface TypingDraft { itemId: string; inputs: string[]; lockedWords: number[]; submitted: boolean; currentWordIndex: number; }
export interface AssemblyDraft { itemId: string; slots: (string | null)[]; lockedSlots: number[]; submitted: boolean; }
export interface LearningProgress extends ProgressBase {
  version: 2; runId: string; practiceStage?: LearningStage; stageStartedAt?: string; stageTotal?: number; phase: LearningPhase; assemblyMode?: "word-bank-v1" | "authored-tiles-v1" | "typing-game-v1";
  reviewVocabularyIds: string[]; vocabularyReview: Record<string, PracticeResult>; skippedAssemblyIds: string[]; assemblyPracticeIds?: string[];
  assemblyCurrentId?: string; assemblyReadingId?: string; assemblyDraft?: AssemblyDraft; typingDraft?: TypingDraft; assemblyElapsedSeconds?: number;
  draft?: { phase: LearningPhase; itemId: string; wordIndex: number; value: string };
}
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const phases: LearningPhase[] = ["intro", "vocabulary-selection", "vocabulary", "vocabulary-review", "vocabulary-complete", "assembly-selection", "assembly", "assembly-complete", "meaning", "completed"];
const emptyResult = (): PracticeResult => ({ attempts: 0, errors: 0, hints: 0, correct: false, skipped: false, lockedWords: [] });
export function vocabularyDefaults(material: LearningMaterial, saved: SavedSelection[]): string[] {
  return material.vocabulary.filter(word => {
    const matches = saved.filter(item => globalVocabularyTextKey(item.text) === globalVocabularyTextKey(word.text) || globalVocabularyTextKey(item.text) === globalVocabularyTextKey(word.sourceText));
    return !matches.length || matches.some(item => savedSelectionFamiliarity(item) !== 5);
  }).map(word => word.id);
}
export function newLearningProgress(material: LearningMaterial, saved: SavedSelection[], now = new Date().toISOString()): LearningProgress {
  return { version: 2, runId: crypto.randomUUID(), materialId: material.id, materialVersion: material.materialVersion, phase: "intro", assemblyMode: "typing-game-v1", selectedVocabularyIds: vocabularyDefaults(material, saved), reviewVocabularyIds: [], vocabulary: {}, vocabularyReview: {}, assembly: {}, skippedAssemblyIds: [], assemblyPracticeIds: [], startedAt: now, updatedAt: now };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => typeof id === "string") && new Set(v).size === v.length;
const validResults = (map: unknown) => record(map) && Object.values(map).every(r => record(r) && [r.attempts,r.errors,r.hints].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) && typeof r.correct === "boolean" && typeof r.skipped === "boolean" && (r.lastAnswer === undefined || typeof r.lastAnswer === "string") && (r.lockedWords === undefined || (Array.isArray(r.lockedWords) && r.lockedWords.every(i => Number.isSafeInteger(i) && Number(i) >= 0))));
export function validLearningProgress(value: unknown): value is LearningProgress | LegacyLearningProgress {
  if (!record(value) || ![1,2].includes(Number(value.version)) || typeof value.materialId !== "string" || !value.materialId.startsWith("learning:") || typeof value.materialVersion !== "string" || !value.materialVersion || !ids(value.selectedVocabularyIds) || !validResults(value.vocabulary) || !validResults(value.assembly) || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || (value.phase === "completed" && (typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))))) return false;
  if (value.version === 1) return ["intro","vocabulary","assembly","meaning","completed"].includes(String(value.phase));
  const assemblyDraft = value.assemblyDraft;
  return value.version === 2 && typeof value.runId === "string" && !!value.runId && phases.includes(value.phase as LearningPhase)
    && (value.practiceStage === undefined || ["vocabulary","assembly"].includes(String(value.practiceStage)))
    && (value.stageStartedAt === undefined || (typeof value.stageStartedAt === "string" && Number.isFinite(Date.parse(value.stageStartedAt))))
    && (value.stageTotal === undefined || (Number.isSafeInteger(value.stageTotal) && Number(value.stageTotal) >= 0))
    && (value.assemblyMode === undefined || ["word-bank-v1","authored-tiles-v1","typing-game-v1"].includes(String(value.assemblyMode)))
    && ids(value.reviewVocabularyIds) && ids(value.skippedAssemblyIds) && validResults(value.vocabularyReview)
    && (value.assemblyPracticeIds === undefined || ids(value.assemblyPracticeIds)) && (value.assemblyCurrentId === undefined || typeof value.assemblyCurrentId === "string")
    && (value.assemblyReadingId === undefined || typeof value.assemblyReadingId === "string")
    && (assemblyDraft === undefined || (record(assemblyDraft) && typeof assemblyDraft.itemId === "string" && typeof assemblyDraft.submitted === "boolean" && Array.isArray(assemblyDraft.slots) && assemblyDraft.slots.length <= 24 && assemblyDraft.slots.every(id => id === null || typeof id === "string") && Array.isArray(assemblyDraft.lockedSlots) && assemblyDraft.lockedSlots.every(i => Number.isInteger(i) && Number(i) >= 0 && Number(i) < (assemblyDraft.slots as unknown[]).length)))
    && (value.assemblyElapsedSeconds === undefined || (Number.isSafeInteger(value.assemblyElapsedSeconds) && Number(value.assemblyElapsedSeconds) >= 0))
    && (value.typingDraft === undefined || (record(value.typingDraft) && typeof value.typingDraft.itemId === "string" && Array.isArray(value.typingDraft.inputs) && value.typingDraft.inputs.length <= 100 && value.typingDraft.inputs.every(input => typeof input === "string" && input.length <= 200) && Array.isArray(value.typingDraft.lockedWords) && value.typingDraft.lockedWords.every(i => Number.isSafeInteger(i) && Number(i) >= 0) && typeof value.typingDraft.submitted === "boolean" && Number.isSafeInteger(value.typingDraft.currentWordIndex) && Number(value.typingDraft.currentWordIndex) >= 0))
    && (value.draft === undefined || (record(value.draft) && phases.includes(value.draft.phase as LearningPhase) && typeof value.draft.itemId === "string" && Number.isSafeInteger(value.draft.wordIndex) && Number(value.draft.wordIndex) >= 0 && typeof value.draft.value === "string" && value.draft.value.length <= 2000));
}
export function loadLearningProgress(storage: Pick<Storage,"getItem">): (LearningProgress | LegacyLearningProgress)[] {
  try { const data = JSON.parse(storage.getItem(LEARNING_PROGRESS_KEY) ?? "null"); return data?.version === 1 && Array.isArray(data.items) ? data.items.filter(validLearningProgress) : []; } catch { return []; }
}
export function saveLearningProgress(storage: Storage, progress: LearningProgress) {
  const items = loadLearningProgress(storage).filter(p => !(p.version === 2 && p.runId === progress.runId && p.materialId === progress.materialId && p.materialVersion === progress.materialVersion));
  storage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify({ version: 1, items: [...items, progress] }));
}
/** Port of Course 2's force-practice/force-skip precedence and last-Bridge guard. */
export function assemblyQueue(material: LearningMaterial, progress: LearningProgress) {
  const all = material.sentences.flatMap(s => s.steps), skipped = new Set<string>(), restored = new Set<string>(), inherited = new Set<string>();
  for (const item of all) {
    if (item.kind === "target" || progress.assemblyPracticeIds?.includes(item.id)) continue;
    if (progress.skippedAssemblyIds.includes(item.id)) skipped.add(item.id);
    else if (item.vocabularyId && !progress.selectedVocabularyIds.includes(item.vocabularyId)) { skipped.add(item.id); inherited.add(item.id); }
  }
  for (const sentence of material.sentences) { const bridges = sentence.steps.filter(s => s.kind === "bridge"); if (bridges.length && bridges.every(s => skipped.has(s.id))) restored.add(bridges.at(-1)!.id); }
  return { all, skipped, inherited, restored, active: all.filter(s => !skipped.has(s.id) || restored.has(s.id)) };
}
export function setAssemblySkipped(progress: LearningProgress, itemId: string, skipped: boolean): LearningProgress {
  return { ...progress, skippedAssemblyIds: skipped ? [...new Set([...progress.skippedAssemblyIds,itemId])] : progress.skippedAssemblyIds.filter(id => id !== itemId), assemblyPracticeIds: skipped ? (progress.assemblyPracticeIds ?? []).filter(id => id !== itemId) : [...new Set([...(progress.assemblyPracticeIds ?? []),itemId])] };
}
export function currentLearningItem(material: LearningMaterial, progress: LearningProgress): LearningVocabulary | AssemblyStep | undefined {
  if (progress.phase === "vocabulary") return material.vocabulary.find(v => progress.selectedVocabularyIds.includes(v.id) && !progress.vocabulary[v.id]?.correct);
  if (progress.phase === "vocabulary-review") return material.vocabulary.find(v => progress.reviewVocabularyIds.includes(v.id) && !progress.vocabularyReview[v.id]?.correct);
  if (progress.phase === "assembly") { const queue = assemblyQueue(material,progress).active; return queue.find(s => s.id === progress.assemblyCurrentId) ?? queue.find(s => !assemblyItemVisited(progress.assembly[s.id])); }
  return undefined;
}
export const practiceMap = (progress: LearningProgress): "vocabulary" | "vocabularyReview" | "assembly" => progress.phase === "assembly" ? "assembly" : progress.phase === "vocabulary-review" ? "vocabularyReview" : "vocabulary";
export const practiceTarget = (item: LearningVocabulary | AssemblyStep): string => "answerText" in item ? item.answerText : item.english;
export function currentWordIndex(material: LearningMaterial, progress: LearningProgress): number {
  const item = currentLearningItem(material,progress); if (!item || !("answerTokens" in item)) return -1;
  const locked = new Set(progress[practiceMap(progress)][item.id]?.lockedWords ?? []);
  return item.answerTokens.findIndex((_,index) => !locked.has(index));
}
export function resumeLearningProgress(storage: Pick<Storage,"getItem">, material: LearningMaterial, saved: SavedSelection[], stage?: LearningStage): LearningProgress {
  const found = loadLearningProgress(storage).filter((p): p is LearningProgress => p.version === 2 && p.materialId === material.id && p.materialVersion === material.materialVersion && p.practiceStage === stage).at(-1);
  if (!found) {
    const vocabularyRevisions = material.vocabularyRevision ? [material.vocabularyRevision,...(material.vocabularyRevision.history ?? [])] : [];
    const previousVersions = vocabularyRevisions.length ? vocabularyRevisions.map(revision => revision.fromMaterialVersion) : [material.assemblyFromMaterialVersion ?? material.typingFromMaterialVersion];
    const previous = loadLearningProgress(storage).filter((p): p is LearningProgress => p.version === 2 && p.materialId === material.id && previousVersions.includes(p.materialVersion) && p.practiceStage === stage).at(-1);
    if (!previous) return newLearningProgress(material,saved);
    if (material.vocabularyRevision) {
      const revision = vocabularyRevisions.find(item => item.fromMaterialVersion === previous.materialVersion)!, replaced = new Set(revision.replacedIds), fresh = new Set([...revision.replacedIds,...(revision.addedIds ?? [])]), defaults = new Set(vocabularyDefaults(material,saved));
      const migrated: LearningProgress = { ...previous,materialVersion: material.materialVersion,runId: crypto.randomUUID(),selectedVocabularyIds: material.vocabulary.filter(word => fresh.has(word.id) ? defaults.has(word.id) : previous.selectedVocabularyIds.includes(word.id)).map(word => word.id),vocabulary: Object.fromEntries(Object.entries(previous.vocabulary).filter(([id]) => !replaced.has(id))),vocabularyReview: Object.fromEntries(Object.entries(previous.vocabularyReview).filter(([id]) => !replaced.has(id))),reviewVocabularyIds: previous.reviewVocabularyIds.filter(id => !replaced.has(id)),draft: previous.draft && replaced.has(previous.draft.itemId) ? undefined : previous.draft };
      // Preserve former inherited assembly skips when a phrase-to-word link is detached.
      migrated.skippedAssemblyIds = [...new Set([...previous.skippedAssemblyIds,...revision.detachedLinks.filter(link => !previous.selectedVocabularyIds.includes(link.vocabularyId)).map(link => link.stepId)])];
      if (stage !== "assembly") { migrated.phase = "vocabulary-selection"; migrated.completedAt = undefined; }
      const temporary = { getItem: () => JSON.stringify({ version: 1,items: [migrated] }) };
      return resumeLearningProgress(temporary,material,saved,stage);
    }
    const migrated = { ...previous, materialVersion: material.materialVersion, runId: crypto.randomUUID(), assemblyMode: "typing-game-v1" as const, assembly: {}, assemblyDraft: undefined, typingDraft: undefined, assemblyCurrentId: undefined, assemblyReadingId: undefined, completedAt: undefined, phase: phases.indexOf(previous.phase) >= phases.indexOf("assembly-selection") ? "assembly-selection" as const : previous.phase };
    if (material.assemblyFromMaterialVersion) {
      migrated.skippedAssemblyIds = [];
      migrated.assemblyPracticeIds = [];
      migrated.assemblyElapsedSeconds = undefined;
      if (stage === "assembly") migrated.stageStartedAt = undefined;
    }
    const temporary = { getItem: () => JSON.stringify({ version: 1, items: [migrated] }) };
    return resumeLearningProgress(temporary,material,saved,stage);
  }
  const words = new Map(material.vocabulary.map(v => [v.id,v])), steps = new Map(material.sentences.flatMap(s => s.steps).map(s => [s.id,s]));
  if ([...found.selectedVocabularyIds,...found.reviewVocabularyIds,...Object.keys(found.vocabulary),...Object.keys(found.vocabularyReview)].some(id => !words.has(id)) || found.reviewVocabularyIds.some(id => !found.selectedVocabularyIds.includes(id)) || [...found.skippedAssemblyIds,...(found.assemblyPracticeIds ?? []),...Object.keys(found.assembly)].some(id => !steps.has(id))) return newLearningProgress(material,saved);
  if ([found.vocabulary,found.vocabularyReview].some(map => Object.entries(map).some(([id,result]) => result.lockedWords?.some(index => index >= words.get(id)!.answerTokens.length)))) return newLearningProgress(material,saved);
  // Historical review evidence remains readable, but no longer schedules a second round.
  let next: LearningProgress = { ...found, assemblyMode: "typing-game-v1" };
  if (found.assemblyMode !== "typing-game-v1") next = { ...next, assembly: {}, assemblyDraft: undefined, typingDraft: undefined, assemblyCurrentId: undefined, assemblyReadingId: undefined, phase: phases.indexOf(found.phase) >= phases.indexOf("assembly") ? "assembly-selection" : found.phase, completedAt: undefined };
  const firstDone = next.selectedVocabularyIds.every(id => next.vocabulary[id]?.correct);
  if (next.practiceStage !== "assembly" && phases.indexOf(next.phase) > phases.indexOf("vocabulary") && !firstDone) next = { ...next, phase: "vocabulary", completedAt: undefined };
  else if (next.phase === "vocabulary-review") next = { ...next, phase: "vocabulary-complete" };
  else if (["assembly-complete","meaning","completed"].includes(next.phase) && !assemblyItemVisited(next.assembly[assemblyQueue(material,next).active.at(-1)?.id ?? ""])) next = { ...next, phase: "assembly", completedAt: undefined };
  if (next.assemblyReadingId && currentLearningItem(material,next)?.id !== next.assemblyReadingId) next = { ...next, assemblyReadingId: undefined };
  if (next.draft && (next.draft.phase !== next.phase || currentLearningItem(material,next)?.id !== next.draft.itemId || currentWordIndex(material,next) !== next.draft.wordIndex)) next = { ...next, draft: undefined };
  if (next.assemblyDraft) {
    const draft = next.assemblyDraft, step = steps.get(draft.itemId), selected = draft.slots.filter((id): id is string => id !== null);
    if (!step || currentLearningItem(material,next)?.id !== step.id || draft.slots.length !== step.assembly.correctOrder.length || new Set(selected).size !== selected.length || selected.some(id => !step.assembly.tiles.some(t => t.id === id)) || draft.lockedSlots.some(index => !sameTile(step,draft.slots[index],step.assembly.correctOrder[index]))) next = { ...next, assemblyDraft: undefined, typingDraft: undefined };
  }
  if (next.typingDraft) {
    const draft = next.typingDraft, step = steps.get(draft.itemId);
    if (!step?.typingTokens || currentLearningItem(material,next)?.id !== step.id || draft.inputs.length !== step.typingTokens.length || draft.currentWordIndex >= draft.inputs.length || draft.lockedWords.some(i => i >= draft.inputs.length || normalizeTypingAnswer(draft.inputs[i]) !== normalizeTypingAnswer(step.typingTokens![i].text))) next = { ...next, typingDraft: undefined };
  }
  return next;
}
/** Course2ClozePrototype's lesson-local selection; accumulated results stay intact. */
export function openVocabularySelection(progress: LearningProgress): LearningProgress {
  return { ...progress,phase: "vocabulary-selection",draft: undefined };
}
export function setVocabularySkipped(material: LearningMaterial, progress: LearningProgress, itemId: string, skipped: boolean): LearningProgress {
  if (!material.vocabulary.some(word => word.id === itemId)) return progress;
  const selectedVocabularyIds = material.vocabulary.filter(word => word.id === itemId ? !skipped : progress.selectedVocabularyIds.includes(word.id)).map(word => word.id);
  return { ...progress,selectedVocabularyIds,reviewVocabularyIds: progress.reviewVocabularyIds.filter(id => selectedVocabularyIds.includes(id)),draft: undefined };
}
export function startLearning(progress: LearningProgress): LearningProgress {
  const firstDone = progress.selectedVocabularyIds.every(id => progress.vocabulary[id]?.correct);
  return { ...progress, draft: undefined, phase: firstDone ? "vocabulary-complete" : "vocabulary", updatedAt: new Date().toISOString() };
}
/** Re-enter the original queue at the current item, or its next surviving neighbour. */
export function beginAssemblySelection(material: LearningMaterial, progress: LearningProgress): LearningProgress {
  const queue = assemblyQueue(material,progress), preferred = progress.assemblyCurrentId;
  const originalIndex = queue.all.findIndex(step => step.id === preferred);
  const target = queue.active.find(step => step.id === preferred) ?? (preferred ? queue.active.find(step => queue.all.indexOf(step) > originalIndex) ?? queue.active.at(-1) : queue.active[0]);
  return { ...progress,phase: "assembly",assemblyCurrentId: target?.id,assemblyReadingId: undefined,assemblyDraft: undefined,typingDraft: undefined,assembly: target && progress.assembly[target.id] ? { ...progress.assembly,[target.id]: { ...progress.assembly[target.id],correct: false,skipped: false,lockedWords: [] } } : progress.assembly,updatedAt: new Date().toISOString() };
}
export function openAssemblySelection(progress: LearningProgress): LearningProgress {
  return { ...progress,phase: "assembly-selection",assemblyReadingId: undefined,assemblyDraft: undefined,typingDraft: undefined };
}
export function continueLearning(progress: LearningProgress, material?: LearningMaterial): LearningProgress {
  if (progress.practiceStage === "vocabulary" && progress.phase === "vocabulary-complete") return progress;
  if (progress.phase === "assembly-selection" && material) return beginAssemblySelection(material,progress);
  const next: Partial<Record<LearningPhase,LearningPhase>> = { intro: "vocabulary-selection", "vocabulary-complete": "assembly-selection", "assembly-selection": "assembly", "assembly-complete": "meaning" };
  return next[progress.phase] ? { ...progress, phase: next[progress.phase]!, draft: undefined, assemblyCurrentId: progress.phase === "assembly-selection" && material ? assemblyQueue(material,progress).active.find(s => !assemblyItemVisited(progress.assembly[s.id]))?.id ?? assemblyQueue(material,progress).active[0]?.id : progress.assemblyCurrentId, updatedAt: new Date().toISOString() } : progress;
}
export const normalizeLearningAnswer = (s: string) => s.normalize("NFC").toLowerCase().replace(/[’‘]/g,"'").replace(/[.,!?;:“”"]/g,"").replace(/\s+/g," ").trim();
export function recordLearningAction(material: LearningMaterial, progress: LearningProgress, action: "answer" | "hint", answer = "", now = new Date().toISOString()): LearningProgress {
  const item = currentLearningItem(material,progress); if (!item || (progress.phase === "assembly" && action === "answer")) return progress;
  const key = practiceMap(progress), result = { ...(progress[key][item.id] ?? emptyResult()) };
  if (action === "hint") result.hints++;
  if (action === "answer" && "answerTokens" in item) { const index = currentWordIndex(material,progress); if (index < 0) return progress; result.attempts++; result.lastAnswer = answer.slice(0,200); if (normalizeLearningAnswer(answer) === normalizeLearningAnswer(item.answerTokens[index].text)) result.lockedWords = [...(result.lockedWords ?? []),index]; else result.errors++; }
  let next: LearningProgress = { ...progress, draft: undefined, updatedAt: now, [key]: { ...progress[key], [item.id]: result } };
  if (key !== "assembly" && currentWordIndex(material,next) < 0) { result.correct = true; next = { ...next, [key]: { ...next[key], [item.id]: result } }; if (!currentLearningItem(material,next)) next.phase = "vocabulary-complete"; }
  return next;
}
export function assemblyDraftFor(step: AssemblyStep, progress: LearningProgress): AssemblyDraft {
  return progress.assemblyDraft?.itemId === step.id ? progress.assemblyDraft : { itemId: step.id, slots: step.assembly.correctOrder.map(() => null), lockedSlots: [], submitted: false };
}
const sameTile = (step: AssemblyStep, left: string | null, right: string) => left !== null && step.assembly.tiles.find(t => t.id === left)?.text === step.assembly.tiles.find(t => t.id === right)?.text;
export function placeAssemblyTile(material: LearningMaterial, progress: LearningProgress, tileId: string): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step) || progress.assembly[step.id]?.correct || !step.assembly.tiles.some(t => t.id === tileId)) return progress;
  const draft = assemblyDraftFor(step,progress), index = draft.slots.indexOf(null); if (index < 0 || draft.slots.includes(tileId)) return progress;
  const slots = [...draft.slots]; slots[index] = tileId;
  return { ...progress, assemblyDraft: { ...draft, slots, submitted: false }, updatedAt: new Date().toISOString() };
}
export function withdrawAssemblyTile(material: LearningMaterial, progress: LearningProgress, index: number): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step) || progress.assembly[step.id]?.correct) return progress;
  const draft = assemblyDraftFor(step,progress); if (!Number.isInteger(index) || index < 0 || index >= draft.slots.length || draft.lockedSlots.includes(index)) return progress;
  const remaining = draft.slots.filter((id,i) => i !== index && id !== null);
  const slots = draft.lockedSlots.length ? draft.slots.map((id,i) => i === index ? null : id) : [...remaining,...Array(draft.slots.length - remaining.length).fill(null)];
  return { ...progress, assemblyDraft: { ...draft, slots, submitted: false }, updatedAt: new Date().toISOString() };
}
export function checkAssembly(material: LearningMaterial, progress: LearningProgress): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step) || progress.assembly[step.id]?.correct) return progress;
  const draft = assemblyDraftFor(step,progress), lockedSlots = step.assembly.correctOrder.flatMap((id,index) => sameTile(step,draft.slots[index],id) ? [index] : []), correct = lockedSlots.length === draft.slots.length;
  const result = { ...(progress.assembly[step.id] ?? emptyResult()) }; result.attempts++; if (!correct) result.errors++; result.correct = correct; result.lastAnswer = draft.slots.map(id => step.assembly.tiles.find(t => t.id === id)?.text ?? "___").join(" ");
  return { ...progress, assemblyCurrentId: step.id, assemblyDraft: { ...draft, lockedSlots, submitted: true }, assembly: { ...progress.assembly, [step.id]: result }, updatedAt: new Date().toISOString() };
}
const assemblyItemVisited = (result: PracticeResult | undefined) => !!(result?.correct || result?.skipped);

/** Original right arrow: reveal CompletionReading first; advance only from that state. */
export function showAssemblyCompletion(material: LearningMaterial, progress: LearningProgress): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step) || progress.assemblyReadingId === step.id || progress.assembly[step.id]?.correct) return progress;
  const next = recordLearningAction(material,progress,"hint");
  return { ...next, assemblyCurrentId: step.id, assemblyReadingId: step.id };
}
export function moveAssembly(material: LearningMaterial, progress: LearningProgress, direction: "next" | "previous" | "repeat"): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step)) return progress;
  if (direction === "repeat") return { ...progress, assembly: { ...progress.assembly, [step.id]: { ...(progress.assembly[step.id] ?? emptyResult()), correct: false, skipped: false } }, assemblyCurrentId: step.id, assemblyReadingId: undefined, assemblyDraft: undefined, typingDraft: undefined };
  if (direction === "next" && !progress.assembly[step.id]?.correct && progress.assemblyReadingId !== step.id) return progress;
  // Reading and continuing is recorded separately from a correctly submitted answer.
  const assembly = direction === "next" && !progress.assembly[step.id]?.correct ? { ...progress.assembly, [step.id]: { ...(progress.assembly[step.id] ?? emptyResult()), skipped: true } } : progress.assembly;
  const active = assemblyQueue(material,progress).active, index = active.findIndex(s => s.id === step.id), target = active[direction === "previous" ? (index + active.length - 1) % active.length : index + 1];
  const next = { ...progress, assembly, assemblyReadingId: undefined, assemblyDraft: undefined, typingDraft: undefined, updatedAt: new Date().toISOString() };
  if (!target) return direction === "next" ? { ...next, phase: "assembly-complete", assemblyCurrentId: undefined } : progress;
  // TypingGame reprocesses the destination sentence on every index change.
  // Revisit as a fresh attempt; keep accumulated errors, hints and attempt counts.
  return { ...next, assemblyCurrentId: target.id, assembly: next.assembly[target.id] ? { ...next.assembly, [target.id]: { ...next.assembly[target.id], correct: false, skipped: false, lockedWords: [] } } : next.assembly };
}
export const completeLearning = (progress: LearningProgress, now = new Date().toISOString()): LearningProgress => progress.phase === "meaning" ? { ...progress, phase: "completed", completedAt: now, updatedAt: now } : progress;
export const restartLearning = (material: LearningMaterial, progress: LearningProgress): LearningProgress => ({ ...newLearningProgress(material,[]), selectedVocabularyIds: [...progress.selectedVocabularyIds], skippedAssemblyIds: [...progress.skippedAssemblyIds], assemblyPracticeIds: [...(progress.assemblyPracticeIds ?? [])], phase: "vocabulary-selection" });

/** Original TypingGame uses whole-item checks, editable wrong words and locked correct words. */
export function typingDraftFor(step: AssemblyStep, progress: LearningProgress): TypingDraft {
  return progress.typingDraft?.itemId === step.id ? progress.typingDraft : { itemId: step.id, inputs: (step.typingTokens ?? []).map(() => ""), lockedWords: [], submitted: false, currentWordIndex: 0 };
}
export function setTypingWord(material: LearningMaterial, progress: LearningProgress, index: number, value: string): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step) || !step.typingTokens || progress.assembly[step.id]?.correct) return progress;
  const draft = typingDraftFor(step,progress); if (!Number.isInteger(index) || index < 0 || index >= draft.inputs.length || draft.lockedWords.includes(index)) return progress;
  const inputs = [...draft.inputs]; inputs[index] = value.slice(0,step.typingTokens[index].text.length);
  return { ...progress, typingDraft: { ...draft, inputs, currentWordIndex: index }, updatedAt: new Date().toISOString() };
}
export function focusTypingWord(material: LearningMaterial, progress: LearningProgress, index: number): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step)) return progress;
  const draft = typingDraftFor(step,progress); if (index < 0 || index >= draft.inputs.length || draft.lockedWords.includes(index)) return progress;
  return { ...progress, typingDraft: { ...draft, currentWordIndex: index } };
}
export function checkTypingAssembly(material: LearningMaterial, progress: LearningProgress): LearningProgress {
  const step = currentLearningItem(material,progress); if (!step || !("assembly" in step) || !step.typingTokens?.length || progress.assembly[step.id]?.correct) return progress;
  const draft = typingDraftFor(step,progress), lockedWords = step.typingTokens.flatMap((token,i) => normalizeTypingAnswer(token.text) === normalizeTypingAnswer(draft.inputs[i]) ? [i] : []), correct = lockedWords.length === draft.inputs.length;
  const result = { ...(progress.assembly[step.id] ?? emptyResult()) }; result.attempts++; if (!correct) result.errors++; result.correct = correct; result.lastAnswer = draft.inputs.join(" ");
  return { ...progress, assemblyCurrentId: step.id, typingDraft: { ...draft, submitted: true, lockedWords, currentWordIndex: correct ? 0 : draft.inputs.findIndex((_,i) => !lockedWords.includes(i)) }, assembly: { ...progress.assembly, [step.id]: result }, updatedAt: new Date().toISOString() };
}

export const normalizeTypingAnswer = (text: string) => text.toLowerCase().replace(/[’'‘]/g, "").replace(/[^a-z0-9+\-]/g, "").trim();


/** Each stage owns a run, draft, results and completion independently. Legacy combined records stay in history. */
export function resumeStageLearningProgress(storage: Pick<Storage,"getItem">, material: LearningMaterial, saved: SavedSelection[], stage: LearningStage): LearningProgress {
  const scoped = loadLearningProgress(storage).some(p => p.version === 2 && p.practiceStage === stage && p.materialId === material.id && [material.materialVersion,material.typingFromMaterialVersion,material.assemblyFromMaterialVersion,material.vocabularyRevision?.fromMaterialVersion,...(material.vocabularyRevision?.history?.map(revision => revision.fromMaterialVersion) ?? [])].includes(p.materialVersion));
  if (scoped) {
    const restored = resumeLearningProgress(storage,material,saved,stage);
    return { ...restored, practiceStage: stage, phase: restored.phase === "intro" ? stage === "assembly" ? "assembly-selection" : "vocabulary-selection" : restored.phase, stageTotal: stage === "assembly" ? assemblyQueue(material,restored).active.length : restored.selectedVocabularyIds.length };
  }
  const legacy = resumeLearningProgress(storage,material,saved), vocabularyPhase = ["vocabulary-selection","vocabulary","vocabulary-review","vocabulary-complete"].includes(legacy.phase);
  const next: LearningProgress = { ...legacy, runId: crypto.randomUUID(), practiceStage: stage, completedAt: undefined, phase: stage === "vocabulary" ? vocabularyPhase ? legacy.phase : phases.indexOf(legacy.phase) > phases.indexOf("vocabulary-complete") ? "vocabulary-complete" : "vocabulary-selection" : ["assembly-selection","assembly","assembly-complete","meaning","completed"].includes(legacy.phase) ? legacy.phase : "assembly-selection" };
  if (stage === "vocabulary") { next.assembly = {}; next.assemblyDraft = undefined; next.typingDraft = undefined; next.assemblyCurrentId = undefined; next.assemblyReadingId = undefined; next.assemblyElapsedSeconds = undefined; }
  else { next.vocabulary = {}; next.vocabularyReview = {}; next.reviewVocabularyIds = []; next.draft = undefined; if (legacy.phase === "completed") next.completedAt = legacy.completedAt; }
  const hasEvidence = stage === "vocabulary" ? Object.keys(next.vocabulary).length > 0 || vocabularyPhase && legacy.phase !== "vocabulary-selection" : Object.keys(next.assembly).length > 0 || ["assembly","assembly-complete","meaning","completed"].includes(next.phase);
  if (hasEvidence) next.stageStartedAt = legacy.startedAt;
  next.stageTotal = stage === "assembly" ? assemblyQueue(material,next).active.length : next.selectedVocabularyIds.length;
  return next;
}
export function restartStageLearning(material: LearningMaterial, progress: LearningProgress): LearningProgress {
  const stage = progress.practiceStage ?? "vocabulary";
  return { ...restartLearning(material,progress), practiceStage: stage, phase: stage === "vocabulary" ? "vocabulary-selection" : "assembly-selection", stageStartedAt: new Date().toISOString(), stageTotal: stage === "assembly" ? assemblyQueue(material,progress).active.length : progress.selectedVocabularyIds.length };
}
export function learningStageSummary(progress: LearningProgress | undefined, stage: LearningStage) {
  if (!progress) return { started: false, complete: false, percent: 0, done: 0, total: 0 };
  const done = stage === "vocabulary" ? progress.selectedVocabularyIds.filter(id => progress.vocabulary[id]?.correct).length : Object.values(progress.assembly).filter(assemblyItemVisited).length;
  const total = stage === "vocabulary" ? progress.selectedVocabularyIds.length : progress.stageTotal ?? 0;
  const complete = stage === "vocabulary" ? progress.phase === "vocabulary-complete" || progress.phase === "vocabulary-review" && done === total : ["assembly-complete","meaning","completed"].includes(progress.phase);
  return { started: !!progress.stageStartedAt, complete, percent: complete ? 100 : total ? Math.min(100,Math.floor(done / total * 100)) : 0, done, total };
}
