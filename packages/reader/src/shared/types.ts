export type ValueLevel = "High" | "Medium" | "Low";
export type ArticleStatus = "save" | "process" | "skip" | null;
export type PublicationId = "economist" | "new-yorker" | "atlantic" | "wired";


export interface LanguageSentence {
  text: string;
  reason: string;
}

export interface LanguageMining {
  sentences: LanguageSentence[];
  expressions: string[];
}

export interface IdeaMining {
  question: string;
  claim: string;
  evidence: string[];
  boundary: string;
  questions: string[];
  angles: string[];
}

export interface ArticleAnalysis {
  summary: string;
  why: string;
  englishValue: ValueLevel;
  contentValue: ValueLevel;
  recommendedRank: number | null;
  language: LanguageMining;
  idea: IdeaMining;
  provider: "mock";
}

export interface ReaderGuide {
  titleZh: string;
  subtitleZh: string | null;
  summaryZh: string;
  model: string;
  provider: "easycliproxy";
  generatedAt: string;
}

export interface ArticleImage {
  id: string;
  role: "lead" | "inline";
  afterParagraphIndex: number;
  alt: string;
  caption: string | null;
}

export interface Article {
  id: string;
  issueId: string;
  publicationId: PublicationId;
  href: string;
  section: string;
  kicker: string | null;
  title: string;
  subtitle: string | null;
  author: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  bodyText: string;
  wordCount: number;
  readerGuide?: ReaderGuide | null;
  status: ArticleStatus;
  analysis: ArticleAnalysis | null;
}

export interface IssueRecord {
  schemaVersion: 1;
  id: string;
  publicationId: PublicationId;
  publicationName: string;
  filename: string;
  sourceFingerprint: string;
  title: string;
  date: string;
  label: string;
  sections: string[];
  sectionTranslations?: Record<string, string>;
  articles: Article[];
}

export interface StatusCounts {
  save: number;
  process: number;
  skip: number;
}

export interface IssueSummary {
  id: string;
  publicationId: PublicationId;
  publicationName: string;
  filename: string;
  title: string;
  date: string;
  label: string;
  articleCount: number;
  sections: string[];
  markedCount: number;
  statusCounts: StatusCounts;
}

export interface IssueFile {
  id: string;
  publicationId: PublicationId;
  publicationName: string;
  date: string;
  label: string;
  filename: string;
  filePath: string;
  fingerprint: string;
}

export type EpubImportStatus = "ready" | "duplicate" | "unsupported" | "invalid" | "imported";

export interface EpubImportPreview {
  filename: string;
  status: EpubImportStatus;
  issueId?: string;
  publicationId?: PublicationId;
  publicationName?: string;
  date?: string;
  label?: string;
  articleCount?: number;
  sectionCount?: number;
  hasCover: boolean;
  coverDataUrl?: string;
  message: string;
}

export type EpubReplacementStatus = "ready" | "mismatch" | "unsupported" | "invalid" | "missing" | "replaced";

export interface EpubReplacementPreview extends Omit<EpubImportPreview, "status"> {
  status: EpubReplacementStatus;
  targetIssueId: string;
  existingFilename?: string;
}

export interface IssueDeletionResponse {
  deleted: true;
  issueId: string;
  filename: string;
}

export interface StatusUpdateBody {
  status: ArticleStatus;
}

export type SentenceExpressionKind = "collocation" | "pattern" | "contextual" | "keyword";
export interface SentenceExpression { kind?: SentenceExpressionKind; text: string; meaningZh?: string; meaningVersion?: 2; explanationZh: string; }

