import { describe,it,expect,vi } from "vitest";
import { requestWorkshopExercises } from "./practice-workshop-provider";
import { generateOrderedPractice, workshopDefaultPrompt, workshopPrompt } from "./ordered-practice";

const exercise = { sentence:"The market is busy.",chinese:"市场很热闹。",pronunciation:"/ðə ˈmɑːrkət ɪz ˈbɪzi/" };
describe("AI practice workshop generation", () => {
  it("reuses the curated teaching prompt, adds the article once and requires IPA in one request",async () => {
    const template = workshopDefaultPrompt();
    expect(template).toContain("when you leave the house");
    expect(template).toContain("国际音标");
    expect(template).toContain("{{ARTICLE_JSON}}");
    expect(template).not.toContain("不输出音标或输入框数据");
    const prompt = workshopPrompt("The market is busy.", template);
    expect(prompt).toContain("文章数据：\"The market is busy.\"");
    const model = vi.fn(async()=>({ text:JSON.stringify({exercises:[exercise]}) }));
    await expect(generateOrderedPractice("The market is busy.",model,{promptTemplate:template,requirePronunciation:true})).resolves.toEqual([exercise]);
    expect(model).toHaveBeenCalledTimes(1);
    await expect(generateOrderedPractice("The market is busy.",async()=>({text:JSON.stringify({exercises:[{sentence:exercise.sentence,chinese:exercise.chinese}]})}),{promptTemplate:template,requirePronunciation:true})).rejects.toThrow("音标");
    expect(()=>workshopPrompt("Hello.",template.replace("{{ARTICLE_JSON}}","missing"))).toThrow("占位符");
  });
  it("sends DeepSeek Chat Completions once without retaining a key in output",async () => {
    const fetcher = vi.fn(async(url:unknown, options?:RequestInit) => {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(options?.headers).toMatchObject({Authorization:"Bearer test-key"});
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("deepseek-chat");
      expect(body.messages[0].content).toBe("The market is busy.");
      return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({exercises:[exercise]})}}]})} as Response;
    });
    const value=await requestWorkshopExercises({provider:"deepseek",prompt:"The market is busy.",apiKey:"test-key"},fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(value.text).not.toContain("test-key");
  });
  it("does not switch the saved profile or expose its secret",async () => {
    const fetcher=vi.fn(async (_:unknown,opts?:RequestInit) => {
      const body=JSON.parse(String(opts?.body));
      expect(body.model).toBe("custom-model");
      expect(opts?.headers).toMatchObject({Authorization:"Bearer profile-secret"});
      return {ok:true,status:200,json:async()=>({output_text:JSON.stringify({exercises:[exercise]})})} as Response;
    });
    const value=await requestWorkshopExercises({provider:"profile",prompt:"example",profile:{id:"preset",name:"Saved",description:"",responsesUrl:"https://example.invalid/v1/responses",model:"custom-model",apiKey:"profile-secret"}},fetcher as unknown as typeof fetch);
    expect(value.text).not.toContain("profile-secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
