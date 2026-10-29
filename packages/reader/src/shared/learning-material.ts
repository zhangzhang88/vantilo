import type { LearningAudioManifest } from "./learning-audio.js";
import type { BookLesson, LessonEvidence } from "./book-lesson.js";

export interface LearningSourceSentence { id: string; english: string; paragraphIndex: number; startOffset: number; }
export interface LearningVocabulary {
  id: string; sentenceId: string; text: string; sourceText: string; answerText: string;
  answerTokens: { text: string; start: number; end: number }[];
  occurrence: number; meaningZh: string; sentenceMeaningZh: string; pronunciation?: string;
}
export interface TypingToken { text: string; start: number; end: number; }
export interface AssemblyTile { id: string; text: string; role: "known" | "new"; fromStepId?: string; }
export interface AssemblyPlan { analysisZh: string; tiles: AssemblyTile[]; correctOrder: string[]; bankOrder: string[]; }
export interface AssemblyStep {
  id: string; kind: "anchor" | "bridge" | "target"; dependsOn: string[]; vocabularyId?: string;
  english: string; meaningZh: string; explanationZh: string; assembly: AssemblyPlan; typingTokens?: TypingToken[];
}
export interface LearningSentence extends LearningSourceSentence { translationZh: string; steps: AssemblyStep[]; }
export interface VocabularyRevisionSource { fromMaterialVersion: string; replacedIds: string[]; addedIds?: string[]; detachedLinks: { stepId: string; vocabularyId: string }[]; }
export interface LearningMaterial {
  audio?: LearningAudioManifest;
  vocabularyRevision?: VocabularyRevisionSource & { history?: VocabularyRevisionSource[]; review: { approved: true; summaryZh: string }; coverage?: { minimum: number; maximum: number } };
  schemaVersion: 3; typingFromMaterialVersion?: string; assemblyFromMaterialVersion?: string; id: string; materialVersion: string; sourceVersion: string;
  source: { lessonId: string; bookId: string; bookFingerprint: string; evidence: LessonEvidence[] };
  titleZh: string; teaserZh: string; english: string; explanationZh: string; adaptation: string;
  vocabulary: LearningVocabulary[]; sentences: LearningSentence[];
  createdAt: string; generator: { model: string | null; modelId?: string | null; reasoningEffort?: string | null; requestedModelId?: string | null; requestedReasoningEffort?: string | null; generatedAt?: string | null; materialVersion?: string; engine: "codex-prep"; policy: "assembly-v3"; review: { approved: true; summaryZh: string } };
}

export function learningSourceSentences(english: string): LearningSourceSentence[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return english.split(/\n\s*\n/).flatMap((paragraph, paragraphIndex) =>
    Array.from(segmenter.segment(paragraph)).flatMap(({ segment, index }) => {
      const text = segment.trim();
      return text ? [{ id: `s:${paragraphIndex}:${index + segment.indexOf(text)}`, english: text, paragraphIndex, startOffset: index + segment.indexOf(text) }] : [];
    }));
}
export function wholeWordSpans(source: string, text: string): number[] {
  const matches: number[] = [];
  if (!text.trim()) return matches;
  let start = source.toLowerCase().indexOf(text.toLowerCase());
  while (start >= 0) {
    if (!/[\p{L}\p{N}'’\-]/u.test(source[start - 1] ?? "") && !/[\p{L}\p{N}'’\-]/u.test(source[start + text.length] ?? "")) matches.push(start);
    start = source.toLowerCase().indexOf(text.toLowerCase(), start + 1);
  }
  return matches;
}
export const exactWordSpan = (source: string, text: string) => wholeWordSpans(source, text).length > 0;
export function learningTokens(text: string): { text: string; start: number; end: number }[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu), match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}
/** A product default for beginner practice volume; semantic usefulness is reviewed by Codex. */
export function learningVocabularyCoverage(english: string): { minimum: number; maximum: number } {
  const words = learningTokens(english).length;
  const minimum = Math.min(12,Math.max(1,Math.ceil(words / 10)));
  return { minimum, maximum: Math.min(24,Math.max(minimum,Math.ceil(words / 5))) };
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
function text(v: unknown, label: string, max = 1500): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`学习材料缺少有效的${label}`);
  return v.trim();
}
function chinese(v: unknown, label: string): string {
  const result = text(v, label);
  if (!/[\u3400-\u9fff]/u.test(result) || /[A-Za-z]/.test(result)) throw new Error(`${label}须使用中文，不能在回忆提示中泄露英文答案`);
  return result;
}

