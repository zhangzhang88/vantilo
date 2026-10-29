import { describe, expect, it } from "vitest";
import { resolveParagraphNavigationTarget } from "./reader-paragraph-navigation";

const metrics = [
  { index: 0, top: 100, bottom: 180 },
  { index: 1, top: 220, bottom: 320 },
  { index: 2, top: 360, bottom: 470 },
];

describe("reader paragraph navigation", () => {
  it("moves to the adjacent paragraph when the viewport anchor is inside a paragraph", () => {
    expect(resolveParagraphNavigationTarget(metrics, 270, 1)).toBe(2);
    expect(resolveParagraphNavigationTarget(metrics, 270, -1)).toBe(0);
    expect(resolveParagraphNavigationTarget(metrics, 140, -1)).toBeNull();
    expect(resolveParagraphNavigationTarget(metrics, 410, 1)).toBeNull();
  });

  it("chooses the next directional paragraph when the anchor is between or outside paragraphs", () => {
    expect(resolveParagraphNavigationTarget(metrics, 200, 1)).toBe(1);
    expect(resolveParagraphNavigationTarget(metrics, 200, -1)).toBe(0);
    expect(resolveParagraphNavigationTarget(metrics, 40, 1)).toBe(0);
    expect(resolveParagraphNavigationTarget(metrics, 500, -1)).toBe(2);
    expect(resolveParagraphNavigationTarget(metrics, 40, -1)).toBeNull();
    expect(resolveParagraphNavigationTarget(metrics, 500, 1)).toBeNull();
  });
});
