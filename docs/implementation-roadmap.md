# Vantilo Implementation Roadmap

## Phase 0 — Repository foundation

- [x] Project documents and independent repository boundaries.
- [x] Fetch `origin/main`; verified local project files and reconciled histories locally.

## Phase 1 — Desktop workspace and Codex session (vertical slice)

- [x] Electron shell, responsive workspace layout, React/Vite/TypeScript build.
- [x] Narrow context-isolated preload bridge; no Renderer Node access; sender/origin checks for IPC.
- [x] Electron `utilityProcess` Runtime lifecycle supervised by the main process; Runtime owns the Codex child process.
- [x] Codex app-server initialize/thread/turn protocol, JSONL buffering/parsing, request IDs, timeouts, error/exit handling, streaming deltas, and cancellation.
- [x] Real conversation messages, activity, runtime status, task completion/error/cancellation in the workspace UI.
- [x] Read-only sandbox; turn-level network disabled; native Codex approval policy `never`. Only the Vantilo Tool Catalog tools are exposed to Codex; every invocation requires a distinct one-time Vantilo approval. Other server-initiated requests are denied; unrecognized MCP startup fails closed.
- [x] Unit tests for JSONL framing, request correlation, deltas, statuses, cancel routing, timeouts, process errors/cleanup, Runtime IPC schemas/correlation/crash handling, and renderer IPC boundary.
- [x] Runtime-owned persistent sessions and local conversation history UI; per-session message isolation and Codex thread recovery.
- [x] Explicit workspace selection, Runtime-owned authorization, and secure exposure of only the Vantilo read-only file catalog.
- [x] Per-call approval UI showing request reason, operation, workspace, relative path, expiry, and explicit allow-once/reject actions; approvals bind to the server request, session, task, and workspace revision and expire or fail closed on cancellation/shutdown.
- [x] Activity UI for pending approvals and tool execution outcomes; no persistent grants.
- [x] Composer styling, fixed bottom toolbar, and session-scoped Codex Agent/model/reasoning-effort menu with keyboard navigation and viewport-bounded overlay.
- [x] Codex model catalog from app-server `model/list`; validated model IDs and reasoning-effort options flow through preload/IPC/Runtime to `thread/start` and every `turn/start`.
- [x] Per-session model settings, workspace ownership, and pin state in session schema v4; v1–v3 migrations preserve messages/thread IDs and fill new fields safely. Running tasks lock settings until the next turn.
- [x] Vantilo-owned composer wrapper uses the separately licensed Spectrum AI PromptField/PromptTokenField APIs with session-local drafts, workspace references, `/list`/`/read`, Codex settings, and send/cancel flow. The native chooser sends selected absolute paths only from main to Runtime for strict workspace validation; Renderer receives only relative references, content is not read during selection, and Codex still needs each one-time read/list approval.
- [x] Keep access fixed to read-only and expose only the local Codex agent/model; do not reproduce BaoCut's write/full-access modes, other engines, or product-specific features unavailable in Vantilo.
- [x] Independently implement Vantilo's page sidebar, pointer/keyboard resizer, and workspace-scoped session/project navigation using Spectrum APIs only as licensed dependencies.
- [x] Independently implement Vantilo's desktop shell with a narrow app rail, conversation header, project/recent-session sidebar, and no task-inspector column; compact workspace controls and Runtime status fit the shell, while unavailable destinations remain labelled placeholders. Visible Vantilo UI copy is localized to Simplified Chinese.
- [x] Remove the embedded browser feature, including its UI, `WebContentsView` host, policy, IPC, and dedicated tests. Vantilo does not provide an embedded browser.
- [x] Independently compose the licensed Spectrum AI PromptField/PromptTokenField APIs, completion items, reference menu, toolbar, and Codex model/reasoning picker around Vantilo session drafts and its live catalog.
- [x] Independently implement role-label-free transcript messages, task status, copy actions, and safe Markdown rendering with licensed Spectrum primitives.
- [x] Render Agent output as GFM Markdown with CJK-friendly emphasis; keep raw HTML, remote images, and external links inert.
- [x] Bind sessions to their creation workspace, scope recent-session navigation on project switches, preserve unassigned legacy history, and support confirmed permanent Codex/local deletion with active-task protection.
- [x] Replace the reviewed BaoCut-attributed UI and CSS implementation with Vantilo-owned modules while retaining Runtime boundaries; see [independent UI review](independent-ui-reimplementation.md).