function parseAssemblyPlan(raw: unknown, english: string, kind: AssemblyStep["kind"], dependencies: string[], earlier: AssemblyStep[]): AssemblyPlan {
  if (!object(raw) || !Array.isArray(raw.tiles) || !raw.tiles.length || raw.tiles.length > 24) throw new Error("组装步骤必须包含 Codex 生成的正式词块方案");
  const tiles = raw.tiles.map((value): AssemblyTile => {
    if (!object(value) || !["known", "new"].includes(String(value.role))) throw new Error("词块缺少已知或新增结构角色");
    const id = text(value.id, "词块身份", 80), tileText = text(value.text, "词块英文");
    const ref = value.fromStepId;
    const from = typeof ref === "number" && Number.isInteger(ref) ? earlier[ref] : earlier.find(step => step.id === ref);
    if (value.role === "known" && (!from || !dependencies.includes(from.id) || tileText.replace(/[.,!?;:]+$/, "") !== from.english.replace(/[.,!?;:]+$/, ""))) throw new Error("已知词块必须准确引用当前步骤的已准备部件");
    if (value.role === "new" && ref !== undefined) throw new Error("新增词块不能伪造已知引用");
    return { id, text: tileText, role: value.role as AssemblyTile["role"], ...(from ? { fromStepId: from.id } : {}) };
  });
  if (new Set(tiles.map(tile => tile.id)).size !== tiles.length) throw new Error("词块身份不能重复；相同文字也需独立身份");
  const order = (value: unknown, name: string): string[] => {
    if (!Array.isArray(value) || value.length !== tiles.length || new Set(value).size !== tiles.length || value.some(id => typeof id !== "string" || !tiles.some(tile => tile.id === id))) throw new Error(`${name}必须恰好包含所有词块身份`);
    return value as string[];
  };
  const correctOrder = order(raw.correctOrder, "目标顺序"), bankOrder = order(raw.bankOrder, "呈现顺序");
  if (correctOrder.map(id => tiles.find(tile => tile.id === id)!.text).join(" ") !== english) throw new Error("正式词块必须精确组合成当前英文步骤，包括标点和词序");
  if (tiles.length > 1 && bankOrder.every((id, index) => id === correctOrder[index])) throw new Error("词块呈现顺序必须经过乱序");
  if (kind !== "anchor" && tiles.length < 2) throw new Error("桥接与最终目标必须通过至少两个语义部件组装，不能整句作为一个词块");
  return { analysisZh: chinese(raw.analysisZh, "语义语法与难度分析"), tiles, correctOrder, bankOrder };
}

