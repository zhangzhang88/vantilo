import { describe,it,expect } from "vitest";
import { parseOrderedExercises } from "./ordered-practice";

describe("ordered IPA practice validation", () => {
  it("keeps legacy two-field exercises and accepts IPA with ampersand punctuation", () => {
    const old = parseOrderedExercises([{ sentence:"salt & pepper", chinese:"盐和胡椒" }]);
    expect(old).toEqual([{ sentence:"salt & pepper",chinese:"盐和胡椒" }]);
    const newer = parseOrderedExercises([{ sentence:"salt & pepper",chinese:"盐和胡椒",pronunciation:"/sɔːlt ən ˈpɛpər/" }],{ requirePronunciation:true });
    expect(newer[0].pronunciation).toBe("/sɔːlt ən ˈpɛpər/");
  });
  it("requires clean /.../ IPA only in the new workshop path", () => {
    expect(() => parseOrderedExercises([{ sentence:"salt",chinese:"盐" }],{requirePronunciation:true})).toThrow("缺少音标");
    for (const value of ["", "no IPA", "/  /", "/abc/\n<script>", "/a/b/", "/<script>/"]) {
      expect(() => parseOrderedExercises([{ sentence:"salt",chinese:"盐",pronunciation:value }],{requirePronunciation:true})).toThrow("音标格式无效");
    }
  });
});