## Verified protocol and environment (2026-10-24)

- Codex CLI `0.164.0-alpha.11.1`; login status reported logged in.
- Used the installed CLI's `app-server --help` and its `generate-json-schema` / `generate-ts` outputs to verify the JSONL interface, including `dynamicTools` on `thread/start`, the server request `item/tool/call`, its request/response schemas, and `thread/resume`. The tested notification names also include `initialize`, `initialized`, `turn/start`, `turn/interrupt`, `turn/started`, `item/agentMessage/delta`, `item/started`, `item/completed`, `turn/completed`, and `mcpServer/startupStatus/updated`.
- A live app-server handshake and thread creation succeeded. The app-server returned the requested read-only sandbox and `approvalPolicy: never`.
- Fresh bindings generated by the installed Codex CLI `0.164.0-alpha.11.1` confirm `model/list` exposes `isDefault`, supported efforts, and `defaultReasoningEffort`; `thread/start` and `thread/resume` accept a model override and return the effective configured model, while `turn/start` accepts independent model/effort overrides. `TurnStartParams` describes these as overrides (not a “restore default” command); null does not establish that a previously selected thread model/effort was reset. `Thread.model` is documented as configured/latest-persisted state, not per-turn telemetry. Vantilo therefore resolves null reasoning effort to the effective model's `defaultReasoningEffort` from the live catalog, not necessarily the user's Codex configuration; the UI and README describe this explicitly. A live `model/list` call previously returned seven visible models on this machine; choices remain runtime-fetched.
- Earlier integration verified non-default model/effort acceptance and that null-valued fields were accepted on an existing thread, but it only inspected request parameters and did not verify which model actually executed afterward. Runtime now resolves null session settings to the unique live catalog-default model and that model's declared default effort. It verifies the effective model on thread start and on historical-thread resume; for a thread already loaded by the app-server, it avoids a redundant resume and sends concrete model/effort overrides on `turn/start`. The real integration requires a unique catalog default and a distinct, uniquely selectable model A, then checks the same-thread A→default transition and both turn requests; missing/ambiguous defaults, no distinct model, and changed catalog preconditions fail explicitly. Real `npm run test:e2e:codex` passed on 2026-10-25 against the installed Codex CLI: `gpt-6-astra` → catalog default `gpt-6.1-sol`, default effort `low`, approved workspace listing/read, Runtime restart and thread recovery, and rejected read with no file access. This verifies request settings and successful task completion, not per-turn inference telemetry: resume reports persisted thread configuration, while `turn/start` carries Vantilo's current overrides.
- On this machine, app-server startup exposed four configured MCP names (`baocut`, `node_repl`, `codex_apps`, `cua_repl`). Their process-local overrides were validated to disable them without editing user configuration. The driver aborts if another MCP server reports startup.
- Electron `36.9.5` `utilityProcess.fork` and `process.parentPort` were verified against the installed Electron type definitions and exercised in the actual desktop app.
- Runtime starts as a separate Node Utility Process; strict versioned IPC validates request IDs, methods, payloads, health, events, responses, and tracked Codex child PID. The main process handles startup timeout, malformed protocol messages, unexpected Runtime exit, and graceful shutdown.
- `npm run build`: passed after the initial Runtime/session persistence implementation; the current workspace-tool implementation is also build-checked below.
- `npm test`: initial Runtime/session pass was 37 tests across 6 files; current workspace-tool test count is recorded below.
- Real Electron-renderer → preload/IPC → independent Runtime utility process → real Codex CLI → streamed reply → completed-state test passed using a local Chromium DevTools connection.
- Real UI cancellation passed after the Runtime split; the renderer showed `Cancelled`.
- Actual Runtime utility-process SIGKILL was tested: the UI reported `Codex unavailable` and a Runtime-exit error, and the tracked Codex app-server process was terminated. Closing the last app window on macOS now quits Vantilo; the Runtime and Codex child were observed to exit. Graceful app shutdown was also verified.
- Actual Codex app-server SIGKILL was tested after the split: the Runtime stayed responsive and returned a structured error through the UI IPC.
- Unit tests cover startup timeout, malformed messages, concurrent request correlation, cancellation routing, unexpected Runtime/Codex exits, and cleanup.
- App-server stderr is redacted to byte-count diagnostics; credentials and raw stderr are not sent to the renderer.
- Workspace authorization is selected only through Electron's native directory picker, persisted separately under userData, canonicalized, and tied to a monotonically increasing revision. The Runtime alone handles strict versioned tool schemas for `list_workspace_files`, `read_workspace_file`, and (since Phase 2.3) `read_workspace_passage`.
- Tool requests arrive through the verified Codex `item/tool/call` JSON-RPC server request. Unsupported server requests and built-in privileged activities are denied/fail-closed. Per-call approval records carry the server request/call, Codex thread/turn, Vantilo task/session, operation, reason, workspace root/revision, and expiry; approval IDs are single-use and never persisted.
- Automated tests cover strict catalog inputs/outputs, bounded execution and cancellation, sensitive paths, symlink/hard-link/path escapes, approval expiry/replay/session/task mismatch, Codex server-request response correlation, Runtime approval gating, real file access only after approval, and rejection/cancellation without file reads.
- Local conversation storage is a versioned JSON document at `app.getPath('userData')/sessions.json`; queued mutations use an atomic temp-file rename, session directory/file permissions are set to `0700`/`0600`, and credential-like message text is redacted before persistence. Corrupt history is preserved to a sidecar and surfaced to the UI; pending assistant messages are recovered as interrupted after restart. Store, corruption, write-failure, ordering, isolation, and restart behavior have unit tests.
- Real desktop test: two separate Vantilo sessions each completed a real Codex turn; the app was closed and relaunched, both local histories were restored, and the first session resumed its original Codex thread and completed a follow-up without changing its thread ID. Confirmed conversation separation and restrictive file permissions. This was tested in the local Electron/Codex environment, not inferred from unit tests.

