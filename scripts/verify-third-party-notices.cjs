const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const [appPath, ...inventories] = process.argv.slice(2);
if (!appPath || inventories.length !== 4) throw new Error('Usage: verify-third-party-notices.cjs <App.app> <all> <main-renderer> <reader-runtime> <electron-main>');
const realApp = fs.realpathSync(appPath);
const resources = path.join(realApp, 'Contents/Resources');
const appResources = path.join(resources, 'app');
const noticePath = path.join(appResources, 'licenses/THIRD_PARTY_NOTICES.txt');
const readerNoticePath = path.join(appResources, 'reader/THIRD_PARTY_NOTICES.txt');
const notice = fs.readFileSync(noticePath, 'utf8');
assert.equal(fs.readFileSync(readerNoticePath, 'utf8'), notice, 'Reader and app notices must be the same complete merged inventory');
assert.doesNotMatch(notice, /undefined@undefined|\(see notice\)/i);

const [allPath, mainPath, readerPath, electronPath] = inventories;
const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));
const main = JSON.parse(fs.readFileSync(mainPath, 'utf8'));
const reader = JSON.parse(fs.readFileSync(readerPath, 'utf8'));
const electron = JSON.parse(fs.readFileSync(electronPath, 'utf8'));
for (const record of all) {
  const heading = `===== ${record.name}@${record.version} — ${record.license} =====`;
  assert.ok(notice.includes(heading), `Merged notices omit ${record.name}@${record.version}`);
}
for (const name of ['react-markdown', 'remark-gfm', 'remark-cjk-friendly']) {
  assert.ok(main.some(record => record.name === name), `Main renderer's bundled runtime inventory omits ${name}`);
}
assert.ok(all.some(record => record.name === '@xmldom/xmldom'), 'Electron runtime dependency @xmldom/xmldom is missing from merged notices');
for (const tooling of ['vite', '@vitejs/plugin-react', 'typescript', 'vitest', 'esbuild']) {
  assert.ok(!main.some(record => record.name === tooling), `Build/test tooling must not be classified as renderer runtime: ${tooling}`);
}
assert.ok(reader.length > 0, 'Reader runtime package inventory is empty');
assert.ok(electron.length > 0, 'Electron main-process runtime package inventory is empty');
for (const identity of ['abstract-logging@2.0.1', 'boolbase@1.0.0', 'isarray@1.0.0', 'pako@1.0.11', 'jszip@3.10.2']) {
  const [name, version] = identity.split('@').length > 2 ? [identity.slice(0, identity.lastIndexOf('@')), identity.slice(identity.lastIndexOf('@') + 1)] : identity.split('@');
  assert.ok(all.some(record => record.name === name && record.version === version), `Notices omit reviewed Reader package ${identity}`);
}
assert.ok(notice.includes('GNU GENERAL PUBLIC LICENSE'), 'Dual-licensed JSZip GPL text is missing');
assert.ok(notice.includes("This software is provided 'as-is'"), 'Pako Zlib license text is missing');

function findFiles(directory, basename) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) found.push(...findFiles(filename, basename));
    else if (entry.isFile() && entry.name === basename) found.push(filename);
  }
  return found;
}
const chromiumFiles = findFiles(realApp, 'LICENSES.chromium.html');
assert.ok(chromiumFiles.length > 0, 'Packaged Electron Chromium license catalog is missing');
assert.ok(chromiumFiles.some(filename => notice.includes(fs.readFileSync(filename, 'utf8').trim())), 'Merged notices do not preserve the packaged Chromium catalog text');
const electronLicense = fs.readFileSync(path.join(appResources, 'licenses/Electron-LICENSE.txt'), 'utf8').trim();
assert.ok(notice.includes(electronLicense), 'Merged notices omit the Electron distribution license');
const codexLicense = fs.readFileSync(path.join(appResources, 'licenses/OpenAI-Codex/LICENSE'), 'utf8').trim();
assert.ok(notice.includes(codexLicense), 'Merged notices omit the Codex license text');
console.log(JSON.stringify({app: realApp, packages: all.length, mainRendererPackages: main.length, readerPackages: reader.length, electronMainPackages: electron.length, chromiumCatalogs: chromiumFiles.length, noticeBytes: Buffer.byteLength(notice)}, null, 2));
