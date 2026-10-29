export function bookSourceUrl(bookId: string, chapterId: string, fragment = ""): string {
  return `/api/books/${encodeURIComponent(bookId)}/original-content?chapterId=${encodeURIComponent(chapterId)}${fragment ? `#${encodeURIComponent(fragment)}` : ""}`;
}

export function bookResourceUrl(bookId: string, entryPath: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/original-resource?path=${encodeURIComponent(entryPath)}`;
}
