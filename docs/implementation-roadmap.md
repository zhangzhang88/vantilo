# Vantilo Implementation Roadmap

## Phase 0 — Repository foundation

- [x] Confirm the local Vantilo directory was empty.
- [x] Confirm the private GitHub repository existed and was empty before setup.
- [x] Perform a read-only source and architecture audit.
- [x] Create README, AGENTS, ignore rules, audit, and roadmap locally.
- [x] Publish those initial documents to the private GitHub repository; verify each local file matches its remote copy exactly.
- [ ] Initialize local Git and connect `origin`.
- [ ] Reconcile local Git history with the already-created remote commits and verify the branch state.

## Phase 1 — Agent workspace vertical slice

- [ ] Electron app shell and BaoCut/Codex-style layout.
- [ ] Separate Runtime process and lifecycle supervision.
- [ ] Codex Driver using the supported local app-server protocol.
- [ ] Stream conversation and task events to the UI.
- [ ] One read-only workspace tool with strict path scope.
- [ ] Show tool calls, results, errors, and approval prompts.
- [ ] Persist conversations and task events.
- [ ] Test missing Codex, not logged in, cancellation, Runtime crash, tool failure, and path escape.

## Phase 2 — Tool platform

- [ ] Stable tool IDs and input/output schemas.
- [ ] Effect classification, scope, approval policy, timeout, cancellation, and idempotency.
- [ ] Structured results/errors and redacted audit logging.
- [ ] Tool discovery and per-agent tool exposure.

## Phase 3 — Reading and English typing game

- [ ] Review upstream code and asset rights.
- [ ] Define reading and practice tool contracts.
- [ ] Implement or selectively migrate permitted domain logic.
- [ ] Keep a full-screen human-facing game UI.
- [ ] Let the Agent prepare practice material and inspect results without driving UI clicks.
- [ ] Verify progress persistence and resume behavior.

## Phase 4 — Video tools

- [ ] Inspect the installed BaoCut version and `baocut spec`/public CLI/MCP contracts.
- [ ] Implement an independent adapter; do not bundle or copy BaoCut engine code.
- [ ] Verify create/import/edit/export capabilities one by one.
- [ ] Add clear fallback to manual handoff when a public operation is unavailable.

## Phase 5 — Workflow composition

- [ ] Let the Agent plan and compose tools from the catalog.
- [ ] Add tested workflow templates only for repeatable/high-risk operations.
- [ ] Provide traceable task steps, approval gates, artifacts, and recovery.
- [ ] Validate an end-to-end reading → typing practice → video workflow.

## Non-negotiable boundaries

- Never modify the original Magazine Reader or BaoCut repositories as part of Vantilo work.
- Do not copy private user data or secrets.
- Do not bundle BaoCut code or assets without the necessary written license.
- Do not copy the Worm game source or MP3s until rights are verified.
- Do not mark a phase complete without actual evidence.