import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const driver = readFileSync(new URL('../scripts/vocabulary-backup-e2e-driver.cjs', import.meta.url), 'utf8');
const raceSource = driver.slice(driver.indexOf('async function runRaceSource()'), driver.indexOf('async function loadRestorePreview'));

describe('vocabulary backup E2E race fixture', () => {
  it('writes and verifies the snapshot at its dedicated race backup path', () => {
    expect(raceSource).toContain('process.env.VANTILO_VOCABULARY_E2E_RACE_BACKUP');
    expect(raceSource).toContain('filePath: raceBackupPath');
    expect(raceSource).toContain("fs.readFile(raceBackupPath, 'utf8')");
  });
});
