export type ParagraphNavigationDirection = -1 | 1;

export interface ParagraphViewportMetric {
  index: number;
  top: number;
  bottom: number;
}

export function resolveParagraphNavigationTarget(
  metrics: ParagraphViewportMetric[],
  anchorY: number,
  direction: ParagraphNavigationDirection,
): number | null {
  if (!Number.isFinite(anchorY)) return null;
  const ordered = metrics
    .filter((metric) =>
      Number.isInteger(metric.index)
      && metric.index >= 0
      && Number.isFinite(metric.top)
      && Number.isFinite(metric.bottom)
      && metric.bottom >= metric.top,
    )
    .sort((left, right) => left.index - right.index);
  if (!ordered.length) return null;

  const containingPosition = ordered.findIndex((metric) => metric.top <= anchorY && metric.bottom >= anchorY);
  if (containingPosition >= 0) {
    const targetPosition = containingPosition + direction;
    return targetPosition >= 0 && targetPosition < ordered.length ? ordered[targetPosition].index : null;
  }

  if (direction === 1) {
    return ordered.find((metric) => metric.top > anchorY)?.index ?? null;
  }

  for (let position = ordered.length - 1; position >= 0; position -= 1) {
    if (ordered[position].bottom < anchorY) return ordered[position].index;
  }
  return null;
}
