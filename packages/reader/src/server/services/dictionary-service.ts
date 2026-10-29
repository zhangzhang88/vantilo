import type { DictionaryDefinition, DictionaryLookupResponse } from "../../shared/types.js";

export interface DictionaryProvider {
  lookup(word: string): Promise<DictionaryLookupResponse>;
}

interface DictionaryProviderOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface CacheEntry {
  value: DictionaryLookupResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEFINITIONS = 8;

function cleanText(value: unknown): string {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join("；");
  if (typeof value !== "string") return "";
  return value.replace(/<br\s*\/?>/gi, "；").replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function pushDefinition(
  target: DictionaryDefinition[],
  seen: Set<string>,
  definition: unknown,
  source: DictionaryDefinition["source"],
  partOfSpeech: unknown = null,
  example: unknown = null,
) {
  const text = cleanText(definition);
  if (!text) return;
  const key = text.toLocaleLowerCase("en-US");
  if (seen.has(key)) return;
  seen.add(key);
  target.push({
    definition: text,
    partOfSpeech: typeof partOfSpeech === "string" && partOfSpeech.trim() ? partOfSpeech.trim() : null,
    example: typeof example === "string" && example.trim() ? example.trim() : null,
    source,
  });
}

export function parseYoudaoDictionaryPayload(payload: unknown): {
  usPhonetic: string | null;
  ukPhonetic: string | null;
  phonetic: string | null;
  definitions: DictionaryDefinition[];
} {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const ec = root.ec && typeof root.ec === "object" ? root.ec as Record<string, unknown> : {};
  const words = Array.isArray(ec.word) ? ec.word : [];
  const word = words[0] && typeof words[0] === "object" ? words[0] as Record<string, unknown> : {};
  const usPhonetic = cleanText(word.usphone) || null;
  const ukPhonetic = cleanText(word.ukphone) || null;
  const phonetic = cleanText(word.phone) || usPhonetic || ukPhonetic || null;
  const definitions: DictionaryDefinition[] = [];
  const seen = new Set<string>();
  const trs = Array.isArray(word.trs) ? word.trs : [];
  for (const item of trs) {
    if (!item || typeof item !== "object") continue;
    const tr = Array.isArray((item as Record<string, unknown>).tr) ? (item as Record<string, unknown>).tr as unknown[] : [];
    const first = tr[0] && typeof tr[0] === "object" ? tr[0] as Record<string, unknown> : {};
    const l = first.l && typeof first.l === "object" ? first.l as Record<string, unknown> : {};
    pushDefinition(definitions, seen, l.i, "youdao");
  }
  return { usPhonetic, ukPhonetic, phonetic, definitions: definitions.slice(0, MAX_DEFINITIONS) };
}

export function parseYoudaoSuggestPayload(payload: unknown, query: string): DictionaryDefinition[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const definitions: DictionaryDefinition[] = [];
  const seen = new Set<string>();
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  const sorted = [...entries].sort((a, b) => {
    const entryA = a && typeof a === "object" ? cleanText((a as Record<string, unknown>).entry).toLocaleLowerCase("en-US") : "";
    const entryB = b && typeof b === "object" ? cleanText((b as Record<string, unknown>).entry).toLocaleLowerCase("en-US") : "";
    return Number(entryB === normalizedQuery) - Number(entryA === normalizedQuery);
  });
  for (const item of sorted) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const entryWord = cleanText(entry.entry).toLocaleLowerCase("en-US");
    if (entryWord && entryWord !== normalizedQuery) continue;
    pushDefinition(definitions, seen, entry.explain, "youdao", entry.pos);
  }
  return definitions.slice(0, 4);
}

export function parseFreeDictionaryPayload(payload: unknown): {
  phonetic: string | null;
  definitions: DictionaryDefinition[];
} {
  const entries = Array.isArray(payload) ? payload : [];
  let phonetic: string | null = null;
  const definitions: DictionaryDefinition[] = [];
  const seen = new Set<string>();
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (!phonetic) phonetic = cleanText(entry.phonetic) || null;
    if (!phonetic && Array.isArray(entry.phonetics)) {
      for (const phoneticItem of entry.phonetics) {
        if (!phoneticItem || typeof phoneticItem !== "object") continue;
        const text = cleanText((phoneticItem as Record<string, unknown>).text);
        if (text) {
          phonetic = text;
          break;
        }
      }
    }
    const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];
    for (const meaningItem of meanings) {
      if (!meaningItem || typeof meaningItem !== "object") continue;
      const meaning = meaningItem as Record<string, unknown>;
      const partOfSpeech = cleanText(meaning.partOfSpeech) || null;
      const items = Array.isArray(meaning.definitions) ? meaning.definitions : [];
      for (const definitionItem of items) {
        if (!definitionItem || typeof definitionItem !== "object") continue;
        const definition = definitionItem as Record<string, unknown>;
        pushDefinition(definitions, seen, definition.definition, "dictionaryapi", partOfSpeech, definition.example);
        if (definitions.length >= MAX_DEFINITIONS) break;
      }
      if (definitions.length >= MAX_DEFINITIONS) break;
    }
    if (definitions.length >= MAX_DEFINITIONS) break;
  }
  return { phonetic, definitions };
}

