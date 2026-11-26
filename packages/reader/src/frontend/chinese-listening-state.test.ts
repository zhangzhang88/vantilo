import { describe, expect, it } from "vitest";
import { CHINESE_LISTENING_KEY, loadChineseListeningRecords, narratableParagraphIndexes, resolveChineseListeningPosition, resolveSpeechChunk, saveChineseListeningPosition, splitChineseSpeech, type ChineseListeningPosition } from "./chinese-listening-state";
import { buildUserDataBackup, parseUserDataBackup, restoreUserDataBackup } from "./user-data-backup";
const memory = () => { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } }; };
const record: ChineseListeningPosition = { documentId: "reading:book:a:one", paragraphIndex: 1, sourceText: "Source two.", chunkIndex: 2, chunkText: "中文原段。", seconds: 6.5, rate: 1.25, completed: false };
describe("Chinese listening state", () => {
  it("removes chapter metadata and layout captions from the narration queue without changing the paragraph indices", () => {
    const paragraphs = ["02", "·２００５年12月8日", "2005年12月9日发生了一件事。", "第一张图", "来源：示例",
      "第一张表", "资料来源：测试资料", "2006年1月1日", "这是下一段正文。", "第 18 页", "Page 19"];
    const tables = [{ id: "table", beforeParagraphIndex: 5, captionParagraphIndexes: [5], rows: [] }];
    const visuals = [{ id: "photo", kind: "image" as const, beforeParagraphIndex: 3, captionParagraphIndexes: [3],
      coveredParagraphIndexes: [4], captionText: "第一张图", originalFragment: "", images: [] }];
    const playable = narratableParagraphIndexes({ paragraphs, tables, visuals });
    expect(playable).toEqual([2, 7, 8]);
    expect(playable.find(index => index >= 9)).toBeUndefined();
    expect(narratableParagraphIndexes({ paragraphs: ["·2005年12月8日", "Page 19"] })).toEqual([]);

    // Body prose inside a complex-layout original visual (such as a paragraph with an inline cover image) remains narratable.
    expect(narratableParagraphIndexes({
      paragraphs: ["《超越感觉》旨在向你介绍批判性思考。", "然而，在过去十年中。"],
      visuals: [{
        id: "inline-img",
        kind: "original",
        reason: "complex-layout",
        beforeParagraphIndex: 0,
        captionParagraphIndexes: [],
        coveredParagraphIndexes: [0],
        captionText: "",
        originalFragment: "node-0",
        images: [],
      }],
    })).toEqual([0, 1]);

    // Universal skip for chapter-end bibliographic endnotes, locator codes (e.g. P1-C01-5), and trailing reference headings without skipping normal numbered prose.
    expect(narratableParagraphIndexes({
      paragraphs: [
        "这是第一章正文段落。",
        "1. 首先，在得出结论之前要理清问题。",
        "参考文献",
        '1 Maxwell Maltz, Psycho-Cybernetics (New York: Pocket Books, 1969), pp. 49-53',
        '2 Thomas R. Blakeslee, The Right Brain (Garden City, N.Y.: Anchor Press/Doubleday, 1980).',
        '4 Ibid., pp.88-90.',
        '7 "Teacher Uses Prayer," Binghamton (New York) press, November 16, 1982, p.1.',
        '9 Binghamton (New York) Press, march 27, 1989, p.1A.',
        '10 "When \'News\' Is Almost a Crime," Time, March 21, 1983, p.84.',
        '11 张三：《思考的方法》，某某出版社，2020年，第 35 页。',
        "P1-C01-5",
      ],
    })).toEqual([0, 1]);
  });
  it("round-trips location, segment and speed in backups without audio", () => {
    const storage = memory(); saveChineseListeningPosition(storage, record);
    const backup = parseUserDataBackup(JSON.stringify(buildUserDataBackup(storage)));
    const restored = memory(); restoreUserDataBackup(restored, backup);
    expect(loadChineseListeningRecords(restored)).toEqual([record]);
    expect(JSON.stringify(backup)).not.toContain("blob:");
    saveChineseListeningPosition(restored, { ...record, seconds: 8 });
    expect(loadChineseListeningRecords(restored)).toEqual([{ ...record, seconds: 8 }]);
  });
  it("guards source snapshots, relocates unique matches and isolates chapters", () => {
    expect(resolveChineseListeningPosition([record], record.documentId, ["Source two.", "Other"])).toMatchObject({ paragraphIndex: 0 });
    expect(resolveChineseListeningPosition([record], record.documentId, ["Changed", "Different"])).toBeUndefined();
    expect(resolveChineseListeningPosition([record], "reading:book:a:other", ["Source two."])).toBeUndefined();
    expect(resolveChineseListeningPosition([record], record.documentId, ["Source two.", "Other", "Source two."])).toBeUndefined();
  });
  it("rejects corrupt data and impossible timestamps before restore", () => {
    const storage = memory(); storage.setItem(CHINESE_LISTENING_KEY, "broken");
    expect(loadChineseListeningRecords(storage)).toEqual([]);
    storage.setItem(CHINESE_LISTENING_KEY, JSON.stringify([{ ...record, seconds: -2 }]));
    expect(loadChineseListeningRecords(storage)).toEqual([]);
    expect(() => parseUserDataBackup(JSON.stringify({ ...buildUserDataBackup(memory()), data: { [CHINESE_LISTENING_KEY]: [{ ...record, rate: 9 }] } }))).toThrow();
  });
  it("packs short sentences and keeps closing punctuation at natural breaks", () => {
    const text = "“听他说完。”我把手记合上了。随后才看见窗外下了雨。";
    expect(splitChineseSpeech(text, 18)).toEqual(["“听他说完。”我把手记合上了。", "随后才看见窗外下了雨。"]);
    expect(splitChineseSpeech("是啊，他点了点头，随后继续读完手里的信。", 11))
      .toEqual(["是啊，他点了点头，", "随后继续读完手里的信。"]);
    expect(splitChineseSpeech("“他确认了吗？”我们继续等消息。", 9)[0]).toBe("“他确认了吗？”");
    expect(splitChineseSpeech("刚好是1,200台，明天才会继续发货。", 10)[0]).toBe("刚好是1,200台，");
  });

  it("recovers an old split point and only keeps the audio offset for identical text", () => {
    const chunks = ["第一段结束。", "第二句还有后半，下一句结束。", "最后一句。"];
    expect(resolveSpeechChunk(chunks, { chunkIndex: 2, chunkText: "还有后半，", seconds: 3 }))
      .toEqual({ chunkIndex: 1, seconds: 0 });
    expect(resolveSpeechChunk(chunks, { chunkIndex: 1, chunkText: "最后一句。", seconds: 3 }))
      .toEqual({ chunkIndex: 2, seconds: 3 });
    expect(resolveSpeechChunk(chunks, { chunkIndex: 1, chunkText: "旧译文", seconds: 3 }))
      .toEqual({ chunkIndex: 0, seconds: 0 });
  });
  it("splits punctuation and long unpunctuated Chinese without dropping content", () => {
    const text = "这是完整的第一句话。" + "很长的中文😀".repeat(100) + "！\n这是最后一句。";
    const chunks = splitChineseSpeech(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every(chunk => Array.from(chunk).length <= 130)).toBe(true);
    expect(chunks.join("")).toBe(text);
    expect(splitChineseSpeech(" \n ")).toEqual([]);
  });
});
