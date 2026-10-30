const HAN = /\p{Script=Han}/u;
const PART_OF_SPEECH = /^(?:(?:[a-z]\.?\s*)?(?:noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|numeral|auxiliary|determiner|article)\b\s*|(?:n|v|adj|adv|pron|prep|conj|interj|num|aux|art|det|vt|vi|phr|abbr)\.\s*)/i;

/** Pick a learner-facing Chinese gloss without changing the complete dictionary response. */
export function firstChineseDictionaryMeaning(definitions: unknown): string | undefined {
  function* texts(value: unknown, depth = 0): Generator<string> {
    if (depth > 5 || value == null) return;
    if (typeof value === "string") { yield value; return; }
    if (Array.isArray(value)) { for (const item of value) yield* texts(item, depth + 1); return; }
    if (typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    // The native full entry also contains examples and pronunciation metadata.
    if (item.source === "macos-dictionary-full") return;
    for (const key of ["definition", "definitions", "definitionsZh", "meaning", "text"]) {
      if (key in item) yield* texts(item[key], depth + 1);
    }
  }
  for (const text of texts(definitions)) {
    for (const part of text.split(/[；;\n①-⑳]+/u)) {
      let candidate = part
        .replace(/<[^>]*>/gu, " ")
        .replace(/[（(][^）)]*[A-Za-z][^）)]*[）)]/gu, " ")
        .replace(PART_OF_SPEECH, "")
        .replace(/^\s*(?:[①-⑳⑴-⒇\d]+[.、)）]?\s*)+/u, "")
        .replace(/\s*(?:[①-⑳⑴-⒇\d]+[.、)）]?\s*)+$/u, "")
        .trim();
      if (!candidate || !HAN.test(candidate) || /[A-Za-z]/u.test(candidate)) continue;
      if (candidate === "展开查看完整词条") continue;
      if (/^[\p{P}\p{S}\d\s]+$/u.test(candidate)) continue;
      return candidate;
    }
  }
  return undefined;
}

export interface WordGlossCandidates {
  cachedAiMeaning?: string;
  generatedAiMeaning?: string;
  generationStatus?: "idle" | "loading" | "success" | "error";
  dictionaryDefinitions?: unknown;
}

export function selectWordGloss(candidates: WordGlossCandidates): { meaning: string; source: "ai" | "dictionary" } | undefined {
  const generated = candidates.generationStatus === "success" ? candidates.generatedAiMeaning?.trim() : undefined;
  if (generated && HAN.test(generated)) return { meaning: generated, source: "ai" };
  const cached = candidates.cachedAiMeaning?.trim();
  if (cached && HAN.test(cached)) return { meaning: cached, source: "ai" };
  const fallback = firstChineseDictionaryMeaning(candidates.dictionaryDefinitions);
  return fallback ? { meaning: fallback, source: "dictionary" } : undefined;
}
