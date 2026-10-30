import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const driver = readFileSync(new URL('../scripts/vocabulary-backup-e2e-driver.cjs', import.meta.url), 'utf8');
const raceSource = driver.slice(driver.indexOf('async function runRaceSource()'), driver.indexOf('async function loadRestorePreview'));
const universalRunner = readFileSync(new URL('../scripts/run-vocabulary-backup-universal-e2e.mjs', import.meta.url), 'utf8');

describe('vocabulary backup E2E race fixture', () => {
  it('writes and verifies the snapshot at its dedicated race backup path', () => {
    expect(raceSource).toContain('process.env.VANTILO_VOCABULARY_E2E_RACE_BACKUP');
    expect(raceSource).toContain('filePath: raceBackupPath');
    expect(raceSource).toContain("fs.readFile(raceBackupPath, 'utf8')");
  });

  it('reuses the isolated magazine-sync preseed on restart modes without replacing data', () => {
    expect(universalRunner).toContain('JSON.parse(await fs.readFile(preferencePath, \'utf8\'))');
    expect(universalRunner).toContain("if (error?.code !== 'ENOENT') throw error;");
    expect(universalRunner).toContain('preferences?.automatic !== false');
    expect(universalRunner).toContain("{ flag: 'wx', mode: 0o600 }");
  });
});
