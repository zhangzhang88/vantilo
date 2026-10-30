export interface ReaderSentence {
  key: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface SentenceReadingPosition {
  documentId: string;
  contentFingerprint: string;
  sentenceIndex: number;
  sentenceKey: string;
  sentenceFingerprint: string;
  paragraphIndex: number;
  startOffset: number;
  updatedAt?: string;
  previousSentenceFingerprint?: string;
  nextSentenceFingerprint?: string;
}

function fingerprint(value: string): string {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    first = Math.imul(first ^ character, 16777619);
    second = Math.imul(second ^ character, 2246822519);
  }
  return `${value.length}:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function readerDocumentContentFingerprint(paragraphs: string[]): string {
  return fingerprint(paragraphs.map((paragraph) => `${paragraph.length}:${paragraph}`).join("\u0000"));
}

export function readerSentenceFingerprint(text: string): string {
  return fingerprint(text);
}

export function createSentenceReadingPosition(
  documentId: string,
  paragraphs: string[],
  sentences: ReaderSentence[],
  sentenceIndex: number,
): SentenceReadingPosition | undefined {
  const sentence = sentences[sentenceIndex];
  if (!documentId || !sentence) return undefined;
  return {
    documentId,
    contentFingerprint: readerDocumentContentFingerprint(paragraphs),
    sentenceIndex,
    sentenceKey: sentence.key,
    sentenceFingerprint: readerSentenceFingerprint(sentence.text),
    paragraphIndex: sentence.paragraphIndex,
    startOffset: sentence.startOffset,
    updatedAt: new Date().toISOString(),
    ...(sentences[sentenceIndex - 1] ? { previousSentenceFingerprint: readerSentenceFingerprint(sentences[sentenceIndex - 1].text) } : {}),
    ...(sentences[sentenceIndex + 1] ? { nextSentenceFingerprint: readerSentenceFingerprint(sentences[sentenceIndex + 1].text) } : {}),
  };
}

export function resolveSentenceReadingPosition(
  position: SentenceReadingPosition | undefined,
  documentId: string,
  paragraphs: string[],
  sentences: ReaderSentence[],
): number | undefined {
  if (!position || position.documentId !== documentId || !sentences.length) return undefined;
  const currentFingerprint = readerDocumentContentFingerprint(paragraphs);
  if (position.contentFingerprint === currentFingerprint) {
    const candidate = sentences[position.sentenceIndex];
    return candidate && candidate.key === position.sentenceKey
      && readerSentenceFingerprint(candidate.text) === position.sentenceFingerprint
      ? position.sentenceIndex : undefined;
  }

  const matches = sentences.flatMap((sentence, index) =>
    readerSentenceFingerprint(sentence.text) === position.sentenceFingerprint ? [{ sentence, index }] : []);
  if (matches.length === 1) return matches[0].index;
  if (matches.length < 2) return undefined;

  const contextualMatches = matches.filter(({ index }) => {
    const hasNeighborFingerprint = position.previousSentenceFingerprint !== undefined || position.nextSentenceFingerprint !== undefined;
    const previousMatches = position.previousSentenceFingerprint === undefined
      ? index === 0
      : Boolean(sentences[index - 1] && readerSentenceFingerprint(sentences[index - 1].text) === position.previousSentenceFingerprint);
    const nextMatches = position.nextSentenceFingerprint === undefined
      ? index === sentences.length - 1
      : Boolean(sentences[index + 1] && readerSentenceFingerprint(sentences[index + 1].text) === position.nextSentenceFingerprint);
    return hasNeighborFingerprint && previousMatches && nextMatches;
  });
  return contextualMatches.length === 1 ? contextualMatches[0].index : undefined;
}

export function buildReaderSentences(paragraphs: string[]): ReaderSentence[] {
  const sentences: ReaderSentence[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    let cursor = 0;
    const pushRange = (rawStart: number, rawEnd: number) => {
      let startOffset = rawStart;
      let endOffset = rawEnd;
      while (startOffset < endOffset && /\s/.test(paragraph[startOffset] ?? "")) startOffset += 1;
      while (endOffset > startOffset && /\s/.test(paragraph[endOffset - 1] ?? "")) endOffset -= 1;
      if (endOffset <= startOffset) return;
      sentences.push({
        key: `${paragraphIndex}:${startOffset}`,
        paragraphIndex,
        startOffset,
        endOffset,
        text: paragraph.slice(startOffset, endOffset),
      });
    };

    for (let index = 0; index < paragraph.length; index += 1) {
      if (!/[.!?]/.test(paragraph[index] ?? "")) continue;
      pushRange(cursor, index + 1);
      cursor = index + 1;
    }

    if (cursor < paragraph.length) pushRange(cursor, paragraph.length);
  });

  return sentences;
}

export function readerSentenceIndexForOffset(
  sentences: ReaderSentence[],
  paragraphIndex: number,
  startOffset: number,
): number {
  return sentences.findIndex((sentence) =>
    sentence.paragraphIndex === paragraphIndex
    && startOffset >= sentence.startOffset
    && startOffset < sentence.endOffset,
  );
}

export function readerSentenceProgress(sentenceIndex: number, totalSentences: number): number {
  if (!Number.isInteger(sentenceIndex) || !Number.isInteger(totalSentences)) return 0;
  if (sentenceIndex < 0 || totalSentences <= 0 || sentenceIndex >= totalSentences) return 0;
  if (sentenceIndex === totalSentences - 1) return 100;
  return Math.max(0, Math.min(99, Math.round(((sentenceIndex + 1) / totalSentences) * 100)));
}
