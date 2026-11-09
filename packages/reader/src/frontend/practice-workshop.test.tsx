// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PracticeWorkshop } from "./practice-workshop";
import { PRACTICE_WORKSHOP_KEY, PRACTICE_WORKSHOP_PROMPT_KEY } from "./practice-workshop-storage";

vi.mock("./ai-provider-settings-panel", () => ({ AiProviderSettingsPanel: () => <div>API 设置</div> }));
vi.mock("./assembly-typing-game", () => ({
  AssemblyTypingGame: ({material}: {material: {sentences: {steps:{english:string}[]}[]} }) =>
    <section data-testid="existing-assembly-game">{material.sentences.map((s,i)=><span key={i}>{s.steps[0].english}</span>)}</section>,
}));
vi.mock("./learning-stage-completion", () => ({ LearningStageCompletion: () => <p>练习结束</p> }));

class EphemeralReaderStorage {
  private values = new Map<string,string>();
  getItem(key:string) { return this.values.get(key) ?? null; }
  setItem(key:string,value:string) { this.values.set(key,value); }
  removeItem(key:string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const isolatedStorage = new EphemeralReaderStorage();
beforeEach(() => {
  Object.defineProperty(window,"localStorage",{value:isolatedStorage,configurable:true});
  vi.stubGlobal("localStorage",isolatedStorage);
  isolatedStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url:string, init?:RequestInit) => {
    if (url === "/api/ai-settings") return {ok:true,json:async()=>({version:1,activeProfileId:null,profiles:[]})};
    if (url === "/api/practice-workshop/prompt") return {ok:true,json:async()=>({prompt:"请生成有序练习 IPA：{{ARTICLE_JSON}}。".repeat(12)})};
    if (url === "/api/practice-workshop/generate") {
      const payload=JSON.parse(String(init?.body));
      expect(payload.provider).toBe("deepseek");
      expect(payload.apiKey).toBe("transient-only-key");
      return {ok:true,json:async()=>({titleZh:"市场里的一件小事",exercises:[{sentence:"the market",chinese:"市场",pronunciation:"/ðə ˈmɑːrkɪt/"}]})};
    }
    throw new Error("Unexpected API: "+url);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("generates, previews, edits, saves, reopens and plays IPA exercises without touching existing game",async()=>{
  const view=render(<PracticeWorkshop />);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  await screen.findByDisplayValue(/请生成有序练习 IPA/);
  fireEvent.click(screen.getByText(/高级设置/));
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:"The market is busy."}});
  fireEvent.change(screen.getByLabelText("AI 服务"),{target:{value:"deepseek"}});
  fireEvent.change(screen.getByLabelText("DeepSeek API Key"),{target:{value:"transient-only-key"}});
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  await screen.findByDisplayValue("/ðə ˈmɑːrkɪt/");
  expect(screen.getByDisplayValue("市场里的一件小事")).toBeTruthy();
  expect(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY)).toContain("市场里的一件小事");
  fireEvent.change(screen.getByLabelText("音标 IPA"),{target:{value:"/ðə ˈmɑːrkət/"}});
  await waitFor(()=>expect(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY)).toContain("/ðə ˈmɑːrkət/"),{timeout:2000});
  const raw=window.localStorage.getItem(PRACTICE_WORKSHOP_KEY);
  expect(raw).toContain("/ðə ˈmɑːrkət/");
  expect(raw).not.toContain("transient-only-key");
  view.unmount();
  render(<PracticeWorkshop />);
  await screen.findByText("市场里的一件小事");
  fireEvent.click(screen.getByRole("button",{name:"打开"}));
  await screen.findByDisplayValue("/ðə ˈmɑːrkət/");
  fireEvent.click(screen.getByRole("button",{name:"开始句子组装"}));
  expect((await screen.findByTestId("existing-assembly-game")).textContent).toContain("the market");
  const fetcher=vi.mocked(fetch);
  expect(fetcher.mock.calls.filter(call=>call[0]==="/api/practice-workshop/generate")).toHaveLength(1);
});
it("keeps the previous result when a generation fails and blocks malformed IPA", async () => {
  let generateCount=0;
  vi.stubGlobal("fetch",vi.fn(async (url:string) => {
    if(url==="/api/ai-settings") return {ok:true,json:async()=>({version:1,activeProfileId:null,profiles:[]})};
    if(url==="/api/practice-workshop/prompt") return {ok:true,json:async()=>({prompt:"Provide ordered examples. ".repeat(6)+"{{ARTICLE_JSON}}"})};
    if(url==="/api/practice-workshop/generate") {
      generateCount++;
      return generateCount===1
        ? {ok:true,json:async()=>({exercises:[{sentence:"salt & pepper",chinese:"盐和胡椒",pronunciation:"/sɔːlt ən ˈpɛpər/"}]})}
        : {ok:false,json:async()=>({error:"模拟请求失败"})};
    }
    throw new Error("Unexpected API");
  }));
  render(<PracticeWorkshop />);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  await screen.findByDisplayValue(/Provide ordered examples/);
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:"Buy salt & pepper."}});
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  await screen.findByDisplayValue("/sɔːlt ən ˈpɛpər/");
  const savedBeforeFailure=window.localStorage.getItem(PRACTICE_WORKSHOP_KEY);
  expect(savedBeforeFailure).toContain("salt & pepper");
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  expect((await screen.findByRole("alert")).textContent).toContain("模拟请求失败");
  expect(screen.getByDisplayValue("salt & pepper")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("音标 IPA"),{target:{value:"/  /"}});
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("音标格式无效"),{timeout:2000});
  expect(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY)).toBe(savedBeforeFailure);
  expect(screen.getByRole("button",{name:"重试保存"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"开始句子组装"}));
  expect(screen.queryByTestId("existing-assembly-game")).toBeNull();
  expect(generateCount).toBe(2);
});



