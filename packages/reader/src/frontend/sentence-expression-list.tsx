import { useState } from "react";
import type { SentenceExpression, SentenceExpressionKind } from "../shared/types";
import type { SentenceTranslationRecord, SentenceTranslationTarget } from "./sentence-translation-state";
import type { SavedSelection } from "./selection-state";
import { hasSavedSentenceExpression, findSavedSentenceExpression } from "./sentence-expression-vocabulary";
import { savedSelectionFamiliarity, type FamiliarityLevel } from "./selection-state";

const expressionLabels: Record<SentenceExpressionKind, string> = { collocation: "固定搭配", pattern: "常用句型", contextual: "本句表达", keyword: "关键词" };

export function SentenceExpressionList({ translation, target, selections, onSave, onFamiliarityChange }: {
  translation: SentenceTranslationRecord; target: SentenceTranslationTarget | null; selections: SavedSelection[];
  onSave: (expression: SentenceExpression) => Promise<void>;
  onFamiliarityChange?: (text: string, familiarity: FamiliarityLevel) => void;
}) {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save(expression: SentenceExpression) {
    const key = `${target?.key}:${expression.text}`;
    if (pending[key]) return;
    setPending((current) => ({ ...current, [key]: true })); setErrors((current) => ({ ...current, [key]: "" }));
    try { await onSave(expression); }
    catch { setErrors((current) => ({ ...current, [key]: "未能补齐释义，尚未加入，请重试。" })); }
    finally { setPending((current) => ({ ...current, [key]: false })); }
  }
  if (!translation.expressions?.length || !target) return null;
  return <details className="sentence-expression-details" key={target.key}>
    <summary>关键表达 · 为什么这样理解</summary>
    <ul>{translation.expressions.map((expression, index) => {
      const saved = hasSavedSentenceExpression(selections, target, expression);
      const exists = Boolean(findSavedSentenceExpression(selections, target, expression));
      const savedRecord = findSavedSentenceExpression(selections, target, expression);
      const familiarity = savedRecord ? savedSelectionFamiliarity(savedRecord) : null;
      const ignored = familiarity === 0;
      const key = `${target.key}:${expression.text}`;
      return <li key={`${expression.text}:${index}`}>
        <div className="sentence-expression-heading"><strong lang="en">{expression.text}</strong>{expression.kind && expressionLabels[expression.kind] && <span className="sentence-expression-kind">{expressionLabels[expression.kind]}</span>}<button className={`sentence-expression-save${ignored ? " is-ignored" : ""}`} disabled={(saved && !ignored) || pending[key]} aria-label={ignored ? `“${expression.text}”已忽视，点击重新加入` : saved ? `“${expression.text}”已加入词汇` : `将“${expression.text}”加入词汇`} onClick={() => ignored ? onFamiliarityChange?.(expression.text, 1) : void save(expression)}>{pending[key] ? "正在补充释义…" : ignored ? "已忽视 · 重新加入" : saved ? "✓ 已加入" : exists ? "补充释义" : "＋ 加入词汇"}</button></div>
        {expression.meaningZh && <p className="sentence-expression-meaning">{expression.meaningZh}</p>}
        <p>{expression.explanationZh}</p>
        {errors[key] && <p role="alert">{errors[key]}</p>}
      </li>;
    })}</ul>
  </details>;
}
