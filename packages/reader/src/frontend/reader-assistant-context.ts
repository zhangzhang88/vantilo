export interface ReaderAssistantContext {
  documentId: string;
  paragraphCount: number;
  currentParagraphIndex: () => number | null;
  locateParagraph: (paragraphIndex: number) => void;
}
