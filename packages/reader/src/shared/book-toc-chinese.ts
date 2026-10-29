export interface BookTocChineseTitles {
  parts: Record<string, string>;
  chapters: Record<string, string>;
}

export interface BookTocChineseStatus {
  state: "idle" | "running" | "ready" | "error";
  titles: BookTocChineseTitles;
  profileId: string | null;
  model: string | null;
  error: string | null;
}
