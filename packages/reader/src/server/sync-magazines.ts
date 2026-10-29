import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { GitHubMagazineSyncService } from "./services/github-magazine-sync-service.js";

const projectRoot = process.cwd();
const syncRoot = path.join(projectRoot, "data", "source-sync");
const incomingDir = path.join(syncRoot, "incoming");
const logPath = path.join(syncRoot, "sync.log");
const dryRun = process.argv.includes("--dry-run") || process.env.MAGAZINE_SYNC_DRY_RUN === "1";

await mkdir(syncRoot, { recursive: true });

async function writeLog(message: string) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  await appendFile(logPath, `${line}\n`, "utf8").catch(() => undefined);
}

await writeLog(`GitHub Magazine Sync V0.1 start${dryRun ? " (dry-run)" : ""}`);

const service = new GitHubMagazineSyncService({
  issuesDir: path.join(projectRoot, "issues"),
  incomingDir,
  token: process.env.MAGAZINE_SYNC_GITHUB_TOKEN || process.env.GITHUB_TOKEN,
  dryRun,
  log: (message) => { void writeLog(message); },
});

try {
  const report = await service.sync();
  await writeLog(`complete: imported=${report.importedCount}, wouldImport=${report.wouldImportCount}, skipped=${report.skippedCount}, failed=${report.failedCount}`);
  if (report.failedCount > 0) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeLog(`fatal: ${message}`);
  process.exitCode = 1;
}
