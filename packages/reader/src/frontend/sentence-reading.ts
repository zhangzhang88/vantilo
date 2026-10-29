export interface ReaderSentence {
  key: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
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
