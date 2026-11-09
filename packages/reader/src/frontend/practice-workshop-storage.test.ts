// @vitest-environment jsdom
import { expect,it } from "vitest";
import { createReaderStorage } from "./reader-storage";
import { loadSavedPractices, saveSavedPractices, saveWorkshopPrompt, PRACTICE_WORKSHOP_KEY, PRACTICE_WORKSHOP_PROMPT_KEY } from "./practice-workshop-storage";

function memory() {
  const data = new Map<string,string>();
  return { backend:{ getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);} },data };
}
const item = { id:"p1",title:"测试",article:"The market is busy.",prompt:"some text {{ARTICLE_JSON}}",providerLabel:"DeepSeek",exercises:[{sentence:"market",chinese:"市场",pronunciation:"/ˈmɑːrkɪt/"}],createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z" };
it("saves and reopens IPA exercises without saving any API key",()=>{
  const {backend,data}=memory(),store=createReaderStorage(backend);
  expect(loadSavedPractices(store)).toEqual([]);
  saveSavedPractices([item],store);
  expect(loadSavedPractices(store)).toEqual([item]);
  expect(data.get(PRACTICE_WORKSHOP_KEY)).not.toContain("secret-key");
});
it("does not overwrite corrupted or unknown-version saved practice",()=>{
  const {backend,data}=memory(),store=createReaderStorage(backend);
  data.set(PRACTICE_WORKSHOP_KEY,'{"version":2,"items":[]}');
  expect(()=>saveSavedPractices([item],store)).toThrow("格式异常");
  expect(data.get(PRACTICE_WORKSHOP_KEY)).toBe('{"version":2,"items":[]}');
});
it("rejects an invalid or duplicate article placeholder without overwriting the last prompt", () => {
  const {backend,data}=memory(),store=createReaderStorage(backend);
  const valid = "生成有序英语练习及整条 IPA。".repeat(12) + "{{ARTICLE_JSON}}";
  saveWorkshopPrompt(valid,store);
  expect(data.get(PRACTICE_WORKSHOP_PROMPT_KEY)).toBe(valid);
  for(const invalid of ["{{ARTICLE_JSON}}","x".repeat(200),valid+"{{ARTICLE_JSON}}"]) {
    expect(()=>saveWorkshopPrompt(invalid,store)).toThrow("占位符");
    expect(data.get(PRACTICE_WORKSHOP_PROMPT_KEY)).toBe(valid);
  }
});