export interface TranslationRequest {
  mode?: "paragraph" | "sentence";
  paragraphContext?: string;
  paragraphTranslationReference?: string;
  expectedProfileId?: string;
  expectedModel?: string;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface TranslationResponse {
  expressions?: SentenceExpression[];
  translation: string;
  profileId?: string;
  model: string;
  provider: "easycliproxy";
}

export interface AiProviderProfilePublic {
  id: string;
  name: string;
  description: string;
  responsesUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export interface AiProviderSettingsPublic {
  version: 1;
  activeProfileId: string | null;
  profiles: AiProviderProfilePublic[];
}

export interface AiProviderProfileDraft {
  id?: string;
  name: string;
  description: string;
  responsesUrl: string;
  model: string;
  apiKey?: string;
}

export interface AiProviderSaveRequest {
  profile: AiProviderProfileDraft;
  activate?: boolean;
}

export interface AiProviderSaveResponse extends AiProviderSettingsPublic {
  savedProfileId: string;
}

export interface AiProviderConnectionTestResponse {
  ok: boolean;
  model: string;
  output?: string;
  error?: string;
}

export interface AiProviderModelsResponse {
  models: string[];
  modelsUrl: string;
}

export type SelectionAssistAction = "translate" | "explain";

export interface SelectionAssistRequest {
  action: SelectionAssistAction;
  text: string;
  context?: string;
  articleTitle?: string;
}

export interface SelectionAssistResponse {
  action: SelectionAssistAction;
  result: string;
  model: string;
  provider: "easycliproxy";
}

export type ReadingAssistantMode = "quick" | "deep";

export interface ReadingAssistantTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ReadingAssistantRequest {
  document?: import("./reading-document-identity.js").ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  question: string;
  mode: ReadingAssistantMode;
  currentParagraphIndex?: number;
  history?: ReadingAssistantTurn[];
}

export interface ReadingAssistantResponse {
  answer: string;
  paragraphIndexes: number[];
  mode: ReadingAssistantMode;
  model: string;
  provider: "easycliproxy";
}

export interface WordContextRequest {
  verifyConsistency?: boolean;
  sentenceTranslationZh?: string;
  expressionExplanationZh?: string;
  suggestedMeaningZh?: string;
  text: string;
  sentence: string;
  paragraph?: string;
  contextBefore?: string;
  contextAfter?: string;
  articleTitle?: string;
}

export interface WordContextResponse {
  sentenceTranslationZh?: string;
  meaningZh: string;
  explanationZh: string;
  meaningEn: string;
  explanationEn: string;
  examplesEn: string[];
  partOfSpeech: string;
  model: string;
  provider: "easycliproxy";
}

export interface DictionaryDefinition {
  definition: string;
  partOfSpeech: string | null;
  example: string | null;
  source: "youdao" | "dictionaryapi";
}

export interface DictionaryLookupResponse {
  word: string;
  phonetic: string | null;
  usPhonetic: string | null;
  ukPhonetic: string | null;
  usAudioUrl: string;
  ukAudioUrl: string;
  definitionsZh: DictionaryDefinition[];
  definitionsEn: DictionaryDefinition[];
  englishDefinitionSource: "exact" | "base-form" | null;
  englishLookupWord: string | null;
  youdaoAvailable: boolean;
  dictionaryApiAvailable: boolean;
}

export type GuidePreparationState = "idle" | "running" | "partial" | "error" | "complete";

export interface GuidePreparationStatus {
  issueId: string;
  state: GuidePreparationState;
  total: number;
  completed: number;
  remaining: number;
  sectionTotal: number;
  sectionCompleted: number;
  sectionRemaining: number;
  attemptCount: number;
  failedArticleIds: string[];
  lastAttemptAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface GuidePreparationStatusCache {
  version: 1;
  issues: Record<string, GuidePreparationStatus>;
}

export interface ReaderGuideBatchResponse {
  issue: IssueRecord;
  generated: number;
  remaining: number;
}

export interface SectionTranslationCache {
  version: 1;
  publications: Partial<Record<PublicationId, Record<string, string>>>;
}

export interface SectionTranslationBatchResponse {
  issue: IssueRecord;
  generated: number;
  remaining: number;
}
