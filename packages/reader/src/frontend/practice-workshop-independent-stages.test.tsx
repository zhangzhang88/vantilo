// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,within,waitFor} from "@testing-library/react";
import {PracticeWorkshop} from "./practice-workshop";
import {PRACTICE_WORKSHOP_KEY} from "./practice-workshop-storage";
import {PRACTICE_WORKSHOP_VOCABULARY_KEY} from "./workshop-vocabulary-storage";

vi.mock("./ai-provider-settings-panel",()=>({AiProviderSettingsPanel:()=>null}));
vi.mock("./use-lesson-speech",()=>({useLessonSpeech:()=>({speakOnce:async()=>true,cancelSpeech:()=>{},hasSpeech:()=>false,error:""})}));
vi.mock("./use-game-sounds",()=>({useGameSounds:()=>({playTypingSound:()=>{},playCorrectSound:()=>{},playCorrectSoundAndWait:async()=>{},playErrorSound:()=>{},stopAllSounds:()=>{}})}));
class MemoryStorage {
  data=new Map<string,string>();
  getItem(key:string){return this.data.get(key)??null;}
  setItem(key:string,value:string){this.data.set(key,value);}
  removeItem(key:string){this.data.delete(key);}
  clear(){this.data.clear();}
}
const store=new MemoryStorage();
const article="The boy noticed the dog.";
const vocabulary={sentenceIndex:0,sentence:article,word:"noticed",occurrence:0,meaningZh:"注意到",sentenceMeaningZh:"男孩注意到了那只狗。",pronunciation:"/ˈnoʊtɪst/"};
const assembly={sentence:"noticed the dog",chinese:"注意到了狗",pronunciation:"/ˈnoʊtɪst ðə dɔːɡ/"};
beforeEach(()=>{
  store.clear();
  Object.defineProperty(window,"localStorage",{configurable:true,value:store});
  vi.stubGlobal("localStorage",store);
  vi.stubGlobal("fetch",vi.fn(async(url:string,request?:RequestInit)=>{
    if(url==="/api/ai-settings")return {ok:true,json:async()=>({version:1,activeProfileId:null,profiles:[]})};
    if(url==="/api/practice-workshop/prompt")return {ok:true,json:async()=>({prompt:"Please generate ordered sentence practice ".repeat(5)+"{{ARTICLE_JSON}}"})};
    if(url==="/api/practice-workshop/vocabulary-prompt")return {ok:true,json:async()=>({prompt:"Please generate only exact original word practice ".repeat(5)+"{{ARTICLE_JSON}}"})};
    if(url==="/api/practice-workshop/generate"){
      const body=JSON.parse(String(request?.body));
      expect(body.article).toBe(article);
      return {ok:true,json:async()=>body.stage==="vocabulary"?{vocabulary:[vocabulary]}:{exercises:[assembly]}};
    }
    throw Error("Unexpected request: "+url);
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it("deletes one of two saved vocabulary lessons with in-page confirmation, even when browser modals are blocked",async()=>{
  const now="2026-11-08T00:00:00.000Z";
  const titles=["计划改变后，他为何感到自豪？","我的英语练习"];
  const seeded=titles.map((name,i)=>({
    id:"vocabulary-"+(i+1),title:name,article,prompt:"Previously saved prompt",
    providerLabel:"Codex",vocabulary:[vocabulary],createdAt:now,updatedAt:now
  }));
  store.setItem(PRACTICE_WORKSHOP_VOCABULARY_KEY,JSON.stringify({version:1,items:seeded}));
  const blockedModal=vi.spyOn(window,"confirm").mockReturnValue(false);
  const {unmount}=render(<PracticeWorkshop/>);
  fireEvent.click(screen.getByRole("button",{name:/^原文填词/}));
  const firstTitle=await screen.findByText(titles[0]);
  const row=firstTitle.closest("li") as HTMLLIElement;
  expect(screen.getByText("已保存的原文填词（2）")).toBeTruthy();
  fireEvent.click(within(row).getByRole("button",{name:"删除"}));
  expect(within(row).getByRole("group",{name:"确认删除 "+titles[0]})).toBeTruthy();
  expect(JSON.parse(store.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY)!).items).toHaveLength(2);
  fireEvent.click(within(row).getByRole("button",{name:"取消"}));
  expect(screen.queryByRole("button",{name:"确认删除"})).toBeNull();

  fireEvent.click(within(row).getByRole("button",{name:"打开"}));
  fireEvent.change(screen.getByLabelText("练习标题"),{target:{value:"删除前有未保存的改名"}});
  fireEvent.click(within(row).getByRole("button",{name:"删除"}));
  const setter=store.setItem.bind(store);
  const blockedWrite=vi.spyOn(store,"setItem").mockImplementation((key,value)=>{
    if(key===PRACTICE_WORKSHOP_VOCABULARY_KEY)throw new Error("模拟存储写入失败");
    return setter(key,value);
  });
  fireEvent.click(within(row).getByRole("button",{name:"确认删除"}));
  expect(screen.getByRole("alert").textContent).toContain("未安全保存");
  expect(JSON.parse(store.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY)!).items).toHaveLength(2);
  blockedWrite.mockRestore();
  fireEvent.click(within(row).getByRole("button",{name:"确认删除"}));
  const after=JSON.parse(store.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY)!);
  expect(after.items.map((item:{id:string})=>item.id)).toEqual(["vocabulary-2"]);
  expect(screen.getByText("已保存的原文填词（1）")).toBeTruthy();
  expect(blockedModal).not.toHaveBeenCalled();
  await new Promise(resolve=>setTimeout(resolve,800));
  expect(JSON.parse(store.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY)!).items).toHaveLength(1);
  unmount();
  render(<PracticeWorkshop/>);
  await screen.findByText(titles[1]);
  expect(screen.queryByText(titles[0])).toBeNull();
  expect(store.getItem(PRACTICE_WORKSHOP_KEY)).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==="/api/practice-workshop/generate")).toHaveLength(0);
  blockedModal.mockRestore();
});

