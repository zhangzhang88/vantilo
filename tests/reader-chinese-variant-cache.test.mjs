import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { beforeAll, expect, it } from 'vitest';
import { readerSourceRoot } from '../scripts/reader-source-path.mjs';
import { adaptReaderSource } from '../scripts/reader-variant.mjs';

let cache;
beforeAll(async () => {
  const result = await build({
    entryPoints: [`${readerSourceRoot}/src/frontend/chinese-translation-reuse.ts`],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{
      name: 'production-translation-variant',
      setup(builder) {
        builder.onLoad({ filter: /paragraph-translation-state\.ts$/ }, async args => ({
          contents: adaptReaderSource(await readFile(args.path, 'utf8'), args.path, { translationPreview: true, qwenPreview: false }),
          loader: 'ts',
        }));
      },
    }],
  });
  cache = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
});

it('restores custom-API records from the exact selected-engine cache without borrowing Codex records', () => {
  const id = 'custom-api:012345abcdef', other = 'codex:gpt-6';
  const key = 'magazine-reader-paragraph-translations-v1';
  const document = { kind: 'article', issueId: 'economist:2026-10-31', articleId: 'world-this-week',
    documentId: 'reading:article:economist:2026-10-31:world-this-week' };
  const sourceText = 'The world this week';
  const target = { key: `${document.documentId}:title`, targetKind: 'title', document, paragraphIndex: -1, sourceText };
  const base = { ...target, translationZh: '本周世界', provider: 'custom-api', model: 'Qwen3.5', generatedAt: '2026-11-06T08:00:00.000Z' };
  const data = new Map([
    [`${key}:vantilo-v2:${id}`, JSON.stringify([base])],
    [`${key}:vantilo-v2:${other}`, JSON.stringify([{ ...base, translationZh: '另一模型译文', provider: 'vantilo-agent' }])],
  ]);
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) };
  const records = cache.loadListeningTranslations(storage, id);
  expect(records).toHaveLength(1);
  expect(records[0].provider).toBe('custom-api');
  expect(cache.restoredListeningTranslations(records, [{target}], true)).toEqual({ [target.key]: '本周世界' });
  expect(cache.restoredListeningTranslations(cache.loadListeningTranslations(storage, other), [{target}], true)).toEqual({ [target.key]: '另一模型译文' });
  expect(data.get(key)).toBeUndefined();
});
