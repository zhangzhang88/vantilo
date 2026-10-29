import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GuidePreparationStatusCache, IssueRecord, SectionTranslationCache } from "../shared/types.js";

export class JsonStorage {
  constructor(private readonly dataDir: string) {}

  private issuePath(issueId: string): string {
    const safeId = issueId.replace(/[^a-zA-Z0-9._-]/g, "-");
    return path.join(this.dataDir, `${safeId}.json`);
  }

  private sectionTranslationsPath(): string {
    return path.join(this.dataDir, "section-translations.json");
  }

  private guidePreparationStatusPath(): string {
    return path.join(this.dataDir, "guide-preparation-status.json");
  }

  async loadIssue(issueId: string): Promise<IssueRecord | null> {
    try {
      const text = await readFile(this.issuePath(issueId), "utf8");
      return JSON.parse(text) as IssueRecord;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async deleteIssue(issueId: string): Promise<void> {
    await rm(this.issuePath(issueId), { force: true });
  }

  async loadSectionTranslations(): Promise<SectionTranslationCache> {
    try {
      const text = await readFile(this.sectionTranslationsPath(), "utf8");
      const parsed = JSON.parse(text) as SectionTranslationCache;
      return parsed?.version === 1 && parsed.publications
        ? parsed
        : { version: 1, publications: {} };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { version: 1, publications: {} };
      throw error;
    }
  }

  async saveSectionTranslations(cache: SectionTranslationCache): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const target = this.sectionTranslationsPath();
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async loadGuidePreparationStatuses(): Promise<GuidePreparationStatusCache> {
    try {
      const text = await readFile(this.guidePreparationStatusPath(), "utf8");
      const parsed = JSON.parse(text) as GuidePreparationStatusCache;
      return parsed?.version === 1 && parsed.issues
        ? parsed
        : { version: 1, issues: {} };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { version: 1, issues: {} };
      throw error;
    }
  }

  async saveGuidePreparationStatuses(cache: GuidePreparationStatusCache): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const target = this.guidePreparationStatusPath();
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async saveIssue(issue: IssueRecord): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const target = this.issuePath(issue.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(issue, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }
}
