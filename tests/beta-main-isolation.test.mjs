import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const betaMain = await readFile(new URL('../electron/beta-main.cjs', import.meta.url), 'utf8');
const universalBuilder = await readFile(new URL('../scripts/build-mac-beta-candidates.mjs', import.meta.url), 'utf8');
const universalE2E = await readFile(new URL('../scripts/run-vocabulary-backup-universal-e2e.mjs', import.meta.url), 'utf8');

describe('packaged Beta E2E data isolation', () => {
  it('sets every Electron data path and verifies Chromium storage before loading the app main process', () => {
    const mainRequire = betaMain.indexOf("require('./main.cjs')");
    expect(mainRequire).toBeGreaterThan(0);
    expect(betaMain.indexOf('startPackagedVocabularyE2EIsolation();')).toBeLessThan(mainRequire);
    expect(betaMain.indexOf('app.setPath(key, paths[key])')).toBeLessThan(mainRequire);
    expect(betaMain.indexOf('app.whenReady().then')).toBeLessThan(mainRequire);
    expect(betaMain.indexOf('session.defaultSession.getStoragePath()')).toBeLessThan(mainRequire);
    expect(betaMain.indexOf('resolveVerification(proof)')).toBeLessThan(mainRequire);
    for (const pathName of ['home', 'appData', 'userData', 'sessionData', 'temp', 'downloads', 'logs', 'crashDumps', 'cache']) {
      expect(betaMain).toContain(`app.setPath(key, paths[key])`);
      expect(betaMain).toContain(`${pathName}: 'VANTILO_VOCABULARY_E2E_${pathName.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`);
    }
    expect(betaMain).toContain("if (process.env.VANTILO_PACKAGED_E2E !== '1') return false;");
    expect(betaMain).toContain("/^--inspect=127\\.0\\.0\\.1:\\d+$/");
    expect(betaMain).toContain('userDataOverride !== paths.userData');
  });

  it('packages the reviewed Beta entrypoint instead of regenerating a weaker inline launcher', () => {
    expect(universalBuilder).toContain("fs.copyFile(path.join(repo,'electron/beta-main.cjs'),path.join(stage,'electron/beta-main.cjs'))");
    expect(universalBuilder).not.toContain("fs.writeFile(path.join(stage,'electron/beta-main.cjs')");
  });

  it('waits for Electron readiness and the persisted isolation proof before driving the packaged app', () => {
    expect(universalE2E).toContain('async function waitForIsolationReady(inspector, child, tail)');
    expect(universalE2E).toContain("return app.isReady()&&global.__vocabularyIsolationProof?.status==='PASS'");
    expect(universalE2E.indexOf('await waitForIsolationReady(inspector, child, tail)')).toBeLessThan(
      universalE2E.indexOf('const proofExpression ='),
    );
    expect(universalE2E).toContain('打包应用未在隔离验收期限内完成 app ready 和隔离证明');
  });
});
