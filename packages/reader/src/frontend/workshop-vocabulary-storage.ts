import { parseWorkshopVocabulary, type WorkshopVocabulary } from "../shared/workshop-vocabulary";
import { getReaderStorage } from "./reader-storage";
export interface SavedVocabularyPractice {
  id:string;title:string;article:string;prompt:string;providerLabel:string;
  vocabulary:WorkshopVocabulary[];createdAt:string;updatedAt:string;
}
export const PRACTICE_WORKSHOP_VOCABULARY_KEY="vantilo:practice-workshop-vocabulary:v1";
export const PRACTICE_WORKSHOP_VOCABULARY_PROMPT_KEY="vantilo:practice-workshop-vocabulary-prompt:v1";
const valid=(value:unknown):value is SavedVocabularyPractice=>{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const item=value as Record<string,unknown>;
  try{return typeof item.id==="string"&&item.id.length>0&&item.id.length<=100
    &&typeof item.title==="string"&&!!item.title.trim()&&item.title.length<=200
    &&typeof item.article==="string"&&!!item.article.trim()&&item.article.length<=2000
    &&typeof item.prompt==="string"&&item.prompt.length<=16000
    &&typeof item.providerLabel==="string"&&item.providerLabel.length<=160
    &&typeof item.createdAt==="string"&&Number.isFinite(Date.parse(item.createdAt))
    &&typeof item.updatedAt==="string"&&Number.isFinite(Date.parse(item.updatedAt))
    &&Array.isArray(item.vocabulary)&&parseWorkshopVocabulary(item.vocabulary,item.article).length===item.vocabulary.length;}
  catch{return false;}
};
export function loadSavedVocabularyPractices(storage=getReaderStorage()):SavedVocabularyPractice[] {
  const raw=storage.getItem(PRACTICE_WORKSHOP_VOCABULARY_KEY);
  if(storage.getSnapshot().readFailed)throw new Error("无法读取第一阶段保存内容，已停止写入");
  if(raw===null)return [];
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("第一阶段保存格式异常，原数据已保留");
  const record=data as {version?:unknown;items?:unknown};
  if(record.version!==1||!Array.isArray(record.items)||record.items.length>30||!record.items.every(valid)||new Set(record.items.map((v:SavedVocabularyPractice)=>v.id)).size!==record.items.length)throw new Error("第一阶段保存格式异常，原数据已保留");
  return record.items as SavedVocabularyPractice[];
}
export function saveSavedVocabularyPractices(items:SavedVocabularyPractice[],storage=getReaderStorage()):void {
  loadSavedVocabularyPractices(storage);
  if(!Array.isArray(items)||items.length>30||!items.every(valid)||new Set(items.map(item=>item.id)).size!==items.length)throw new Error("第一阶段保存数据无效或超过 30 份");
  storage.setItem(PRACTICE_WORKSHOP_VOCABULARY_KEY,JSON.stringify({version:1,items}));
  if(storage.getPendingKeys().includes(PRACTICE_WORKSHOP_VOCABULARY_KEY))throw new Error("第一阶段练习未安全保存");
}
export function saveVocabularyWorkshopPrompt(prompt:string,storage=getReaderStorage()):void {
  if(typeof prompt!=="string"||prompt.length<100||prompt.length>16000||prompt.split("{{ARTICLE_JSON}}").length!==2)throw new Error("词汇准备提示词须包含一次 {{ARTICLE_JSON}} 占位符");
  if(storage.getSnapshot().readFailed)throw new Error("无法读取第一阶段提示词");
  storage.setItem(PRACTICE_WORKSHOP_VOCABULARY_PROMPT_KEY,prompt);
  if(storage.getPendingKeys().includes(PRACTICE_WORKSHOP_VOCABULARY_PROMPT_KEY))throw new Error("第一阶段提示词未安全保存");
}
