# Reader test layers

Run these commands from the Vantilo repository root:

```sh
npm run test:offline --workspace=@vantilo/reader
npm run typecheck --workspace=@vantilo/reader
```

The offline suite uses synthetic, original EPUB/HTML fixtures under `packages/reader/tests/fixtures/`. It does not read the personal `issues/` or `books/` library and does not call a real model. The Codex protocol test invokes the installed `@openai/codex` JavaScript entry point only to generate and inspect its app-server schema; Codex preparation logic is otherwise tested with injected mocks.

## Real magazine corpus integration

`src/epub/economist-parser.test.ts` verifies parser fidelity against six real publication issues, including specific long-form article text and image placement. This is intentionally not synthesized. The tests are skipped by default unless all required local EPUBs are supplied through `VANTILO_READER_CORPUS_DIR`:

- `TheEconomist.2026.09.19.epub`
- `TheEconomist.2026.09.12.epub`
- `TheNewYorker.2026.09.21.epub`
- `TheNewYorker.2026.09.14.epub`
- `TheAtlantic.2026.09.02.epub`
- `Wired.2026.09.02.epub`

Run this layer explicitly with:

```sh
VANTILO_READER_CORPUS_DIR=/absolute/path/to/authorized/issues npm run test:corpus --workspace=@vantilo/reader
```

The command fails before Vitest if the variable or any required file is absent. Keep corpus files local; do not copy them into the repository, test fixtures, build artifacts, or release packages.

## Real Codex/model and external-service checks

The offline tests do not establish successful authentication or model inference. Root-level `npm run test:e2e:codex` and `npm run test:e2e:codex:passage` are separate live integrations; run only with an intentionally configured Codex session and clearly report live-service results separately from offline tests.
