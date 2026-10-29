export interface BookResearchReport {
  indexedChapters: number;
  indexedParagraphs: number;
  scopeChapterId?: string;
  queries: string[];
  read: Array<{ chapterId: string; title: string; paragraphs: number[] }>;
  truncated: boolean;
}
