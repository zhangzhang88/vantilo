import type { Article, ArticleAnalysis } from "../shared/types.js";

export interface AnalyzerProvider {
  readonly name: string;
  analyze(article: Article): ArticleAnalysis;
  rank(articles: Article[]): void;
}