- Prior baseline (before the corrective default-model fix): typecheck/build passed and 64 tests across 10 files passed. The earlier authenticated Codex E2E used temporary Vantilo workspace/session files and did not edit Codex config; it verified model/tool request acceptance and thread recovery, but its “default reset” check inspected only nullable request fields, not the effective model. This false assurance motivated the correction. The real Codex E2E passed on 2026-10-25 using isolated temporary Vantilo data and a separate test thread; it did not use the active Vantilo session or alter Codex configuration/authentication. See the protocol and telemetry limitation above.

## Security follow-up

- [x] Packaged Renderer trust now requires the exact canonical `dist/index.html` file URL; IPC sender checks and the main-window `will-navigate` guard use the same fail-closed rule. Regression tests cover forged local paths, encoding/path-normalization variants, query/fragment/protocol mismatches, and development-origin restrictions.
- [x] Embedded-browser DNS rebinding and actual connection-target protection are not applicable: the embedded browser feature was removed. This does not indicate that DNS-rebinding defenses were implemented or verified.

## Phase 2 — Tool platform

- [x] Stable versioned tool IDs/schemas, read-only effects/scopes, per-call approval policy, bounded execution, cancellation/timeouts, structured receipts, and redacted output.
- [x] Secure Runtime enforcement for the explicitly selected workspace, including symlink/hard-link/path/sensitive-file exclusions, capped UTF-8 reads, bounded listings, and atomic persisted authorization.
- [x] Tool catalog, approval service, runtime correlation, IPC/preload/UI boundary, and failure/cancellation behavior covered by automated tests.
- [x] Run `npm run test:e2e:codex` against the local authenticated Codex app-server; real model A→catalog-default switching on the same thread (including default effort), approved listing/read, Runtime restart and thread recovery, and a rejected read with zero file access all passed on 2026-10-25. The test used temporary Vantilo workspace/session data and a separate test thread, did not use the active Vantilo session, and did not edit Codex configuration/authentication. It verifies submitted settings and task success, not per-turn inference telemetry.

### Phase 2.1 — Codex thread/tool-catalog compatibility boundary

