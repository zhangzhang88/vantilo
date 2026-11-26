import { splitChineseSpeech } from "./chinese-listening-state";
import { applyAudiobookSmartSkipWithMap } from "./audiobook-smart-skip";
import type { AudiobookSmartSkip } from "../shared/audiobook-bridge";

export interface HighlightedSpeechSpan {
  before: string;
  active: string;
  after: string;
}

export interface LiveSpeechHighlight {
  beforeSentence: string;
  sentenceBeforeChar: string;
  activeChar: string;
  sentenceAfterChar: string;
  afterSentence: string;
}

export interface SpeechChunkTarget {
  chunkIndex: number;
  chunkText: string;
  speechOffset: number;
}

const CJK_CHAR = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;
const SHORT_PAUSE = /[，、：,:]/;
const SENTENCE_END = /[。！？!?；;…\n]/;
const CLOSING_PUNCT = /[」』”’）》】〉）)\]"']/;
const IGNORABLE_PUNCT = /[\s「」『』“”‘’《》【】〈〉（）()[\]"'—–-]/;
const LEADING_SKIP = /[\s，、：,:。！？!?；;…）」』”’》】〉)\]]/;

interface TimedChar {
  char: string;
  start: number;
  end: number;
  weight: number;
  speakable: boolean;
}

function classifyChar(char: string): { weight: number; speakable: boolean } {
  if (CJK_CHAR.test(char)) return { weight: 1.0, speakable: true };
  if (LATIN_OR_DIGIT.test(char)) return { weight: 0.38, speakable: true };
  if (SENTENCE_END.test(char)) return { weight: 1.15, speakable: false };
  if (SHORT_PAUSE.test(char)) return { weight: 0.55, speakable: false };
  if (IGNORABLE_PUNCT.test(char)) return { weight: 0.08, speakable: false };
  return { weight: 0.6, speakable: true };
}

function findChunkRange(
  text: string,
  chunkIndex?: number,
  chunkText?: string,
): { start: number; end: number } | null {
  if (!text) return null;

  const chunks = splitChineseSpeech(text);
  const cleanChunkText = chunkText?.trim();
  const ranges: Array<{ start: number; end: number; chunk: string }> = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const start = text.indexOf(chunk, cursor);
    if (start === -1) continue;
    const end = start + chunk.length;
    ranges.push({ start, end, chunk });
    cursor = end;
  }

  if (chunkIndex !== undefined && chunkIndex >= 0 && chunkIndex < ranges.length) {
    const candidate = ranges[chunkIndex];
    if (!cleanChunkText || candidate.chunk.trim() === cleanChunkText) {
      return { start: candidate.start, end: candidate.end };
    }
    const withinChunk = text.indexOf(cleanChunkText, candidate.start);
    if (withinChunk !== -1 && withinChunk + cleanChunkText.length <= candidate.end) {
      return { start: withinChunk, end: withinChunk + cleanChunkText.length };
    }
  }

  if (cleanChunkText) {
    const direct = text.indexOf(cleanChunkText);
    if (direct !== -1) {
      return { start: direct, end: direct + cleanChunkText.length };
    }
  }

  if (chunkIndex !== undefined && chunkIndex >= 0 && chunkIndex < ranges.length) {
    return { start: ranges[chunkIndex].start, end: ranges[chunkIndex].end };
  }

  if (ranges.length > 0) {
    return { start: ranges[0].start, end: ranges[0].end };
  }

  return { start: 0, end: text.length };
}

/** Locate the active spoken speech chunk inside a paragraph. */
export function splitHighlightedSpeechChunk(
  text: string,
  chunkIndex?: number,
  chunkText?: string,
  smartSkip?: AudiobookSmartSkip,
): HighlightedSpeechSpan | null {
  if (smartSkip) {
    const mapped = applyAudiobookSmartSkipWithMap(text, smartSkip);
    if (!mapped.text.trim()) return null;
    const filteredRange = findChunkRange(mapped.text, chunkIndex, chunkText);
    if (!filteredRange) return null;
    const rawRange = mapped.mapFilteredRangeToRaw(filteredRange.start, filteredRange.end);
    if (!rawRange) return null;
    return {
      before: text.slice(0, rawRange.start),
      active: text.slice(rawRange.start, rawRange.end),
      after: text.slice(rawRange.end),
    };
  }
  const range = findChunkRange(text, chunkIndex, chunkText);
  if (!range) return null;
  return {
    before: text.slice(0, range.start),
    active: text.slice(range.start, range.end),
    after: text.slice(range.end),
  };
}

