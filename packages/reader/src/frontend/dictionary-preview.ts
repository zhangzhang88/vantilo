import { firstChineseDictionaryMeaning } from "./dictionary-meaning";

type PreviewDefinition = { definition: string; source: string; partOfSpeech?: string | null };
export type DictionaryPreviewMeaning = { meaning: string; partOfSpeech?: string };

/** Limit display only; the original dictionary and its complete entry remain untouched. */
export function dictionaryPreviewMeanings(definitions: PreviewDefinition[]): DictionaryPreviewMeaning[] {
  const result: DictionaryPreviewMeaning[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (definition.source === "macos-dictionary-full" || typeof definition.definition !== "string") continue;
    let partOfSpeech = definition.partOfSpeech?.trim() || undefined;
    for (const line of definition.definition.split(/\n/u)) {
      const heading = line.trim().match(/^(?:[A-F]\.\s*)?(?:(?:in)?transitive\s+|phrasal\s+|auxiliary\s+|modal\s+)?(?:noun|verb|adjective|adverb|pronoun|preposition|interjection|exclamation|conjunction|determiner|article|numeral|number|abbreviation|prefix|suffix)\s*$/iu);
      if (heading) { partOfSpeech = heading[0].trim(); continue; }
      for (const part of line.split(/[；;①-⑳]+/u)) {
        const meaning = firstChineseDictionaryMeaning(part);
        if (!meaning || seen.has(meaning)) continue;
        seen.add(meaning);
        result.push({ meaning, ...(partOfSpeech ? { partOfSpeech } : {}) });
        if (result.length === 3) return result;
      }
    }
  }
  return result;
}
