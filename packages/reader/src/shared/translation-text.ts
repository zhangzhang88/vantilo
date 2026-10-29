/** Decorations remain in the document, but are not translation targets. */
export function isTranslatableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Only classify a leading Book number when the following text confirms the chapter title. */
export function isChapterNumberParagraph(text: string, index: number, chapterTitle: string | undefined, nextParagraph: string | undefined): boolean {
  if (index !== 0 || !chapterTitle || !/^\d+$/.test(text.trim())) return false;
  const match = chapterTitle.trim().match(/^(?:chapter\s+)?(\d+)[\s.:：—–-]+(.+)$/i);
  const normalize = (value: string) => value.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  return Boolean(match && match[1] === text.trim() && normalize(match[2]) === normalize(nextParagraph ?? ""));
}
