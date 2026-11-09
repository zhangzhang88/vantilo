// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,within,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useState} from "react";
import {createBasicMaterial} from "../shared/basic-learning";
import {newLearningProgress,type LearningProgress} from "./learning-state";
import {workshopVocabularyMaterial} from "./workshop-vocabulary-adapter";
import {VocabularyPreparationGame} from "./vocabulary-preparation-game";
import type {BookLesson} from "../shared/book-lesson";

const audio = vi.hoisted(()=>({
  typing:vi.fn(),wrong:vi.fn(),correct:vi.fn(),speech:vi.fn(),
  finishCorrect:null as null | (()=>void),
  finishSpeech:null as null | ((value:boolean)=>void),
}));
vi.mock("./use-game-sounds",()=>({useGameSounds:()=>({
  playTypingSound:audio.typing,playErrorSound:audio.wrong,
  playCorrectSound:vi.fn(),
  playCorrectSoundAndWait:audio.correct,
  stopAllSounds:vi.fn(),
})}));
vi.mock("./use-lesson-speech",()=>({useLessonSpeech:()=>({
  speakOnce:audio.speech,hasSpeech:()=>true,cancelSpeech:vi.fn(),error:"",
})}));

const english="The boy noticed the dog.";
const lesson:BookLesson={
  id:"workshop-fixture",bookId:"practice-workshop",bookTitle:"AI 练习工坊",
  sourceFingerprint:"synthetic-workshop",createdAt:"2026-11-08T08:00:00.000Z",
  titleZh:"词汇反馈测试",teaserZh:"",english,explanationZh:"",keywords:[],evidence:[],
  wordCount:5,adaptation:"AI 简易英文改写，非原著引文",
};
const item={sentenceIndex:0,sentence:english,word:"noticed",occurrence:0,
  meaningZh:"注意到",sentenceMeaningZh:"男孩注意到了那只狗。",pronunciation:"/ˈnoʊtɪst/"};

class IsolatedStorage {
  data=new Map<string,string>();
  getItem(key:string){return this.data.get(key)??null;}
  setItem(key:string,value:string){this.data.set(key,value);}
  removeItem(key:string){this.data.delete(key);}
  clear(){this.data.clear();}
}
beforeEach(()=>{
  Object.defineProperty(window,"localStorage",{value:new IsolatedStorage(),configurable:true});
  audio.typing.mockClear();audio.wrong.mockClear();audio.correct.mockReset();audio.speech.mockReset();
  audio.finishCorrect=null;audio.finishSpeech=null;
  audio.correct.mockImplementation(()=>new Promise<void>(resolve=>{audio.finishCorrect=resolve;}));
  audio.speech.mockImplementation(()=>new Promise<boolean>(resolve=>{audio.finishSpeech=resolve;}));
});
afterEach(()=>cleanup());

function renderOneWordGame(){
  const material=workshopVocabularyMaterial(lesson,createBasicMaterial(lesson,"reveal-test"),[item]);
  function Harness(){
    const [progress,setProgress]=useState<LearningProgress>(()=>({
      ...newLearningProgress(material,[]),phase:"vocabulary",practiceStage:"vocabulary",stageTotal:1,
    }));
    return progress.phase==="vocabulary"
      ?<VocabularyPreparationGame material={material} progress={progress} update={setProgress} exit={()=>{}} reset={()=>{}}/>
      :<div data-testid="vocabulary-finished">{progress.phase}</div>;
  }
  render(<><div id="root"/><Harness/></>);
  return screen.getByRole("textbox",{name:"当前缺失词"}) as HTMLInputElement;
}

