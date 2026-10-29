import { parseLearningContent, type LearningMaterial } from "../../src/shared/learning-material.js";
import type { BookLesson } from "../../src/shared/book-lesson.js";

/** Entirely synthetic lesson/material fixture; no source EPUB or user content. */
export const lesson: BookLesson = {
  id: "lesson:synthetic", bookId: "book:test-fixture", bookTitle: "Synthetic Test Book",
  sourceFingerprint: "sha256:synthetic-test-fixture", titleZh: "合成测试课程", teaserZh: "仅用于自动化测试。",
  english: "Good evidence supports a careful claim.", explanationZh: "合成测试说明。", keywords: ["evidence"],
  evidence: [{ chapterId: "chapter:test-fixture", paragraphIndex: 0 }], wordCount: 6,
  adaptation: "AI 简易英文改写，非原著引文", createdAt: "2025-01-01T00:00:00.000Z",
};
const tokens = (text: string) => [...text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)].map(m => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
const plan = (parts: Array<{ id: string; text: string; role: "new" | "known"; fromStepId?: number }>, bankOrder?: string[]) => {
  const correctOrder = parts.map(part => part.id);
  return { analysisZh: "本计划仅为合成测试内容。", tiles: parts, correctOrder, bankOrder: bankOrder ?? [...correctOrder].reverse() };
};
export const content = {
  vocabulary: [
    { sentenceId: "s:0:0", text: "evidence", sourceText: "evidence", answerTokens: tokens("evidence"), meaningZh: "证据", sentenceMeaningZh: "好的证据支持一个谨慎的主张。" },
    { sentenceId: "s:0:0", text: "careful", sourceText: "careful", answerTokens: tokens("careful"), meaningZh: "谨慎的", sentenceMeaningZh: "好的证据支持一个谨慎的主张。" },
  ],
  sentences: [{ id: "s:0:0", translationZh: "好的证据支持一个谨慎的主张。", steps: [
    { kind: "anchor", english: "a careful claim", dependsOn: [], meaningZh: "一个谨慎的主张", explanationZh: "先准备名词短语。", assembly: plan([{ id: "a", text: "a", role: "new" }, { id: "careful", text: "careful", role: "new" }, { id: "claim", text: "claim", role: "new" }], ["careful", "a", "claim"]), typingTokens: tokens("a careful claim") },
    { kind: "anchor", english: "Good evidence", dependsOn: [], meaningZh: "好的证据", explanationZh: "准备主语。", assembly: plan([{ id: "a", text: "Good", role: "new" }, { id: "b", text: "evidence", role: "new" }], ["b", "a"]), typingTokens: tokens("Good evidence") },
    { kind: "bridge", english: "supports a careful claim", dependsOn: [0], meaningZh: "支持一个谨慎的主张", explanationZh: "加入动词并保留已学结构。", assembly: plan([{ id: "a", text: "supports", role: "new" }, { id: "b", text: "a careful claim", role: "known", fromStepId: 0 }], ["b", "a"]), typingTokens: tokens("supports a careful claim") },
    { kind: "target", english: "Good evidence supports a careful claim.", dependsOn: [1, 2], meaningZh: "好的证据支持一个谨慎的主张。", explanationZh: "组合主语与谓语。", assembly: plan([{ id: "a", text: "Good evidence", role: "new" }, { id: "b", text: "supports a careful claim.", role: "new" }], ["b", "a"]), typingTokens: tokens("Good evidence supports a careful claim.") }
  ] }],
};
export const material = {
  schemaVersion: 3, id: "learning:synthetic-fixture", materialVersion: "synthetic-v1", sourceVersion: "synthetic-v1",
  source: { lessonId: lesson.id, bookId: lesson.bookId, bookFingerprint: lesson.sourceFingerprint, evidence: lesson.evidence },
  titleZh: lesson.titleZh, teaserZh: lesson.teaserZh, english: lesson.english, explanationZh: lesson.explanationZh,
  adaptation: lesson.adaptation, ...parseLearningContent(content, lesson), createdAt: lesson.createdAt,
  generator: { model: null, engine: "codex-prep", policy: "assembly-v3", review: { approved: true, summaryZh: "仅用于测试。" } },
} satisfies LearningMaterial;
