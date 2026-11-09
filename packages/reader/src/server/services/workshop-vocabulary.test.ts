import {describe,expect,it,vi} from "vitest";
import {generateWorkshopVocabulary,workshopVocabularyDefaultPrompt,parseWorkshopVocabularyJson} from "./workshop-vocabulary";
describe("stage 1 prompt and provider contract",()=>{
  const text="The boy noticed the dog.";
  const entry={sentenceIndex:0,sentence:text,word:"noticed",occurrence:0,meaningZh:"注意到",sentenceMeaningZh:"男孩注意到了那只狗。",pronunciation:"/ˈnoʊtɪst/"};
  it("passes source text as untrusted article once and validates source positions",async()=>{
    const template=workshopVocabularyDefaultPrompt();
    expect(template.split("{{ARTICLE_JSON}}")).toHaveLength(2);
    const generator=vi.fn(async(prompt:string)=>{
      expect(prompt).toContain(JSON.stringify(text));
      expect(prompt).not.toContain("{{ARTICLE_JSON}}");
      return {text:JSON.stringify({vocabulary:[entry]})};
    });
    expect(await generateWorkshopVocabulary(text,generator,template)).toEqual([entry]);
    expect(generator).toHaveBeenCalledTimes(1);
  });
  it("accepts complete JSON with Markdown fencing or an explanatory preface",async()=>{
    const json=JSON.stringify({vocabulary:[entry]});
    for(const raw of [json, "\uFEFF"+json,
      "```json\n"+json+"\n```",
      "已整理好：\n```json\n"+json+"\n```\n以上是结果。",
      "下面是词汇：\n"+json+"\n可用于练习。"]){
      await expect(generateWorkshopVocabulary(text,async()=>({text:raw}))).resolves.toEqual([entry]);
    }
  });
  it("rejects truncated or ambiguous JSON rather than fabricating vocabulary",async()=>{
    const json=JSON.stringify({vocabulary:[entry]});
    for(const raw of [json.slice(0,-5), "not json", json+"\n"+json,
      "```json\n"+json+"\n```\n```json\n"+json+"\n```"]){
      await expect(generateWorkshopVocabulary(text,async()=>({text:raw}))).rejects.toThrow(/JSON|多段/);
    }
    expect(()=>parseWorkshopVocabularyJson("")).toThrow("没有返回词汇数据");
  });
  it("rejects unrelated model text rather than accepting a rephrased answer",async()=>{
    const generated=vi.fn(async()=>({text:JSON.stringify({vocabulary:[{...entry,sentence:"A boy noticed a dog."}]})}));
    await expect(generateWorkshopVocabulary(text,generated)).rejects.toThrow("原句与文章不一致");
  });
});