async function generateAStoredAssembly() {
  render(<PracticeWorkshop/>);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  await screen.findByDisplayValue(/请生成有序练习 IPA/);
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:"The market is busy."}});
  fireEvent.click(screen.getByText(/高级设置/));
  fireEvent.change(screen.getByLabelText("AI 服务"),{target:{value:"deepseek"}});
  fireEvent.change(screen.getByLabelText("DeepSeek API Key"),{target:{value:"transient-only-key"}});
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  await screen.findByDisplayValue("/ðə ˈmɑːrkɪt/");
  await waitFor(()=>expect(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY)).toContain("市场里的一件小事"));
}

it("renames saved practice without an AI call, and deleting it cannot trigger automatic recreation",async()=>{
  await generateAStoredAssembly();
  const original=JSON.parse(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY) as string);
  const id=original.items[0].id;
  fireEvent.click(screen.getByRole("button",{name:"重命名 市场里的一件小事"}));
  fireEvent.change(screen.getByLabelText("修改中文标题"),{target:{value:"市场里最忙碌的一天"}});
  fireEvent.click(screen.getByRole("button",{name:"保存名称"}));
  const changed=JSON.parse(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY) as string);
  expect(changed.items[0].title).toBe("市场里最忙碌的一天");
  expect(changed.items[0].id).toBe(id);
  expect(changed.items[0].exercises).toEqual(original.items[0].exercises);
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==="/api/practice-workshop/generate")).toHaveLength(1);
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button",{name:"删除"}));
  expect(screen.getByRole("group",{name:"确认删除 市场里最忙碌的一天"})).toBeTruthy();
  expect(JSON.parse(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY) as string).items).toHaveLength(1);
  expect(confirm).not.toHaveBeenCalled(); // iframe does not have allow-modals
  fireEvent.click(screen.getByRole("button",{name:"确认删除"}));
  expect(JSON.parse(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY) as string).items).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("练习标题"),{target:{value:"已经删除，不应复活"}});
  await new Promise(resolve=>setTimeout(resolve,850));
  expect(JSON.parse(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY) as string).items).toHaveLength(0);
  expect(screen.getByText(/已保存的句子组装（0）/)).toBeTruthy();
  confirm.mockRestore();
});

it("does not overwrite 30 old exercises when auto-save reaches the limit",async()=>{
  const now="2026-11-08T00:00:00.000Z";
  const oldItems=Array.from({length:30},(_,index)=>({
    id:"older-"+index,title:"以前保存的练习"+index,article:"The market is busy.",
    prompt:"旧提示词",providerLabel:"Codex",
    exercises:[{sentence:"the market",chinese:"市场",pronunciation:"/ðə ˈmɑːrkɪt/"}],
    createdAt:now,updatedAt:now
  }));
  const original=JSON.stringify({version:1,items:oldItems});
  window.localStorage.setItem(PRACTICE_WORKSHOP_KEY,original);
  await generateAStoredAssemblyWithoutSaveExpectation();
  const content=window.localStorage.getItem(PRACTICE_WORKSHOP_KEY);
  expect(content).toBe(original);
  expect(screen.getByRole("alert").textContent).toContain("生成成功，但尚未保存");
  expect(screen.getByRole("button",{name:"重试保存"})).toBeTruthy();
  expect(screen.getByDisplayValue("/ðə ˈmɑːrkɪt/")).toBeTruthy();
});

