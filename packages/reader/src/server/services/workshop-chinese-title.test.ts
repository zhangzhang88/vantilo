import {describe,expect,it,vi} from "vitest";
import {generateOrderedPracticeWithTitle,workshopDefaultPrompt} from "./ordered-practice";
import {generateWorkshopVocabularyWithTitle,workshopVocabularyDefaultPrompt} from "./workshop-vocabulary";
import {normalizeAiWorkshopTitle} from "./workshop-chinese-title";
import {ensureVisibleWorkshopTitleRule, WORKSHOP_CHINESE_TITLE_INSTRUCTION} from "../../shared/workshop-title";

const article="The boy noticed the dog.";
const vocabulary={sentenceIndex:0,sentence:article,word:"noticed",occurrence:0,meaningZh:"注意到",sentenceMeaningZh:"男孩注意到了那只狗。",pronunciation:"/ˈnoʊtɪst/"};
const exercise={sentence:"noticed the dog",chinese:"注意到那只狗",pronunciation:"/ˈnoʊtɪst ðə dɔːɡ/"};
const chineseTitle="男孩为何突然注意到那只狗？";

describe("optional AI-generated Chinese practice titles",()=>{
  it("puts the title rule into the editable prompt exactly once, including old custom prompts",()=>{
    const oldCustom="Only source words and accurate IPA; preserve every sentence. ".repeat(3)+"{{ARTICLE_JSON}}";
    const migrated=ensureVisibleWorkshopTitleRule(oldCustom);
    expect(migrated.startsWith(oldCustom)).toBe(true);
    expect(migrated).toContain(WORKSHOP_CHINESE_TITLE_INSTRUCTION.trim());
    expect(migrated.match(/titleZh/g)).toHaveLength(2); // the requirement and JSON example
    expect(ensureVisibleWorkshopTitleRule(migrated)).toBe(migrated);
    expect(workshopDefaultPrompt()).toContain("titleZh");
    expect(workshopVocabularyDefaultPrompt()).toContain("titleZh");
    expect(workshopDefaultPrompt().split("{{ARTICLE_JSON}}")).toHaveLength(2);
    expect(workshopVocabularyDefaultPrompt().split("{{ARTICLE_JSON}}")).toHaveLength(2);
  });

  it("sends the exact visible prompt without appending hidden instructions",async()=>{
    const custom=ensureVisibleWorkshopTitleRule("Write exact source-aligned exercises. ".repeat(4)+"{{ARTICLE_JSON}}");
    let sent="";
    await generateOrderedPracticeWithTitle(article,async prompt=>{
      sent=prompt;
      return {text:JSON.stringify({exercises:[exercise]})};
    },{promptTemplate:custom,requirePronunciation:true});
    expect(sent).toBe(custom.replace("{{ARTICLE_JSON}}",JSON.stringify(article)));
    expect(sent.split("中文复习标题")).toHaveLength(2);
  });

  it("returns title and each complete practice set in the same AI call, without changing source checks",async()=>{
    const vocabModel=vi.fn(async(prompt:string)=>{
      expect(prompt).toContain("titleZh");
      expect(prompt).toContain(JSON.stringify(article));
      return {text:JSON.stringify({titleZh:chineseTitle,vocabulary:[vocabulary]})};
    });
    const assemblyModel=vi.fn(async(prompt:string)=>{
      expect(prompt).toContain("titleZh");
      expect(prompt).toContain(JSON.stringify(article));
      return {text:JSON.stringify({titleZh:chineseTitle,exercises:[exercise]})};
    });
    await expect(generateWorkshopVocabularyWithTitle(article,vocabModel,workshopVocabularyDefaultPrompt())).resolves.toEqual({titleZh:chineseTitle,vocabulary:[vocabulary]});
    await expect(generateOrderedPracticeWithTitle(article,assemblyModel,{promptTemplate:workshopDefaultPrompt(),requirePronunciation:true})).resolves.toEqual({titleZh:chineseTitle,exercises:[exercise]});
    expect(vocabModel).toHaveBeenCalledTimes(1);
    expect(assemblyModel).toHaveBeenCalledTimes(1);
  });

  it("accepts valid exercises when the title is missing, English-only or malformed",async()=>{
    for(const titleZh of [undefined,"A Story","标题\n注入",32, ""]){
      const data={exercises:[exercise],...(titleZh===undefined?{}:{titleZh})};
      const result=await generateOrderedPracticeWithTitle(article,async()=>({text:JSON.stringify(data)}),{promptTemplate:workshopDefaultPrompt(),requirePronunciation:true});
      expect(result.exercises).toEqual([exercise]);
      expect(result.titleZh).toBeNull();
    }
    const result=await generateWorkshopVocabularyWithTitle(article,async()=>({text:JSON.stringify({vocabulary:[vocabulary]})}));
    expect(result.titleZh).toBeNull();
    expect(result.vocabulary).toEqual([vocabulary]);
  });

  it("never weakens exercise validation merely to recover an attractive title",async()=>{
    await expect(generateWorkshopVocabularyWithTitle(article,async()=>({text:JSON.stringify({titleZh:chineseTitle,vocabulary:[{...vocabulary,word:"wrong"}]})}))).rejects.toThrow();
    await expect(generateOrderedPracticeWithTitle(article,async()=>({text:JSON.stringify({titleZh:chineseTitle,exercises:[{...exercise,pronunciation:"/ /"}]})}),{promptTemplate:workshopDefaultPrompt(),requirePronunciation:true})).rejects.toThrow();
    expect(normalizeAiWorkshopTitle("一篇值得重读的文章")).toBe("一篇值得重读的文章");
  });
});
