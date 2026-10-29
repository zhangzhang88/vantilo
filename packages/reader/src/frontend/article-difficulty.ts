import { savedSelectionFamiliarity, type FamiliarityLevel, type SavedSelection } from "./selection-state";

export type ArticleDifficultyLevel = "easy" | "moderate" | "hard" | "challenge";

export interface ArticleVocabularyProfile {
  totalTerms: number;
  newTerms: number;
  learningTerms: number;
  knownTerms: number;
  ignoredTerms: number;
  newPercent: number;
  learningPercent: number;
  knownPercent: number;
  ignoredPercent: number;
  difficulty: ArticleDifficultyLevel;
  difficultyLabel: "轻松" | "适中" | "较难" | "挑战";
}

const WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

function normalizeWord(text: string): string {
  return text.trim().replace(/’/g, "'").toLocaleLowerCase("en-US");
}

function uniqueArticleTerms(paragraphs: string[]): string[] {
  const terms = new Set<string>();
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(WORD_PATTERN)) terms.add(normalizeWord(match[0]));
  }
  return [...terms];
}

function vocabularyStateMap(selections: SavedSelection[]): Map<string, FamiliarityLevel> {
  const states = new Map<string, FamiliarityLevel>();
  for (const selection of selections) {
    const normalized = normalizeWord(selection.text);
    if (!normalized || !new RegExp(`^[A-Za-z]+(?:['’][A-Za-z]+)*$`).test(selection.text.trim())) continue;
    states.set(normalized, savedSelectionFamiliarity(selection));
  }
  return states;
}

function percentage(count: number, total: number): number {
  return total ? Math.round((count / total) * 100) : 0;
}

function difficultyForNewPercent(newPercent: number): Pick<ArticleVocabularyProfile, "difficulty" | "difficultyLabel"> {
  if (newPercent <= 10) return { difficulty: "easy", difficultyLabel: "轻松" };
  if (newPercent <= 20) return { difficulty: "moderate", difficultyLabel: "适中" };
  if (newPercent <= 35) return { difficulty: "hard", difficultyLabel: "较难" };
  return { difficulty: "challenge", difficultyLabel: "挑战" };
}

export function buildArticleVocabularyProfile(
  paragraphs: string[],
  selections: SavedSelection[],
): ArticleVocabularyProfile {
  const terms = uniqueArticleTerms(paragraphs);
  const states = vocabularyStateMap(selections);
  let newTerms = 0;
  let learningTerms = 0;
  let knownTerms = 0;
  let ignoredTerms = 0;

  for (const term of terms) {
    const state = states.get(term);
    if (state === undefined) newTerms += 1;
    else if (state === 0) ignoredTerms += 1;
    else if (state === 5) knownTerms += 1;
    else learningTerms += 1;
  }

  const totalTerms = terms.length;
  const newPercent = percentage(newTerms, totalTerms);
  return {
    totalTerms,
    newTerms,
    learningTerms,
    knownTerms,
    ignoredTerms,
    newPercent,
    learningPercent: percentage(learningTerms, totalTerms),
    knownPercent: percentage(knownTerms, totalTerms),
    ignoredPercent: percentage(ignoredTerms, totalTerms),
    ...difficultyForNewPercent(newPercent),
  };
}