export interface ParagraphSentenceRange {
  start: number;
  end: number;
  text: string;
}

function splitSentenceRanges(chunk: string, baseOffset: number): Array<{ start: number; end: number }> {
  const chars = Array.from(chunk);
  const segments: Array<{ start: number; end: number }> = [];
  let segStart = baseOffset;
  let offset = baseOffset;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const nextOffset = offset + char.length;
    const isEnd = SENTENCE_END.test(char)
      || (char === "." && i + 1 < chars.length && (/\s/.test(chars[i + 1]) || CLOSING_PUNCT.test(chars[i + 1])));
    if (isEnd) {
      let endOffset = nextOffset;
      while (i + 1 < chars.length && (CLOSING_PUNCT.test(chars[i + 1]) || SENTENCE_END.test(chars[i + 1]))) {
        i += 1;
        endOffset += chars[i].length;
      }
      segments.push({ start: segStart, end: endOffset });
      segStart = endOffset;
      offset = endOffset;
      continue;
    }
    offset = nextOffset;
  }
  if (segStart < baseOffset + chunk.length) {
    segments.push({ start: segStart, end: baseOffset + chunk.length });
  }
  return segments.length ? segments : [{ start: baseOffset, end: baseOffset + chunk.length }];
}

/** Split a paragraph (or sub-slice) into contiguous sentence ranges preserving exact character offsets. */
export function splitParagraphSentences(text: string, baseOffset = 0): ParagraphSentenceRange[] {
  if (!text) return [];
  return splitSentenceRanges(text, 0).map(({ start, end }) => ({
    start: baseOffset + start,
    end: baseOffset + end,
    text: text.slice(start, end),
  }));
}

/** Locate BOTH the active sentence AND the exact currently spoken character inside
 * that sentence, driven by sample-accurate chunk playback seconds and duration. */
export function splitLiveSpeechHighlight(
  text: string,
  chunkIndex?: number,
  chunkText?: string,
  chunkSeconds?: number,
  chunkDuration?: number,
  smartSkip?: AudiobookSmartSkip,
): LiveSpeechHighlight | null {
  const mapped = smartSkip ? applyAudiobookSmartSkipWithMap(text, smartSkip) : null;
  const effectiveText = mapped ? mapped.text : text;
  if (!effectiveText.trim()) return null;
  const chunkRange = findChunkRange(effectiveText, chunkIndex, chunkText);
  if (!chunkRange) return null;

  const chunkSlice = effectiveText.slice(chunkRange.start, chunkRange.end);
  const rawChars = Array.from(chunkSlice);
  if (!rawChars.length) return null;

  const timedChars: TimedChar[] = [];
  let offset = chunkRange.start;
  let totalWeight = 0;
  for (const char of rawChars) {
    const { weight, speakable } = classifyChar(char);
    const end = offset + char.length;
    timedChars.push({ char, start: offset, end, weight, speakable });
    totalWeight += weight;
    offset = end;
  }

  const seconds = Math.max(0, chunkSeconds ?? 0);
  const estimatedDuration = Math.max(0.25, totalWeight / 4.6);
  const effectiveDuration = chunkDuration && chunkDuration > 0
    ? chunkDuration
    : Math.max(estimatedDuration, seconds + 0.18);
  const progress = Math.max(0, Math.min(0.9999, seconds / effectiveDuration));
  const targetWeight = progress * totalWeight;

  let activeIndex = timedChars.length - 1;
  let cumulative = 0;
  for (let i = 0; i < timedChars.length; i++) {
    cumulative += timedChars[i].weight;
    if (cumulative >= targetWeight) {
      activeIndex = i;
      break;
    }
  }

  const sentenceRanges = splitSentenceRanges(chunkSlice, chunkRange.start);
  const rawActiveChar = timedChars[activeIndex];
  const sentence = sentenceRanges.find(
    range => rawActiveChar.start >= range.start && rawActiveChar.start < range.end,
  ) ?? sentenceRanges[sentenceRanges.length - 1];

  // Snap punctuation/whitespace onto the nearest speakable character inside the same sentence.
  let chosen = rawActiveChar;
  if (!chosen.speakable) {
    const inSentence = timedChars.filter(
      item => item.speakable && item.start >= sentence.start && item.end <= sentence.end,
    );
    if (inSentence.length > 0) {
      let nearest = inSentence[0];
      let bestDistance = Math.abs(nearest.start - chosen.start);
      for (const candidate of inSentence) {
        const distance = Math.abs(candidate.start - chosen.start);
        if (distance < bestDistance || (distance === bestDistance && candidate.start <= chosen.start)) {
          nearest = candidate;
          bestDistance = distance;
        }
      }
      chosen = nearest;
    }
  }

  if (mapped) {
    const rawSentence = mapped.mapFilteredRangeToRaw(sentence.start, sentence.end);
    const rawChar = mapped.mapFilteredRangeToRaw(chosen.start, chosen.end);
    if (!rawSentence || !rawChar) return null;
    const rawSentenceStart = Math.min(rawSentence.start, rawChar.start);
    const rawSentenceEnd = Math.max(rawSentence.end, rawChar.end);
    return {
      beforeSentence: text.slice(0, rawSentenceStart),
      sentenceBeforeChar: text.slice(rawSentenceStart, rawChar.start),
      activeChar: text.slice(rawChar.start, rawChar.end),
      sentenceAfterChar: text.slice(rawChar.end, rawSentenceEnd),
      afterSentence: text.slice(rawSentenceEnd),
    };
  }

  return {
    beforeSentence: text.slice(0, sentence.start),
    sentenceBeforeChar: text.slice(sentence.start, chosen.start),
    activeChar: text.slice(chosen.start, chosen.end),
    sentenceAfterChar: text.slice(chosen.end, sentence.end),
    afterSentence: text.slice(sentence.end),
  };
}

