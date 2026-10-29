/** IDs identify local sources; source text is always resolved on the server. */
export type AssistantScope =
  | { kind: "all" | "books" | "magazines" }
  | { kind: "publication"; publicationId: string }
  | { kind: "issue"; issueId: string }
  | { kind: "article"; issueId: string; articleId: string }
  | { kind: "chapter"; bookId: string; chapterId: string }
  | { kind: "lesson"; bookId: string; lessonId: string };

export function parseAssistantScope(raw: unknown): AssistantScope {
  if (typeof raw !== "string" || raw.length > 1200) throw new Error("讨论范围无效");
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (!value || typeof value !== "object") throw new Error("讨论范围无效");
  const id = (key: string) => {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 300) throw new Error("讨论范围无效");
    return value[key] as string;
  };
  switch (value.kind) {
    case "all": case "books": case "magazines": return { kind: value.kind };
    case "publication": return { kind: value.kind, publicationId: id("publicationId") };
    case "issue": return { kind: value.kind, issueId: id("issueId") };
    case "article": return { kind: value.kind, issueId: id("issueId"), articleId: id("articleId") };
    case "chapter": return { kind: value.kind, bookId: id("bookId"), chapterId: id("chapterId") };
    case "lesson": return { kind: value.kind, bookId: id("bookId"), lessonId: id("lessonId") };
    default: throw new Error("讨论范围无效");
  }
}
