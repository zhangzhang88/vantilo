export interface ScienceArticleImage {
  id: string;
  sourceUrl: string | null;
  alt: string;
  width?: number;
  height?: number;
  status: "cached" | "link-only" | "unavailable";
  mediaId?: string;
  mimeType?: string;
  reason?: string;
}

export type ScienceArticleBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "list"; ordered: boolean; items: ScienceArticleBlock[][] }
  | { kind: "figure"; images: ScienceArticleImage[]; caption: string; captionPlacement: "before" | "after" }
  | { kind: "table"; caption: string; rows: { section: "head" | "body" | "foot"; cells: { header: boolean; rowSpan: number; colSpan: number; blocks: ScienceArticleBlock[] }[] }[] }
  | { kind: "source-link"; label: string };

export interface ScienceArticle {
  id: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  sourceName: string;
  sourceUrl: string;
  credit: string;
  savedAt: string;
  paragraphs: string[];
  /** Missing on articles collected by the original text-only importer. */
  contentVersion?: 2;
  blocks?: ScienceArticleBlock[];
  updatedAt?: string;
}

export function scienceArticleImages(blocks: ScienceArticleBlock[]): ScienceArticleImage[] {
  return blocks.flatMap((block): ScienceArticleImage[] => {
    if (block.kind === "figure") return block.images;
    if (block.kind === "list") return block.items.flatMap(scienceArticleImages);
    if (block.kind === "table") return block.rows.flatMap((row) => row.cells.flatMap((cell) => scienceArticleImages(cell.blocks)));
    return [];
  });
}

export function scienceArticleMediaUrl(articleId: string, mediaId: string): string {
  return `/api/science-articles/${encodeURIComponent(articleId)}/media/${encodeURIComponent(mediaId)}`;
}