/** Resolve a character selection offset inside a paragraph into the exact speech
 * chunk and intra-chunk start offset so "听此处" begins speaking right from the
 * selected spot rather than restarting from the beginning of the paragraph. */
export function resolveSpeechChunkForOffset(
  paragraphText: string,
  charOffset: number,
  selectedText?: string,
  smartSkip?: AudiobookSmartSkip,
): SpeechChunkTarget | undefined {
  if (!paragraphText.trim()) return undefined;
  let rawOffset = Number.isFinite(charOffset) ? Math.max(0, Math.min(Math.floor(charOffset), paragraphText.length)) : 0;
  if ((!Number.isFinite(charOffset) || charOffset < 0) && selectedText?.trim()) {
    const matched = paragraphText.indexOf(selectedText.trim());
    if (matched !== -1) rawOffset = matched;
  }

  let effectiveText = paragraphText;
  let offset = rawOffset;
  if (smartSkip) {
    const mapped = applyAudiobookSmartSkipWithMap(paragraphText, smartSkip);
    if (!mapped.text.trim()) return undefined;
    effectiveText = mapped.text;
    offset = mapped.mapRawOffset(rawOffset);
  }

  const chunks = splitChineseSpeech(effectiveText);
  if (!chunks.length) return undefined;

  const ranges: Array<{ chunkIndex: number; start: number; end: number; chunk: string }> = [];
  let cursor = 0;
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const start = effectiveText.indexOf(chunk, cursor);
    if (start === -1) continue;
    const end = start + chunk.length;
    ranges.push({ chunkIndex, start, end, chunk });
    cursor = end;
  }
  if (!ranges.length) return undefined;

  let rangeIndex = ranges.findIndex(item => offset < item.end);
  if (rangeIndex === -1) rangeIndex = ranges.length - 1;
  const target = ranges[rangeIndex];

  let speechOffset = Math.max(0, offset - target.start);
  while (speechOffset < target.chunk.length && LEADING_SKIP.test(target.chunk[speechOffset])) {
    speechOffset += 1;
  }

  const tail = target.chunk.slice(speechOffset);
  if (!tail.trim()) {
    const next = ranges[rangeIndex + 1];
    if (next) return { chunkIndex: next.chunkIndex, chunkText: next.chunk, speechOffset: 0 };
    return { chunkIndex: target.chunkIndex, chunkText: target.chunk, speechOffset: 0 };
  }

  return {
    chunkIndex: target.chunkIndex,
    chunkText: tail,
    speechOffset,
  };
}
