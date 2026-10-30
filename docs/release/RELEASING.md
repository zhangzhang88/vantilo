# Vantilo release procedure

When asked **“功能已在本地开发版真人验收通过，开始发布 Vantilo 新版本”**, **“开始发布 Vantilo 新版本”**, **“发布 Vantilo”**, or **“准备 Vantilo Release”**, first read this document, root AGENTS.md, and the applicable [macOS Universal build instructions](macos-universal-build.md). Follow the complete development-to-release workflow using the actual current and target versions, Git and remote state, release commit, artifacts and SHA-256. Resume safely from verified completed steps; never blindly recreate or overwrite an existing tag or Release. Past hashes and release decisions are not reusable authorization.

## Acceptance gates and artifact identity

Treat these as separate gates and record evidence and PASS, FAIL or NOT RUN for each:

1. **Source verification:** run relevant automated tests, typecheck and production builds for the intended release source. These do not establish a human UI result or packaged-app behavior.
2. **Development-version human acceptance:** record the owner's acceptance of the actual changed features in the development app and the source state tested. Do not infer this from tests or a launch.
3. **Packaged-app acceptance:** unpack the exact candidate ZIP into an independent test location and launch the actual packaged application with isolated userData and storage. Verify the changed features and relevant regressions using synthetic data and simulated services as applicable. For restart persistence, fully exit the packaged app, verify the process has exited, relaunch it and check the restored position; a Reader test-host restart or page reload is not equivalent. Verify signature, notarization, Gatekeeper, icon and architecture separately. Do not claim Intel hardware acceptance from Universal slices.

Any feature source change after an older artifact was built requires a new version-specific Universal ZIP built and accepted from the corresponding intended source commit; never reuse the older commit's package. Reuse an already accepted ZIP only when its version, exact feature source commit, build report, SHA-256 and applicable acceptance evidence all match the intended release. Documentation-only commits after the build do not move the release tag away from the build commit.

**All required package acceptance must pass before pushing source, creating a tag or publishing a GitHub Release.** If a required check fails or has not run, stop the release and report the exact gap; a previous release is not evidence that the current candidate passed. Do not overwrite existing versioned artifacts.

## Before building

1. Inspect Git status, staged and unstaged changes, current branch and HEAD, version metadata, remote main, local and remote tags, and GitHub Releases. Preserve unrelated changes. Confirm the intended release commit and do not overwrite an existing version.
2. Run relevant Reader tests, full root tests, typecheck and production build; record passes, failures and skips. Commit only reviewed files when explicitly authorized.
3. Run `/bin/sh /Volumes/Workspace/_System/verify-workspace-volume.sh` before build writes or downloads, and inspect `df -h`. Confirm the expected Workspace UUID, APFS, `/Volumes/Workspace`, writable state and adequate free space. Stop if validation fails; do not silently put builds, caches or downloads on the internal disk.
4. Follow the Universal manual to create a new version-specific copy under `/Volumes/Workspace/Development/Vantilo/workspaces/`; preserve and compare the exact branch, HEAD, status, diff and untracked files. Exclude secrets, personal libraries and local data. Verify dependencies, links and input archives before reuse. Route HOME, temp and caches to the verified external workspace; link `out` to the management root's `out`.
5. Run `npm run build:mac:universal` with the external environment configured as in the manual. It builds the app and Reader and emits only ZIP, SHA-256 sidecar and report in a new `out/<version>/`. No DMG. The Intel dictionary helper gate must freshly compile current source and compare against the versioned input under the script's existing rule, allowing only the specified Mach-O UUID difference. Preserve old inputs; on mismatch stop and investigate, never disable or weaken the gate. Verify ZIP integrity, sidecar, report commit, version, architectures and packaged EPUB count, then complete the packaged-app acceptance gate above.

## Observed 0.1.12 build issues

