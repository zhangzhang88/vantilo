import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { adaptReaderSource } from '../scripts/reader-variant.mjs';
import { readerSourceRoot } from '../scripts/reader-source-path.mjs';

it('saves and restores the blue theme with the existing global reading preferences', async () => {
  const filename = `${readerSourceRoot}/src/frontend/reader-preferences.ts`;
  const adapted = adaptReaderSource(readFileSync(filename, 'utf8'), filename);
  const js = ts.transpileModule(adapted, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const preferences = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  const saved = { ...preferences.DEFAULT_READER_PREFERENCES, theme: 'blue', themePreset: 'blue', fontSize: 21, fontFamily: 'sans' };
  preferences.saveReaderPreferences(storage, saved);
  const restored = preferences.loadReaderPreferences(storage);
  expect(restored).toMatchObject({ theme: 'blue', themePreset: 'blue', fontSize: 21, fontFamily: 'sans' });
  expect(preferences.resolveReaderTheme(restored, false)).toBe('blue');
  expect(preferences.resolveReaderTheme(restored, true)).toBe('blue');
});

it('saves and restores the expanded 12–24px global reading size range', async () => {
  const filename = `${readerSourceRoot}/src/frontend/reader-preferences.ts`;
  const adapted = adaptReaderSource(readFileSync(filename, 'utf8'), filename);
  const js = ts.transpileModule(adapted, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const preferences = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  preferences.saveReaderPreferences(storage, { ...preferences.DEFAULT_READER_PREFERENCES, fontSize: 12 });
  expect(preferences.loadReaderPreferences(storage).fontSize).toBe(12);
  preferences.saveReaderPreferences(storage, { ...preferences.DEFAULT_READER_PREFERENCES, fontSize: 14 });
  expect(preferences.loadReaderPreferences(storage).fontSize).toBe(14);
});

it('enables automatic pronunciation for new readers while keeping an explicit saved choice', async () => {
  const filename = `${readerSourceRoot}/src/frontend/reader-preferences.ts`;
  const adapted = adaptReaderSource(readFileSync(filename, 'utf8'), filename);
  const js = ts.transpileModule(adapted, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const preferences = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  expect(preferences.loadReaderPreferences(storage).autoPronounceOnWordClick).toBe(true);
  preferences.saveReaderPreferences(storage, { ...preferences.DEFAULT_READER_PREFERENCES, autoPronounceOnWordClick: false });
  expect(preferences.loadReaderPreferences(storage).autoPronounceOnWordClick).toBe(false);
});

it('upgrades the old saved-off default once, then respects a later opt-out', async () => {
  const filename = `${readerSourceRoot}/src/frontend/reader-preferences.ts`;
  const adapted = adaptReaderSource(readFileSync(filename, 'utf8'), filename);
  const js = ts.transpileModule(adapted, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const preferences = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  items.set(preferences.READER_PREFERENCES_KEY, JSON.stringify({ ...preferences.DEFAULT_READER_PREFERENCES, autoPronounceOnWordClick: false }));

  expect(preferences.loadReaderPreferences(storage).autoPronounceOnWordClick).toBe(true);
  expect(JSON.parse(items.get(preferences.READER_PREFERENCES_KEY)).autoPronounceOnWordClick).toBe(true);
  preferences.saveReaderPreferences(storage, { ...preferences.DEFAULT_READER_PREFERENCES, autoPronounceOnWordClick: false });
  expect(preferences.loadReaderPreferences(storage).autoPronounceOnWordClick).toBe(false);
});
