const SEARCH_URL = 'https://www.google.com/search?q=';

/** Browser address-bar convenience only; Electron main revalidates every resolved URL before navigation. */
export function resolveBrowserAddress(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 2048) return null;
  const looksLikeHost = /^(localhost|\[[\da-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#]|$)/i.test(text);
  if (looksLikeHost || /^[a-z][a-z\d+.-]*:/i.test(text)) {
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  return `${SEARCH_URL}${encodeURIComponent(text)}`;
}
