# Vantilo

**An agent-first workspace for macOS.**

Vantilo is a new, independent Mac application project. Its core is a BaoCut/Codex-style agent workspace backed by a local Runtime and a unified tool catalog. Agents should be able to compose tools to reshape workflows rather than forcing users through a single fixed sequence.

## Product direction

- **Agent workspace:** conversation-first UI, streaming activity, visible tool calls, approvals, task status, and artifacts.
- **Local Runtime:** owns agent sessions, tasks, event delivery, tool execution, permissions, persistence, and audit logs.
- **Agent drivers:** Codex app-server first; additional engines only after separate compatibility work.
- **Tool catalog:** a single, validated contract for tools that agents can discover and call.
- **Domain capabilities:** local files and projects first; reading and English typing practice next; video workflows through an independent BaoCut adapter later.

## Project boundaries

- This repository is independent from `magazine-reader` and BaoCut.
- Do not modify either original project as part of Vantilo work.
- Do not copy BaoCut code, binaries, UI components, or brand assets into Vantilo. The initial video integration should use public interfaces only.
- Magazine Reader's typing game has code and audio assets whose upstream license status still needs clarification. Do not copy those assets until the rights are verified; a clean reimplementation of the behavior may be preferable.
- Never copy user books, magazine EPUBs, API keys, tokens, cookies, local settings, or private data into this repository.

## Current status

- [x] Product name selected: Vantilo
- [x] Private GitHub repository created
- [x] Local project directory confirmed empty before initialization
- [x] Read-only remote/local architecture audit completed
- [x] Initial project documents published to the private GitHub repository; local and remote file contents verified identical
- [x] Local Git initialized on branch `main` and `origin` configured
- [ ] Fetch remote `main` and reconcile local history (WebCodex Runner HTTPS access to `github.com:443` currently times out)
- [ ] Verify Codex CLI installation/login status in the interactive Mac shell (the WebCodex Runner PATH does not expose `codex`)
- [ ] Agent workspace MVP implemented

See [the architecture audit](docs/architecture-audit.md) and [the roadmap](docs/implementation-roadmap.md).