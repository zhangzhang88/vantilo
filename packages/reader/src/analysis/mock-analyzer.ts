import type { AnalyzerProvider } from "./analyzer.js";
import type { Article, ArticleAnalysis, ValueLevel } from "../shared/types.js";

const stopWords = new Set([
  "the", "and", "that", "with", "from", "this", "have", "has", "will", "would", "were", "been", "being",
  "for", "are", "but", "not", "they", "their", "them", "into", "than", "then", "when", "where", "which", "while",
  "about", "after", "before", "because", "could", "should", "over", "under", "more", "most", "some", "such", "also",
  "its", "his", "her", "our", "your", "you", "who", "what", "how", "why", "all", "any", "can", "may", "might",
]);

function sentenceWords(sentence: string): string[] {
  return sentence.match(/[A-Za-z]+(?:[’'][A-Za-z]+)*/g) ?? [];
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function clip(text: string, max = 220): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function levelScore(level: ValueLevel): number {
  return level === "High" ? 3 : level === "Medium" ? 2 : 1;
}

function englishValue(article: Article, sentenceCount: number): ValueLevel {
  if (article.wordCount >= 500 && article.wordCount <= 1_800 && sentenceCount >= 8) return "High";
  if (article.wordCount >= 250 && sentenceCount >= 4) return "Medium";
  return "Low";
}

function contentValue(article: Article): ValueLevel {
  const prioritySections = new Set(["Leaders", "China", "Finance & economics", "Business", "Science & technology", "International"]);
  if (prioritySections.has(article.section) && article.wordCount >= 500) return "High";
  if (article.wordCount >= 350) return "Medium";
  return "Low";
}

function languageCandidates(allSentences: string[]) {
  const preferred = allSentences.filter((sentence) => {
    const words = sentenceWords(sentence).length;
    return words >= 12 && words <= 34 && sentence.length <= 260;
  });
  const pool = preferred.length >= 3 ? preferred : allSentences;
  return pool.slice(0, 5).map((text) => ({
    text,
    reason: `原文真实句子，约 ${sentenceWords(text).length} 个词；长度适中，适合观察表达与句法结构。`,
  }));
}

function usefulExpressions(candidateSentences: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const sentence of candidateSentences) {
    const words = sentenceWords(sentence).map((word) => word.toLowerCase());
    for (let index = 0; index < words.length - 1; index += 1) {
      const first = words[index];
      const second = words[index + 1];
      if (stopWords.has(first) || stopWords.has(second)) continue;
      if (first.length < 4 && second.length < 4) continue;
      const phrase = `${first} ${second}`;
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      result.push(phrase);
      if (result.length >= 8) return result;
    }
  }

  return result;
}

export class MockAnalyzer implements AnalyzerProvider {
  readonly name = "mock";

  analyze(article: Article): ArticleAnalysis {
    const allSentences = sentences(article.bodyText);
    const candidateSentences = languageCandidates(allSentences);
    const english = englishValue(article, allSentences.length);
    const content = contentValue(article);
    const intro = article.subtitle || allSentences[0] || article.title;
    const evidence = allSentences.slice(1, 4).map((sentence) => clip(sentence, 190));

    return {
      summary: `Mock Analyzer 暂以原文导语作为内容概览：${clip(intro)}`,
      why: `这是一篇 ${article.section} 栏目的真实文章。当前仅用篇幅、栏目和文本结构做粗粒度判断，适合先验证你是否愿意继续处理这类内容。`,
      englishValue: english,
      contentValue: content,
      recommendedRank: null,
      language: {
        sentences: candidateSentences,
        expressions: usefulExpressions(candidateSentences.map((item) => item.text)),
      },
      idea: {
        question: `这篇文章真正需要回答的问题可以先从标题出发：${article.title.replace(/[?？]$/, "")}？`,
        claim: `Mock Analyzer 暂不做真实观点判断。核心判断候选来自原文导语：“${clip(intro, 260)}”`,
        evidence: evidence.length ? evidence : ["当前 Mock Analyzer 未抽取到足够长的证据句，后续真实 Analyzer 需要补足。"],
        boundary: "V0.1 使用 Mock Analyzer；这里展示的是流程占位与真实原文片段，不应当被视为已经完成事实核查或论证评估。",
        questions: [
          `作者对“${article.title.replace(/[?？]$/, "")}”的回答依赖哪些前提？`,
          "文章最关键的因果关系是什么，是否存在替代解释？",
          "作者使用的证据能支持多大范围的结论？",
          `这个 ${article.section} 主题与中国普通人的生活有什么真实连接？`,
          "如果把它发展成中文内容，最需要额外核查哪一条事实？",
        ],
        angles: [
          `从“${clip(article.title, 58)}”追问一个普通人能理解的问题`,
          `把 ${article.section} 的宏观判断拆成“它如何影响个人”的解释`,
        ],
      },
      provider: "mock",
    };
  }

  rank(articles: Article[]): void {
    const sectionBoost = new Set(["Leaders", "China", "Finance & economics", "Science & technology"]);
    const scored = articles
      .filter((article) => article.analysis)
      .map((article, index) => ({
        article,
        index,
        score:
          levelScore(article.analysis!.englishValue) +
          levelScore(article.analysis!.contentValue) +
          (sectionBoost.has(article.section) ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 5);

    scored.forEach(({ article }, index) => {
      if (article.analysis) article.analysis.recommendedRank = index + 1;
    });
  }
}
