import { describe, expect, it } from "vitest";
import { splitChineseSpeech } from "./chinese-listening-state";
import {
  resolveSpeechChunkForOffset,
  splitHighlightedSpeechChunk,
  splitLiveSpeechHighlight,
} from "./audiobook-sync-highlight";

describe("splitHighlightedSpeechChunk", () => {
  it("highlights the exact spoken chunk while preserving the complete paragraph text", () => {
    const paragraph =
      "这些领导者的观点基于其大型语言模型的快速变化：这类模型已经从生成文本发展到几乎不需要监督就能执行任务。这项新技术，为求简便，我们称之为人工智能，它预示着这样一种未来：你可能一觉醒来，收到人工智能代理发来的消息，告诉你已经更换了互联网服务提供商并降低了网费。毫无疑问，人工智能代理将重塑经济生活的很大一部分，但关于人工智能影响的预测往往过于简单化。";
    const chunks = splitChineseSpeech(paragraph);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const span = splitHighlightedSpeechChunk(paragraph, 1, chunks[1]);
    expect(span).not.toBeNull();
    expect(span!.active).toBe(chunks[1]);
    expect(`${span!.before}${span!.active}${span!.after}`).toBe(paragraph);
  });

  it("falls back to direct chunkText match when chunkIndex shifted", () => {
    const paragraph = "第一句在这里。第二句在这里。第三句在这里。";
    const span = splitHighlightedSpeechChunk(paragraph, 99, "第二句在这里。");
    expect(span).toEqual({
      before: "第一句在这里。",
      active: "第二句在这里。",
      after: "第三句在这里。",
    });
  });

  it("highlights the first speech unit when chunk cursor has not reported text yet", () => {
    const paragraph = "开篇第一句。";
    const span = splitHighlightedSpeechChunk(paragraph);
    expect(span).toEqual({ before: "", active: "开篇第一句。", after: "" });
  });
});

describe("splitLiveSpeechHighlight (sentence + per-character)", () => {
  it("highlights only the active sentence and advances character-by-character with audio seconds", () => {
    const paragraph = "有两件事会让一份工作变得棘手。这可能是因为部分产出难以核验、重新分配任务组成部分的成本很高。第二，这份工作需要人际协作。";
    const early = splitLiveSpeechHighlight(paragraph, 0, paragraph, 0.2, 12);
    const middle = splitLiveSpeechHighlight(paragraph, 0, paragraph, 5.5, 12);
    const late = splitLiveSpeechHighlight(paragraph, 0, paragraph, 10.5, 12);

    expect(early).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(late).not.toBeNull();

    // Every split reconstructs the exact original paragraph without dropping characters.
    for (const span of [early!, middle!, late!]) {
      expect(
        `${span.beforeSentence}${span.sentenceBeforeChar}${span.activeChar}${span.sentenceAfterChar}${span.afterSentence}`,
      ).toBe(paragraph);
      expect(span.activeChar.length).toBe(1);
    }

    // Sentence highlight narrows from sentence 1 -> sentence 2 -> sentence 3 as seconds progress.
    expect(`${early!.sentenceBeforeChar}${early!.activeChar}${early!.sentenceAfterChar}`).toBe("有两件事会让一份工作变得棘手。");
    expect(`${middle!.sentenceBeforeChar}${middle!.activeChar}${middle!.sentenceAfterChar}`).toBe(
      "这可能是因为部分产出难以核验、重新分配任务组成部分的成本很高。",
    );
    expect(`${late!.sentenceBeforeChar}${late!.activeChar}${late!.sentenceAfterChar}`).toBe("第二，这份工作需要人际协作。");

    // Within the same sentence, advancing seconds advances the active character forward.
    const midA = splitLiveSpeechHighlight(paragraph, 0, paragraph, 3.6, 12)!;
    const midB = splitLiveSpeechHighlight(paragraph, 0, paragraph, 6.2, 12)!;
    expect(midB.sentenceBeforeChar.length).toBeGreaterThan(midA.sentenceBeforeChar.length);
  });
});

