import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dateFromFilename, scanIssueFiles } from "../../epub/epub-core.js";
import { publicationFromFilename, publicationIssueId } from "../../shared/publication.js";
import type { PublicationId } from "../../shared/types.js";
import { EpubImportService } from "./epub-import-service.js";

export interface MagazineSyncSource {
  publicationId: PublicationId;
  directory: string;
}

export const DEFAULT_MAGAZINE_SYNC_SOURCES: MagazineSyncSource[] = [
  { publicationId: "economist", directory: "01_economist" },
  { publicationId: "new-yorker", directory: "02_new_yorker" },
  { publicationId: "atlantic", directory: "04_atlantic" },
  { publicationId: "wired", directory: "05_wired" },
];

interface GitHubContentEntry {
  type: "dir" | "file" | string;
  name: string;
  path: string;
  download_url?: string | null;
}

interface RemoteIssue {
  date: string;
  path: string;
}

export type MagazineSyncItemStatus = "imported" | "would-import" | "skipped" | "failed";

export interface MagazineSyncItemResult {
  publicationId: PublicationId;
  date: string;
  status: MagazineSyncItemStatus;
  filename?: string;
  message: string;
}

export interface MagazineSyncPublicationReport {
  publicationId: PublicationId;
  localBaselineDate: string | null;
  remoteLatestDate: string | null;
  candidateCount: number;
  results: MagazineSyncItemResult[];
}

export interface GitHubMagazineSyncReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  importedCount: number;
  wouldImportCount: number;
  skippedCount: number;
  failedCount: number;
  publications: MagazineSyncPublicationReport[];
}

export interface GitHubMagazineSyncOptions {
  issuesDir: string;
  incomingDir: string;
  owner?: string;
  repo?: string;
  ref?: string;
  sources?: MagazineSyncSource[];
  fetchImpl?: typeof fetch;
  token?: string;
  maxDownloadBytes?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
}

