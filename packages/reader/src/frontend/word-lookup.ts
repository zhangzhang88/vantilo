export interface ClickableWordSegment {
  text: string;
  isWord: boolean;
  startOffset: number;
}

const WORD_PATTERN = /[A-Za-z]+(?:[-'’][A-Za-z]+)*/g;

export function isDictionaryWord(text: string): boolean {
  return /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/.test(text.trim());
}

export function clickableWordSegments(text: string, baseOffset = 0): ClickableWordSegment[] {
  if (!text) return [];
  const segments: ClickableWordSegment[] = [];
  let cursor = 0;
  WORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(text))) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), isWord: false, startOffset: baseOffset + cursor });
    }
    segments.push({ text: match[0], isWord: true, startOffset: baseOffset + match.index });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isWord: false, startOffset: baseOffset + cursor });
  }
  return segments.length ? segments : [{ text, isWord: false, startOffset: baseOffset }];
}
