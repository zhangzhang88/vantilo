// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { VocabularyPreparationGame } from "./vocabulary-preparation-game";
import { AssemblyTypingGame } from "./assembly-typing-game";
import { material as original } from "../../tests/fixtures/learning";
import { newLearningProgress, startLearning, type LearningProgress } from "./learning-state";
import type { LearningMaterial } from "../shared/learning-material";

const heard: string[] = [];
class EphemeralReaderStorage {
  private values = new Map<string,string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string,value: string) { this.values.set(key,value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const isolatedStorage = new EphemeralReaderStorage();
beforeEach(() => {
  Object.defineProperty(window,"localStorage",{value:isolatedStorage,configurable:true});
  vi.stubGlobal("localStorage",isolatedStorage);
  isolatedStorage.clear();
});
class SimulatedCachedAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public src: string) { heard.push(src); }
  pause() {}
  async play() { queueMicrotask(() => this.onended?.()); }
}

const clipUrl = `/api/learning-audio/${"a".repeat(64)}.wav`;
const material: LearningMaterial = (() => {
  const base = structuredClone(original);
  const texts = [...new Set([
    ...base.vocabulary.map(word => word.answerText),
    ...base.vocabulary.map(word => base.english),
    ...base.sentences.flatMap(sentence => sentence.steps.map(step => step.english)),
  ])];
  const clips = texts.map((text,i) => ({ key: (i + 1).toString(16).padStart(64,"0"), text, url: clipUrl, bytes: 96044 }));
  const voice = { voice: "aiden", rate: "1x", status: "ready" as const, total: clips.length, clips };
  base.audio = { ...voice, schemaVersion: 1, materialVersion: base.materialVersion, provider: "qwen3-tts", voices: [voice] };
  return base;
})();

afterEach(() => { cleanup(); isolatedStorage.clear(); vi.unstubAllGlobals(); heard.length = 0; });

function WordPractice() {
  const [progress,setProgress] = useState<LearningProgress>(() => startLearning(newLearningProgress(material,[])));
  return progress.phase === "vocabulary" || progress.phase === "vocabulary-review"
    ? <VocabularyPreparationGame material={material} progress={progress} update={setProgress} exit={() => {}} reset={() => {}} />
    : <div role="status">词汇阶段完成</div>;
}

function SentencePractice() {
  const [progress,setProgress] = useState<LearningProgress>(() => ({
    ...newLearningProgress(material,[]), phase:"assembly", assemblyCurrentId:material.sentences[0].steps[0].id,
  }));
  return progress.phase === "assembly"
    ? <AssemblyTypingGame material={material} progress={progress} update={setProgress} exit={() => {}} />
    : <div role="status">完整句打字阶段完成</div>;
}

it("a person can enter vocabulary practice, correct a wrong word, finish two cloze words and hear cached Qwen WAV", async () => {
  vi.stubGlobal("Audio", SimulatedCachedAudio);
  render(<><div id="root" /><WordPractice /></>);
  expect(screen.getByRole("dialog",{name:"词汇准备游戏"})).toBeTruthy();
  let input = screen.getByRole("textbox",{name:"当前缺失词"});
  fireEvent.change(input,{target:{value:"evidnce"}});
  fireEvent.keyDown(input,{key:"Enter"});
  expect(screen.getByText("还不对，再试一次。答案不会自动出现。")).toBeTruthy();
  input = screen.getByRole("textbox",{name:"当前缺失词"});
  fireEvent.change(input,{target:{value:"evidence"}});
  fireEvent.keyDown(input,{key:"Enter"});
  await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
  input = screen.getByRole("textbox",{name:"当前缺失词"});
  fireEvent.change(input,{target:{value:"careful"}});
  fireEvent.keyDown(input,{key:"Enter"});
  await waitFor(() => expect(screen.getByText("词汇阶段完成")).toBeTruthy());
  expect(heard.length).toBeGreaterThan(0);
  expect(heard.every(url => /^\/api\/learning-audio\/[a-f0-9]{64}\.wav$/.test(url))).toBe(true);
});

it("a person can type every lexical word and complete the progressive sentence assembly without Edge audio", async () => {
  vi.stubGlobal("Audio", SimulatedCachedAudio);
  render(<><div id="root" /><SentencePractice /></>);
  for (const step of material.sentences[0].steps) {
    await waitFor(() => expect(screen.getAllByTestId("typing-word")).toHaveLength(step.typingTokens!.length));
    for (const [index,token] of step.typingTokens!.entries()) {
      fireEvent.change(screen.getAllByTestId("typing-word")[index],{target:{value:token.text}});
    }
    fireEvent.click(screen.getByText("提交"));
    await waitFor(() => expect(screen.getByRole("button",{name:"下一项"})).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"下一项"}));
  }
  await waitFor(() => expect(screen.getByText("完整句打字阶段完成")).toBeTruthy());
  expect(heard.length).toBeGreaterThan(0);
  expect(heard.every(url => url.endsWith(".wav"))).toBe(true);
});