/** Validate source identity and ordered assembly dependencies, never claim semantic certification. */
export function parseLearningContent(raw: unknown, lesson: BookLesson, options: { allowLegacyVocabularyPhrases?: boolean } = {}): Pick<LearningMaterial, "vocabulary" | "sentences"> {
  if (!object(raw) || !Array.isArray(raw.sentences) || !Array.isArray(raw.vocabulary)) throw new Error("学习材料格式不完整");
  const sources = learningSourceSentences(lesson.english);
  if (raw.vocabulary.length < 1 || raw.vocabulary.length > 24) throw new Error("每篇可准备 1–24 个单词，按全文理解难点选择");
  const words = new Set<string>();
  const vocabulary = raw.vocabulary.map((v, index): LearningVocabulary => {
    if (!object(v)) throw new Error("词汇格式错误");
    const source = sources.find(s => s.id === v.sentenceId);
    const word = text(v.text, "词汇", 100);
    const surface = text(v.sourceText ?? v.text, "原句词形", 100);
    const spans = source ? wholeWordSpans(source.english, surface) : [];
    const occurrence = v.occurrence ?? (spans.length === 1 ? 0 : undefined);
    if (!source || !spans.length || !Number.isInteger(occurrence) || Number(occurrence) < 0 || Number(occurrence) >= spans.length || words.has(word.toLowerCase())) throw new Error("词汇必须准确对应正文且不能重复；重复词形需指定 occurrence");
    const sourceText = source.english.slice(spans[Number(occurrence)], spans[Number(occurrence)] + surface.length);
    if (v.answerText !== undefined && v.answerText !== sourceText) throw new Error("作答词形必须与原句缺口一致");
    const expectedTokens = learningTokens(sourceText);
    if (!options.allowLegacyVocabularyPhrases && (expectedTokens.length !== 1 || expectedTokens[0].text !== sourceText || learningTokens(word).length !== 1 || learningTokens(word)[0].text !== word)) throw new Error("第一阶段每题只能挖空一个完整单词，不能使用短语");
    if (!Array.isArray(v.answerTokens) || !expectedTokens.length || v.answerTokens.length !== expectedTokens.length || expectedTokens.some((token, i) => { const candidate = (v.answerTokens as unknown[])[i]; return !object(candidate) || candidate.text !== token.text || candidate.start !== token.start || candidate.end !== token.end; })) throw new Error("词汇必须包含备课阶段生成的准确作答词及位置");
    words.add(word.toLowerCase());
    return { id: `v:${index}`, sentenceId: source.id, text: word, sourceText, answerText: sourceText, answerTokens: expectedTokens, ...(v.pronunciation === undefined ? {} : { pronunciation: text(v.pronunciation,"词汇音标",100) }), occurrence: Number(occurrence), meaningZh: chinese(v.meaningZh, "词汇含义"), sentenceMeaningZh: chinese(v.sentenceMeaningZh, "词汇所在整句句意") };
  });
  if (!raw.sentences.length || raw.sentences.length > 3) throw new Error("请选择 1–3 个重点句子");
  const used = new Set<string>();
  const sentences = raw.sentences.map((v): LearningSentence => {
    if (!object(v)) throw new Error("句子格式错误");
    const source = sources.find(s => s.id === v.id);
    if (!source || used.has(source.id)) throw new Error("重点句子来源错误或重复");
    used.add(source.id);
    if (!Array.isArray(v.steps) || v.steps.length < 3 || v.steps.length > 12) throw new Error("句子需有 Anchor、Bridge 和最终 Target，合计 3–12 步");
    const steps: AssemblyStep[] = [];
    for (const [index, item] of v.steps.entries()) {
      if (!object(item) || !["anchor", "bridge", "target"].includes(String(item.kind))) throw new Error("组装步骤缺少类型");
      const english = text(item.english, "英文步骤");
      if (!source.english.includes(english) || !exactWordSpan(source.english, english)) throw new Error("组装步骤必须来自原句完整词语");
      if (steps.some(step => step.english === english)) throw new Error("组装目标不能重复");
      if (!Array.isArray(item.dependsOn)) throw new Error("组装步骤缺少依赖");
      const dependencies = item.dependsOn.map((dependency: unknown) => {
        // Generated JSON uses earlier zero-based indexes; cached material uses stable IDs.
        const step = typeof dependency === "number" && Number.isInteger(dependency) ? steps[dependency] : steps.find(s => s.id === dependency);
        if (!step) throw new Error("依赖必须指向同句已经出现的组装步骤");
        if (!wholeWordSpans(english, step.english).length || learningTokens(english).length <= learningTokens(step.english).length) throw new Error("依赖的语言结构必须完整保留在当前步骤中");
        return step.id;
      });
      if (new Set(dependencies).size !== dependencies.length) throw new Error("组装依赖不能重复");
      if (item.kind === "anchor" && dependencies.length) throw new Error("Anchor 应作为独立准备的部件");
      if (item.kind !== "anchor" && (!dependencies.length || learningTokens(english).length < 2)) throw new Error("Bridge/Target 必须组装已准备的部件");
      if (item.kind === "target" && (index !== v.steps.length - 1 || english !== source.english || !dependencies.some(id => steps.find(s => s.id === id)?.kind === "bridge"))) throw new Error("最终 Target 必须是精确原句，并有 Bridge 支撑");
      if (item.kind !== "target" && english === source.english) throw new Error("完整原句只能作为最终 Target");
      const vocabularyId = item.vocabularyId === undefined ? undefined : text(item.vocabularyId, "词汇关联");
      if (vocabularyId && (item.kind !== "anchor" || !vocabulary.some(word => word.id === vocabularyId && word.sourceText.toLowerCase() === english.toLowerCase()))) throw new Error("Anchor 必须以相同完整词形关联词汇；没有完全匹配项时应省略 vocabularyId");
      const kind = item.kind as AssemblyStep["kind"];
      const assembly = parseAssemblyPlan(item.assembly, english, kind, dependencies, steps);
      let typingTokens: TypingToken[] | undefined;
      if (item.typingTokens !== undefined) {
        const expected = learningTokens(english);
        if (!Array.isArray(item.typingTokens) || item.typingTokens.length !== expected.length || expected.some((token,i) => { const t = (item.typingTokens as unknown[])[i]; return !object(t) || t.text !== token.text || t.start !== token.start || t.end !== token.end; })) throw new Error("组装必须包含备课阶段生成的准确逐词输入位置");
        typingTokens = item.typingTokens as TypingToken[];
      }
      steps.push({ ...(typingTokens ? { typingTokens } : {}), id: `${source.id}:step:${index}`, kind, dependsOn: dependencies, ...(vocabularyId ? { vocabularyId } : {}), english, meaningZh: chinese(item.meaningZh, "中文含义"), explanationZh: chinese(item.explanationZh, "组装说明"), assembly });
    }
    if (steps.at(-1)?.kind !== "target" || !steps.some(step => step.kind === "anchor") || !steps.some(step => step.kind === "bridge")) throw new Error("组装需包含 Anchor、Bridge 和最终 Target");
    return { ...source, translationZh: chinese(v.translationZh, "句子译文"), steps };
  }).sort((a, b) => sources.findIndex(s => s.id === a.id) - sources.findIndex(s => s.id === b.id));
  return { sentences, vocabulary };
}
