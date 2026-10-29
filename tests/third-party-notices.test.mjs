import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPackageRootsFromModules, packageRecordsFromRoots, renderThirdPartyNotices } from '../scripts/third-party-notices.mjs';

const temporaryRoots = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixtureRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-third-party-notices-'));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, 'licenses'), { recursive: true });
  await fs.writeFile(path.join(root, 'licenses/npm-license-overrides.json'), '{}\n');
  return root;
}

async function fixturePackage(root, name, metadata, licenseText = '') {
  const directory = path.join(root, 'node_modules', ...name.split('/'));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...metadata }));
  await fs.writeFile(path.join(directory, 'index.js'), 'module.exports = true;\n');
  if (licenseText) await fs.writeFile(path.join(directory, 'LICENSE'), licenseText);
  return directory;
}

const mitText = `MIT License\nCopyright (c) Fixture Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction.\n\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;

describe('production third-party notice inventory', () => {
  it('resolves package identities from bundler module IDs and renders the exact license text', async () => {
    const root = await fixtureRepo();
    const directory = await fixturePackage(root, '@fixture/runtime', { license: 'MIT' }, mitText);
    const ids = [`\0${path.join(directory, 'index.js')}?commonjs-es-import`];
    const roots = await collectPackageRootsFromModules(root, ids);
    expect(roots).toEqual([await fs.realpath(directory)]);
    const records = await packageRecordsFromRoots(root, roots);
    const notices = await renderThirdPartyNotices({ repoRoot: root, appVersion: '0.1.10', packageRecords: records });
    expect(notices).toContain('===== @fixture/runtime@1.0.0 — MIT =====');
    expect(notices).toContain(mitText.trim());
    expect(notices).not.toMatch(/undefined@undefined|\(see notice\)/i);
  });

  it('fails closed when package name, version, SPDX expression, or license text is missing or unresolved', async () => {
    const root = await fixtureRepo();
    const missingMetadata = await fixturePackage(root, 'missing-metadata', { version: '1.0.0' }, mitText);
    await expect(packageRecordsFromRoots(root, [missingMetadata])).rejects.toThrow(/Incomplete name\/version\/license/);

    const unknownLicense = await fixturePackage(root, 'unknown-license', { license: 'Custom-Terms' }, mitText);
    await expect(packageRecordsFromRoots(root, [unknownLicense])).rejects.toThrow(/Unreviewed SPDX license expression/);

    const missingText = await fixturePackage(root, 'missing-text', { license: 'MIT' });
    const records = await packageRecordsFromRoots(root, [missingText]);
    await expect(renderThirdPartyNotices({ repoRoot: root, appVersion: '0.1.10', packageRecords: records })).rejects.toThrow(/No license or notice text shipped/);

    const malformedText = await fixturePackage(root, 'malformed-license', { license: 'MIT' }, 'not an MIT license');
    const malformedRecords = await packageRecordsFromRoots(root, [malformedText]);
    await expect(renderThirdPartyNotices({ repoRoot: root, appVersion: '0.1.10', packageRecords: malformedRecords })).rejects.toThrow(/does not substantiate MIT/);
  });

  it('includes the three reviewed exact-version npm license-text fallbacks', async () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const roots = await collectPackageRootsFromModules(repo, [
      'node_modules/abstract-logging/index.js',
      'node_modules/boolbase/index.js',
      'node_modules/isarray/index.js',
    ]);
    const records = await packageRecordsFromRoots(repo, roots);
    const notices = await renderThirdPartyNotices({ repoRoot: repo, appVersion: '0.1.10', packageRecords: records });
    expect(notices).toContain('abstract-logging@2.0.1 — MIT');
    expect(notices).toContain('boolbase@1.0.0 — ISC');
    expect(notices).toContain('isarray@1.0.0 — MIT');
    expect(notices).toContain('https://jsumners.mit-license.org/');
    expect(notices).not.toMatch(/undefined@undefined|\(see notice\)/i);
  });
});
