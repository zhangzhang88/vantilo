import type { PublicationId } from "./types.js";

const FIXED_SECTION_TRANSLATIONS: Record<PublicationId, Record<string, string>> = {
  economist: {
    "The world this week": "本周要闻",
    Leaders: "社论",
    Letters: "读者来信",
    "By Invitation": "特邀评论",
    Briefing: "深度专题",
    Asia: "亚洲",
    China: "中国",
    "United States": "美国",
    "The Americas": "美洲",
    "Middle East & Africa": "中东与非洲",
    Europe: "欧洲",
    Britain: "英国",
    International: "国际",
    Business: "商业",
    "Finance & economics": "金融与经济",
    "Science & technology": "科学与技术",
    Culture: "文化",
    Obituary: "逝者纪念",
  },
  "new-yorker": {
    "Goings On": "城中指南",
    "The Talk of the Town": "城中话题",
    "Reporting & Essays": "报道与随笔",
    "Shouts & Murmurs": "幽默短文",
    Fiction: "小说",
    "The Critics": "评论",
    Poems: "诗歌",
  },
  atlantic: {
    Features: "专题",
    Dispatches: "现场报道",
    "Culture & Critics": "文化与评论",
    Departments: "栏目",
    Poetry: "诗歌",
  },
  wired: {
    "The Big Story": "重磅报道",
    Other: "其他",
    Business: "商业",
    Gear: "产品与装备",
  },
};

export function fixedSectionNameZh(publicationId: PublicationId, section: string): string | null {
  return FIXED_SECTION_TRANSLATIONS[publicationId][section.trim()] ?? null;
}

export function fixedSectionTranslations(
  publicationId: PublicationId,
  sections: string[],
): Record<string, string> {
  return Object.fromEntries(
    sections.flatMap((section) => {
      const translated = fixedSectionNameZh(publicationId, section);
      return translated ? [[section, translated] as const] : [];
    }),
  );
}
