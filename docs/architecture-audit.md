# Vantilo Architecture Audit

**Audit date:** 2026-10-24  
**Status:** Read-only source audit completed; local Codex probe and legal review remain open.  
**Scope:** Vantilo's empty local directory and empty private remote, the local Magazine Reader source, the public BaoCut source, and the upstream source location documented for the typing-game migration.

## 1. Verified project state

### Vantilo

- Local directory: `/Users/world/Downloads/code/Vantilo`.
- The local project listing showed this directory; recursive listing returned only `Vantilo/`, and the top-level file listing reported `(empty directory)`.
- Git status reported that `Vantilo` is not yet a Git repository.
- GitHub repository: [zhangzhang88/vantilo](https://github.com/zhangzhang88/vantilo).
- GitHub metadata confirms it is **private**, uses `main` as the default branch, and has repository size `0`. A tree request returned GitHub API 409, `Git Repository is empty`.

The initial files in this directory can therefore be created without overwriting existing Vantilo files. Git initialization and remote synchronization are a separate step.

### Magazine Reader — protected; not modified

Local status before this audit:

- Branch `main`, 23 commits ahead of `origin/main`.
- One existing unstaged user change: `src/frontend/book-detail-content.css`.
- The observed diff adds:
  `.book-continue-card .book-cover[data-cover-source="epub"] .book-cover-fallback { display: none; }`

This change is user work and must be preserved. No files were changed by this audit.

The local project uses React 19, Vite 7, TypeScript, Fastify 5, and ESM. It already has a Codex-oriented reading/lesson-preparation assistant, but Vantilo must not adopt that workflow as its primary UI. Vantilo's primary UI is the agent workspace.

## 2. BaoCut architecture findings

Sources reviewed include BaoCut's public README, desktop README, Runtime, Runtime supervisor, Tool Catalog, Codex Driver, and Codex executable/login probe:

- [BaoCut README](https://github.com/JimLiu/baocut/blob/main/README.zh-Hans.md)
- [Desktop architecture](https://github.com/JimLiu/baocut/blob/main/apps/desktop/README.md)
- [Runtime](https://github.com/JimLiu/baocut/blob/main/packages/runtime-core/src/runtime.ts)
- [Runtime supervisor](https://github.com/JimLiu/baocut/blob/main/apps/desktop/src/main/runtime-supervisor.ts)
- [Tool Catalog](https://github.com/JimLiu/baocut/blob/main/packages/runtime-core/src/agent-tools/tool-catalog.ts)
- [Codex Driver](https://github.com/JimLiu/baocut/blob/main/packages/agent-drivers/src/codex/codex-driver.ts)
- [Codex discovery and login probe](https://github.com/JimLiu/baocut/blob/main/packages/agent-drivers/src/codex/codex-binary.ts)

### Desktop UI

BaoCut's desktop application uses Electron. The main process manages the window and supervises the Runtime; preload and renderer are separate; shared UI components implement the Home workspace and conversation view. The Home workspace combines a conversation sidebar, central conversation, and workspace panes for task outputs. This is the right interaction reference for Vantilo, without copying BaoCut's UI code, branding, or assets.

### Runtime and Tool Catalog

BaoCut's README states that desktop, CLI, MCP, and Web entry points share a Runtime. The Runtime owns agent drivers, session/task handling, scopes/grants, persistence, logs, and domain services.

The inspected Tool Catalog defines typed tools with:
- stable name/title and usage description;
- input schema;
- effect metadata and hints such as read-only, destructive, and idempotent;
- examples and supported surfaces;
- scope-aware exposure and dispatch;
- structured success/error outcomes.

Vantilo should implement its own independent Tool Catalog with the same architectural principles. Avoid copying the implementation.

### Codex integration

BaoCut's inspected Codex Driver uses the `codex app-server` machine protocol rather than embedding the ChatGPT website. It discovers the local Codex executable, checks version and account/login status, creates sessions, receives events, and handles tool/approval interactions. The inspected source currently declares a minimum Codex version of `0.158.0`; treat that as a source-version detail, not a permanent requirement. The actual CLI version and login state on this Mac have **not** been verified because the local command-execution probe did not run successfully.

Vantilo should first use the supported local Codex CLI/app-server path and report installation/login state without reading or printing private credential files. Do not build a custom OAuth flow or scrape ChatGPT cookies before confirming that the supported CLI protocol meets the product need.

## 3. Magazine Reader typing-game findings

Sources reviewed locally:

- `src/frontend/assembly-typing-game.tsx`
- `src/frontend/vocabulary-preparation-game.tsx`
- `src/frontend/learning-state.ts`
- `src/frontend/use-game-sounds.ts`
- `docs/LEARNING-ENGINE-V0.2.md`
- `docs/LEARNING-ENGINE-SOURCE-AUDIT-V0.2.md`
- `public/worm/README.md`

The game has two substantial phases:

1. **Vocabulary preparation:** select vocabulary, mask a target word in its source sentence, enter it word by word, lock correct positions, retry errors, reveal hints, and use speech/audio.
2. **Full-screen sentence typing/assembly:** Chinese prompt, word-by-word English input slots, keyboard navigation, submit/retry, lock correct words, correct errors, reveal answer, elapsed time, progress, speech, sound settings, and independent phase progress.

The current components use React portals for the full-screen game. `learning-state.ts` contains the state transitions and a versioned progress contract; UI components should not be treated as the only source of the game rules. `use-game-sounds.ts` states that its playback hook is adapted from Worm's `hooks/useGameSounds.ts`. `public/worm/README.md` states that three MP3 files were copied unchanged and records their hashes.

### Reuse and license status

The Magazine Reader migration audit identifies `/Users/world/Downloads/code/pke-course-studio/worm_28-experiment` as the read-only upstream source and records upstream commit `babc41aa1ef3ced46c55d06878d25ef4a98cfee3`. The expected `LICENSE` files at the upstream subdirectory and parent root were not found by the local file-read checks. This does **not** prove that no other license or rights statement exists; it means permission is not yet verified.

Therefore:
- do not copy the Worm source components or the three MP3 files into Vantilo until the applicable rights are confirmed;
- first review the upstream repository's full license/history and asset provenance;
- if rights remain unclear, implement equivalent behavior from the observed product contract without copying source code or audio;
- keep the game domain logic independent of React UI so it can be exposed both as user-facing game actions and Agent tools.

## 4. BaoCut license boundary

The inspected [BaoCut LICENSE](https://github.com/JimLiu/baocut/blob/main/LICENSE) is **BaoCut Community License 1.0**, dated October 7, 2026. It is source-available, not an unrestricted permissive license. It allows creating and monetizing video content, but section 3 says selling/distributing BaoCut software or incorporating its code, binaries, or engine into a commercial software product requires a separate written commercial license. The license also says an independently written plugin, integration, or client that only uses BaoCut public interfaces and contains no BaoCut software code is not covered merely because it interoperates.

Initial Vantilo approach:
- build an independent adapter around documented/public BaoCut CLI/MCP interfaces;
- do not bundle BaoCut binaries, copy its source, or use its logo/UI assets;
- verify the exact interface contract and current license before shipping;
- obtain written permission before any commercial bundling or engine embedding.

## 5. Recommended Vantilo architecture

```text
Vantilo.app (Electron shell)
├── Renderer UI (React + TypeScript)
│   ├── conversation sidebar and history
│   ├── central Agent conversation and streamed events
│   └── workspace panes for tool calls, approvals, and artifacts
├── Preload / narrow IPC bridge
└── Local Runtime (separate process)
    ├── session and task manager
    ├── event stream and cancellation
    ├── Agent Driver registry
    │   └── Codex app-server (first)
    ├── Tool Catalog (schema + scope + effect + approval)
    ├── permission/approval service
    ├── persistence, audit log, and artifact store
    └── domain tools
        ├── workspace/file tools
        ├── reading tools
        ├── typing-practice tools
        └── BaoCut public-interface adapter (later)
```

The Renderer must not receive unrestricted filesystem or shell access. Privileged operations should go through Runtime with explicit scope checks, validated inputs, approval policy, cancellation, timeouts, structured errors, and secret-redacted logs.

## 6. First vertical slice and acceptance criteria

Build only the agent-workspace foundation first; do not begin a broad feature migration.

1. Electron shell with a BaoCut/Codex-like conversation workspace.
2. Runtime lifecycle: start, health check, stop, reconnect, and failure display.
3. Codex Driver: detect installation/version/login status, start a session, receive streamed events, and cancel a task.
4. Tool Catalog and one read-only tool, such as listing or reading a file under an explicitly authorized workspace.
5. A write-operation approval demonstration, disabled by default.
6. Persistence for conversations, task state, tool events, and artifact references.

Acceptance:
- app starts without the user manually launching multiple terminals;
- missing/outdated/not-logged-in Codex states are clearly reported;
- Agent output streams into the conversation;
- a tool call and its result are visible and traceable;
- path traversal and out-of-scope access are rejected;
- write/command operations follow approval policy;
- task cancellation and Runtime reconnect are handled;
- original projects remain unchanged.

## 7. Roadmap

1. **Project foundation:** independent repository, instructions, audit, ignore rules, and verified remote.
2. **Agent workspace:** Electron UI, Runtime supervisor, Codex Driver, conversation/event model.
3. **Tool platform:** schemas, discovery, scope, approval, execution receipt, timeout/cancellation, logs.
4. **Reading and typing game:** after source/asset license review; expose the same domain functions to UI and Agent tools.
5. **Video adapter:** public BaoCut interface only; verify actual CLI/MCP commands before promising automatic timeline creation.
6. **Cross-tool workflows:** let the Agent compose tools dynamically; use fixed templates only where repeatability or safety requires them.

## 8. Outstanding verification

- Actual Codex CLI install/version/login status on the Mac.
- The exact current BaoCut CLI/MCP command contract and the locally installed BaoCut version (BaoCut was not listed as a local project; source was reviewed remotely).
- Full rights status for Worm game source and audio assets.
- Local code signing/notarization and packaging requirements for a distributable Mac app.
- User data directory and backup/restore contract for Vantilo.

## 9. Conclusion

The remote and local source audit supports this direction: **BaoCut/Codex-style Agent workspace + independent local Runtime + Codex app-server Driver + one tool catalog**. Magazine Reader's two-stage English typing game is a high-value domain capability, but its upstream source and sound assets need a rights check before reuse. Video integration should begin as an adapter, not an embedded BaoCut engine.

This is an architecture audit, not an implementation or runtime verification report. The local Codex state and game-source rights remain unverified.