- Codex tool definitions are supplied to `thread/start`. The current Vantilo Driver does not supply updated definitions on `thread/resume` or `turn/start`; do not assume that an existing Codex thread can receive a newly added tool catalog. New threads can receive the then-current catalog, while an existing thread may retain its previous definitions.
- Runtime must continue to reject unknown, disabled, incompatible-version, or out-of-current-task-snapshot calls, even if Codex presents or attempts to call a stale tool definition.
- Phase 2.1 did not implement a thread-level catalog fingerprint. Phase 2.2 below adds fingerprinting and conservative migration; it still does not implement a Codex same-thread tool-definition update.

### Phase 2.2 — Thread-scoped catalog compatibility (required before expanding tools)

- [x] Compute a stable SHA-256 fingerprint from the sorted effective Codex tool definitions plus internal IDs/versions, effects, resource scopes, approval policy, and timeout. Persist it in session schema v5 as `toolCatalogFingerprint`; the existing numeric `toolCatalogVersion` is migrated, not retained as a parallel current field.
- [x] Migrate only known v4/legacy `toolCatalogVersion: 1` threads to the archived fingerprint for the exact two-tool definitions shipped by that version. Missing or unrecognized version evidence maps to an unknown fingerprint and an empty allowed-tool set.
- [x] On restore, compare the stored thread fingerprint with the current catalog. Keep only historically proven unchanged tools; unknown or incompatible calls fail before approval/execution. UI reports partial/unknown/incompatible status, offers a new conversation, and continues ordinary chat/history/model selection.
- [x] Do not assume tool definitions refresh on `thread/resume` or `turn/start`; new definitions are sent only when creating a thread with `thread/start`. No real Codex E2E or same-thread update path is claimed.

### Phase 2.3 — First reading-domain vertical slice

- [x] Add `vantilo.reading.read-passage`: one explicitly requested 1-based inclusive range from authorized `.md`, `.markdown`, `.txt`, or `.text` files, with per-call approval, line/output/scan bounds, and explicit untrusted-source metadata.
- [x] Reuse WorkspaceAuthority path, symlink, hard-link, workspace-revision, and file-identity checks; do not traverse or automatically ingest whole books.
- [x] Fingerprint the expanded catalog while retaining the immutable v1 archive. New threads receive the passage tool; migrated v1 threads remain limited to their historically supplied list/read tools. `thread/resume` and `turn/start` do not refresh definitions.
- [x] Bump the strict Runtime IPC protocol contract to version 7 for the new tool names and compatibility payload schema.
- [ ] Real Codex passage E2E: **NOT RUN**. Current evidence is local Fake Driver/app-server simulation and unit tests only; this is not real Codex acceptance. The last confirmed local checks were 145 tests passed, `npm run typecheck`, `npm run build`, and `git diff --check` passed. No remote thread or real model request has been created for the Passage E2E.

## Phase 3 — English typing game

- [ ] Review upstream code and asset rights before reuse; otherwise independently implement domain behavior.

## Phase 4 — Video tools

- [ ] Verify public BaoCut interfaces and license; implement independent adapter only.

## Phase 5 — Workflow composition

- [ ] Agent-composed workflows with traceable steps, approvals, artifacts, and recovery.

## Non-negotiable boundaries

Never modify protected projects, copy unlicensed code/assets or private data, bundle BaoCut engine assets without permission, or weaken tests/safety controls.


## Phase 3 — Existing Magazine Reader module

- [x] Add a home action and persistent app-rail entry to open the existing Magazine Reader in Vantilo's main workspace, with a one-click return to Agent.
- [x] Start the original Reader's local frontend/API only on demand, use fixed loopback ports (5175 / 5174), suppress automatic source sync on Vantilo-triggered startup, and stop only child processes owned by Vantilo.
- [x] Keep the module URL fixed, sandbox its iframe, constrain frame navigation to the Reader loopback origin, and expose only a trusted-renderer IPC method to request startup. No generic browser, address bar, or arbitrary URL API is restored.
- [x] Add mocked lifecycle, constrained IPC/navigation, frontend-adapter and module UI tests; document source-project, external-API and localStorage boundaries in [the integration review](magazine-reader-integration.md).
- [x] Use non-watch API startup, Reader-owned Vite dependencies with an external cache, bounded process-group cleanup and cancellation; detect visible-module service failures and offer retry.
- [ ] Electron GUI manual acceptance is not performed in this task; no real Codex E2E, Reader sync or AI provider calls are run.
- [ ] Future packaging work: vendor or package the Reader frontend/backend and its runtime dependencies for portable Vantilo distribution. Current integration expects the original local project path and its existing npm dependencies.


