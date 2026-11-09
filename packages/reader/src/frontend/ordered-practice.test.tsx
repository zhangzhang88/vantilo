// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { lesson } from "../../tests/fixtures/learning";
import { createBasicMaterial } from "../shared/basic-learning";
import { learningTokens } from "../shared/learning-material";
import { generateOrderedPractice } from "../server/services/ordered-practice";
import { orderedPracticeMaterial } from "./ordered-practice-adapter";
import { AssemblyTypingGame } from "./assembly-typing-game";
import { newLearningProgress, type LearningProgress } from "./learning-state";

vi.mock("./use-lesson-speech", () => ({ useLessonSpeech: () => ({ speakOnce: async () => true, cancelSpeech: () => {}, hasSpeech: () => false, error: "" }) }));
const soundSpies = vi.hoisted(() => ({ playTypingSound: vi.fn(),playCorrectSound: vi.fn(),playErrorSound: vi.fn(),stopAllSounds: vi.fn() }));
vi.mock("./use-game-sounds", () => ({ useGameSounds: () => soundSpies }));
// An isolated in-memory storage backend avoids Node 26 localStorage configuration.
class IsolatedStorage {
  private data = new Map<string,string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
const isolatedStorage = new IsolatedStorage();
beforeEach(() => {
  vi.clearAllMocks();
  isolatedStorage.clear();
  Object.defineProperty(window, "localStorage", { configurable: true, value: isolatedStorage });
  vi.stubGlobal("localStorage", isolatedStorage);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function playOrderedExercise(sentence: string, chinese: string) {
  const material = orderedPracticeMaterial(lesson,createBasicMaterial(lesson,"synthetic"),[{ sentence,chinese }]);
  const tokens = learningTokens(sentence), gameTokens = material.sentences[0].steps[0].typingTokens ?? [];
  expect(gameTokens.length).toBe(tokens.length);
  expect(gameTokens.every((token,index) => token.text === tokens[index].text)).toBe(true);
  function Game() {
    const [progress,setProgress] = useState<LearningProgress>(() => ({ ...newLearningProgress(material,[]),phase: "assembly",practiceStage: "assembly" }));
    return progress.phase === "assembly" ? <AssemblyTypingGame material={material} progress={progress} update={setProgress} exit={() => {}} /> : <p>完成</p>;
  }
  render(<><div id="root" /><Game /></>);
  const dialog = screen.getByRole("dialog",{ name: "句子组装游戏" }), words = dialog.querySelector(".worm-game-words");
  expect(Boolean(words && Array.from(words.querySelectorAll(".worm-game-punctuation")).some(item => item.textContent?.trim() === "&"))).toBe(true);
  const inputs = screen.getAllByTestId("typing-word");
  expect(inputs.length).toBe(tokens.length);
  inputs.forEach((input,index) => fireEvent.change(input,{ target: { value: tokens[index].text } }));
  fireEvent.keyDown(inputs.at(-1)!,{ key: "Enter" });
  expect(dialog.querySelector(".worm-game-completion") !== null).toBe(true);
  fireEvent.keyDown(dialog,{ key: "Enter" });
  expect(screen.queryByText("完成") !== null).toBe(true);
}

it("plays an ordered synthetic list, including a repeated item, with the existing keyboard and feedback", () => {
  const exercises = [
    { sentence: "evidence", chinese: "证据" },
    { sentence: "Good evidence", chinese: "好的证据" },
    { sentence: "evidence", chinese: "再次复习证据" },
  ];
  const material = orderedPracticeMaterial(lesson,createBasicMaterial(lesson,"synthetic"),exercises);
  expect(material.sentences.map(sentence => sentence.steps[0].english)).toEqual(exercises.map(item => item.sentence));
  expect(new Set(material.sentences.map(sentence => sentence.steps[0].id)).size).toBe(3);
  function Game() {
    const [progress,setProgress] = useState<LearningProgress>(() => ({ ...newLearningProgress(material,[]),phase: "assembly",practiceStage: "assembly" }));
    return progress.phase === "assembly" ? <AssemblyTypingGame material={material} progress={progress} update={setProgress} exit={() => {}} /> : <p>完成</p>;
  }
  render(<><div id="root" /><Game /></>);
  let input = screen.getAllByTestId("typing-word")[0];
  fireEvent.change(input,{ target: { value: "wrong" } });
  fireEvent.keyDown(input,{ key: "Enter" });
  expect(screen.getByText("正确的词已锁定，请修改其余词后再次提交。")).toBeTruthy();
  fireEvent.change(input,{ target: { value: "evidence" } });
  fireEvent.keyDown(input,{ key: "Enter" });
  fireEvent.keyDown(screen.getByRole("dialog",{ name: "句子组装游戏" }),{ key: "Enter" });
  expect(screen.getByText("好的证据")).toBeTruthy();
  let inputs = screen.getAllByTestId("typing-word");
  fireEvent.keyDown(inputs[0],{ key: ";",ctrlKey: true });
  expect(screen.getByTestId("revealed-answer").textContent).toBe("Good evidence");
  fireEvent.change(inputs[0],{ target: { value: "Good" } });
  fireEvent.keyDown(inputs[0],{ key: " " });
  inputs = screen.getAllByTestId("typing-word");
  fireEvent.change(inputs[1],{ target: { value: "evidence" } });
  fireEvent.keyDown(inputs[1],{ key: "Enter" });
  fireEvent.keyDown(screen.getByRole("dialog",{ name: "句子组装游戏" }),{ key: "Enter" });
  expect(screen.getByText("再次复习证据")).toBeTruthy();
  input = screen.getAllByTestId("typing-word")[0];
  fireEvent.change(input,{ target: { value: "evidence" } });
  fireEvent.keyDown(input,{ key: "Enter" });
  fireEvent.keyDown(screen.getByRole("dialog",{ name: "句子组装游戏" }),{ key: "Enter" });
  expect(screen.getByText("完成")).toBeTruthy();
});

it("preserves a full IPA string on the actual game step, and only shows it after submission", () => {
  const ipa = "/ðə ˈmɑːrkɪt/";
  const material = orderedPracticeMaterial(lesson, createBasicMaterial(lesson,"synthetic"), [
    { sentence:"the market", chinese:"市场", pronunciation:ipa },
  ]);
  expect(material.sentences[0].steps[0].pronunciation).toBe(ipa);
  function Game() {
    const [progress,setProgress] = useState<LearningProgress>(() => ({ ...newLearningProgress(material,[]),phase:"assembly",practiceStage:"assembly" }));
    return progress.phase === "assembly" ? <AssemblyTypingGame material={material} progress={progress} update={setProgress} exit={() => {}} /> : <p>完成</p>;
  }
  render(<><div id="root" /><Game /></>);
  expect(screen.queryByText(ipa)).toBeNull(); // Do not reveal IPA before typing.
  const inputs = screen.getAllByTestId("typing-word");
  fireEvent.change(inputs[0],{target:{value:"the"}});
  fireEvent.change(inputs[1],{target:{value:"market"}});
  fireEvent.keyDown(inputs[1],{key:"Enter"});
  expect(screen.getByText(ipa)).toBeTruthy();
});

it("keeps the original typing, wrong-answer, and correct-answer sound triggers for workshop exercises", () => {
  const material = orderedPracticeMaterial(lesson,createBasicMaterial(lesson,"synthetic"),[
    { sentence:"the market",chinese:"市场",pronunciation:"/ðə ˈmɑːrkɪt/" },
  ]);
  function Game() {
    const [progress,setProgress] = useState<LearningProgress>(() => ({ ...newLearningProgress(material,[]),phase:"assembly",practiceStage:"assembly" }));
    return progress.phase === "assembly" ? <AssemblyTypingGame material={material} progress={progress} update={setProgress} exit={() => {}} /> : <p>完成</p>;
  }
  render(<><div id="root" /><Game /></>);
  const inputs = screen.getAllByTestId("typing-word");
  fireEvent.change(inputs[0],{target:{value:"wrong"}});
  expect(soundSpies.playTypingSound).toHaveBeenCalledTimes(1);
  fireEvent.change(inputs[1],{target:{value:"market"}});
  fireEvent.keyDown(inputs[1],{key:"Enter"});
  expect(soundSpies.playErrorSound).toHaveBeenCalledTimes(1);
  fireEvent.change(inputs[0],{target:{value:"the"}});
  fireEvent.keyDown(inputs[0],{key:"Enter"});
  expect(soundSpies.playCorrectSound).toHaveBeenCalledTimes(1);
  expect(screen.getByText("/ðə ˈmɑːrkɪt/")).toBeTruthy();
});

it("rejects malformed and untypeable generated items", () => {
  const basic = createBasicMaterial(lesson,"synthetic");
  expect(() => orderedPracticeMaterial(lesson,basic,[{ sentence: "hello (world)",chinese: "你好" }])).toThrow();
  expect(() => orderedPracticeMaterial(lesson,basic,[{ sentence: "hello",chinese: "" }])).toThrow();
});

it("shows ampersands as punctuation while typing only words", () => {
  playOrderedExercise("salt & pepper","盐和胡椒");
});

const replayPath = process.env.VANTILO_ORDERED_PRACTICE_REPLAY_PATH;
if (replayPath) it("replays the saved response through validation, adaptation, and the existing game", async () => {
  if (!replayPath.endsWith("-raw.txt")) throw new Error("回放文件名无效");
  const callPath = replayPath.slice(0,-"-raw.txt".length) + "-call-01.json";
  const [raw,callText] = await Promise.all([readFile(replayPath,"utf8"),readFile(callPath,"utf8")]);
  const call = JSON.parse(callText) as { status?: unknown; article?: unknown; rawResponse?: unknown };
  const article = call.article;
  if (call.status !== "COMPLETED" || typeof article !== "string" || call.rawResponse !== raw) throw new Error("已保存的 AI 调用证据不匹配");
  const generate = vi.fn(async () => ({ text: raw }));
  const exercises = await generateOrderedPractice(article,generate);
  expect(generate.mock.calls.length).toBe(1);
  expect(exercises.length).toBe(47);
  const ampersandIndexes = exercises.flatMap((item,index) => item.sentence.includes("&") ? [index] : []);
  expect(ampersandIndexes.length).toBe(1);
  expect(ampersandIndexes[0]).toBe(3);
  const fullMaterial = orderedPracticeMaterial(lesson,createBasicMaterial(lesson,"synthetic"),exercises);
  expect(fullMaterial.sentences.length).toBe(47);
  const ampersandExercise = exercises[ampersandIndexes[0]];
  if (!ampersandExercise) throw new Error("保存的响应缺少 ampersand 练习");
  playOrderedExercise(ampersandExercise.sentence,ampersandExercise.chinese);
});
