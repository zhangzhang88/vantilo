import { learningTokens } from "./learning-material.js";

export interface OrderedExercise { sentence: string; chinese: string; pronunciation?: string; }

/** Structural validation only; this does not certify grammar, translation, or teaching quality. */
export function parseOrderedExercises(value: unknown, options: { requirePronunciation?: boolean } = {}): OrderedExercise[] {
  if (!Array.isArray(value) || !value.length || value.length > 80) throw new Error("练习列表必须包含 1–80 条题目");
  return value.map((item: unknown, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`第 ${index + 1} 条练习格式无效`);
    const { sentence, chinese, pronunciation } = item as Record<string, unknown>;
    if (typeof sentence !== "string" || typeof chinese !== "string" || !sentence.trim() || sentence.length > 250 || !chinese.trim() || chinese.length > 250 || !/^[A-Za-z0-9\s'’.,!?;:&\-]+$/.test(sentence) || !/[㐀-鿿]/.test(chinese)) throw new Error(`第 ${index + 1} 条练习格式无效`);
    const english = sentence.trim(), tokens = learningTokens(english);
    if (!tokens.length || tokens.length > 100 || tokens.some(token => token.text.length > 100)) throw new Error(`第 ${index + 1} 条练习无法逐词输入`);
    if (options.requirePronunciation && pronunciation === undefined) throw new Error(`第 ${index + 1} 条练习缺少音标`);
    if (pronunciation !== undefined && (typeof pronunciation !== "string" || pronunciation.length > 750 || !/^\/[^\/<>\r\n]{1,748}\/$/u.test(pronunciation.trim()))) throw new Error(`第 ${index + 1} 条练习音标格式无效`);
    if (typeof pronunciation === "string" && /^\/\s*\/$/u.test(pronunciation.trim())) throw new Error(`第 ${index + 1} 条练习音标格式无效`);
    return { sentence: english, chinese: chinese.trim(), ...(pronunciation === undefined ? {} : { pronunciation: pronunciation.trim() }) };
  });
}
