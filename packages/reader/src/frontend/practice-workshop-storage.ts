import { parseOrderedExercises, type OrderedExercise } from "../shared/ordered-practice";
import { getReaderStorage } from "./reader-storage";

export interface SavedPractice {
  id: string; title: string; article: string; prompt: string; providerLabel: string;
  exercises: OrderedExercise[]; createdAt: string; updatedAt: string;
}
export const PRACTICE_WORKSHOP_KEY = "vantilo:practice-workshop:v1";
export const PRACTICE_WORKSHOP_PROMPT_KEY = "vantilo:practice-workshop-prompt:v1";

function validPractice(value: unknown): value is SavedPractice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string,unknown>;
  try {
    return typeof v.id === "string" && v.id.length > 0 && v.id.length <= 100
      && typeof v.title === "string" && !!v.title.trim() && v.title.length <= 200
      && typeof v.article === "string" && !!v.article.trim() && v.article.length <= 2000
      && typeof v.prompt === "string" && v.prompt.length <= 16000
      && typeof v.providerLabel === "string" && v.providerLabel.length <= 160
      && typeof v.createdAt === "string" && typeof v.updatedAt === "string"
      && Number.isFinite(Date.parse(v.createdAt)) && Number.isFinite(Date.parse(v.updatedAt))
      && Array.isArray(v.exercises) && parseOrderedExercises(v.exercises,{ requirePronunciation:true }).length === v.exercises.length;
  } catch { return false; }
}

/** Fail closed rather than replacing unreadable or future-version practice records. */
export function loadSavedPractices(storage = getReaderStorage()): SavedPractice[] {
  const raw = storage.getItem(PRACTICE_WORKSHOP_KEY);
  if (storage.getSnapshot().readFailed) throw new Error("无法读取练习数据，已停止保存以保护原内容");
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("保存的练习格式异常，已保留原数据");
  const data = value as { version?: unknown; items?: unknown };
  if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 30 || !data.items.every(validPractice))
    throw new Error("保存的练习格式异常，已保留原数据");
  const items = data.items as SavedPractice[];
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("保存的练习存在重复 ID，已保留原数据");
  return items;
}

export function saveSavedPractices(items: SavedPractice[], storage = getReaderStorage()): void {
  // Confirm the old record remains readable before writing; never silently reset it.
  loadSavedPractices(storage);
  if (!Array.isArray(items) || items.length > 30 || !items.every(validPractice) || new Set(items.map(item => item.id)).size !== items.length)
    throw new Error("要保存的练习无效或超过 30 份");
  storage.setItem(PRACTICE_WORKSHOP_KEY, JSON.stringify({ version: 1,items }));
  if (storage.getPendingKeys().includes(PRACTICE_WORKSHOP_KEY)) throw new Error("本地存储暂时无法写入，练习尚未安全保存");
}

export function saveWorkshopPrompt(prompt: string, storage = getReaderStorage()): void {
  if (typeof prompt !== "string" || prompt.length < 100 || prompt.length > 16000 || prompt.split("{{ARTICLE_JSON}}").length !== 2) throw new Error("提示词必须包含一次 {{ARTICLE_JSON}} 占位符，长度为 100–16000 字符");
  if (storage.getSnapshot().readFailed) throw new Error("本地读取失败，不能保存提示词");
  storage.setItem(PRACTICE_WORKSHOP_PROMPT_KEY, prompt);
  if (storage.getPendingKeys().includes(PRACTICE_WORKSHOP_PROMPT_KEY)) throw new Error("提示词尚未安全保存");
}
