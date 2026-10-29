import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningMaterialService, learningSourceVersion } from "./learning-material-service.js";
import { CodexPrepService } from "./codex-prep-service.js";
import type { CodexAuthService } from "./codex-auth-service.js";
import { lesson, content, material as fixtureMaterial } from "../../../tests/fixtures/learning.js";
import { learningSourceSentences, learningVocabularyCoverage } from "../../shared/learning-material.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root,{ recursive: true, force: true }))); });
async function root() { const dir = await mkdtemp(path.join(os.tmpdir(),"mr-learning-")); roots.push(dir); return dir; }
const review = JSON.stringify({ approved: true, summaryZh: "词块结构与原文一致，学习路径可用。", issuesZh: [] });
const generator = () => vi.fn(async (input: string) => input.startsWith("MAGAZINE_READER_LEARNING_REVIEW") ? review : JSON.stringify(content));
async function legacyPhrase(dir: string) {
  const saved = await new LearningMaterialService(dir,generator()).prepare(lesson);
  saved.vocabulary[0] = { ...saved.vocabulary[0],text: "Good evidence",sourceText: "Good evidence",answerText: "Good evidence",answerTokens: [{ text: "Good",start: 0,end: 4 },{ text: "evidence",start: 5,end: 13 }],meaningZh: "好的证据",pronunciation: "/ɡʊd ˈevɪdəns/" };
  saved.sentences[0].steps[1].vocabularyId = "v:0";
  saved.materialVersion = createHash("sha256").update(JSON.stringify({ sourceVersion: saved.sourceVersion,content: { sentences: saved.sentences,vocabulary: saved.vocabulary } })).digest("hex");
  await writeFile(path.join(dir,"learning-materials",`${saved.sourceVersion}.authored-v3.json`),JSON.stringify(saved));
  return saved;
}
const wordReplacement = { id: "v:0",text: "evidence",sourceText: "evidence",answerTokens: [{ text: "evidence",start: 0,end: 8 }],occurrence: 0,meaningZh: "证据",pronunciation: "/ˈevɪdəns/" };
describe("Codex-authored learning material publication", () => {
  it("expands sparse vocabulary across the full article while preserving existing words, translations and assembly", async () => {
    const dir = await root(), source = { ...lesson,english: `${lesson.english} Readers compare different explanations before they choose an answer. A surprising result can change our understanding of familiar ideas. Small differences between people do not always have a simple cause.` };
    const previous = { ...structuredClone(fixtureMaterial),english: source.english,sourceVersion: learningSourceVersion(source) };
    previous.materialVersion = createHash("sha256").update(JSON.stringify({ sourceVersion: previous.sourceVersion,content: { sentences: previous.sentences,vocabulary: previous.vocabulary } })).digest("hex");
    await mkdir(path.join(dir,"learning-materials"));
    await writeFile(path.join(dir,"learning-materials",`${previous.sourceVersion}.authored-v3.json`),JSON.stringify(previous));
    const sentenceId = learningSourceSentences(source.english)[1].id, translationZh = "读者在选择答案之前会比较不同的解释。";
    const additions = [
      { sentenceId,text: "compare",sourceText: "compare",answerTokens: [{ text: "compare",start: 0,end: 7 }],occurrence: 0,meaningZh: "比较",pronunciation: "/kəmˈper/" },
      { sentenceId,text: "different",sourceText: "different",answerTokens: [{ text: "different",start: 0,end: 9 }],occurrence: 0,meaningZh: "不同的",pronunciation: "/ˈdɪfrənt/" },
    ];
    const generate = vi.fn(async (input: string) => input.startsWith("MAGAZINE_READER_SINGLE_WORD_VOCABULARY_REVIEW") ? review : JSON.stringify({ replacements: [],additions,sentenceTranslations: [{ sentenceId,translationZh }] }));
    const next = await new LearningMaterialService(dir,generate).prepare(source);
    expect(next.vocabulary.length).toBeGreaterThanOrEqual(learningVocabularyCoverage(source.english).minimum);
    expect(next.vocabulary.slice(0,2)).toEqual(previous.vocabulary);
    expect(next.vocabulary.slice(2).map(word => word.sentenceMeaningZh)).toEqual([translationZh,translationZh]);
    expect(next.sentences).toEqual(previous.sentences);
    expect(next.vocabularyRevision).toMatchObject({ replacedIds: [],addedIds: ["v:2","v:3"] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await new LearningMaterialService(dir).prepare(source)).toEqual(next);
    const fresh = await root();
    await expect(new LearningMaterialService(fresh,vi.fn().mockResolvedValue(JSON.stringify(content))).prepare(source)).rejects.toThrow("单词数量不足");
    await expect(readdir(path.join(fresh,"learning-materials"))).rejects.toThrow();
  });
  it("accepts legacy retained words without IPA while requiring it for newly authored words", async () => {
    const dir = await root(), source = { ...lesson,english: `${lesson.english} Readers compare different explanations before they choose an answer. A surprising result can change our understanding.` };
    const previous = structuredClone(fixtureMaterial);
    previous.english = source.english; previous.sourceVersion = learningSourceVersion(source); previous.vocabulary = [previous.vocabulary[0]];
    delete previous.vocabulary[0].pronunciation;
    previous.materialVersion = createHash("sha256").update(JSON.stringify({ sourceVersion: previous.sourceVersion,content: { sentences: previous.sentences,vocabulary: previous.vocabulary } })).digest("hex");
    await mkdir(path.join(dir,"learning-materials"));
    await writeFile(path.join(dir,"learning-materials",`${previous.sourceVersion}.authored-v3.json`),JSON.stringify(previous));
    const secondId = learningSourceSentences(source.english)[1].id, thirdId = learningSourceSentences(source.english)[2].id;
    const additions = [
      { sentenceId: secondId,text: "compare",sourceText: "compare",answerTokens: [{ text: "compare",start: 0,end: 7 }],occurrence: 0,meaningZh: "比较",pronunciation: "/kəmˈper/" },
      { sentenceId: thirdId,text: "surprising",sourceText: "surprising",answerTokens: [{ text: "surprising",start: 0,end: 10 }],occurrence: 0,meaningZh: "令人意外的",pronunciation: "/sərˈpraɪzɪŋ/" },
    ];
    const generate = vi.fn(async (input: string) => {
      if (input.startsWith("MAGAZINE_READER_SINGLE_WORD_VOCABULARY_REVIEW")) {
        const data = JSON.parse(input.slice(input.indexOf("DATA: ") + 6));
        expect(data.authoredVocabulary.every((word: { pronunciation?: string }) => word.pronunciation)).toBe(true);
        expect(data.retainedVocabulary).toHaveLength(1);
        expect(data.retainedVocabulary[0].pronunciation).toBeUndefined();
        return review;
      }
      return JSON.stringify({ replacements: [],additions,sentenceTranslations: [
        { sentenceId: secondId,translationZh: "读者在选择答案前比较不同解释。" },
        { sentenceId: thirdId,translationZh: "一个令人意外的结果会改变我们的理解。" },
      ] });
    });
    const next = await new LearningMaterialService(dir,generate).prepare(source);
    expect(next.vocabulary[0]).toEqual(previous.vocabulary[0]);
    expect(next.vocabulary.slice(1).every(word => word.pronunciation)).toBe(true);
  });
  it("upgrades old phrase targets once with Codex, reuses translations and preserves every assembly expression", async () => {
    const dir = await root(), previous = await legacyPhrase(dir);
    const generate = vi.fn(async (input: string) => input.startsWith("MAGAZINE_READER_SINGLE_WORD_VOCABULARY_REVIEW") ? review : JSON.stringify({ replacements: [wordReplacement] }));
    const service = new LearningMaterialService(dir,generate), readOnly = await service.readCached(lesson);
    expect(readOnly?.vocabulary[0].sourceText).toBe("Good evidence"); expect(generate).not.toHaveBeenCalled();
    const next = await service.prepare(lesson);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(next.vocabulary[0]).toMatchObject({ text: "evidence",sourceText: "evidence",meaningZh: "证据",sentenceMeaningZh: previous.vocabulary[0].sentenceMeaningZh });
    expect(next.vocabulary.every(word => word.answerTokens.length === 1)).toBe(true);
    expect(next.vocabulary[1]).toEqual(previous.vocabulary[1]);
    expect(next.sentences[0].steps[1].vocabularyId).toBeUndefined();
    const withoutLinks = (sentences: typeof next.sentences) => sentences.map(sentence => ({ ...sentence,steps: sentence.steps.map(({ vocabularyId: _link,...step }) => step) }));
    expect(withoutLinks(next.sentences)).toEqual(withoutLinks(previous.sentences));
    expect(next.vocabularyRevision).toMatchObject({ fromMaterialVersion: previous.materialVersion,replacedIds: ["v:0"],detachedLinks: [{ stepId: previous.sentences[0].steps[1].id,vocabularyId: "v:0" }],review: { approved: true } });
    expect(JSON.parse(await readFile(path.join(dir,"learning-materials",`${previous.sourceVersion}.${previous.materialVersion}.json`),"utf8"))).toEqual(previous);
    expect(await new LearningMaterialService(dir).prepare(lesson)).toEqual(next);
  });
  it("rejects newly generated phrase vocabulary and keeps legacy cache untouched if replacement fails", async () => {
    const dir = await root(), previous = await legacyPhrase(dir), file = path.join(dir,"learning-materials",`${previous.sourceVersion}.authored-v3.json`), before = await readFile(file,"utf8");
    await expect(new LearningMaterialService(dir).prepare(lesson)).rejects.toThrow("旧词汇材料包含短语");
    const invalid = vi.fn(async () => JSON.stringify({ replacements: [{ ...wordReplacement,text: "Good evidence",sourceText: "Good evidence",answerTokens: previous.vocabulary[0].answerTokens }] }));
    await expect(new LearningMaterialService(dir,invalid).prepare(lesson)).rejects.toThrow("只能挖空一个完整单词");
    expect(await readFile(file,"utf8")).toBe(before);
    const empty = await root(), phrases = { ...content,vocabulary: previous.vocabulary };
    await expect(new LearningMaterialService(empty,vi.fn().mockResolvedValue(JSON.stringify(phrases))).prepare(lesson)).rejects.toThrow("只能挖空一个完整单词");
    await expect(readdir(path.join(empty,"learning-materials"))).rejects.toThrow();
  });
  it("coalesces preparation, persists authored tiles, and reloads cache without Codex", async () => {
    const dir = await root(), generate = generator(), service = new LearningMaterialService(dir,generate);
    const [first,duplicate] = await Promise.all([service.prepare(lesson),service.prepare(lesson)]);
    expect(first).toEqual(duplicate); expect(generate).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ schemaVersion: 3, generator: { engine: "codex-prep", policy: "assembly-v3", model: null, modelId: null, reasoningEffort: null, requestedModelId: null, requestedReasoningEffort: null, generatedAt: expect.any(String), materialVersion: first.materialVersion } });
    expect(first.sentences[0].steps[2].assembly.tiles[1].text).toBe("a careful claim");
    expect(await new LearningMaterialService(dir).prepare(lesson)).toEqual(first);
    expect(generate.mock.calls[0][0]).toContain("syntax, phrase structure"); expect(generate.mock.calls[0][0]).toContain("browser must not split");
  });
  it("reads an existing published material without invoking Codex or audio preparation", async () => {
    const dir = await root(), generated = generator();
    const published = await new LearningMaterialService(dir,generated).prepare(lesson);
    const generate = vi.fn(), prepareAudio = vi.fn(), reader = new LearningMaterialService(dir,generate,prepareAudio);
    expect(await reader.readCached(lesson)).toEqual(published);
    expect(generate).not.toHaveBeenCalled();
    expect(prepareAudio).not.toHaveBeenCalled();
    expect(await new LearningMaterialService(await root()).readCached(lesson)).toBeNull();
  });
  it("reuses the project's existing Codex prep runner, without adding authentication", async () => {
    const dir = await root(), accessToken = vi.fn(async () => "synthetic-token"), run = vi.fn(async () => JSON.stringify(content));
    const prep = new CodexPrepService(dir,{ accessToken } as unknown as CodexAuthService,run);
    try { expect(await prep.generateLearningMaterial("test preparation")).toMatchObject({ text: JSON.stringify(content), usage: null }); expect(run.mock.calls[0].slice(0,3)).toEqual(["test preparation","synthetic-token",path.join(dir,"data","codex-prep-sandbox")]); expect(accessToken).toHaveBeenCalledTimes(1); expect(prep.list(lesson.bookId)).toEqual([]); } finally { prep.close(); }
  });
  it("repairs one invalid authored plan before publication and never invents a frontend fallback", async () => {
    const dir = await root(), bad = structuredClone(content); bad.sentences[0].steps[2].assembly.tiles[1].fromStepId = 999;
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(JSON.stringify(content)).mockResolvedValueOnce(review);
    const result = await new LearningMaterialService(dir,generate).prepare(lesson);
    expect(result.schemaVersion).toBe(3); expect(generate).toHaveBeenCalledTimes(3); expect(generate.mock.calls[1][0]).toContain("已知词块"); expect(await readdir(path.join(dir,"learning-materials"))).toHaveLength(2);
  });
  it("fails unpublished on unavailable Codex or repeated malformed output, then allows retry", async () => {
    const dir = await root(); await expect(new LearningMaterialService(dir).prepare(lesson)).rejects.toThrow("Codex");
    const generate = vi.fn().mockResolvedValueOnce("{}").mockResolvedValueOnce("{}").mockImplementation(async (input: string) => input.startsWith("MAGAZINE_READER_LEARNING_REVIEW") ? review : JSON.stringify(content)); const service = new LearningMaterialService(dir,generate);
    await expect(service.prepare(lesson)).rejects.toThrow(); await expect(readdir(path.join(dir,"learning-materials"))).rejects.toThrow(); expect((await service.prepare(lesson)).sentences).toHaveLength(1);
  });
  it("does not publish structurally valid content that fails Codex semantic review", async () => {
    const dir = await root(), rejected = JSON.stringify({ approved: false, summaryZh: "步骤不完整。", issuesZh: ["谓语缺少语义必需的宾语。"] });
    const generate = vi.fn(async (input: string) => input.startsWith("MAGAZINE_READER_LEARNING_REVIEW") ? rejected : JSON.stringify(content));
    await expect(new LearningMaterialService(dir,generate).prepare(lesson)).rejects.toThrow("教学审阅未通过");
    expect(generate).toHaveBeenCalledTimes(4); expect(generate.mock.calls[2][0]).toContain("谓语缺少");
    await expect(readdir(path.join(dir,"learning-materials"))).rejects.toThrow();
  });
  it("preserves old material and publishes a new version only after validation", async () => {
    const dir = await root(), revised = structuredClone(content); revised.sentences[0].steps[0].assembly.analysisZh = "先练习修饰语和名词的关系，再把冠词加入这个完整短语。";
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify(content)).mockResolvedValueOnce(review).mockResolvedValueOnce(JSON.stringify(revised)).mockResolvedValueOnce(review), service = new LearningMaterialService(dir,generate);
    const old = await service.prepare(lesson), next = await service.prepare(lesson,true);
    expect(old.sourceVersion).toBe(next.sourceVersion); expect(old.materialVersion).not.toBe(next.materialVersion);
    const files = await readdir(path.join(dir,"learning-materials")); expect(files).toContain(`${old.sourceVersion}.${old.materialVersion}.json`); expect(files).toContain(`${next.sourceVersion}.${next.materialVersion}.json`);
  });
  it("revises only assembly while reusing existing vocabulary and full-sentence translations", async () => {
    const dir = await root(), revised = structuredClone(content);
    revised.vocabulary[0].meaningZh = "不应替换的词义";
    revised.sentences[0].translationZh = "不应重新生成的整句翻译。";
    revised.sentences[0].steps[0].assembly.analysisZh = "提前准备完整名词短语，再与已有动作组合，避免长句重复。";
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify(content)).mockResolvedValueOnce(review).mockResolvedValueOnce(JSON.stringify(revised)).mockResolvedValueOnce(review);
    const service = new LearningMaterialService(dir,generate), previous = await service.prepare(lesson), next = await service.prepare(lesson,true);
    expect(next.vocabulary).toEqual(previous.vocabulary);
    expect(next.sentences.map(sentence => sentence.translationZh)).toEqual(previous.sentences.map(sentence => sentence.translationZh));
    expect(next.assemblyFromMaterialVersion).toBe(previous.materialVersion);
    expect(next.sentences[0].steps[0].assembly.analysisZh).toBe(revised.sentences[0].steps[0].assembly.analysisZh);
    expect(await new LearningMaterialService(dir).readCached(lesson)).toEqual(next);
  });
  it("retains the published material if a revision changes source sentences or fails teaching review", async () => {
    const dir = await root(), service = new LearningMaterialService(dir,generator());
    const previous = await service.prepare(lesson), file = path.join(dir,"learning-materials",`${previous.sourceVersion}.authored-v3.json`), before = await readFile(file,"utf8");
    const changed = structuredClone(content); changed.sentences[0].id = "s:0:999";
    await expect(new LearningMaterialService(dir,vi.fn().mockResolvedValue(JSON.stringify(changed))).prepare(lesson,true)).rejects.toThrow("保留已有重点句");
    const rejected = vi.fn(async (input: string) => input.startsWith("MAGAZINE_READER_LEARNING_REVIEW") ? JSON.stringify({ approved: false, summaryZh: "长句重复。", issuesZh: ["连续重复长句，仅新增简单主语。"] }) : JSON.stringify(content));
    await expect(new LearningMaterialService(dir,rejected).prepare(lesson,true)).rejects.toThrow("长句");
    expect(await readFile(file,"utf8")).toBe(before);
  });
  it("keeps old V2 cache read-only and does not mistake it for an authored V3 plan", async () => {
    const dir = await root(); await mkdir(path.join(dir,"learning-materials")); const oldFile = path.join(dir,"learning-materials",`${learningSourceVersion(lesson)}.assembly-v2.json`); await writeFile(oldFile,"old word-bank version");
    const generate = generator(); expect((await new LearningMaterialService(dir,generate).prepare(lesson)).schemaVersion).toBe(3); expect(generate).toHaveBeenCalledTimes(2); expect(await readFile(oldFile,"utf8")).toBe("old word-bank version");
  });
  it("rejects cache drift rather than silently rewriting published material", async () => {
    const dir = await root(), generate = generator(), service = new LearningMaterialService(dir,generate), result = await service.prepare(lesson), file = path.join(dir,"learning-materials",`${result.sourceVersion}.authored-v3.json`);
    await writeFile(file,JSON.stringify({ ...result, english: "Changed source" })); const before = await readFile(file,"utf8"); await expect(service.prepare(lesson)).rejects.toThrow("校验失败"); expect(await readFile(file,"utf8")).toBe(before); expect(generate).toHaveBeenCalledTimes(2);
  });
  it("uses Codex to add persisted input slots to old authored material, then works without Codex", async () => {
    const dir = await root(), old = structuredClone(content);
    for (const sentence of old.sentences) for (const step of sentence.steps) delete (step as { typingTokens?: unknown }).typingTokens;
    const layout = { steps: materialSteps() };
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify(old)).mockResolvedValueOnce(review).mockResolvedValueOnce(JSON.stringify(layout));
    const result = await new LearningMaterialService(dir,generate).prepare(lesson);
    expect(generate).toHaveBeenCalledTimes(3); expect(generate.mock.calls[2][0]).toContain("MAGAZINE_READER_TYPING_LAYOUT"); expect(result.typingFromMaterialVersion).toBeTruthy();
    expect(result.sentences[0].steps[2].typingTokens).toEqual(content.sentences[0].steps[2].typingTokens);
    expect(await new LearningMaterialService(dir).prepare(lesson)).toEqual(result);
    expect(await readdir(path.join(dir,"learning-materials"))).toContain(`${result.sourceVersion}.${result.typingFromMaterialVersion}.json`);
  });
  it("rejects incorrect Codex word ranges instead of deriving them in the browser", async () => {
    const dir = await root(), old = structuredClone(content);
    for (const sentence of old.sentences) for (const step of sentence.steps) delete (step as { typingTokens?: unknown }).typingTokens;
    const layout = { steps: materialSteps() }; layout.steps[0].typingTokens[0].end = 99;
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify(old)).mockResolvedValueOnce(review).mockResolvedValueOnce(JSON.stringify(layout));
    await expect(new LearningMaterialService(dir,generate).prepare(lesson)).rejects.toThrow("准确逐词输入位置");
  });

  it("prepares audio after the validated material without changing its learning version", async () => {
    const dir = await root(), generated = generator(), prepareAudio = vi.fn(async (material: { materialVersion: string }) => ({ schemaVersion: 1 as const,materialVersion: material.materialVersion,provider: "edge-tts" as const,voice: "en-US-AriaNeural",rate: "-10%",status: "ready" as const,total: 0,clips: [] }));
    const service = new LearningMaterialService(dir,generated,prepareAudio), result = await service.prepare(lesson);
    expect(prepareAudio).toHaveBeenCalledTimes(1); expect(result.audio?.materialVersion).toBe(result.materialVersion);
    const saved = await new LearningMaterialService(dir).prepare(lesson); expect(saved.materialVersion).toBe(result.materialVersion); expect(saved.vocabulary).toEqual(result.vocabulary); expect(saved.audio).toBeUndefined();
  });

});

function materialSteps() { return content.sentences.flatMap(sentence => sentence.steps.map((step,i) => ({ id: `${sentence.id}:step:${i}`, typingTokens: structuredClone(step.typingTokens) }))); }