describe("resolveSpeechChunkForOffset", () => {
  it("resolves exact intra-chunk offset when selecting mid-paragraph", () => {
    const paragraph = "有两件事会让一份工作变得棘手。这可能是因为部分产出难以核验。第三句在这里。";
    const offset = paragraph.indexOf("部分产出");
    const target = resolveSpeechChunkForOffset(paragraph, offset, "部分产出");
    expect(target).toEqual({
      chunkIndex: 0,
      chunkText: "部分产出难以核验。第三句在这里。",
      speechOffset: offset,
    });

    // Live highlight on the returned sub-chunk starts at the selected word.
    const highlight = splitLiveSpeechHighlight(paragraph, target!.chunkIndex, target!.chunkText, 0, 5);
    expect(highlight?.beforeSentence).toBe("有两件事会让一份工作变得棘手。这可能是因为");
    expect(highlight?.activeChar).toBe("部");
  });

  it("maps selections inside later speech chunks of a long paragraph to the right chunkIndex", () => {
    const paragraph =
      "这些领导者的观点基于其大型语言模型的快速变化：这类模型已经从生成文本发展到几乎不需要监督就能执行任务。这项新技术，为求简便，我们称之为人工智能，它预示着这样一种未来：你可能一觉醒来，收到人工智能代理发来的消息，告诉你已经更换了互联网服务提供商并降低了网费。毫无疑问，人工智能代理将重塑经济生活的很大一部分，但关于人工智能影响的预测往往过于简单化。";
    const chunks = splitChineseSpeech(paragraph);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const secondChunkStart = paragraph.indexOf(chunks[1]);
    const phraseOffset = paragraph.indexOf("重塑经济生活");
    expect(phraseOffset).toBeGreaterThanOrEqual(secondChunkStart);

    const target = resolveSpeechChunkForOffset(paragraph, phraseOffset, "重塑经济生活");
    expect(target?.chunkIndex).toBe(1);
    expect(target?.speechOffset).toBe(phraseOffset - secondChunkStart);
    expect(target?.chunkText.startsWith("重塑经济生活")).toBe(true);
  });

  it("skips leading punctuation when the drag begins on a comma or period", () => {
    const paragraph = "第一句，第二句开始。";
    const target = resolveSpeechChunkForOffset(paragraph, paragraph.indexOf("，"));
    expect(target).toEqual({
      chunkIndex: 0,
      chunkText: "第二句开始。",
      speechOffset: paragraph.indexOf("第二句"),
    });
  });

  it("maps selection offsets accurately after smart-skip removes URLs or parentheticals", () => {
    const paragraph = "先看 https://example.com/very/long/path 网址（附注内容）。第二句从这里开始朗读。";
    const smartSkip = { tables: true, urls: true, parentheses: true, brackets: false, braces: false };
    const offset = paragraph.indexOf("第二句");
    const target = resolveSpeechChunkForOffset(paragraph, offset, "第二句", smartSkip);
    expect(target).toEqual({
      chunkIndex: 0,
      chunkText: "第二句从这里开始朗读。",
      speechOffset: "先看 网址。".length,
    });
  });

  it("maps live speech highlight back onto visible text without ever highlighting skipped URLs or parentheticals", () => {
    const paragraph = "请看 https://example.com 然后继续读。";
    const smartSkip = { tables: true, urls: true, parentheses: false, brackets: false, braces: false };
    const urlStart = paragraph.indexOf("https://");
    const urlEnd = urlStart + "https://example.com".length;

    const halfway = splitLiveSpeechHighlight(paragraph, 0, "请看 然后继续读。", 2.5, 5, smartSkip);
    expect(halfway).not.toBeNull();
    expect(
      `${halfway!.beforeSentence}${halfway!.sentenceBeforeChar}${halfway!.activeChar}${halfway!.sentenceAfterChar}${halfway!.afterSentence}`,
    ).toBe(paragraph);
    const halfOffset = halfway!.beforeSentence.length + halfway!.sentenceBeforeChar.length;
    expect(halfOffset < urlStart || halfOffset >= urlEnd).toBe(true);
    expect("请看然后继续读").toContain(halfway!.activeChar);

    for (let seconds = 0; seconds <= 5; seconds += 0.2) {
      const span = splitLiveSpeechHighlight(paragraph, 0, "请看 然后继续读。", seconds, 5, smartSkip)!;
      expect(`${span.beforeSentence}${span.sentenceBeforeChar}${span.activeChar}${span.sentenceAfterChar}${span.afterSentence}`).toBe(paragraph);
      const activeOffset = span.beforeSentence.length + span.sentenceBeforeChar.length;
      expect(activeOffset < urlStart || activeOffset >= urlEnd).toBe(true);
    }

    // Skipped parenthetical between two sentences should stay outside the second sentence highlight.
    const twoSentence = "第一句。(注：跳过) 第二句。";
    const parenSkip = { tables: true, urls: true, parentheses: true, brackets: false, braces: false };
    const secondSentenceSpan = splitLiveSpeechHighlight(twoSentence, 0, "第一句。 第二句。", 4.2, 5, parenSkip)!;
    expect(`${secondSentenceSpan.beforeSentence}${secondSentenceSpan.sentenceBeforeChar}${secondSentenceSpan.activeChar}${secondSentenceSpan.sentenceAfterChar}${secondSentenceSpan.afterSentence}`).toBe(twoSentence);
    expect(secondSentenceSpan.beforeSentence).toBe("第一句。(注：跳过) ");
    expect("第二句").toContain(secondSentenceSpan.activeChar);
  });
});
