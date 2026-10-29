import { readingDocumentIdentityFromLegacyFields, type ReadingDocumentIdentity } from "../shared/reading-document-identity";

export interface ReadingEntry {
  document?: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  title?: string;
  sourceTitle?: string;
  sourceFingerprint?: string;
}
export const readingEntryDocument = (entry: ReadingEntry): ReadingDocumentIdentity | null => readingDocumentIdentityFromLegacyFields(entry);
export const readingEntryKey = (entry: ReadingEntry): string => readingEntryDocument(entry)?.documentId ?? "";
export function normalizeReadingEntry(value: unknown): ReadingEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as ReadingEntry;
  const document = readingEntryDocument(raw);
  if (!document) return null;
  const entry: ReadingEntry = document.kind === "article"
    ? { issueId: document.issueId, articleId: document.articleId, ...(raw.document ? { document } : {}) }
    : { document };
  for (const key of ["title", "sourceTitle", "sourceFingerprint"] as const) {
    if (typeof raw[key] === "string" && raw[key]!.trim() && raw[key]!.length <= 2000) entry[key] = raw[key]!.trim();
  }
  return entry;
}
