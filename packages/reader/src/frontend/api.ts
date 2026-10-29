import type {
  Article,
  ArticleImage,
  ArticleStatus,
  AiProviderConnectionTestResponse,
  AiProviderModelsResponse,
  AiProviderProfileDraft,
  AiProviderSaveResponse,
  AiProviderSettingsPublic,
  DictionaryLookupResponse,
  EpubImportPreview,
  EpubReplacementPreview,
  GuidePreparationStatus,
  IssueRecord,
  IssueSummary,
  IssueDeletionResponse,
  ReaderGuideBatchResponse,
  ReadingAssistantRequest,
  ReadingAssistantResponse,
  SectionTranslationBatchResponse,
  SelectionAssistRequest,
  SelectionAssistResponse,
  TranslationRequest,
  TranslationResponse,
  WordContextRequest,
  WordContextResponse,
} from "../shared/types";
import type { BookImportPreview, BookRecord, BookSummary } from "../shared/book-data-contract";
import type { BookCategoryId } from "../shared/book-category";
import type { BookTocChineseStatus } from "../shared/book-toc-chinese";
import type { BookLesson } from "../shared/book-lesson";
import type { LearningMaterial } from "../shared/learning-material";
import type { CodexModelOption, CodexPrepModelPreferences } from "../shared/codex-prep-models";
import type { ContentDiscoverySnapshot } from "../shared/content-discovery";
import type { ScienceArticle } from "../shared/science-article";

export function fetchCodexPrepModelPreferences(): Promise<CodexPrepModelPreferences> {
  return request<CodexPrepModelPreferences>("/api/prep/model-preferences");
}

export function saveCodexPrepModelPreferences(preferences: CodexPrepModelPreferences): Promise<CodexPrepModelPreferences> {
  return request<CodexPrepModelPreferences>("/api/prep/model-preferences", { method: "PUT", body: JSON.stringify(preferences) });
}

export function fetchCodexPrepModels(): Promise<{ models: CodexModelOption[]; defaultModelId: string | null; catalogSource: "app-server"; entitlementVerified: false }> {
  return request("/api/prep/models");
}

export function fetchBookLessons(bookId: string): Promise<BookLesson[]> {
  return request<BookLesson[]>(`/api/books/${encodeURIComponent(bookId)}/lessons`);
}

export function fetchContentDiscovery(): Promise<ContentDiscoverySnapshot> {
  return request<ContentDiscoverySnapshot>("/api/content-discovery");
}

export function refreshContentDiscovery(): Promise<ContentDiscoverySnapshot> {
  return request<ContentDiscoverySnapshot>("/api/content-discovery/refresh", { method: "POST" });
}

export function fetchScienceArticles(): Promise<ScienceArticle[]> {
  return request<ScienceArticle[]>("/api/science-articles");
}

export function importScienceArticle(sourceUrl: string): Promise<ScienceArticle> {
  return request<ScienceArticle>("/api/science-articles/import", { method: "POST", body: JSON.stringify({ sourceUrl }) });
}

export function deleteScienceArticle(id: string): Promise<{ status: "deleted" }> {
  return request(`/api/science-articles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function refreshScienceArticle(id: string): Promise<ScienceArticle> {
  return request(`/api/science-articles/${encodeURIComponent(id)}/refresh`, { method: "POST" });
}

export function deleteBookLesson(bookId: string, lessonId: string): Promise<{ status: "deleted"; lessonId: string }> {
  return request(`/api/books/${encodeURIComponent(bookId)}/lessons/${encodeURIComponent(lessonId)}`, { method: "DELETE" });
}

export function fetchCachedLearningMaterial(bookId: string, lessonId: string): Promise<{ material: LearningMaterial | null }> {
  return request<{ material: LearningMaterial | null }>(`/api/books/${encodeURIComponent(bookId)}/lessons/${encodeURIComponent(lessonId)}/learning-material`);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchAiProviderSettings(): Promise<AiProviderSettingsPublic> {
  return request<AiProviderSettingsPublic>("/api/ai-settings");
}

export function saveAiProviderProfile(profile: AiProviderProfileDraft, activate = true): Promise<AiProviderSaveResponse> {
  return request<AiProviderSaveResponse>("/api/ai-settings/profile", {
    method: "PUT",
    body: JSON.stringify({ profile, activate }),
  });
}

export function activateAiProviderProfile(profileId: string): Promise<AiProviderSettingsPublic> {
  return request<AiProviderSettingsPublic>(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}/activate`, {
    method: "POST",
  });
}

export function deleteAiProviderProfile(profileId: string): Promise<AiProviderSettingsPublic> {
  return request<AiProviderSettingsPublic>(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
  });
}

export function testAiProviderConnection(profile: AiProviderProfileDraft): Promise<AiProviderConnectionTestResponse> {
  return request<AiProviderConnectionTestResponse>("/api/ai-settings/test", {
    method: "POST",
    body: JSON.stringify(profile),
  });
}

export function discoverAiProviderModels(profile: AiProviderProfileDraft): Promise<AiProviderModelsResponse> {
  return request<AiProviderModelsResponse>("/api/ai-settings/models", {
    method: "POST",
    body: JSON.stringify(profile),
  });
}

export function fetchIssues(): Promise<IssueSummary[]> {
  return request<IssueSummary[]>("/api/issues");
}

export function issueCoverUrl(issueId: string): string {
  return `/api/issues/${encodeURIComponent(issueId)}/cover`;
}

export function fetchArticleImages(issueId: string, articleId: string): Promise<ArticleImage[]> {
  return request<ArticleImage[]>(`/api/issues/${encodeURIComponent(issueId)}/articles/${encodeURIComponent(articleId)}/images`);
}

