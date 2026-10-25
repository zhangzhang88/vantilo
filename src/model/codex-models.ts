export interface CodexModelChoice {
  id: string;
  displayName: string;
  defaultEffort: string | null;
  efforts: readonly { id: string; description: string }[];
}

/** Keep a requested effort only when the newly selected model's live catalog supports it. */
export function compatibleReasoningEffort(model: Pick<CodexModelChoice, 'efforts'> | null | undefined, current: string | null): string | null {
  return current && model?.efforts.some(effort => effort.id === current) ? current : null;
}

/** Roving focus movement for the menu's arrow/Home/End keys. */
export function nextMenuItemIndex(key: string, currentIndex: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (currentIndex + 1 + count) % count;
  if (key === 'ArrowUp') return (currentIndex - 1 + count) % count;
  return null;
}

export function isScrollViewportNearEnd(scrollTop: number, clientHeight: number, scrollHeight: number, threshold = 96): boolean {
  return Number.isFinite(scrollTop) && Number.isFinite(clientHeight) && Number.isFinite(scrollHeight) && scrollHeight - scrollTop - clientHeight <= threshold;
}
