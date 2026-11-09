import { describe, expect, it } from "vitest";
import type { BookLesson } from "./book-lesson";
import { createBasicMaterial } from "./basic-learning";

const lesson: BookLesson = { id: "lesson:test", bookId: "book:test", bookTitle: "Test", sourceFingerprint: "sha256:test", titleZh: "测试", teaserZh: "", explanationZh: "", english: "A good answer can help us answer a bigger question. Why does it matter?", keywords: [], evidence: [], wordCount: 14, adaptation: "AI 简易英文改写，非原著引文", createdAt: "2026-01-01T00:00:00.000Z" };

describe("source-only basic practice", () => {
  it("reuses only the exact source occurrence and never carries unreviewed meanings", () => {
    const material = createBasicMaterial(lesson,"version",[
      { sentenceId: "s:0:0", sourceText: "answer", occurrence: 1, answerText: "answer", meaningZh: "未经验证的释义" },
      { sentenceId: "s:0:0", sourceText: "answer", occurrence: 0, answerText: "wrong" },
      { sentenceId: "s:0:0", sourceText: "good answer", occurrence: 0 },
      { sentenceId: "s:0:999", sourceText: "matter", occurrence: 0 },
    ]);
    const first = material.words.find(word => word.id === material.defaultWordIds[0])!;
    expect(first.answer).toBe("answer");
    expect(first.start).toBe(lesson.english.indexOf("answer",lesson.english.indexOf("answer") + 1));
    expect(first.context.slice(first.start,first.end)).toBe(first.answer);
    expect(JSON.stringify(material)).not.toContain("未经验证的释义");
    expect(material.sentences.map(sentence => sentence.english)).toEqual(["A good answer can help us answer a bigger question.","Why does it matter?"]);
    for (const sentence of material.sentences) for (const token of sentence.tokens) expect(sentence.english.slice(token.start,token.end)).toBe(token.text);
  });
  it("keeps stable identities when old candidates change and splits long sentences safely", () => {
    const long = { ...lesson, english: `${Array.from({length: 205},(_,index) => `word${index}`).join(" ")}.` };
    const first = createBasicMaterial(long,"same",[]), second = createBasicMaterial(long,"same",[{ sentenceId:"s:0:0",sourceText:"word2",occurrence:0 }]);
    expect(first.materialVersion).toBe(second.materialVersion);
    expect(first.words.map(word => word.id)).toEqual(second.words.map(word => word.id));
    expect(first.sentences.map(sentence => sentence.tokens.length)).toEqual([100,100,5]);
    expect(first.sentences.map(sentence => sentence.english).join("")).toBe(long.english);
  });
  it("rejects empty and oversized source text", () => {
    expect(() => createBasicMaterial({ ...lesson,english:" " },"version")).toThrow();
    expect(() => createBasicMaterial({ ...lesson,english:"x".repeat(12001) },"version")).toThrow();
  });
});
