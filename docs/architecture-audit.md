# Vantilo Architecture Audit

**Audit date:** 2026-10-24  
**Status:** Read-only source audit completed; local Git initialized and `origin` configured; remote history fetch, interactive Mac Codex probe, and legal review remain open.  
**Scope:** Vantilo's empty local directory and empty private remote, the local Magazine Reader source, the public BaoCut source, and the upstream source location documented for the typing-game migration.

## 1. Verified project state

### Vantilo

- Local directory: the Vantilo repository checkout.
- The initial project listing showed this directory was empty before setup.
- At the initial audit, Git status reported that `Vantilo` was not yet a Git repository.
- GitHub repository: [zhangzhang88/vantilo](https://github.com/zhangzhang88/vantilo).
- GitHub metadata confirms it is **private** and uses `main` as the default branch. **At the initial pre-setup check**, repository size was `0` and a tree request returned GitHub API 409 (`Git Repository is empty`), confirming that the remote was empty before the starter documents were published.

The initial files were created without overwriting existing Vantilo files and published to the private GitHub repository through the GitHub Contents API. The local and remote copies of `README.md`, `AGENTS.md`, `.gitignore`, `docs/architecture-audit.md`, and `docs/implementation-roadmap.md` were compared and matched exactly before the latest status update. At the time of this audit, the local repository had been initialized on branch `main`, `origin` was configured as `https://github.com/zhangzhang88/vantilo.git`, and GitHub HTTPS probes from the WebCodex Runner timed out, so the remote history had not yet been fetched or reconciled. This is historical status: `origin/main` was subsequently fetched and reconciled into local `main`; the current Git history records that relationship. The initial network limitation and recommendation not to create an unrelated root commit no longer describe the current repository state.

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

BaoCut's desktop application uses Electron. The main process manages the window and supervises the Runtime; preload and renderer are separate; shared UI components implement the Home workspace and conversation view. The Home workspace combines a conversation sidebar, central conversation, and workspace panes for task outputs. This was the interaction reference during initial architecture planning. A subsequent corrective implementation review replaced the previously BaoCut-attributed UI and browser-host modules with Vantilo-owned implementations; only separately licensed Spectrum dependencies and the attributed third-party Codex icon remain. See [the independent UI implementation review](independent-ui-reimplementation.md).

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

BaoCut's inspected Codex Driver uses the `codex app-server` machine protocol rather than embedding the ChatGPT website. It discovers the local Codex executable, checks version and account/login status, creates sessions, receives events, and handles tool/approval interactions. The inspected source currently declares a minimum Codex version of `0.158.0`; treat that as a source-version detail, not a permanent requirement. The WebCodex Runner does not expose `codex` in its PATH, and checks of several common executable locations found no CLI there. The actual CLI version and login state in the user's interactive Mac shell remain unverified; the Runner result does not prove that Codex is absent from the regular Terminal environment.

Vantilo should use the supported local Codex CLI/app-server path and report installation/login state without reading or printing private credential files. The CLI and login state were unverified at the time of this initial audit; later protocol checks and the real Codex integration are recorded in the implementation roadmap. Do not build a custom OAuth flow or scrape ChatGPT cookies.

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

The current components use React portals for the full-screen game. `learning-state.ts` contains the state transitions and a versioned progress contract; UI components should not be treated as the only source of the game rules. The owner confirmed that the layout/keyboard-lifecycle code in `assembly-typing-game.tsx` is their copyrighted code from their own Worm project and authorized its public distribution in Vantilo. The former `use-game-sounds.ts` hook's external MP3 dependency has been replaced with original synthesized tones; no Worm MP3 assets are included.

### Reuse and license status

The earlier migration audit identified `pke-course-studio/worm_28-experiment` and could not find its LICENSE files. Since that audit, the project owner explicitly confirmed that the repository is their own project, that the layout/keyboard-lifecycle code in `assembly-typing-game.tsx` is their copyrighted work, and that its use and public distribution in Vantilo are authorized. This confirmation covers that specific source code only; it does not authorize third-party dependencies or other sounds/images/media. The copied MP3 assets were excluded, and Vantilo now synthesizes its own game tones. Do not ask the owner to re-prove the confirmed source-code rights.

- Preserve the source attribution and the scope of the owner's confirmation.
- Review third-party dependency notices and any independently sourced assets/services separately.
- Keep game domain logic independent of React UI so it can be exposed both as user-facing game actions and Agent tools.

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

- [x] Actual Codex CLI install/version/login status on the Mac was verified later; see the implementation roadmap's protocol/environment record.
- The exact current BaoCut CLI/MCP command contract and the locally installed BaoCut version (BaoCut was not listed as a local project; source was reviewed remotely).
- Audit third-party dependency notices and independently sourced media/services; the owner's Worm source-code confirmation does not extend to those materials.
- Local code signing/notarization and packaging requirements for a distributable Mac app.
- User data directory and backup/restore contract for Vantilo.

## 9. Conclusion

The remote and local source audit supports this direction: **BaoCut/Codex-style Agent workspace + independent local Runtime + Codex app-server Driver + one tool catalog**. Magazine Reader's two-stage English typing game is a high-value domain capability. Its owner-confirmed source code is authorized for Vantilo distribution; separately sourced assets and third-party dependencies still require their own review. Video integration should begin as an adapter, not an embedded BaoCut engine.

This is an architecture audit, not an implementation or runtime verification report. The game-source ownership and distribution permission described above are confirmed by the project owner; local Codex state and third-party rights remain subject to their separately documented verification.