it("reports storage write failure and retains generated material for explicit retry",async()=>{
  const originalSet=isolatedStorage.setItem.bind(isolatedStorage);
  const spy=vi.spyOn(isolatedStorage,"setItem").mockImplementation((key,value)=>{
    if(key===PRACTICE_WORKSHOP_KEY)throw new Error("模拟磁盘写入失败");
    originalSet(key,value);
  });
  await generateAStoredAssemblyWithoutSaveExpectation();
  expect(screen.getByRole("alert").textContent).toContain("尚未保存");
  expect(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY)).toBeNull();
  spy.mockRestore();
  fireEvent.click(screen.getByRole("button",{name:"重试保存"}));
  await waitFor(()=>expect(window.localStorage.getItem(PRACTICE_WORKSHOP_KEY)).toContain("市场里的一件小事"));
  expect(screen.getByText("✓ 已自动保存")).toBeTruthy();
});

async function generateAStoredAssemblyWithoutSaveExpectation() {
  render(<PracticeWorkshop/>);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  await screen.findByDisplayValue(/请生成有序练习 IPA/);
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:"The market is busy."}});
  fireEvent.click(screen.getByText(/高级设置/));
  fireEvent.change(screen.getByLabelText("AI 服务"),{target:{value:"deepseek"}});
  fireEvent.change(screen.getByLabelText("DeepSeek API Key"),{target:{value:"transient-only-key"}});
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  await screen.findByDisplayValue("/ðə ˈmɑːrkɪt/");
}
it("uses a manually chosen saved profile without activating the global profile", async () => {
  const calls:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async (url:string,init?:RequestInit) => {
    calls.push(url);
    if(url==="/api/ai-settings") return {ok:true,json:async()=>({version:1,activeProfileId:"p-old",profiles:[{id:"p-old",name:"Old model",model:"old"},{id:"p-alt",name:"Alternate",model:"alt"}]})};
    if(url==="/api/practice-workshop/prompt") return {ok:true,json:async()=>({prompt:"Create short lessons. ".repeat(7)+"{{ARTICLE_JSON}}"})};
    if(url==="/api/practice-workshop/generate") {
      const payload=JSON.parse(String(init?.body));
      expect(payload.provider).toBe("profile");
      expect(payload.profileId).toBe("p-alt");
      expect(payload.apiKey).toBeUndefined();
      return {ok:true,json:async()=>({exercises:[{sentence:"the market",chinese:"市场",pronunciation:"/ðə ˈmɑːrkɪt/"}]})};
    }
    throw new Error("Unexpected URL "+url);
  }));
  render(<PracticeWorkshop />);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  await screen.findByDisplayValue(/Create short lessons/);
  fireEvent.click(screen.getByText(/高级设置/));
  fireEvent.change(screen.getByLabelText("英文文章"),{target:{value:"The market opens early."}});
  fireEvent.change(screen.getByLabelText("AI 服务"),{target:{value:"profile"}});
  fireEvent.change(screen.getByLabelText("已保存的服务"),{target:{value:"p-alt"}});
  fireEvent.click(screen.getByRole("button",{name:"生成句子组装练习"}));
  await screen.findByDisplayValue("/ðə ˈmɑːrkɪt/");
  expect(calls.filter(value=>value==="/api/practice-workshop/generate")).toHaveLength(1);
  expect(calls.some(value=>value.includes("activate"))).toBe(false);
});

it("edits, saves and restores the default prompt without storing credentials", async () => {
  const original="请生成按教学顺序排列的英文词组、完整句及对应 IPA。".repeat(8)+"{{ARTICLE_JSON}}";
  vi.stubGlobal("fetch",vi.fn(async (url:string) => {
    if(url==="/api/ai-settings") return {ok:true,json:async()=>({version:1,activeProfileId:null,profiles:[]})};
    if(url==="/api/practice-workshop/prompt") return {ok:true,json:async()=>({prompt:original})};
    throw new Error("Unexpected API "+url);
  }));
  render(<PracticeWorkshop />);
  fireEvent.click(screen.getByRole("button",{name:/^句子组装/}));
  fireEvent.click(screen.getByText(/高级设置/));
  const box=await screen.findByLabelText(/AI 生成规则/);
  await waitFor(()=>expect((box as HTMLTextAreaElement).value).toContain(original));
  expect((box as HTMLTextAreaElement).value).toContain("titleZh");
  fireEvent.change(box,{target:{value:"Add one more challenge. "+original}});
  fireEvent.click(screen.getByRole("button",{name:"保存当前提示词"}));
  expect(window.localStorage.getItem(PRACTICE_WORKSHOP_PROMPT_KEY)).toContain("Add one more challenge");
  fireEvent.click(screen.getByRole("button",{name:"恢复默认提示词"}));
  expect((box as HTMLTextAreaElement).value).toContain(original);
  expect((box as HTMLTextAreaElement).value).toContain("titleZh");
  fireEvent.click(screen.getByRole("button",{name:"保存当前提示词"}));
  expect(window.localStorage.getItem(PRACTICE_WORKSHOP_PROMPT_KEY)).toContain(original);
  expect(window.localStorage.getItem(PRACTICE_WORKSHOP_PROMPT_KEY)).toContain("titleZh");
});
