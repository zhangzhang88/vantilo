export const BOOK_CATEGORIES = [
  { id: "psychology", label: "心理学" },
  { id: "economics", label: "经济学" },
  { id: "education", label: "教育育儿" },
  { id: "personal-growth", label: "个人成长" },
  { id: "thinking", label: "思维方法" },
  { id: "research", label: "研究方法" },
  { id: "social-science", label: "社会科学" },
  { id: "literature", label: "文学" },
  { id: "science", label: "自然科学" },
  { id: "history", label: "历史" },
  { id: "uncategorized", label: "未分类" },
] as const;

export type BookCategoryId = typeof BOOK_CATEGORIES[number]["id"];
export function isBookCategoryId(value: unknown): value is BookCategoryId {
  return BOOK_CATEGORIES.some(category => category.id === value);
}
export function bookCategoryLabel(value: BookCategoryId | undefined): string {
  return BOOK_CATEGORIES.find(category => category.id === value)?.label ?? "未分类";
}
