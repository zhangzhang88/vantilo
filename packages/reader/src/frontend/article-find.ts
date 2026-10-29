export interface ArticleFindMatch {
  index: number;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
}

const MAX_ARTICLE_FIND_MATCHES = 500;

export function findArticleMatches(
  paragraphs: string[],
  query: string,
  maxMatches = MAX_ARTICLE_FIND_MATCHES,
): ArticleFindMatch[] {
  const needle = query.trim().toLocaleLowerCase("en-US");
  if (!needle || maxMatches <= 0) return [];

  const matches: ArticleFindMatch[] = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex] ?? "";
    const haystack = paragraph.toLocaleLowerCase("en-US");
    let fromIndex = 0;

    while (fromIndex <= haystack.length - needle.length) {
      const startOffset = haystack.indexOf(needle, fromIndex);
      if (startOffset < 0) break;
      const endOffset = startOffset + needle.length;
      matches.push({
        index: matches.length,
        paragraphIndex,
        startOffset,
        endOffset,
      });
      if (matches.length >= maxMatches) return matches;
      fromIndex = endOffset;
    }
  }

  return matches;
}
