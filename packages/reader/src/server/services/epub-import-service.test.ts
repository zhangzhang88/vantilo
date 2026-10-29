import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EpubImportService } from "./epub-import-service.js";
import { syntheticMagazineEpub } from "../../../tests/fixtures/synthetic-magazine.js";

const roots: string[] = [];
const sourceEpub = await syntheticMagazineEpub();

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("EPUB import service", () => {
  it("previews, copies and then rejects a duplicate without touching the source file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-import-service-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    await mkdir(issuesDir);
    const service = new EpubImportService(issuesDir);
    const source = Buffer.from(sourceEpub);
    const originalBytes = Buffer.from(source);
    const filename = "TheEconomist.2099.01.01.epub";

    const preview = await service.preview(filename, source);
    expect(preview).toMatchObject({
      filename,
      status: "ready",
      issueId: "economist:2099-01-01",
      publicationName: "The Economist",
      date: "2099-01-01",
      hasCover: true,
    });
    expect(preview.articleCount).toBeGreaterThan(10);
    expect(preview.sectionCount).toBeGreaterThan(1);

    const imported = await service.import(filename, source);
    expect(imported.status).toBe("imported");
    expect(await readdir(issuesDir)).toEqual([filename]);
    expect(source.equals(originalBytes)).toBe(true);

    const duplicate = await service.import(filename, source);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.message).toContain("不会重复导入");
    expect(await readdir(issuesDir)).toEqual([filename]);
  });

  it("serializes concurrent imports of the same issue even when filenames differ", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-import-concurrent-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    await mkdir(issuesDir);
    const service = new EpubImportService(issuesDir);
    const source = Buffer.from(sourceEpub);

    const results = await Promise.all([
      service.import("TheEconomist.2099.01.05.epub", source),
      service.import("economist-2099-01-05.epub", source),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["duplicate", "imported"]);
    expect(await readdir(issuesDir)).toHaveLength(1);
  });

  it("previews only an exact same-issue EPUB as replaceable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-replace-preview-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    await mkdir(issuesDir);
    const service = new EpubImportService(issuesDir);
    const source = Buffer.from(sourceEpub);
    const targetFilename = "TheEconomist.2099.01.07.epub";
    const targetIssueId = "economist:2099-01-07";

    await expect(service.import(targetFilename, source)).resolves.toMatchObject({ status: "imported", issueId: targetIssueId });

    const replacement = await service.previewReplacement(targetIssueId, "economist-2099-01-07.epub", source);
    expect(replacement).toMatchObject({
      status: "ready",
      targetIssueId,
      issueId: targetIssueId,
      existingFilename: targetFilename,
      hasCover: true,
    });

    const mismatch = await service.previewReplacement(targetIssueId, "TheEconomist.2099.01.08.epub", source);
    expect(mismatch).toMatchObject({
      status: "mismatch",
      targetIssueId,
      issueId: "economist:2099-01-08",
      existingFilename: targetFilename,
    });
    expect(mismatch.message).toContain("不能替换");
    expect(await readdir(issuesDir)).toEqual([targetFilename]);
  });

  it("rejects unsupported and broken files without leaving EPUBs behind", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-import-invalid-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    await mkdir(issuesDir);
    const service = new EpubImportService(issuesDir);

    const unsupported = await service.preview("unknown-magazine.2099.01.01.epub", Buffer.from("not-an-epub"));
    expect(unsupported.status).toBe("unsupported");

    const invalid = await service.import("TheEconomist.2099.01.02.epub", Buffer.from("not-an-epub"));
    expect(invalid.status).toBe("invalid");
    expect(await readdir(issuesDir)).toEqual([]);
  });
});
