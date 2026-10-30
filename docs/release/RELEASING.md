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
5. Run `npm run build:mac:universal` with the external environment configured as in the manual. It builds the app and Reader and emits only ZIP, SHA-256 sidecar and report in a new `out/<version>/`. No DMG. The Intel dictionary helper preparer automatically checks source/toolchain identity, compiles current source, creates an immutable versioned input when absent/stale, then runs the strict integrity gate. Normal helper expiry is a repairable build preparation issue and must not prompt for user intervention. Only the explicitly permitted Mach-O UUID difference is normalized; unexplained differences stop the build. Preserve old inputs; never disable or weaken the gate. Verify ZIP integrity, sidecar, report commit, version, architectures and packaged EPUB count, then complete the packaged-app acceptance gate above.

## Observed 0.1.12 build issues

- **SWC cache permissions:** Workspace ancestors failed SWC's cache ownership check. A new APFS sparse image under the external work copy's `build/runtime-tmp` was mounted separately; its private `native-bindings` directory allowed the native binding to load. Verify image backing, mount and permissions; never redirect to internal storage.
- **Outdated Intel dictionary helper (resolved automatically by current scripts):** the old shared helper retained `prefix(8000)` removed from current source. It was preserved; a current-source helper was manually added for 0.1.12 at `universal-inputs/native-x64-0.1.12-4e7bc51/vantilo-dictionary`, SHA-256 `f9ed5c8b3754ad5d4e385045c50539840c3803f4ec0443466c3031e3ccd3064f`. The build scripts now automate this preparation for future versions. This historical 0.1.12 manual recovery did not rebuild or replace its published package.
- **Reader test cleanup:** `ENOTEMPTY` occurred while a background preparation job still wrote its temporary directory. The test now waits for the job's terminal error state before cleanup; the complete suite was also verified serially.
- **Signing:** the 0.1.12 app is ad-hoc signed, has no Developer ID and is not notarized; local Gatekeeper assessment rejected it. Future ordinary distribution requires a valid Developer ID, hardened runtime and entitlement review, Apple notarization, stapling, and actual Gatekeeper acceptance. Do not describe ad-hoc verification as notarization.
- **0.1.12 历史更新器限制：** 该版本仅检查稳定版，不能发现 Beta 预发布。0.1.13 已加入 Beta 更新通道；历史用户仍可使用直接下载链接。

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

## In-app update assets

A Beta build uses the explicitly configured `beta` channel and selects GitHub pre-releases; Stable uses `stable` and selects non-prereleases. Publish an uploaded `Vantilo-Beta-<version>-universal.zip` (or `Vantilo-<version>-universal.zip`) and its exact-name `.sha256` sidecar containing `<64 hex SHA-256>  <ZIP filename>`. Confirm the GitHub asset digest, sidecar and ZIP bytes agree, and check the release tag, notes, publication date and asset sizes before publishing. GitHub API digest is preferred; the sidecar is a fallback, not an independent signature. The first-stage updater downloads to a user-selected directory, verifies SHA-256 and guides the user to manually replace the application. Future automatic installation requires a separate design covering Developer ID signing, notarization and secure update authentication.

## Release notes for users and the full record

### 永久发布语言与格式规则

除非用户明确要求英文，所有版本的 GitHub Release 标题、正文、应用内摘要及完整技术发布记录必须使用简体中文。用户摘要应自然简洁；技术变更、测试与构建结果、签名、公证、已知限制和第三方服务风险均用中文如实解释。不得直接复制英文提交、PR 或开发日志作为正文，不得直接在中文应用更新页面展示英文 Release 正文。必要的技术标识、文件名、命令、API 名称、错误代码和模型名称可保留原文。每次发布前逐项检查标题、正文、应用内摘要及完整技术说明，发现英文段落先翻译。历史 Release 保持原样，历史版本的限制不得被当作当前版本限制。

Release 正文按以下结构编写；不适用的子项可省略，不得编造测试结果：

1. `## 一、本次更新`：3–5 条普通用户能理解的功能、体验和修复，供应用默认提取。
2. `## 二、详细更新内容`：重要功能、改进和使用方法。
3. `## 三、技术变更与测试结果`：技术变更及真实测试、构建和验收结果。
4. `## 四、已知限制与风险说明`：签名、公证、架构验收、第三方服务、未运行测试和已知限制。
5. `## 五、安装与更新说明`：安装、更新步骤和注意事项。

完整技术记录及必要风险披露继续保留在 GitHub Release，并在应用内折叠展示。用户摘要不包含内部构建日志或技术测试报告。

## 0.1.13 发布记录与流程改进

- 使用版本化的 Intel helper 自动准备机制，保留原输入并通过严格完整性门禁；外置 APFS 构建工作副本及 ZIP 报告均记录在 `0.1.13-build` 和 `out/0.1.13/`。
- 最终安装包在隔离用户数据下启动并确认当前版本、Beta 通道和最新版本状态。未发布的更高版本使用注入合成响应与合成文件验证中文摘要、折叠、下载、取消、重试、SHA-256 和访达定位；不得将该场景记为真实 GitHub 新版下载。
- 根测试 525 项通过；Reader 离线测试 547 项通过、7 项跳过。Intel 真机未验收，签名为 ad-hoc，未公证；门禁和局限见 [0.1.13 发布记录](0.1.13-beta.md)。
- 新版发布说明必须按本文中文格式编写；历史英文说明保留原样，应用在没有简体中文说明时提供 GitHub 原文入口。
