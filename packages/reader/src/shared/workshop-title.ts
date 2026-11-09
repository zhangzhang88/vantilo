/** AI title rules shared by the editable workshop prompts and the server. */
export const WORKSHOP_CHINESE_TITLE_INSTRUCTION =
  "\n中文复习标题（和练习数据同一次生成）：请根据英文文章内容，拟一个自然、准确、有好奇心的简体中文标题，通常 8–18 个汉字；不能编造原文没有的人物、情节或事实。在同一个 JSON 根对象中提供可选字段 \"titleZh\"，例如 \"titleZh\":\"一场改变计划的意外\"。原有 exercises 或 vocabulary 数组必须完整保留。无法拟题时可以省略标题，但不能省略练习。只输出一份完整 JSON，不要 Markdown 或额外说明。";

export function ensureVisibleWorkshopTitleRule(template: string): string {
  // Old user-customized templates must retain every original instruction.
  return template.includes("titleZh") || template.length + WORKSHOP_CHINESE_TITLE_INSTRUCTION.length > 16000
    ? template : template + WORKSHOP_CHINESE_TITLE_INSTRUCTION;
}

export function normalizeAiWorkshopTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title=value.trim();
  if(title.length<4||title.length>30||!/[\u3400-\u9fff]/u.test(title)||/[\r\n<>\\]/u.test(title)||/^["'`#]/.test(title))return null;
  return title;
}
