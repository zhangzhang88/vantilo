import { link, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { dateFromFilename, dateLabel, readEpubCover, scanIssueFiles } from "../../epub/epub-core.js";
import { parsePublicationEpub } from "../../epub/publication-parser.js";
import { publicationFromFilename, publicationIssueId } from "../../shared/publication.js";
import type { EpubImportPreview, EpubReplacementPreview, IssueFile } from "../../shared/types.js";

const MAX_PREVIEW_COVER_BYTES = 2_000_000;

interface ImportIdentity {
  filename: string;
  issueId: string;
  publicationId: IssueFile["publicationId"];
  publicationName: string;
  date: string;
  label: string;
}

export class EpubImportService {
  private readonly importInFlight = new Map<string, Promise<EpubImportPreview>>();
  constructor(private readonly issuesDir: string) {}

  isImporting(issueId: string): boolean {
    return this.importInFlight.has(issueId);
  }

  async preview(filename: string, data: Buffer): Promise<EpubImportPreview> {
    return this.inspect(filename, data, true);
  }

  async previewReplacement(targetIssueId: string, filename: string, data: Buffer, includeCoverData = true): Promise<EpubReplacementPreview> {
    const candidate = await this.inspect(filename, data, includeCoverData, true);
    const base = { ...candidate, targetIssueId };
    if (candidate.status !== "ready" || !candidate.issueId) {
      return { ...base, status: candidate.status === "unsupported" ? "unsupported" : "invalid" };
    }

    const existing = await this.findDuplicate(targetIssueId);
    if (!existing) {
      return { ...base, status: "missing", message: "要替换的目标期次不存在。" };
    }
    if (candidate.issueId !== targetIssueId) {
      return {
        ...base,
        status: "mismatch",
        existingFilename: existing.filename,
        message: `候选 EPUB 属于 ${candidate.issueId}，不能替换 ${targetIssueId}。`,
      };
    }
    return {
      ...base,
      status: "ready",
      existingFilename: existing.filename,
      message: "校验通过，可以安全替换这一期。",
    };
  }

  async import(filename: string, data: Buffer): Promise<EpubImportPreview> {
    const preview = await this.inspect(filename, data, false);
    if (preview.status !== "ready" || !preview.issueId) return preview;

    const activeImport = this.importInFlight.get(preview.issueId);
    if (activeImport) {
      await activeImport;
      const duplicate = await this.findDuplicate(preview.issueId);
      return duplicate
        ? { ...preview, status: "duplicate", coverDataUrl: undefined, message: `该期已存在（${duplicate.filename}），不会重复导入。` }
        : preview;
    }

    const issueId = preview.issueId;
    const importPromise = this.commitImport(preview, issueId, data)
      .finally(() => this.importInFlight.delete(issueId));
    this.importInFlight.set(issueId, importPromise);
    return importPromise;
  }

  private async commitImport(preview: EpubImportPreview, issueId: string, data: Buffer): Promise<EpubImportPreview> {
    await mkdir(this.issuesDir, { recursive: true });
    const duplicate = await this.findDuplicate(issueId);
    if (duplicate) {
      return { ...preview, status: "duplicate", coverDataUrl: undefined, message: `该期已存在（${duplicate.filename}），不会重复导入。` };
    }

    const finalPath = path.join(this.issuesDir, preview.filename);
    const tempPath = path.join(this.issuesDir, `.epub-import-${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, data, { flag: "wx" });
      try {
        await link(tempPath, finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          return { ...preview, status: "duplicate", coverDataUrl: undefined, message: "同名 EPUB 已存在，未覆盖原文件。" };
        }
        throw error;
      }
      return { ...preview, status: "imported", coverDataUrl: undefined, message: "导入完成。" };
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  private async inspect(filename: string, data: Buffer, includeCoverData: boolean, allowExistingIssue = false): Promise<EpubImportPreview> {
    const identity = this.identityFromFilename(filename);
    if (!identity) {
      return {
        filename: this.safeDisplayFilename(filename),
        status: "unsupported",
        hasCover: false,
        message: "无法从文件名识别支持的杂志与有效日期。",
      };
    }
    if (!data.length) return { ...identity, status: "invalid", hasCover: false, message: "EPUB 文件为空。" };

    if (!allowExistingIssue) {
      const duplicate = await this.findDuplicate(identity.issueId);
      if (duplicate) return this.duplicatePreview(identity, duplicate.filename);
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-import-"));
    const tempPath = path.join(tempDir, "candidate.epub");
    try {
      await writeFile(tempPath, data);
      const issueFile: IssueFile = {
        id: identity.issueId,
        publicationId: identity.publicationId,
        publicationName: identity.publicationName,
        date: identity.date,
        label: identity.label,
        filename: identity.filename,
        filePath: tempPath,
        fingerprint: `${data.length}:import-preview`,
      };
      const parsed = await parsePublicationEpub(issueFile);
      const cover = await readEpubCover(issueFile).catch(() => null);
      return {
        ...identity,
        status: "ready",
        articleCount: parsed.articles.length,
        sectionCount: parsed.sections.length,
        hasCover: Boolean(cover),
        coverDataUrl: includeCoverData && cover && cover.data.length <= MAX_PREVIEW_COVER_BYTES
          ? `data:${cover.mediaType};base64,${cover.data.toString("base64")}`
          : undefined,
        message: "校验通过，可以导入。",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "EPUB 解析失败";
      return { ...identity, status: "invalid", hasCover: false, message: `无法解析 EPUB：${message}` };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private identityFromFilename(filename: string): ImportIdentity | null {
    const candidate = filename.trim();
    if (!candidate || path.basename(candidate) !== candidate || !candidate.toLocaleLowerCase("en-US").endsWith(".epub")) return null;
    const publication = publicationFromFilename(candidate);
    const date = dateFromFilename(candidate);
    if (!publication || !date || !this.isValidDate(date)) return null;
    return {
      filename: candidate,
      issueId: publicationIssueId(publication.id, date),
      publicationId: publication.id,
      publicationName: publication.name,
      date,
      label: dateLabel(date),
    };
  }

  private isValidDate(date: string): boolean {
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }

  private async findDuplicate(issueId: string): Promise<IssueFile | undefined> {
    return (await scanIssueFiles(this.issuesDir)).find((file) => file.id === issueId);
  }

  private duplicatePreview(identity: Pick<ImportIdentity, "filename" | "issueId" | "publicationId" | "publicationName" | "date" | "label">, existingFilename: string): EpubImportPreview {
    return {
      ...identity,
      status: "duplicate",
      hasCover: false,
      message: `该期已存在（${existingFilename}），不会重复导入。`,
    };
  }

  private safeDisplayFilename(filename: string): string {
    return path.basename(filename.trim()) || "未命名 EPUB";
  }
}