const DEFAULT_OWNER = "hehonghui";
const DEFAULT_REPO = "awesome-english-ebooks";
const DEFAULT_REF = "master";
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export class GitHubMagazineSyncService {
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;
  private readonly sources: MagazineSyncSource[];
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly maxDownloadBytes: number;
  private readonly dryRun: boolean;
  private readonly log: (message: string) => void;
  private readonly importService: EpubImportService;

  constructor(private readonly options: GitHubMagazineSyncOptions) {
    this.owner = options.owner ?? DEFAULT_OWNER;
    this.repo = options.repo ?? DEFAULT_REPO;
    this.ref = options.ref ?? DEFAULT_REF;
    this.sources = options.sources ?? DEFAULT_MAGAZINE_SYNC_SOURCES;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token;
    this.maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
    this.dryRun = options.dryRun ?? false;
    this.log = options.log ?? (() => undefined);
    this.importService = new EpubImportService(options.issuesDir);
  }

  async sync(): Promise<GitHubMagazineSyncReport> {
    const startedAt = new Date().toISOString();
    const publications: MagazineSyncPublicationReport[] = [];
    await mkdir(this.options.incomingDir, { recursive: true });
    const localFiles = await scanIssueFiles(this.options.issuesDir);

    for (const source of this.sources) {
      const localForPublication = localFiles
        .filter((file) => file.publicationId === source.publicationId)
        .sort((a, b) => b.date.localeCompare(a.date));
      const localBaselineDate = localForPublication[0]?.date ?? null;
      const localIssueIds = new Set(localForPublication.map((file) => file.id));
      const report: MagazineSyncPublicationReport = {
        publicationId: source.publicationId,
        localBaselineDate,
        remoteLatestDate: null,
        candidateCount: 0,
        results: [],
      };
      publications.push(report);

      try {
        const remoteIssues = await this.listRemoteIssues(source);
        report.remoteLatestDate = remoteIssues[0]?.date ?? null;
        const candidates = this.selectCandidates(source.publicationId, remoteIssues, localBaselineDate, localIssueIds);
        report.candidateCount = candidates.length;
        this.log(`${source.publicationId}: local=${localBaselineDate ?? "none"}, remote=${report.remoteLatestDate ?? "none"}, candidates=${candidates.length}`);

        for (const candidate of candidates) {
          report.results.push(await this.syncRemoteIssue(source, candidate));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`${source.publicationId}: failed to inspect upstream: ${message}`);
        report.results.push({
          publicationId: source.publicationId,
          date: report.remoteLatestDate ?? localBaselineDate ?? "unknown",
          status: "failed",
          message: `检查上游失败：${message}`,
        });
      }
    }

    const allResults = publications.flatMap((publication) => publication.results);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: this.dryRun,
      importedCount: allResults.filter((item) => item.status === "imported").length,
      wouldImportCount: allResults.filter((item) => item.status === "would-import").length,
      skippedCount: allResults.filter((item) => item.status === "skipped").length,
      failedCount: allResults.filter((item) => item.status === "failed").length,
      publications,
    };
  }

  private async listRemoteIssues(source: MagazineSyncSource): Promise<RemoteIssue[]> {
    const entries = await this.listDirectory(source.directory);
    const issues = entries
      .filter((entry) => entry.type === "dir" && this.isChildPath(source.directory, entry.path))
      .map((entry) => ({ date: dateFromFilename(entry.name), path: entry.path }))
      .filter((entry): entry is { date: string; path: string } => Boolean(entry.date))
      .map((entry) => ({ date: entry.date, path: entry.path }));

    return issues.sort((a, b) => b.date.localeCompare(a.date));
  }

  private selectCandidates(
    publicationId: PublicationId,
    remoteIssues: RemoteIssue[],
    localBaselineDate: string | null,
    localIssueIds: Set<string>,
  ): RemoteIssue[] {
    if (!remoteIssues.length) return [];
    if (!localBaselineDate) return [remoteIssues[0]];

    return remoteIssues
      .filter((remote) => remote.date > localBaselineDate)
      .filter((remote) => !localIssueIds.has(publicationIssueId(publicationId, remote.date)))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private async syncRemoteIssue(source: MagazineSyncSource, remoteIssue: RemoteIssue): Promise<MagazineSyncItemResult> {
    const entries = await this.listDirectory(remoteIssue.path);
    const candidate = this.selectEpubEntry(source, remoteIssue, entries);
    if (!candidate) {
      return {
        publicationId: source.publicationId,
        date: remoteIssue.date,
        status: "failed",
        message: "远端期次目录没有可安全识别的 EPUB。",
      };
    }

    const importFilename = this.importFilename(source.publicationId, remoteIssue.date, candidate.name);
    if (!importFilename) {
      return {
        publicationId: source.publicationId,
        date: remoteIssue.date,
        status: "failed",
        filename: candidate.name,
        message: "远端 EPUB 文件名中的杂志或日期与期次目录冲突。",
      };
    }

    if (this.dryRun) {
      this.log(`${source.publicationId} ${remoteIssue.date}: would import ${candidate.name}`);
      return {
        publicationId: source.publicationId,
        date: remoteIssue.date,
        status: "would-import",
        filename: importFilename,
        message: `发现新一期：${candidate.name}`,
      };
    }

    if (!candidate.download_url) {
      return {
        publicationId: source.publicationId,
        date: remoteIssue.date,
        status: "failed",
        filename: importFilename,
        message: "GitHub 没有提供 EPUB 下载地址。",
      };
    }

    const partPath = path.join(this.options.incomingDir, `${source.publicationId}-${remoteIssue.date}-${Date.now()}.epub.part`);
    try {
      const data = await this.download(candidate.download_url);
      await writeFile(partPath, data, { flag: "wx" });
      const imported = await this.importService.import(importFilename, data);
      if (imported.status === "imported") {
        this.log(`${source.publicationId} ${remoteIssue.date}: imported ${importFilename}`);
        return {
          publicationId: source.publicationId,
          date: remoteIssue.date,
          status: "imported",
          filename: importFilename,
          message: imported.message,
        };
      }
      if (imported.status === "duplicate") {
        this.log(`${source.publicationId} ${remoteIssue.date}: already exists`);
        return {
          publicationId: source.publicationId,
          date: remoteIssue.date,
          status: "skipped",
          filename: importFilename,
          message: imported.message,
        };
      }
      return {
        publicationId: source.publicationId,
        date: remoteIssue.date,
        status: "failed",
        filename: importFilename,
        message: imported.message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`${source.publicationId} ${remoteIssue.date}: failed: ${message}`);
      return {
        publicationId: source.publicationId,
        date: remoteIssue.date,
        status: "failed",
        filename: importFilename,
        message,
      };
    } finally {
      await unlink(partPath).catch(() => undefined);
    }
  }

  private selectEpubEntry(source: MagazineSyncSource, remoteIssue: RemoteIssue, entries: GitHubContentEntry[]): GitHubContentEntry | null {
    const epubs = entries.filter((entry) => entry.type === "file"
      && entry.name.toLocaleLowerCase("en-US").endsWith(".epub")
      && this.isChildPath(remoteIssue.path, entry.path));

    const exact = epubs.find((entry) => {
      const publication = publicationFromFilename(entry.name);
      const date = dateFromFilename(entry.name);
      return publication?.id === source.publicationId && date === remoteIssue.date;
    });
    if (exact) return exact;

    return epubs.find((entry) => {
      const publication = publicationFromFilename(entry.name);
      const date = dateFromFilename(entry.name);
      return (!publication || publication.id === source.publicationId) && (!date || date === remoteIssue.date);
    }) ?? null;
  }

  private importFilename(publicationId: PublicationId, date: string, remoteFilename: string): string | null {
    const remotePublication = publicationFromFilename(remoteFilename);
    const remoteDate = dateFromFilename(remoteFilename);
    if (remotePublication && remotePublication.id !== publicationId) return null;
    if (remoteDate && remoteDate !== date) return null;
    if (remotePublication && remoteDate) return path.basename(remoteFilename);

    const dottedDate = date.replaceAll("-", ".");
    const prefix: Record<PublicationId, string> = {
      economist: "TheEconomist",
      "new-yorker": "NewYorker",
      atlantic: "TheAtlantic",
      wired: "Wired",
    };
    return `${prefix[publicationId]}.${dottedDate}.epub`;
  }

  private async listDirectory(repoPath: string): Promise<GitHubContentEntry[]> {
    const response = await this.fetchImpl(this.contentsUrl(repoPath), { headers: this.githubHeaders() });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} ${response.statusText || "request failed"}`.trim());
    }
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) throw new Error(`GitHub path is not a directory: ${repoPath}`);
    return payload.filter((entry): entry is GitHubContentEntry => this.isGitHubContentEntry(entry));
  }

  private async download(url: string): Promise<Buffer> {
    const headers = url.startsWith("https://api.github.com/") ? this.githubHeaders() : { "User-Agent": "magazine-reader-sync" };
    const response = await this.fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`EPUB download failed: HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > this.maxDownloadBytes) throw new Error(`EPUB exceeds ${this.maxDownloadBytes} byte safety limit`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length) throw new Error("Downloaded EPUB is empty");
    if (data.length > this.maxDownloadBytes) throw new Error(`EPUB exceeds ${this.maxDownloadBytes} byte safety limit`);
    return data;
  }

  private githubHeaders(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      "User-Agent": "magazine-reader-sync",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private contentsUrl(repoPath: string): string {
    const encodedPath = repoPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(this.ref)}`;
  }

  private isGitHubContentEntry(value: unknown): value is GitHubContentEntry {
    if (!value || typeof value !== "object") return false;
    const entry = value as Partial<GitHubContentEntry>;
    return typeof entry.type === "string" && typeof entry.name === "string" && typeof entry.path === "string";
  }

  private isChildPath(parent: string, child: string): boolean {
    return child.startsWith(`${parent}/`) && !child.slice(parent.length + 1).includes("../");
  }
}

export async function listIncomingFiles(incomingDir: string): Promise<string[]> {
  return (await readdir(incomingDir).catch(() => [])).sort();
}