export function articleImageUrl(issueId: string, articleId: string, imageId: string): string {
  return `/api/issues/${encodeURIComponent(issueId)}/articles/${encodeURIComponent(articleId)}/images/${encodeURIComponent(imageId)}`;
}

async function sendEpub<T>(url: string, file: File, query: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${url}?${new URLSearchParams({ filename: file.name, ...query })}`, {
    method: "POST",
    headers: { "Content-Type": "application/epub+zip" },
    body: file,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function previewEpubImport(file: File): Promise<EpubImportPreview> {
  return sendEpub<EpubImportPreview>("/api/import/epub/preview", file);
}

export function importEpub(file: File): Promise<EpubImportPreview> {
  return sendEpub<EpubImportPreview>("/api/import/epub", file);
}

export function previewBookEpubImport(file: File): Promise<BookImportPreview> {
  return sendEpub<BookImportPreview>("/api/books/import/preview", file);
}

export function importBookEpub(file: File, categoryId: BookCategoryId = "uncategorized"): Promise<BookImportPreview> {
  return sendEpub<BookImportPreview>("/api/books/import", file, { categoryId });
}

export function updateBookCategory(bookId: string, categoryId: BookCategoryId): Promise<{ bookId: string; categoryId: BookCategoryId }> {
  return request(`/api/books/${encodeURIComponent(bookId)}/category`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId }) });
}

export function deleteBook(bookId: string): Promise<{ status: "deleted"; bookId: string }> {
  return request(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
}

export function fetchBooks(): Promise<BookSummary[]> {
  return request<BookSummary[]>("/api/books");
}

export function fetchBook(bookId: string): Promise<BookRecord> {
  return request<BookRecord>(`/api/books/${encodeURIComponent(bookId)}`);
}

export function fetchBookTocChinese(bookId: string): Promise<BookTocChineseStatus> {
  return request<BookTocChineseStatus>(`/api/books/${encodeURIComponent(bookId)}/toc-chinese`);
}

export function generateBookTocChinese(bookId: string, regenerate = false): Promise<BookTocChineseStatus> {
  return request<BookTocChineseStatus>(`/api/books/${encodeURIComponent(bookId)}/toc-chinese`, {
    method: "POST",
    body: JSON.stringify({ regenerate }),
  });
}

export function bookCoverUrl(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/cover`;
}

export function previewEpubReplacement(issueId: string, file: File): Promise<EpubReplacementPreview> {
  return sendEpub<EpubReplacementPreview>(`/api/issues/${encodeURIComponent(issueId)}/replace/preview`, file);
}

export function replaceEpub(issueId: string, file: File): Promise<EpubReplacementPreview> {
  return sendEpub<EpubReplacementPreview>(`/api/issues/${encodeURIComponent(issueId)}/replace`, file);
}

export function fetchIssue(issueId: string): Promise<IssueRecord> {
  return request<IssueRecord>(`/api/issues/${encodeURIComponent(issueId)}`);
}

export function deleteIssue(issueId: string): Promise<IssueDeletionResponse> {
  return request<IssueDeletionResponse>(`/api/issues/${encodeURIComponent(issueId)}`, {
    method: "DELETE",
  });
}

export function fetchGuidePreparationStatus(issueId: string): Promise<GuidePreparationStatus> {
  return request<GuidePreparationStatus>(`/api/issues/${encodeURIComponent(issueId)}/guide-preparation`);
}

export function resumeGuidePreparation(issueId: string): Promise<GuidePreparationStatus> {
  return request<GuidePreparationStatus>(`/api/issues/${encodeURIComponent(issueId)}/guide-preparation`, {
    method: "POST",
  });
}

export function prepareReaderGuideBatch(issueId: string, limit = 8): Promise<ReaderGuideBatchResponse> {
  return request<ReaderGuideBatchResponse>(`/api/issues/${encodeURIComponent(issueId)}/guides`, {
    method: "POST",
    body: JSON.stringify({ limit }),
  });
}

export function prepareSectionTranslations(issueId: string): Promise<SectionTranslationBatchResponse> {
  return request<SectionTranslationBatchResponse>(`/api/issues/${encodeURIComponent(issueId)}/section-translations`, {
    method: "POST",
  });
}

export function fetchArticle(issueId: string, articleId: string): Promise<Article> {
  return request<Article>(
    `/api/issues/${encodeURIComponent(issueId)}/articles/${encodeURIComponent(articleId)}`,
  );
}

export function setArticleStatus(
  issueId: string,
  articleId: string,
  status: ArticleStatus,
): Promise<Article> {
  return request<Article>(
    `/api/issues/${encodeURIComponent(issueId)}/articles/${encodeURIComponent(articleId)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
}

export function translateParagraph(input: TranslationRequest, signal?: AbortSignal): Promise<TranslationResponse> {
  return request<TranslationResponse>("/api/translate", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function assistSelection(input: SelectionAssistRequest): Promise<SelectionAssistResponse> {
  return request<SelectionAssistResponse>("/api/selection-assist", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function askReadingAssistant(input: ReadingAssistantRequest): Promise<ReadingAssistantResponse> {
  return request<ReadingAssistantResponse>("/api/reading-assistant", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function explainWordContext(input: WordContextRequest): Promise<WordContextResponse> {
  return request<WordContextResponse>("/api/word-context", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function lookupDictionary(word: string): Promise<DictionaryLookupResponse> {
  return request<DictionaryLookupResponse>(`/api/dictionary?word=${encodeURIComponent(word)}`);
}
