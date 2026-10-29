import { describe, expect, it } from "vitest";
import { scienceArticleGuide, scienceDiscoveryRefreshNotice } from "./science-article-directory";

describe("science article directory guides", () => {
  it("provides Chinese curiosity titles for current Our World in Data candidates", () => {
    expect(scienceArticleGuide("When do people experience mental health conditions for the first time?")).toEqual({
      titleZh: "心理健康问题通常在什么时候首次出现？",
      teaserZh: "从年龄分布数据看，哪些阶段更需要及早关注心理健康？",
    });
    expect(scienceArticleGuide("138 million children are in child labor. What does this actually mean?").titleZh).toContain("童工");
  });

  it("says existing candidates remain available when a refresh adds nothing new", () => {
    expect(scienceDiscoveryRefreshNotice(0, 0)).toBe("本次检查没有新增候选或自动收录文章；当前文章仍可选择。");
    expect(scienceDiscoveryRefreshNotice(3, 1)).toBe("来源更新完成：新增 3 篇可读候选，自动收录 1 篇。");
  });

  it("provides a Chinese curiosity title and teaser for current discoveries", () => {
    expect(scienceArticleGuide("What is a Kelvin wave?")).toEqual({
      titleZh: "太平洋里有种“看不见的巨浪”，能推动厄尔尼诺？",
      teaserZh: "它横跨数千英里、移动缓慢，还会暂时抬高海平面。",
    });
    expect(scienceArticleGuide("What is a lagoon?").titleZh).toContain("潟湖");
    expect(scienceArticleGuide("WHAT ARE THE MOON’S PHASES?").titleZh).toContain("月亮");
    expect(scienceArticleGuide("All About the Moon").titleZh).toContain("月球");
    expect(scienceArticleGuide("Animals for Kids").titleZh).toContain("熊");
  });

  it("provides specific Chinese guides for NASA Space Place activity pages", () => {
    for (const title of ["What is the atmosphere?", "CubeSat Builder: Build a NASA Spacecraft!", "Your Name in Landsat", "Snap it! An Eclipse Photo Adventure", "SWOT Launch Bingo", "Color Your Universe: Find the Hidden Objects"]) {
      const guide = scienceArticleGuide(title);
      expect(guide.titleZh).not.toBe(title);
      expect(guide.teaserZh).not.toBe("打开文章，看看这个科学问题背后的发现。");
    }
  });

  it("keeps the English source title when no Chinese guide is available", () => {
    expect(scienceArticleGuide("A newly discovered title").titleZh).toBe("A newly discovered title");
  });
});
