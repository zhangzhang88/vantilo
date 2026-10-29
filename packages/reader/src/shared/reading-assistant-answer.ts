export interface ReadingAssistantAnswerPresentation {
  answer: string;
  paragraphIndexes: number[];
}

function boundedParagraphIndexes(indexes: number[], paragraphCount: number): number[] {
  return [...new Set(indexes
    .filter((index) => Number.isInteger(index) && index >= 0 && index < paragraphCount))]
    .slice(0, 8);
}

function oneBasedParagraphIndexes(values: number[], paragraphCount: number): number[] {
  return boundedParagraphIndexes(values.map((value) => value - 1), paragraphCount);
}

function paragraphIndexesFromLeakedJson(text: string, paragraphCount: number): number[] {
  const match = text.match(/["']?paragraphs["']?\s*:\s*\[([^\]]*)\]/i);
  if (!match) return [];
  const values = (match[1].match(/\d+/g) ?? []).map(Number);
  return oneBasedParagraphIndexes(values, paragraphCount);
}

function paragraphIndexesFromMarkers(text: string, paragraphCount: number): number[] {
  const values = [...text.matchAll(/\[P(\d+)\]/gi)].map((match) => Number(match[1]));
  return oneBasedParagraphIndexes(values, paragraphCount);
}

function decodeJsonStringFragment(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function answerTextWithoutStructuredNoise(text: string): string {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const malformedObject = cleaned.match(/^\s*\{\s*"answer"\s*:\s*"([\s\S]*)"\s*,\s*"paragraphs"\s*:\s*\[[^\]]*\]\s*\}?\s*$/i);
  const answerSource = malformedObject ? decodeJsonStringFragment(malformedObject[1]) : cleaned;
  return answerSource
    .replace(/\s*"?\s*,\s*"paragraphs"\s*:\s*\[[^\]]*\]\s*\}?\s*$/i, "")
    .replace(/\s*\[P\d+\]/gi, "")
    .replace(/[ \t]+(?=\n)/g, "")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeReadingAssistantAnswer(input: {
  text: string;
  paragraphCount: number;
  paragraphIndexes?: number[];
}): ReadingAssistantAnswerPresentation {
  const explicitIndexes = boundedParagraphIndexes(input.paragraphIndexes ?? [], input.paragraphCount);
  const leakedJsonIndexes = paragraphIndexesFromLeakedJson(input.text, input.paragraphCount);
  const markerIndexes = paragraphIndexesFromMarkers(input.text, input.paragraphCount);
  return {
    answer: answerTextWithoutStructuredNoise(input.text),
    paragraphIndexes: explicitIndexes.length
      ? explicitIndexes
      : leakedJsonIndexes.length
        ? leakedJsonIndexes
        : markerIndexes,
  };
}