it("can generate and finish stage 1 without stage 2, while retaining independently saved stage 2 exercises",async()=>{
  const view=render(<><div id="root"/><PracticeWorkshop/></>);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  await screen.findByDisplayValue(/Please generate ordered sentence practice/);
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:article}});
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  await screen.findByDisplayValue(assembly.sentence);
  expect(store.getItem(PRACTICE_WORKSHOP_KEY)).toContain(assembly.sentence);
  const originalAssembly=store.getItem(PRACTICE_WORKSHOP_KEY);
  fireEvent.click(screen.getByRole("button",{name:/^原文填词/}));
  await screen.findByDisplayValue(/Please generate only exact original word practice/);
  expect(screen.getByText(/已保存的原文填词（0）/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"生成原文填词练习"}));
  await screen.findByDisplayValue(vocabulary.word);
  expect(screen.getByDisplayValue(vocabulary.sentenceMeaningZh)).toBeTruthy();
  expect(store.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY)).toContain(vocabulary.pronunciation);
  expect(store.getItem(PRACTICE_WORKSHOP_KEY)).toEqual(originalAssembly);
  fireEvent.click(screen.getByRole("button",{name:"开始原文填词"}));
  const choice=await screen.findByRole("dialog",{name:"本课词汇选择"});
  expect(within(choice).getByText(vocabulary.word)).toBeTruthy();
  fireEvent.click(within(choice).getByRole("button",{name:/开始练习/}));
  const game=await screen.findByRole("dialog",{name:"词汇准备游戏"});
  expect(within(game).getByText(vocabulary.meaningZh)).toBeTruthy();
  expect(within(game).getByText(vocabulary.sentenceMeaningZh)).toBeTruthy();
  expect(within(game).getByText(vocabulary.pronunciation)).toBeTruthy();
  const input=within(game).getByRole("textbox",{name:"当前缺失词"});
  fireEvent.change(input,{target:{value:"noticde"}});
  fireEvent.keyDown(input,{key:"Enter"});
  await screen.findByText("还不对，再试一次。答案不会自动出现。");
  fireEvent.change(input,{target:{value:"noticed"}});
  fireEvent.keyDown(input,{key:"Enter"});
  await screen.findByText("词汇准备完成");
  fireEvent.click(screen.getByRole("button",{name:/返回阅读/}));
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  expect(screen.getByText("我的英语练习")).toBeTruthy();
  expect(store.getItem(PRACTICE_WORKSHOP_KEY)).toEqual(originalAssembly);
  fireEvent.click(screen.getByRole("button",{name:"开始句子组装"}));
  expect(await screen.findByRole("dialog",{name:"句子组装游戏"})).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==="/api/practice-workshop/generate")).toHaveLength(2);
  view.unmount();
});


