import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const betaMain = await readFile(new URL('../electron/beta-main.cjs', import.meta.url), 'utf8');
const universalBuilder = await readFile(new URL('../scripts/build-mac-beta-candidates.mjs', import.meta.url), 'utf8');

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
});