it("keeps the first key when typing during a revealed answer, and cancels the old 3-second timer",()=>{
  vi.useFakeTimers();
  try{
    const input=renderOneWordGame();
    fireEvent.keyDown(input,{key:"Enter"}); // Empty answer reveals the word.
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("noticed");
    expect(screen.getByTestId("revealed-answer").textContent).toBe("noticed");
    expect(screen.queryByText("答案显示三秒后收起，请继续回忆。")).toBeNull();
    fireEvent.keyDown(input,{key:"n",code:"KeyN"});
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("n");
    expect(screen.queryByTestId("revealed-answer")).toBeNull();
    expect(audio.typing).toHaveBeenCalledTimes(1);
    fireEvent.change(input,{target:{value:"no"}});
    expect(audio.typing).toHaveBeenCalledTimes(2);
    act(()=>{vi.advanceTimersByTime(3100);});
    expect(input.value).toBe("no"); // A stale timeout cannot clear an in-progress answer.
    expect(input.readOnly).toBe(false);
  }finally{vi.useRealTimers();}
});

it("clicking the answer input closes the reveal immediately and still allows typing",()=>{
  vi.useFakeTimers();
  try{
    const input=renderOneWordGame();
    fireEvent.keyDown(input,{key:"Enter"});
    act(()=>{vi.advanceTimersByTime(900);});
    fireEvent.click(input);
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("");
    fireEvent.change(input,{target:{value:"n"}});
    act(()=>{vi.advanceTimersByTime(2400);});
    expect(input.value).toBe("n");
    expect(audio.typing).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
});

it("still automatically hides a revealed answer after three seconds of no input",()=>{
  vi.useFakeTimers();
  try{
    const input=renderOneWordGame();
    fireEvent.keyDown(input,{key:"Enter"});
    act(()=>{vi.advanceTimersByTime(2999);});
    expect(input.readOnly).toBe(true);
    act(()=>{vi.advanceTimersByTime(1);});
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("");
    expect(screen.queryByTestId("revealed-answer")).toBeNull();
    expect(audio.typing).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
});

it("plays typing, wrong and original correct sounds, then TTS for the exact full source sentence, then advances",async()=>{
  const material=workshopVocabularyMaterial(lesson,createBasicMaterial(lesson,"isolated"),[item]);
  function Harness(){
    const [progress,setProgress]=useState<LearningProgress>(()=>({
      ...newLearningProgress(material,[]),phase:"vocabulary",practiceStage:"vocabulary",stageTotal:1,
    }));
    return progress.phase==="vocabulary"
      ?<VocabularyPreparationGame material={material} progress={progress} update={setProgress} exit={()=>{}} reset={()=>{}}/>
      :<div data-testid="vocabulary-finished">{progress.phase}</div>;
  }
  render(<><div id="root"/><Harness/></>);
  const dialog=await screen.findByRole("dialog",{name:"词汇准备游戏"});
  const input=within(dialog).getByRole("textbox",{name:"当前缺失词"});
  fireEvent.change(input,{target:{value:"noticde"}});
  expect(audio.typing).toHaveBeenCalledOnce();
  fireEvent.keyDown(input,{key:"Enter"});
  expect(audio.wrong).toHaveBeenCalledOnce();
  expect(audio.correct).not.toHaveBeenCalled();
  expect(audio.speech).not.toHaveBeenCalled();
  fireEvent.change(input,{target:{value:"noticed"}});
  fireEvent.keyDown(input,{key:"Enter"});
  expect(audio.correct).toHaveBeenCalledOnce();
  expect(screen.queryByText("听完原句后继续。")).toBeNull();
  expect(audio.speech).not.toHaveBeenCalled();
  expect(screen.queryByTestId("vocabulary-finished")).toBeNull();
  await act(async()=>{audio.finishCorrect?.();});
  await waitFor(()=>expect(audio.speech).toHaveBeenCalledWith(english));
  expect(screen.queryByTestId("vocabulary-finished")).toBeNull();
  await act(async()=>{audio.finishSpeech?.(true);});
  expect((await screen.findByTestId("vocabulary-finished")).textContent).toBe("vocabulary-complete");
  expect(audio.correct.mock.invocationCallOrder[0]).toBeLessThan(audio.speech.mock.invocationCallOrder[0]);
});