it("lets first-time learners choose either mode, then remembers the last choice without changing existing practice keys",async()=>{
  const {unmount}=render(<PracticeWorkshop/>);
  const wordCard=screen.getByRole("button",{name:/^原文填词/});
  const sentenceCard=screen.getByRole("button",{name:/^句子组装/});
  expect(wordCard.getAttribute("aria-pressed")).toBe("false");
  expect(sentenceCard.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText(/选一种玩法，开始制作练习/)).toBeTruthy();
  expect(store.getItem(PRACTICE_WORKSHOP_KEY)).toBeNull();
  expect(store.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY)).toBeNull();
  fireEvent.click(wordCard);
  expect(wordCard.getAttribute("aria-pressed")).toBe("true");
  expect(store.getItem("vantilo:practice-workshop-selected-mode:v1")).toBe("vocabulary");
  unmount();
  render(<PracticeWorkshop/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:/^原文填词/}).getAttribute("aria-pressed")).toBe("true"));
  expect(store.getItem(PRACTICE_WORKSHOP_KEY)).toBeNull();
  expect(store.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY)).toBeNull();
});

it("retains separate article drafts when switching modes and blocks mismatched practice results",async()=>{
  render(<PracticeWorkshop/>);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  await screen.findByDisplayValue(/Please generate ordered sentence practice/);
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:article}});
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  await screen.findByDisplayValue(assembly.sentence);
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:"A different article."}});
  expect(screen.getByText(/当前文章与这些练习的原文不同/)).toBeTruthy();
  expect(screen.queryByRole("button",{name:"保存练习"})).toBeNull();
  expect(screen.getByRole("button",{name:"开始句子组装"}).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:/^原文填词/}));
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:"The fresh story belongs only here."}});
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  expect((screen.getByLabelText("英文文章") as HTMLTextAreaElement).value).toBe("A different article.");
  expect(screen.getByDisplayValue(assembly.sentence)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"恢复练习原文"}));
  expect((screen.getByLabelText("英文文章") as HTMLTextAreaElement).value).toBe(article);
  expect(store.getItem(PRACTICE_WORKSHOP_KEY)).toContain(assembly.sentence);
  expect(screen.getByRole("button",{name:"开始句子组装"}).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:/^原文填词/}));
  expect((screen.getByLabelText("英文文章") as HTMLTextAreaElement).value).toBe("The fresh story belongs only here.");
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==="/api/practice-workshop/generate")).toHaveLength(1);
});
it("reopens saved Stage 1 with no Stage 2 generation and no extra model call",async()=>{
  const {unmount}=render(<><div id="root"/><PracticeWorkshop/></>);
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:article}});
  fireEvent.click(screen.getByRole("button",{name:/^原文填词/}));
  await screen.findByDisplayValue(/Please generate only exact original word practice/);
  fireEvent.click(screen.getByRole("button",{name:"生成原文填词练习"}));
  await screen.findByDisplayValue("noticed");
  unmount();
  render(<><div id="root"/><PracticeWorkshop/></>);
  await screen.findByText("我的英语练习");
  fireEvent.click(screen.getByRole("button",{name:"打开"}));
  expect(screen.getByDisplayValue(vocabulary.pronunciation)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"开始原文填词"}));
  expect(await screen.findByRole("dialog",{name:"本课词汇选择"})).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==="/api/practice-workshop/generate")).toHaveLength(1);
});