## Current development — Reader and Agent unification (2026-10-25)

- [x] Compile the original Reader through a read-only adaptation layer; keep private records and credentials out of build output. Explicitly requested EPUB seed content is tracked by a separate manifest.
- [x] Remove science-article functionality and independent Reader AI-service configuration/engine from the Vantilo variant.
- [x] Reuse native ChatGPT account, AgentComposer and AgentRuntime task code; keep original Reader scoped conversations and model preferences separate from project sessions. Runtime IPC is v10 and session storage v6.
- [x] Add isolated per-user library and first-use/default workspace; retain source-project data untouched.
- [x] Four-publication scheduled/manual checks with fixed source, bounded downloads, retry and deduplication, verified with synthetic issues.
- [x] Source/build/unit and isolated Electron frontend/layout verification; no real model calls or upstream downloads.
- [ ] Real ChatGPT sign-in and completed inference acceptance with the user, then review any remaining product adjustments.
- [ ] Mac application packaging is **paused by user request**; only resume after explicit instruction. Prior ignored out/ artifacts are not current deliverables.

## Offline starter library

- [x] User explicitly authorized local reuse of the existing EPUB inventory: 19 issues and 11 ebooks. Source remains read-only; ignored build assets hold only EPUBs and an integrity manifest.
- [x] Initialize both Reader shelves offline before opening the API; preserve existing files, deduplicate content, resume per-entry imports and respect subsequent user deletion.
- [x] Populate the current local Vantilo library; read-only running API checks identify 19 issues and 11 books.
- [x] Synthetic tests cover first launch, duplicate/filename conflicts, interruption, upgrades, corrupt content/ledger, symlink/traversal rejection and release-content guards. Full suite: 197 tests pass.
- [ ] Confirm the distributable content catalog and its individual rights/evidence before creating an installer. Current seed is for personal development. Packaging remains paused.

## Reader conversation correction (2026-10-26)

- [x] Restore original scoped assistant, quick prompts and book preparation/candidate confirmation; Reader never uses the selected Agent project conversation.
- [x] Share source components, native login/catalog and Runtime/Driver code with independent Reader history, drafts, model preferences and private zero-tool task context.
- [x] Hide internal task records/events from project navigation; cancel only the correlated Reader request; preserve old project histories on missing rollout.
- [x] Replace Reader's external TTS/font loading with device facilities. Voice quality and real-account inference remain unverified.
- [ ] User acceptance after a full development-app restart; packaging remains paused.

## Parallel execution (2026-10-26)

- [x] Agent and Reader use separate Runtime/Driver instances with the same native credential home; one active turn per lane, bounded serial queue within Reader.
- [x] Lazy Reader startup, correlated cancellation, independent stores, account-change guard and supervision of both native child processes.
- [x] Runtime IPC v12 restores authoritative task occupancy; duplicate sends and terminal native errors no longer leave a stale send state.
- [ ] Real-account simultaneous inference acceptance remains unverified; packaging remains paused.

## Permission modes (2026-10-26)

- [x] Add the Agent composer permission-mode entry point and make the current supervised/read-only mode explicit.
- [x] Show and wire the four permission modes in the Agent composer; higher modes are constrained to the currently published workspace tools.
- [ ] Add command execution with explicit risk classes before expanding “automatic” or “full access” beyond workspace tools.
- [ ] Persist the selected mode per Agent session and enforce it in Runtime; Reader remains independently read-only.
- [x] Add the first scoped `write_workspace_file` tool for the supervised Agent lane; it requires explicit approval and is disabled in Reader.
- [x] Enable “automatic edit approval” only for that bounded text-file tool; automatic/full-access currently cover only the published workspace tools.
