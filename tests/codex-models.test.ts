import { describe, expect, it } from 'vitest';
import { compatibleReasoningEffort, isScrollViewportNearEnd, nextMenuItemIndex } from '../src/model/codex-models';

describe('model and conversation viewport behavior', () => {
  it('retains reasoning effort only if the target model supports it', () => {
    const model = { efforts: [{ id: 'low', description: '' }, { id: 'high', description: '' }] };
    expect(compatibleReasoningEffort(model, 'high')).toBe('high');
    expect(compatibleReasoningEffort(model, 'medium')).toBeNull();
    expect(compatibleReasoningEffort(undefined, 'high')).toBeNull();
    expect(compatibleReasoningEffort(model, null)).toBeNull();
  });
  it('moves focus with arrows and Home/End without trapping Tab', () => {
    expect(nextMenuItemIndex('ArrowDown', -1, 3)).toBe(0);
    expect(nextMenuItemIndex('ArrowUp', 0, 3)).toBe(2);
    expect(nextMenuItemIndex('Home', 2, 3)).toBe(0);
    expect(nextMenuItemIndex('End', 0, 3)).toBe(2);
    expect(nextMenuItemIndex('Tab', 0, 3)).toBeNull();
    expect(nextMenuItemIndex('ArrowDown', -1, 0)).toBeNull();
  });
  it('follows output only while the reader remains near the bottom', () => {
    expect(isScrollViewportNearEnd(900, 100, 1000)).toBe(true);
    expect(isScrollViewportNearEnd(500, 100, 1000)).toBe(false);
    expect(isScrollViewportNearEnd(500, 100, 1000, 400)).toBe(true);
  });
});