export function dictionaryBaseFormCandidates(rawWord: string): string[] {
  const word = rawWord.trim().toLocaleLowerCase("en-US");
  if (!/^[a-z]+$/.test(word) || word.length < 4) return [];

  const candidates: string[] = [];
  const add = (candidate: string) => {
    if (candidate.length < 3 || candidate === word || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  if (word.endsWith("ied") && word.length > 4) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("ed") && word.length > 4) {
    const stem = word.slice(0, -2);
    add(stem);
    if (stem.length > 3 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
    add(word.slice(0, -1));
  }
  if (word.endsWith("ing") && word.length > 5) {
    const stem = word.slice(0, -3);
    add(stem);
    if (stem.length > 3 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
    add(`${stem}e`);
  }
  if (word.endsWith("ies") && word.length > 4) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 4) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
  } else if (word.endsWith("s") && word.length > 3) {
    add(word.slice(0, -1));
  }

  return candidates.slice(0, 4);
}

async function fetchJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class PublicDictionaryProvider implements DictionaryProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: DictionaryProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 1_200;
  }

  async lookup(rawWord: string): Promise<DictionaryLookupResponse> {
    const word = rawWord.trim();
    if (!word) throw new Error("Dictionary word is empty");
    const key = word.toLocaleLowerCase("en-US");
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const encoded = encodeURIComponent(word);
    const [youdaoJson, youdaoSuggest, freeDictionary] = await Promise.all([
      fetchJson(this.fetchImpl, `https://dict.youdao.com/jsonapi?q=${encoded}`, this.timeoutMs),
      fetchJson(this.fetchImpl, `https://dict.youdao.com/suggest?type=DESKdict&num=10&q=${encoded}&doctype=json`, this.timeoutMs),
      fetchJson(this.fetchImpl, `https://api.dictionaryapi.dev/api/v2/entries/en/${encoded}`, this.timeoutMs),
    ]);

    const youdao = parseYoudaoDictionaryPayload(youdaoJson);
    const suggestDefinitions = parseYoudaoSuggestPayload(youdaoSuggest, word);
    const exactFree = parseFreeDictionaryPayload(freeDictionary);
    let englishFree = exactFree;
    let englishDefinitionSource: DictionaryLookupResponse["englishDefinitionSource"] = exactFree.definitions.length ? "exact" : null;
    let englishLookupWord: string | null = exactFree.definitions.length ? word : null;
    let dictionaryApiAvailable = Boolean(freeDictionary);

    if (!englishFree.definitions.length) {
      const candidates = dictionaryBaseFormCandidates(word);
      const candidateResults = await Promise.all(candidates.map(async (candidate) => ({
        candidate,
        payload: await fetchJson(
          this.fetchImpl,
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(candidate)}`,
          this.timeoutMs,
        ),
      })));
      for (const { candidate, payload } of candidateResults) {
        if (payload) dictionaryApiAvailable = true;
        const candidateFree = parseFreeDictionaryPayload(payload);
        if (!candidateFree.definitions.length) continue;
        englishFree = candidateFree;
        englishDefinitionSource = "base-form";
        englishLookupWord = candidate;
        break;
      }
    }
    const definitionsZh = [...youdao.definitions];
    const seenZh = new Set(definitionsZh.map((item) => item.definition.toLocaleLowerCase("en-US")));
    for (const definition of suggestDefinitions) {
      const normalized = definition.definition.toLocaleLowerCase("en-US");
      if (!seenZh.has(normalized)) {
        definitionsZh.push(definition);
        seenZh.add(normalized);
      }
    }

    const value: DictionaryLookupResponse = {
      word,
      phonetic: exactFree.phonetic || youdao.phonetic,
      usPhonetic: youdao.usPhonetic || exactFree.phonetic,
      ukPhonetic: youdao.ukPhonetic || exactFree.phonetic,
      usAudioUrl: `https://dict.youdao.com/dictvoice?audio=${encoded}&type=2`,
      ukAudioUrl: `https://dict.youdao.com/dictvoice?audio=${encoded}&type=1`,
      definitionsZh: definitionsZh.slice(0, MAX_DEFINITIONS),
      definitionsEn: englishFree.definitions,
      englishDefinitionSource,
      englishLookupWord,
      youdaoAvailable: Boolean(youdaoJson || youdaoSuggest),
      dictionaryApiAvailable,
    };
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }
}

export function createPublicDictionaryProvider(): DictionaryProvider {
  return new PublicDictionaryProvider();
}