- **SWC cache permissions:** Workspace ancestors failed SWC's cache ownership check. A new APFS sparse image under the external work copy's `build/runtime-tmp` was mounted separately; its private `native-bindings` directory allowed the native binding to load. Verify image backing, mount and permissions; never redirect to internal storage.
- **Outdated Intel dictionary helper:** the old shared helper retained `prefix(8000)` removed from current source. Preserve it. The current-source helper was placed in `universal-inputs/native-x64-0.1.12-4e7bc51/vantilo-dictionary`, SHA-256 `f9ed5c8b3754ad5d4e385045c50539840c3803f4ec0443466c3031e3ccd3064f`. The unchanged gate rebuilt current source and accepted only the Mach-O UUID difference. Verify new inputs independently for every release; never bypass the gate.
- **Reader test cleanup:** `ENOTEMPTY` occurred while a background preparation job still wrote its temporary directory. The test now waits for the job's terminal error state before cleanup; the complete suite was also verified serially.
- **Signing:** the 0.1.12 app is ad-hoc signed, has no Developer ID and is not notarized; local Gatekeeper assessment rejected it. Future ordinary distribution requires a valid Developer ID, hardened runtime and entitlement review, Apple notarization, stapling, and actual Gatekeeper acceptance. Do not describe ad-hoc verification as notarization.
- **Beta updates:** the in-app updater checks stable releases and does not discover GitHub pre-releases. Provide a direct Beta download link; design a separate Beta channel in future work.

## Publishing, only when explicitly authorized

1. Recheck exact remote main and ensure fast-forward; verify release commit ancestry and no conflicting tag or Release. Confirm ZIP size, actual SHA-256, sidecar and build report commit. Never force-push or replace historical assets.
2. Push reviewed commits to main. Create the version tag at the exact build commit, then publish a GitHub pre-release with ZIP and sidecar. Do not claim Intel hardware, notarization or packaged-app scenarios that were not tested. Disclose relevant third-party service authorization and privacy limitations.
3. Update README, latest download links and release records with the actual release and asset links; commit documentation separately. Keep the release tag on the build commit, not the documentation commit. Push the documentation commit only when authorized.
4. Verify remote tag target, release published/pre-release state, asset names, size and digest, direct download availability, README links and final workspace status. Record issues and their verified solutions after every release, update this SOP accordingly, and report limitations and evidence honestly.

## 用户已接受的第三方服务风险

| 项目 | 持续性决定 |
| --- | --- |
| 服务 | Youdao `dictvoice` |
| 用途 | 单词发音，按现有集成方式使用 |
| 授权状态 | 尚未取得适用于公开分发的书面授权确认 |
| 用户决定 | 用户知情并明确接受该风险，自行承担；授权保留现有集成并继续公开分发 |
| 发布处理 | 该已知事项单独存在时允许继续发布，无需等待有道书面回复 |
| 是否重复询问 | 否，不要求用户再次确认或提供授权证明 |
| 是否擅自删除或替换 | 否，不因该已接受的风险删除或替换现有发音集成 |

This specific continuing decision takes precedence over a general pause for unconfirmed third-party service authorization **for the existing Youdao `dictvoice` integration and its current use only**. Keep the true authorization status in internal risk records and do not claim Youdao has granted permission. It is not permission to skip independent source-test, external-volume, Universal integrity, packaged-app acceptance, Git or release-asset checks, and is not itself authorization to publish every future release.

Reassess if the integration changes to a different third-party pronunciation service or a new Youdao endpoint, materially changes the calling method or data processing scope, encounters materially changed service terms, or faces an actual restriction or other significant new risk. This decision does not extend to other third-party services.

## 0.1.12 evidence

Build commit `4e7bc5160678514dfbc4035dfe4224b3cca0328c`; ZIP SHA-256 `62d4250f668d97f53c0f06c8e00324fa1c359d9ec42be871f3266ad2406b6752`; size 485,521,368 bytes. The package was launched in an isolated profile; packaged Reader fixture tests passed. Full packaged-app sentence restart and production-route translation reuse were not run. The isolated app automatically synced a live magazine during a later launch; it was not included in the ZIP. The application uses Youdao dictvoice, whose written public-distribution authorization has not been confirmed; the owner accepted that risk for this release. The later continuing decision and its scope are recorded above.

Published on 2026-10-30 at 06:35:48 UTC as [Vantilo Beta 0.1.12](https://github.com/zhangzhang88/vantilo/releases/tag/v0.1.12), pre-release and not draft. GitHub recorded two uploaded assets: the ZIP size and SHA-256 matched above; the 100-byte sidecar's own SHA-256 was `805f2eb471787ab6bfa067f8bbf041efbc71d4632b1935a9d0daa94fecaf554e`. The public ZIP link returned HTTP 206 for a one-byte range and the sidecar link returned HTTP 200 with the expected ZIP hash. The tag points to the build commit, independent of the later documentation commit.
