// @vitest-environment jsdom
import {expect,it} from "vitest";
import {createReaderStorage} from "./reader-storage";
import {saveSavedPractices,loadSavedPractices,PRACTICE_WORKSHOP_KEY} from "./practice-workshop-storage";
import {saveSavedVocabularyPractices,loadSavedVocabularyPractices,PRACTICE_WORKSHOP_VOCABULARY_KEY} from "./workshop-vocabulary-storage";

function store(){
  const data=new Map<string,string>();
  const backend={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  return {data,storage:createReaderStorage(backend)};
}
const old={id:"assembly-original",title:"旧练习",article:"The boy noticed the dog.",prompt:"abc {{ARTICLE_JSON}}",providerLabel:"DeepSeek",
  exercises:[{sentence:"noticed the dog",chinese:"注意到了狗",pronunciation:"/ˈnoʊtɪst ðə dɔːɡ/"}],createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z"};
const first={id:"vocab-new",title:"第一阶段",article:old.article,prompt:"word {{ARTICLE_JSON}}",providerLabel:"DeepSeek",
  vocabulary:[{sentenceIndex:0,sentence:old.article,word:"noticed",occurrence:0,meaningZh:"注意到",sentenceMeaningZh:"男孩注意到了狗。",pronunciation:"/ˈnoʊtɪst/"}],
  createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z"};
it("keeps stage 1 saves isolated from the pre-existing stage 2 storage, including IPA",()=>{
  const {data,storage}=store();
  saveSavedPractices([old],storage);
  const legacyBytes=data.get(PRACTICE_WORKSHOP_KEY);
  saveSavedVocabularyPractices([first],storage);
  expect(data.get(PRACTICE_WORKSHOP_KEY)).toBe(legacyBytes);
  expect(loadSavedPractices(storage)).toEqual([old]);
  expect(loadSavedVocabularyPractices(storage)).toEqual([first]);
  expect(data.get(PRACTICE_WORKSHOP_VOCABULARY_KEY)).not.toContain("sk-test");
});
it("fails closed on unknown stage 1 schema without modifying stage 2",()=>{
  const {storage,data}=store();
  saveSavedPractices([old],storage);
  const prior=data.get(PRACTICE_WORKSHOP_KEY);
  data.set(PRACTICE_WORKSHOP_VOCABULARY_KEY,'{"version":99,"items":[]}');
  expect(()=>saveSavedVocabularyPractices([first],storage)).toThrow("格式异常");
  expect(data.get(PRACTICE_WORKSHOP_KEY)).toBe(prior);
});
