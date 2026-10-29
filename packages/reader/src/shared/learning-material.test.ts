import { describe, expect, it } from "vitest";
import { learningSourceSentences, learningTokens, parseLearningContent, wholeWordSpans } from "./learning-material.js";
import { content, lesson, material } from "../../tests/fixtures/learning.js";
describe("source-bound Codex-authored material contract", () => {
  it("rejects phrase vocabulary in new lessons while permitting explicit read-only legacy validation", () => {
    const raw = structuredClone(content);
    raw.vocabulary[0] = { ...raw.vocabulary[0],text: "Good evidence",sourceText: "Good evidence",answerTokens: [{ text: "Good",start: 0,end: 4 },{ text: "evidence",start: 5,end: 13 }] };
    expect(() => parseLearningContent(raw,lesson)).toThrow("只能挖空一个完整单词");
    expect(parseLearningContent(raw,lesson,{ allowLegacyVocabularyPhrases: true }).vocabulary[0].answerTokens).toHaveLength(2);
    raw.vocabulary[0] = { ...content.vocabulary[0],text: "good evidence" };
    expect(() => parseLearningContent(raw,lesson)).toThrow("只能挖空一个完整单词");
  });
  it("preserves exact Source, stable references and semantic phrase boundaries across saved round trips", () => {
    const before = JSON.stringify(lesson), result = parseLearningContent(content,lesson);
    expect(result.sentences[0].steps.at(-1)?.english).toBe(lesson.english);
    expect(result.sentences[0].steps[1].english).not.toContain(result.sentences[0].steps[0].english);
    expect(result.sentences[0].steps.at(-1)?.dependsOn).toEqual(["s:0:0:step:1","s:0:0:step:2"]);
    expect(result.sentences[0].steps[2].assembly.tiles[1]).toMatchObject({ text: "a careful claim", role: "known", fromStepId: "s:0:0:step:0" });
    expect(result.sentences[0].steps[3].assembly.tiles).toHaveLength(2); expect(parseLearningContent(material,lesson)).toEqual(result); expect(JSON.stringify(lesson)).toBe(before);
  });
  it("validates source positions, contractions and hyphens without erasing meaning", () => {
    const sentences = learningSourceSentences("The price is 3.5 dollars. It may rise.\n\nA careful claim matters."); expect(sentences).toHaveLength(3); expect(sentences[0].english).toBe("The price is 3.5 dollars."); expect(sentences[2]).toMatchObject({ paragraphIndex: 1, startOffset: 0 });
    expect(learningTokens("We don't re-write it.").map(t => t.text)).toEqual(["We","don't","re-write","it"]); expect(wholeWordSpans("well-being","well")).toEqual([]);
  });
  it.each([
    ["missing-plan","Codex"], ["missing-order","目标顺序"], ["duplicate-id","身份不能重复"], ["bad-bank","呈现顺序"], ["not-shuffled","乱序"], ["wrong-piece","精确组合"], ["bad-known","已知词块"], ["fake-known","新增词块"], ["single-target","至少两个"], ["wrong-final","最终 Target"], ["bad-dependency","依赖"], ["partial-word","词汇必须"], ["duplicate-source","来源错误或重复"], ["no-bridge","Anchor"], ["leaked-cue","不能在回忆提示"], ["wrong-token","备课阶段"]
  ])("rejects invalid published plan: %s",(kind,message) => {
    const raw: any = structuredClone(content), steps = raw.sentences[0].steps;
    if (kind === "missing-plan") delete steps[0].assembly;
    if (kind === "missing-order") steps[0].assembly.correctOrder.pop();
    if (kind === "duplicate-id") steps[0].assembly.tiles[1].id = steps[0].assembly.tiles[0].id;
    if (kind === "bad-bank") steps[0].assembly.bankOrder = ["a","a","claim"];
    if (kind === "not-shuffled") steps[0].assembly.bankOrder = [...steps[0].assembly.correctOrder];
    if (kind === "wrong-piece") steps[0].assembly.tiles[2].text = "claims";
    if (kind === "bad-known") steps[2].assembly.tiles[1].fromStepId = 1;
    if (kind === "fake-known") steps[1].assembly.tiles[0].fromStepId = 0;
    if (kind === "single-target") steps[3].assembly = { analysisZh: "测试整体。", tiles: [{ id: "whole", text: lesson.english, role: "new" }], correctOrder: ["whole"], bankOrder: ["whole"] };
    if (kind === "wrong-final") steps[3].english = "Good evidence supports a careful claim";
    if (kind === "bad-dependency") steps[0].dependsOn = [3];
    if (kind === "partial-word") raw.vocabulary[0].sourceText = "evid";
    if (kind === "duplicate-source") raw.sentences.push(structuredClone(raw.sentences[0]));
    if (kind === "no-bridge") steps[2].kind = "anchor";
    if (kind === "leaked-cue") steps[3].explanationZh = "完整句是 " + lesson.english;
    if (kind === "wrong-token") raw.vocabulary[0].answerTokens[0].start = 1;
    expect(() => parseLearningContent(raw,lesson)).toThrow(message);
  });
  it("requires occurrence for ambiguous surface forms and preserves inflection", () => {
    const source = { ...lesson, english: "Genes shape how genes change our lives." };
    const raw = { vocabulary: [{ sentenceId: "s:0:0", text: "gene", sourceText: "genes", answerTokens: [{ text: "genes", start: 0, end: 5 }], occurrence: 1, meaningZh: "基因", sentenceMeaningZh: "基因影响基因如何改变我们的生活。" }], sentences: [{ id: "s:0:0", translationZh: "基因影响基因如何改变我们的生活。", steps: [
      { kind: "anchor", english: "our lives", dependsOn: [], meaningZh: "我们的生活", explanationZh: "准备宾语。", assembly: { analysisZh: "用限定语和名词准备名词短语。", tiles: [{ id: "a", text: "our", role: "new" }, { id: "b", text: "lives", role: "new" }], correctOrder: ["a","b"], bankOrder: ["b","a"] } },
      { kind: "bridge", english: "change our lives", dependsOn: [0], meaningZh: "改变我们的生活", explanationZh: "加入动作。", assembly: { analysisZh: "保持名词短语整体并加入动词。", tiles: [{ id: "a", text: "change", role: "new" }, { id: "b", text: "our lives", role: "known", fromStepId: 0 }], correctOrder: ["a","b"], bankOrder: ["b","a"] } },
      { kind: "target", english: source.english, dependsOn: [1], meaningZh: "基因影响基因如何改变我们的生活。", explanationZh: "形成完整句。", assembly: { analysisZh: "保持动宾短语，加入完整的主语和从句关系。", tiles: [{ id: "a", text: "Genes shape", role: "new" }, { id: "b", text: "how genes", role: "new" }, { id: "c", text: "change our lives.", role: "known", fromStepId: 1 }], correctOrder: ["a","b","c"], bankOrder: ["c","a","b"] } }
    ] }] };
    expect(parseLearningContent(raw,source).vocabulary[0]).toMatchObject({ text: "gene", sourceText: "genes", answerText: "genes", occurrence: 1 }); delete (raw.vocabulary[0] as { occurrence?: number }).occurrence; expect(() => parseLearningContent(raw,source)).toThrow("occurrence");
  });
});
