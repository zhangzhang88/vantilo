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
- [x] Read-only sandbox; turn-level network disabled; native Codex approval policy `never`. Only the two Vantilo dynamic workspace tools are exposed to Codex; every invocation requires a distinct one-time Vantilo approval. Other server-initiated requests are denied; unrecognized MCP startup fails closed.
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
- [x] Independently implement Vantilo's desktop shell with a narrow app rail, top navigation, conversation/browser tabs, project/recent-session sidebar, and no task-inspector column; compact workspace controls and Runtime status fit the shell, while unavailable destinations remain labelled placeholders. Visible Vantilo UI copy is localized to Simplified Chinese.
- [x] Add a Vantilo-owned isolated `WebContentsView` browser host: no Node/preload, no inherited system-browser cookies, explicit URL validation, request-level loopback-host-literal/app-origin blocking, disabled permissions/downloads/popups, and owner-window-scoped IPC. Unit tests cover sandbox options, sender ownership, URL rules, permissions, navigation, and bounds.
- [x] Independently compose the licensed Spectrum AI PromptField/PromptTokenField APIs, completion items, reference menu, toolbar, and Codex model/reasoning picker around Vantilo session drafts and its live catalog.
- [x] Independently implement role-label-free transcript messages, task status, copy actions, and safe Markdown rendering with licensed Spectrum primitives.
- [x] Render Agent output as GFM Markdown with CJK-friendly emphasis; keep raw HTML and remote images inert, and route clicked HTTP(S) links into the isolated browser.
- [x] Bind sessions to their creation workspace, scope recent-session navigation on project switches, preserve unassigned legacy history, and support confirmed permanent Codex/local deletion with active-task protection.
- [x] Replace the reviewed BaoCut-attributed UI, CSS, and browser-host implementation with Vantilo-owned modules while retaining Runtime boundaries and browser security policies; see [independent UI review](independent-ui-reimplementation.md).

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
- Workspace authorization is selected only through Electron's native directory picker, persisted separately under userData, canonicalized, and tied to a monotonically increasing revision. The Runtime alone handles strict versioned tool schemas for `list_workspace_files` and `read_workspace_file`.
- Tool requests arrive through the verified Codex `item/tool/call` JSON-RPC server request. Unsupported server requests and built-in privileged activities are denied/fail-closed. Per-call approval records carry the server request/call, Codex thread/turn, Vantilo task/session, operation, reason, workspace root/revision, and expiry; approval IDs are single-use and never persisted.
- Automated tests cover strict catalog inputs/outputs, bounded execution and cancellation, sensitive paths, symlink/hard-link/path escapes, approval expiry/replay/session/task mismatch, Codex server-request response correlation, Runtime approval gating, real file access only after approval, and rejection/cancellation without file reads.
- Local conversation storage is a versioned JSON document at `app.getPath('userData')/sessions.json`; queued mutations use an atomic temp-file rename, session directory/file permissions are set to `0700`/`0600`, and credential-like message text is redacted before persistence. Corrupt history is preserved to a sidecar and surfaced to the UI; pending assistant messages are recovered as interrupted after restart. Store, corruption, write-failure, ordering, isolation, and restart behavior have unit tests.
- Real desktop test: two separate Vantilo sessions each completed a real Codex turn; the app was closed and relaunched, both local histories were restored, and the first session resumed its original Codex thread and completed a follow-up without changing its thread ID. Confirmed conversation separation and restrictive file permissions. This was tested in the local Electron/Codex environment, not inferred from unit tests.

- Prior baseline (before the corrective default-model fix): typecheck/build passed and 64 tests across 10 files passed. The earlier authenticated Codex E2E used temporary Vantilo workspace/session files and did not edit Codex config; it verified model/tool request acceptance and thread recovery, but its “default reset” check inspected only nullable request fields, not the effective model. This false assurance motivated the correction. The real Codex E2E passed on 2026-10-25 using isolated temporary Vantilo data and a separate test thread; it did not use the active Vantilo session or alter Codex configuration/authentication. See the protocol and telemetry limitation above.

## Security follow-up

- [x] Packaged Renderer trust now requires the exact canonical `dist/index.html` file URL; IPC sender checks and the main-window `will-navigate` guard use the same fail-closed rule. Regression tests cover forged local paths, encoding/path-normalization variants, query/fragment/protocol mismatches, and development-origin restrictions.
- [ ] Browser DNS rebinding and actual connection-target restrictions are unresolved. Current filtering checks URL host literals and app origins; it does not validate DNS answers or prevent public hostnames from resolving to loopback, private, or link-local addresses. Do not claim browser network isolation is fully secure. Before making that claim, evaluate a controlled proxy or another network-layer design that constrains the actual destination IP for every connection and redirect, and test its bypass resistance and DNS-race behavior.

## Phase 2 — Tool platform

- [x] Stable versioned tool IDs/schemas, read-only effects/scopes, per-call approval policy, bounded execution, cancellation/timeouts, structured receipts, and redacted output.
- [x] Secure Runtime enforcement for the explicitly selected workspace, including symlink/hard-link/path/sensitive-file exclusions, capped UTF-8 reads, bounded listings, and atomic persisted authorization.
- [x] Tool catalog, approval service, runtime correlation, IPC/preload/UI boundary, and failure/cancellation behavior covered by automated tests.
- [x] Run `npm run test:e2e:codex` against the local authenticated Codex app-server; real model A→catalog-default switching on the same thread (including default effort), approved listing/read, Runtime restart and thread recovery, and a rejected read with zero file access all passed on 2026-10-25. The test used temporary Vantilo workspace/session data and a separate test thread, did not use the active Vantilo session, and did not edit Codex configuration/authentication. It verifies submitted settings and task success, not per-turn inference telemetry.

## Phase 3 — Reading and English typing game

- [ ] Review upstream code and asset rights before reuse; otherwise independently implement domain behavior.

## Phase 4 — Video tools

- [ ] Verify public BaoCut interfaces and license; implement independent adapter only.

## Phase 5 — Workflow composition

- [ ] Agent-composed workflows with traceable steps, approvals, artifacts, and recovery.

## Non-negotiable boundaries

Never modify protected projects, copy unlicensed code/assets or private data, bundle BaoCut engine assets without permission, or weaken tests/safety controls.
