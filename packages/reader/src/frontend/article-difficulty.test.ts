import { describe, expect, it } from "vitest";
import { buildArticleVocabularyProfile } from "./article-difficulty";
import type { SavedSelection } from "./selection-state";

function selection(text: string, familiarity: 0 | 1 | 2 | 3 | 4 | 5): SavedSelection {
  return {
    id: text,
    issueId: "economist:2026-09-19",
    articleId: "article-1",
    articleTitle: "Article",
    text,
    context: text,
    paragraphIndex: 0,
    createdAt: "2026-09-22T00:00:00.000Z",
    familiarity,
  };
}

describe("article vocabulary difficulty", () => {
  it("classifies unique article terms by the shared six-state vocabulary model", () => {
    const profile = buildArticleVocabularyProfile(
      ["AI helps people. People learn AI quickly."],
      [selection("AI", 5), selection("people", 3), selection("quickly", 0)],
    );

    expect(profile.totalTerms).toBe(5);
    expect(profile).toMatchObject({
      newTerms: 2,
      learningTerms: 1,
      knownTerms: 1,
      ignoredTerms: 1,
      newPercent: 40,
      learningPercent: 20,
      knownPercent: 20,
      ignoredPercent: 20,
      difficulty: "challenge",
      difficultyLabel: "挑战",
    });
  });

  it("does not treat a saved phrase as if each word in the phrase were already known", () => {
    const profile = buildArticleVocabularyProfile(
      ["artificial intelligence changes work"],
      [selection("artificial intelligence", 5)],
    );
    expect(profile.newPercent).toBe(100);
  });

  it("uses the new-word share for the compact difficulty bands", () => {
    const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
    const profile = buildArticleVocabularyProfile(
      [words.join(" ")],
      words.slice(0, 9).map((word) => selection(word, 5)),
    );
    expect(profile.newPercent).toBe(10);
    expect(profile.difficulty).toBe("easy");
  });
});
