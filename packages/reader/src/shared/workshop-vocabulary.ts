import { learningSourceSentences, learningTokens } from "./learning-material.js";

/** AI supplies teaching annotations; the program owns every source sentence, token and exact answer offset. */
export interface WorkshopVocabulary {
  sentenceIndex: number;
  sentence: string;
  word: string;
  occurrence: number;
  meaningZh: string;
  sentenceMeaningZh: string;
  pronunciation: string;
}
export interface ResolvedWorkshopVocabulary extends WorkshopVocabulary { sentenceId: string; start: number; end: number; answer: string; }
const chinese = (value:unknown,label:string,max=300):string => {
  if(typeof value!=="string" || !value.trim() || value.length>max || !/[\u3400-\u9fff]/u.test(value) || /[A-Za-z]/.test(value)) throw new Error(label+"必须是有效中文，不得含英文答案");
  return value.trim();
};
const ipa = (value:unknown):string => {
  if(typeof value!=="string" || value.length>100 || !/^\/[^\/<>\r\n]{1,98}\/$/u.test(value.trim()) || /^\/\s*\/$/u.test(value.trim())) throw new Error("音标 IPA 格式无效");
  return value.trim();
};
export function parseWorkshopVocabulary(value:unknown,article:string):ResolvedWorkshopVocabulary[] {
  if(typeof article!=="string"||!article.trim()||article.length>2000)throw new Error("英文文章必须为 1–2000 字符");
  if(!Array.isArray(value)||!value.length||value.length>32)throw new Error("词汇列表必须包含 1–32 项");
  const sources=learningSourceSentences(article);
  const seen=new Set<string>(),seenWords=new Set<string>();
  return value.map((raw,index):ResolvedWorkshopVocabulary=>{
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error(`第 ${index+1} 项词汇格式无效`);
    const item=raw as Record<string,unknown>;
    const n=item.sentenceIndex;
    if(!Number.isInteger(n)||Number(n)<0||Number(n)>=sources.length)throw new Error(`第 ${index+1} 项原句序号无效`);
    const source=sources[Number(n)];
    if(item.sentence!==source.english)throw new Error(`第 ${index+1} 项原句与文章不一致`);
    const word=item.word;
    if(typeof word!=="string"||!word.trim()||word.length>100||learningTokens(word).length!==1||learningTokens(word)[0]?.text!==word)throw new Error(`第 ${index+1} 项必须是一个原文完整单词`);
    // The existing game locates occurrences case-insensitively. Match its index, but require the chosen surface word to match exactly.
    const tokens=learningTokens(source.english).filter(token=>token.text.toLocaleLowerCase("en-US")===word.toLocaleLowerCase("en-US"));
    if(!Number.isInteger(item.occurrence)||Number(item.occurrence)<0||Number(item.occurrence)>=tokens.length)throw new Error(`第 ${index+1} 项词形或出现次数与原句不符`);
    const target=tokens[Number(item.occurrence)];
    if(target.text!==word)throw new Error(`第 ${index+1} 项原文大小写或出现位置不匹配`);
    const id=source.id+":"+target.start,key=word.toLocaleLowerCase("en-US");
    if(seen.has(id)||seenWords.has(key))throw new Error(`第 ${index+1} 项重复选用了相同词汇`);
    seen.add(id);seenWords.add(key);
    return {sentenceIndex:Number(n),sentence:source.english,word,occurrence:Number(item.occurrence),
      meaningZh:chinese(item.meaningZh,"词义"),sentenceMeaningZh:chinese(item.sentenceMeaningZh,"整句中文",750),
      pronunciation:ipa(item.pronunciation),sentenceId:source.id,start:target.start,end:target.end,answer:source.english.slice(target.start,target.end)};
  });
}
