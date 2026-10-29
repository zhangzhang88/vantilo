import { describe, expect, it } from "vitest";
import { canonicalIssueId, publicationFromFilename, publicationIssueId } from "./publication.js";
import { fixedSectionNameZh } from "./section-translations.js";

describe("publication identity", () => {
  it("recognizes the four supported magazine filenames", () => {
    expect(publicationFromFilename("TheEconomist.2026.09.19.epub")?.id).toBe("economist");
    expect(publicationFromFilename("new_yorker.2026.09.21.epub")?.id).toBe("new-yorker");
    expect(publicationFromFilename("Atlantic_2026.09.02.epub")?.id).toBe("atlantic");
    expect(publicationFromFilename("wired_2026.09.02.epub")?.id).toBe("wired");
  });

  it("keeps recurring section translations scoped to each publication", () => {
    expect(fixedSectionNameZh("new-yorker", "Goings On")).toBe("城中指南");
    expect(fixedSectionNameZh("new-yorker", "The Talk of the Town")).toBe("城中话题");
    expect(fixedSectionNameZh("atlantic", "Features")).toBe("专题");
    expect(fixedSectionNameZh("wired", "The Big Story")).toBe("重磅报道");
    expect(fixedSectionNameZh("new-yorker", "Future Desk")).toBeNull();
  });

  it("creates publication-aware ids and migrates legacy Economist ids", () => {
    expect(publicationIssueId("wired", "2026-09-02")).toBe("wired:2026-09-02");
    expect(canonicalIssueId("2026-09-19")).toBe("economist:2026-09-19");
    expect(canonicalIssueId("atlantic:2026-09-02")).toBe("atlantic:2026-09-02");
  });
});
