import fs from 'node:fs/promises';
import path from 'node:path';
import { findPackageRoot } from './package-root-resolution.mjs';

const SPDX_EXPRESSIONS = new Set([
  'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'ISC', 'MIT',
  '(MIT AND Zlib)', '(MIT OR GPL-3.0-or-later)',
]);
const SPDX_COMPONENTS = {
  'Apache-2.0': ['Apache License', 'Version 2.0'],
  'BSD-2-Clause': ['Redistribution and use in source and binary forms'],
  'BSD-3-Clause': ['Redistribution and use in source and binary forms'],
  'BlueOak-1.0.0': ['Blue Oak Model License'],
  ISC: ['Permission to use, copy, modify, and/or distribute', 'THE SOFTWARE IS PROVIDED'],
  MIT: ['Permission is hereby granted, free of charge', 'THE SOFTWARE IS PROVIDED'],
  Zlib: ["This software is provided 'as-is'", 'Permission is granted to anyone to use'],
  'GPL-3.0-or-later': ['GNU GENERAL PUBLIC LICENSE', 'TERMS AND CONDITIONS'],
};
const SUPPLEMENTAL_FILES = {
  'pako@1.0.11': ['lib/zlib/README'],
};

function cleanModuleId(raw, repoRoot) {
  let id = String(raw).replace(/^\0+/, '').split('?')[0];
  if (id.startsWith('file://')) id = new URL(id).pathname;
  return path.isAbsolute(id) ? path.resolve(id) : path.resolve(repoRoot, id);
}

export async function collectPackageRootsFromModules(repoRoot, moduleIds) {
  const roots = new Set();
  for (const raw of moduleIds) {
    const filename = cleanModuleId(raw, repoRoot);
    if (!filename.split(path.sep).includes('node_modules')) continue;
    const root = await findPackageRoot(filename);
    if (!root) throw new Error(`Unable to identify bundled package for module: ${raw}`);
    roots.add(await fs.realpath(root));
  }
  return [...roots].sort();
}

export async function packageRecordsFromRoots(repoRoot, roots) {
  const byIdentity = new Map();
  for (const root of roots) {
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const { name, version, license } = manifest;
    if (typeof name !== 'string' || !name.trim() || /undefined|null/i.test(name)
      || typeof version !== 'string' || !version.trim() || /undefined|null/i.test(version)
      || typeof license !== 'string' || !license.trim() || /undefined|null|see license|unlicensed/i.test(license)) {
      throw new Error(`Incomplete name/version/license metadata in ${manifestPath}`);
    }
    if (!SPDX_EXPRESSIONS.has(license)) throw new Error(`Unreviewed SPDX license expression ${JSON.stringify(license)} for ${name}@${version}`);
    const identity = `${name}@${version}`;
    const record = { name, version, license, packagePath: path.relative(repoRoot, root).split(path.sep).join('/') };
    const previous = byIdentity.get(identity);
    if (previous && previous.license !== license) throw new Error(`Conflicting license metadata for ${identity}`);
    if (!previous || record.packagePath.localeCompare(previous.packagePath) < 0) byIdentity.set(identity, record);
  }
  return [...byIdentity.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

async function listLicenseFiles(packageRoot) {
  const found = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '.git') continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(filename); continue; }
      if (entry.isFile() && /^(?:licen[cs]es?|copying|notice)(\.|$)/i.test(entry.name)) found.push(filename);
    }
  }
  await visit(packageRoot);
  return found.sort();
}

function validateLicenseCoverage(expression, documents, identity) {
  const texts = documents.map(item => item.text).join('\n').toLowerCase();
  const components = expression.replace(/[()]/g, '').split(/\s+(?:AND|OR)\s+/);
  for (const component of components) {
    const markers = SPDX_COMPONENTS[component];
    if (!markers || markers.some(marker => !texts.includes(marker.toLowerCase()))) {
      throw new Error(`License text for ${identity} does not substantiate ${component}`);
    }
  }
}

async function readPackageDocuments(repoRoot, record, overrides) {
  const identity = `${record.name}@${record.version}`;
  const packageRoot = path.resolve(repoRoot, record.packagePath);
  const override = overrides[identity];
  let files = await listLicenseFiles(packageRoot);
  const documents = [];
  if (override) {
    if (override.license !== record.license || typeof override.file !== 'string' || !Array.isArray(override.source) || !override.source.length) {
      throw new Error(`Invalid reviewed license override for ${identity}`);
    }
    files = [path.resolve(repoRoot, override.file)];
    documents.push({ label: path.relative(repoRoot, files[0]).split(path.sep).join('/'), text: await fs.readFile(files[0], 'utf8'), source: override.source.join('\n') });
  } else {
    if (!files.length) throw new Error(`No license or notice text shipped for ${identity}; add and review an exact-version override or stop the build`);
    for (const filename of files) documents.push({ label: path.relative(packageRoot, filename).split(path.sep).join('/'), text: await fs.readFile(filename, 'utf8') });
  }
  for (const supplemental of SUPPLEMENTAL_FILES[identity] ?? []) {
    const filename = path.join(packageRoot, supplemental);
    documents.push({ label: supplemental, text: await fs.readFile(filename, 'utf8'), source: `Included in the exact installed ${identity} package` });
  }
  if (documents.some(item => !item.text.trim())) throw new Error(`Empty license/notice text for ${identity}`);
  validateLicenseCoverage(record.license, documents, identity);
  return documents;
}

export async function renderThirdPartyNotices({ repoRoot, appVersion, packageRecords, binaryDocuments = [] }) {
  const overrides = JSON.parse(await fs.readFile(path.join(repoRoot, 'licenses/npm-license-overrides.json'), 'utf8'));
  const lines = [
    `Vantilo ${appVersion} — third-party runtime notices`,
    'This inventory covers third-party packages present in the production main renderer, Reader web/API bundles, or bundled Electron main-process bundles, plus the binary distributions listed below.',
    'Package names, versions, and SPDX expressions are read from their exact installed package.json files; applicable license and notice text is reproduced in full below.',
    '',
  ];
  for (const record of packageRecords) {
    const identity = `${record.name}@${record.version}`;
    const docs = await readPackageDocuments(repoRoot, record, overrides);
    lines.push(`===== ${identity} — ${record.license} =====`);
    lines.push(`Installed package: ${record.packagePath}`);
    for (const doc of docs) {
      lines.push(`--- ${doc.label}${doc.source ? ` (source: ${doc.source})` : ''} ---`);
      lines.push(doc.text.trimEnd());
      lines.push('');
    }
  }
  for (const doc of binaryDocuments) {
    if (!doc.name || !doc.version || !doc.license || !doc.label || !doc.text?.trim()) throw new Error('Incomplete bundled binary license document');
    lines.push(`===== ${doc.name}@${doc.version} — ${doc.license} =====`);
    lines.push(`--- ${doc.label}${doc.source ? ` (source: ${doc.source})` : ''} ---`);
    lines.push(doc.text.trimEnd());
    lines.push('');
  }
  const result = lines.join('\n').trimEnd() + '\n';
  if (/undefined@undefined|\(see notice\)/i.test(result)) throw new Error('Generated notices contain unresolved package metadata');
  for (const identity of Object.keys(overrides)) {
    if (!packageRecords.some(record => `${record.name}@${record.version}` === identity)) throw new Error(`Stale license override is not used by a bundled package: ${identity}`);
  }
  return result;
}
