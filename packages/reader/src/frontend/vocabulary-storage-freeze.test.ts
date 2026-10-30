import { afterAll, afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { freezeReaderStorageKeys, getReaderStorage, writeFrozenReaderStorageKeys } from "./reader-storage";
import { SAVED_SELECTIONS_KEY } from "./selection-state";
import { WORD_CONTEXT_MEANINGS_KEY } from "./word-context-state";
import { VOCABULARY_REVIEW_SCHEDULE_KEY } from "./vocabulary-review-schedule";

const dom = new JSDOM("", { url: "http://127.0.0.1:5175/vocabulary-freeze-test" });
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const storagePrototype = Object.getPrototypeOf(dom.window.localStorage);
const methods = new Map(["setItem", "removeItem", "clear"].map(key => [key, Object.getOwnPropertyDescriptor(storagePrototype, key)]));
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });

afterEach(() => {
  dom.window.localStorage.clear();
});

describe("vocabulary storage write freeze", () => {
  it("blocks native and ReaderStorage writes for vocabulary keys while leaving unrelated Reader writes available", () => {
    const release = freezeReaderStorageKeys([SAVED_SELECTIONS_KEY, WORD_CONTEXT_MEANINGS_KEY, VOCABULARY_REVIEW_SCHEDULE_KEY]);
    expect(() => dom.window.localStorage.setItem(SAVED_SELECTIONS_KEY, "[]")).toThrow("暂停相关数据写入");
    expect(() => getReaderStorage().setItem(WORD_CONTEXT_MEANINGS_KEY, "[]")).toThrow("暂停相关数据写入");
    expect(() => dom.window.localStorage.clear()).toThrow("暂停相关数据写入");
    dom.window.localStorage.setItem("reader-preferences", "still writable");
    writeFrozenReaderStorageKeys({ [SAVED_SELECTIONS_KEY]: "[]" });
    expect(dom.window.localStorage.getItem(SAVED_SELECTIONS_KEY)).toBe("[]");
    release();
    dom.window.localStorage.setItem(SAVED_SELECTIONS_KEY, "[1]");
    expect(dom.window.localStorage.getItem(SAVED_SELECTIONS_KEY)).toBe("[1]");
  });

  it("refuses unknown keys and repeated concurrent vocabulary freezes", () => {
    const release = freezeReaderStorageKeys([SAVED_SELECTIONS_KEY]);
    expect(() => freezeReaderStorageKeys(["reader-preferences"])).toThrow("只允许冻结");
    expect(() => freezeReaderStorageKeys([SAVED_SELECTIONS_KEY])).toThrow("已在进行中");
    expect(() => writeFrozenReaderStorageKeys({ "reader-preferences": "x" })).toThrow("未持有");
    release();
  });
});

afterAll(() => {
  for (const [key, value] of methods) if (value) Object.defineProperty(storagePrototype, key, value);
  if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
  else delete (globalThis as { window?: unknown }).window;
  dom.window.close();
});
