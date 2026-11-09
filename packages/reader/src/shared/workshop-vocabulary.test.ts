import {describe,expect,it} from "vitest";
import { parseWorkshopVocabulary } from "./workshop-vocabulary";
import { learningSourceSentences } from "./learning-material";

const article="The boy noticed the dog. The dog was friendly.";
const sentences=learningSourceSentences(article);
const entry={sentenceIndex:0,sentence:sentences[0].english,word:"noticed",occurrence:0,
  meaningZh:"注意到",sentenceMeaningZh:"男孩注意到了那只狗。",pronunciation:"/ˈnoʊtɪst/"};
describe("stage 1 source-anchored vocabulary",()=>{
  it("derives stable exact answers/offsets from the article without inventing blanks",()=>{
    const [word]=parseWorkshopVocabulary([entry],article);
    expect(word).toMatchObject({answer:"noticed",start:8,end:15,sentenceId:sentences[0].id});
    expect(word.sentence.slice(word.start,word.end)).toBe("noticed");
  });
  it("keeps occurrence positions compatible with the original game across capitalization",()=>{
    const second={sentenceIndex:0,sentence:sentences[0].english,word:"the",occurrence:1,
      meaningZh:"这只",sentenceMeaningZh:"男孩注意到了那只狗。",pronunciation:"/ðə/"};
    expect(parseWorkshopVocabulary([second],article)[0].start).toBe(16);
    expect(()=>parseWorkshopVocabulary([{...second,occurrence:0}],article)).toThrow("大小写");
  });
  it("rejects hallucinated words, changed sentences, ambiguous positions, duplicates and missing teaching annotations",()=>{
    const invalid=[
      {...entry,word:"notices"}, {...entry,word:"the dog"},{...entry,sentence:"The boy noticed a dog."},
      {...entry,sentenceIndex:1},{...entry,occurrence:1},{...entry,meaningZh:"noticed"},
      {...entry,sentenceMeaningZh:""},{...entry,pronunciation:"/ /"},
    ];
    for(const item of invalid)expect(()=>parseWorkshopVocabulary([item],article)).toThrow();
    expect(()=>parseWorkshopVocabulary([entry,entry],article)).toThrow("重复");
  });
});
