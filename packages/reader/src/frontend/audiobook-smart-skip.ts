import {
  DEFAULT_AUDIOBOOK_SMART_SKIP,
  isAudiobookSmartSkip,
  type AudiobookSmartSkip,
} from "../shared/audiobook-bridge";

export const AUDIOBOOK_SMART_SKIP_KEY = "vantilo-audiobook-smart-skip-v1";

export function loadAudiobookSmartSkip(storage: Pick<Storage, "getItem">): AudiobookSmartSkip {
  try {
    const raw = storage.getItem(AUDIOBOOK_SMART_SKIP_KEY);
    if (!raw) return { ...DEFAULT_AUDIOBOOK_SMART_SKIP };
    const parsed: unknown = JSON.parse(raw);
    if (isAudiobookSmartSkip(parsed)) return { ...parsed };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const partial = parsed as Partial<AudiobookSmartSkip>;
      return {
        tables: typeof partial.tables === "boolean" ? partial.tables : DEFAULT_AUDIOBOOK_SMART_SKIP.tables,
        urls: typeof partial.urls === "boolean" ? partial.urls : DEFAULT_AUDIOBOOK_SMART_SKIP.urls,
        parentheses: typeof partial.parentheses === "boolean" ? partial.parentheses : DEFAULT_AUDIOBOOK_SMART_SKIP.parentheses,
        brackets: typeof partial.brackets === "boolean" ? partial.brackets : DEFAULT_AUDIOBOOK_SMART_SKIP.brackets,
        braces: typeof partial.braces === "boolean" ? partial.braces : DEFAULT_AUDIOBOOK_SMART_SKIP.braces,
      };
    }
  } catch {
    // Keep defaults when localStorage is unavailable or malformed.
  }
  return { ...DEFAULT_AUDIOBOOK_SMART_SKIP };
}

export function saveAudiobookSmartSkip(storage: Pick<Storage, "setItem">, settings: AudiobookSmartSkip): void {
  if (!isAudiobookSmartSkip(settings)) throw new Error("朗读智能跳过设置无效");
  storage.setItem(AUDIOBOOK_SMART_SKIP_KEY, JSON.stringify(settings));
}

const URL_CHAR = String.raw`[A-Za-z0-9._~:/?#@!$&*+=%-]`;
const URL_PATTERN = new RegExp(
  `(?:https?:\\/\\/${URL_CHAR}+|www\\.${URL_CHAR}+|\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:com|org|net|edu|gov|io|ai|co|cn|uk|me|app|dev|tv|news|info)(?:\\/${URL_CHAR}*)?)`,
  "giu",
);

interface MappedChar {
  char: string;
  rawIndex: number;
  synthetic?: boolean;
}

function replaceMapped(
  items: MappedChar[],
  pattern: RegExp,
  replace: (match: RegExpExecArray, source: MappedChar[]) => MappedChar[],
): MappedChar[] {
  const text = items.map(item => item.char).join("");
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const out: MappedChar[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    for (let i = last; i < start; i++) out.push(items[i]);
    out.push(...replace(match, items));
    last = end;
  }
  if (last === 0) return items;
  for (let i = last; i < items.length; i++) out.push(items[i]);
  return out;
}

function stripBalancedPairsMapped(items: MappedChar[], pattern: RegExp): MappedChar[] {
  let current = items;
  for (let pass = 0; pass < 3; pass++) {
    const next = replaceMapped(current, pattern, (match, source) => [{ char: " ", rawIndex: source[match.index].rawIndex, synthetic: true }]);
    if (next === current) break;
    current = next;
  }
  return current;
}

export interface SmartSkipMappedText {
  text: string;
  mapRawOffset: (rawOffset: number) => number;
  mapFilteredRangeToRaw: (filteredStart: number, filteredEnd: number) => { start: number; end: number } | null;
}

/** Apply smart-skip rules while retaining an exact UTF-16 offset map between
 * the visible paragraph and the filtered speech text. */
export function applyAudiobookSmartSkipWithMap(text: string, settings: AudiobookSmartSkip): SmartSkipMappedText {
  if (!text) return { text: "", mapRawOffset: () => 0, mapFilteredRangeToRaw: () => null };
  let items: MappedChar[] = Array.from({ length: text.length }, (_, rawIndex) => ({
    char: text[rawIndex],
    rawIndex,
  }));
  if (settings.urls) {
    items = replaceMapped(items, URL_PATTERN, (match, source) => [{ char: " ", rawIndex: source[match.index].rawIndex, synthetic: true }]);
  }
  if (settings.parentheses) {
    items = stripBalancedPairsMapped(items, /（[^（）]*）|\([^()]*\)/gu);
  }
  if (settings.brackets) {
    items = stripBalancedPairsMapped(items, /【[^【】]*】|\[[^[\]]*\]/gu);
  }
  if (settings.braces) {
    items = stripBalancedPairsMapped(items, /｛[^｛｝]*｝|\{[^{}]*\}/gu);
  }
  items = replaceMapped(items, /[ \t]{2,}/g, (match, source) => [{
    char: " ",
    rawIndex: source[match.index].rawIndex,
    synthetic: source.slice(match.index, match.index + match[0].length).some(item => item.synthetic),
  }]);
  items = replaceMapped(items, /\s+([，。！？、；：,.!?;:])/g, (match, source) => {
    const end = match.index + match[0].length;
    return source.slice(end - match[1].length, end);
  });
  items = replaceMapped(items, /([，、；：])\s*([，。！？、；：])/g, (match, source) => {
    const end = match.index + match[0].length;
    return source.slice(end - match[2].length, end);
  });
  let start = 0;
  while (start < items.length && /\s/.test(items[start].char)) start += 1;
  let end = items.length;
  while (end > start && /\s/.test(items[end - 1].char)) end -= 1;
  const trimmed = items.slice(start, end);
  const filtered = trimmed.map(item => item.char).join("");
  return {
    text: filtered,
    mapRawOffset: (rawOffset: number) => {
      if (!Number.isFinite(rawOffset) || rawOffset <= 0) return 0;
      const target = Math.floor(rawOffset);
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i].rawIndex >= target) return i;
      }
      return trimmed.length;
    },
    mapFilteredRangeToRaw: (filteredStart: number, filteredEnd: number) => {
      if (!trimmed.length) return null;
      const s = Math.max(0, Math.min(Math.floor(filteredStart), trimmed.length));
      const e = Math.max(s, Math.min(Math.floor(filteredEnd), trimmed.length));
      if (s >= e) return null;
      let firstReal = -1;
      let lastReal = -1;
      for (let i = s; i < e; i++) {
        if (!trimmed[i].synthetic) {
          if (firstReal === -1) firstReal = i;
          lastReal = i;
        }
      }
      if (firstReal !== -1 && lastReal !== -1) {
        return {
          start: trimmed[firstReal].rawIndex,
          end: Math.min(text.length, trimmed[lastReal].rawIndex + 1),
        };
      }
      return {
        start: trimmed[s].rawIndex,
        end: Math.min(text.length, trimmed[e - 1].rawIndex + 1),
      };
    },
  };
}

/** Apply user-configured smart-skip rules (URLs, parentheses, brackets, braces)
 * to speech text right before synthesis while leaving visible reading text untouched. */
export function applyAudiobookSmartSkip(text: string, settings: AudiobookSmartSkip): string {
  return applyAudiobookSmartSkipWithMap(text, settings).text;
}
