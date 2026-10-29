import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubMagazineSyncService, listIncomingFiles, type MagazineSyncSource } from "./github-magazine-sync-service.js";
import { syntheticMagazineEpub } from "../../../tests/fixtures/synthetic-magazine.js";

const roots: string[] = [];
const sourceEpub = await syntheticMagazineEpub();
const economistSource: MagazineSyncSource[] = [{ publicationId: "economist", directory: "01_economist" }];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function directory(name: string, repoPath: string) {
  return { type: "dir", name, path: repoPath, download_url: null };
}

function file(name: string, repoPath: string, downloadUrl: string | null) {
  return { type: "file", name, path: repoPath, download_url: downloadUrl };
}

describe("GitHub magazine sync service", () => {
  it("imports every newer remote Economist issue oldest-first, ignores non-EPUB files, and becomes idempotent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-github-sync-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    const incomingDir = path.join(root, "data", "source-sync", "incoming");
    await mkdir(issuesDir, { recursive: true });
    await writeFile(path.join(issuesDir, "TheEconomist.2099.01.01.epub"), sourceEpub);
    const epub = sourceEpub;
    const requests: string[] = [];

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/contents/01_economist?")) {
        return jsonResponse([
          directory("te_2099.01.15", "01_economist/te_2099.01.15"),
          directory("te_2099.01.01", "01_economist/te_2099.01.01"),
          directory("te_2099.01.08", "01_economist/te_2099.01.08"),
        ]);
      }
      if (url.includes("/contents/01_economist/te_2099.01.08?")) {
        return jsonResponse([
          file("TheEconomist.2099.01.08.pdf", "01_economist/te_2099.01.08/TheEconomist.2099.01.08.pdf", "https://raw.example/08.pdf"),
          file("TheEconomist.2099.01.08.mobi", "01_economist/te_2099.01.08/TheEconomist.2099.01.08.mobi", "https://raw.example/08.mobi"),
          file("TheEconomist.2099.01.08.epub", "01_economist/te_2099.01.08/TheEconomist.2099.01.08.epub", "https://raw.example/08.epub"),
        ]);
      }
      if (url.includes("/contents/01_economist/te_2099.01.15?")) {
        return jsonResponse([
          file("TheEconomist.2099.01.15.epub", "01_economist/te_2099.01.15/TheEconomist.2099.01.15.epub", "https://raw.example/15.epub"),
        ]);
      }
      if (url === "https://raw.example/08.epub" || url === "https://raw.example/15.epub") {
        return new Response(epub, { status: 200, headers: { "content-length": String(epub.length) } });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const service = new GitHubMagazineSyncService({ issuesDir, incomingDir, sources: economistSource, fetchImpl });
    const first = await service.sync();
    expect(first).toMatchObject({ importedCount: 2, failedCount: 0, wouldImportCount: 0 });
    expect(first.publications[0]).toMatchObject({
      publicationId: "economist",
      localBaselineDate: "2099-01-01",
      remoteLatestDate: "2099-01-15",
      candidateCount: 2,
    });
    expect(first.publications[0].results.map((item) => `${item.date}:${item.status}`)).toEqual([
      "2099-01-08:imported",
      "2099-01-15:imported",
    ]);
    expect((await readdir(issuesDir)).sort()).toEqual([
      "TheEconomist.2099.01.01.epub",
      "TheEconomist.2099.01.08.epub",
      "TheEconomist.2099.01.15.epub",
    ]);
    expect(await listIncomingFiles(incomingDir)).toEqual([]);
    expect(requests).not.toContain("https://raw.example/08.pdf");
    expect(requests).not.toContain("https://raw.example/08.mobi");

    const rawRequestCount = requests.filter((url) => url.startsWith("https://raw.example/")).length;
    const second = await service.sync();
    expect(second).toMatchObject({ importedCount: 0, failedCount: 0 });
    expect(second.publications[0].candidateCount).toBe(0);
    expect(requests.filter((url) => url.startsWith("https://raw.example/")).length).toBe(rawRequestCount);
  });

  it("uses only the newest remote issue as the first baseline when that publication is absent locally", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-github-sync-empty-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    const incomingDir = path.join(root, "data", "source-sync", "incoming");
    await mkdir(issuesDir, { recursive: true });
    const requests: string[] = [];

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/contents/01_economist?")) {
        return jsonResponse([
          directory("te_2099.02.01", "01_economist/te_2099.02.01"),
          directory("te_2099.02.08", "01_economist/te_2099.02.08"),
          directory("te_2099.02.15", "01_economist/te_2099.02.15"),
        ]);
      }
      if (url.includes("/contents/01_economist/te_2099.02.15?")) {
        return jsonResponse([
          file("download.epub", "01_economist/te_2099.02.15/download.epub", "https://raw.example/latest.epub"),
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const report = await new GitHubMagazineSyncService({
      issuesDir,
      incomingDir,
      sources: economistSource,
      fetchImpl,
      dryRun: true,
    }).sync();

    expect(report).toMatchObject({ importedCount: 0, wouldImportCount: 1, failedCount: 0, dryRun: true });
    expect(report.publications[0]).toMatchObject({ localBaselineDate: null, remoteLatestDate: "2099-02-15", candidateCount: 1 });
    expect(report.publications[0].results[0]).toMatchObject({
      date: "2099-02-15",
      status: "would-import",
      filename: "TheEconomist.2099.02.15.epub",
    });
    expect(requests.some((url) => url.includes("2099.02.01"))).toBe(false);
    expect(requests.some((url) => url.includes("2099.02.08"))).toBe(false);
    expect(requests.some((url) => url.startsWith("https://raw.example/"))).toBe(false);
  });

  it("fails closed on a broken remote EPUB and removes the incoming partial file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-github-sync-invalid-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    const incomingDir = path.join(root, "data", "source-sync", "incoming");
    await mkdir(issuesDir, { recursive: true });
    await writeFile(path.join(issuesDir, "TheEconomist.2099.03.01.epub"), sourceEpub);

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/contents/01_economist?")) {
        return jsonResponse([directory("te_2099.03.08", "01_economist/te_2099.03.08")]);
      }
      if (url.includes("/contents/01_economist/te_2099.03.08?")) {
        return jsonResponse([
          file("TheEconomist.2099.03.08.epub", "01_economist/te_2099.03.08/TheEconomist.2099.03.08.epub", "https://raw.example/broken.epub"),
        ]);
      }
      if (url === "https://raw.example/broken.epub") return new Response(Buffer.from("not an epub"), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    };

    const report = await new GitHubMagazineSyncService({ issuesDir, incomingDir, sources: economistSource, fetchImpl }).sync();
    expect(report).toMatchObject({ importedCount: 0, failedCount: 1 });
    expect(await readdir(issuesDir)).toEqual(["TheEconomist.2099.03.01.epub"]);
    expect(await listIncomingFiles(incomingDir)).toEqual([]);
  });
});
