# Vantilo release procedure

When asked **“功能已在本地开发版真人验收通过，开始发布 Vantilo 新版本”**, **“开始发布 Vantilo 新版本”**, **“发布 Vantilo”**, or **“准备 Vantilo Release”**, first read this document, root AGENTS.md, and the applicable [macOS Universal build instructions](macos-universal-build.md). Follow the complete development-to-release workflow using the actual current and target versions, Git and remote state, release commit, artifacts and SHA-256. Resume safely from verified completed steps; never blindly recreate or overwrite an existing tag or Release. Past hashes and release decisions are not reusable authorization.

## Acceptance gates and artifact identity

Treat these as separate gates and record evidence and PASS, FAIL or NOT RUN for each:

1. **Source verification:** run relevant automated tests, typecheck and production builds for the intended release source. These do not establish a human UI result or packaged-app behavior.
2. **Development-version acceptance:** manual human acceptance is the default: record the owner's acceptance of the actual changed features in the development app and the source state tested. For a fully automatable flow, complete automated E2E may replace manual UI acceptance only if it launches real Electron, performs real UI actions through actual IPC and business services, uses fresh isolated user data and synthetic records, does not mock backup/restore/merge/integrity/rollback logic, verifies real files and persistent storage, covers the full flow and restart persistence plus cancellation, malformed input, integrity failures and rollback, runs against the final current-source packaged application, is repeatable, and reports uncovered scenarios as PASS, FAIL, BLOCKED or NOT RUN. Unit/component tests, a Reader-only host, mocked core behavior, or a development-only launch do not qualify. This exception replaces only manual UI interaction for the flow actually covered. Independent source, external-volume, Intel-helper, Universal artifact identity/integrity and packaged functional/data-safety gates remain mandatory. A narrowly scoped Beta risk exception below may waive only explicitly accepted distribution-risk checks as blockers; it never changes their recorded status or allows them to be called PASS. Scenarios requiring a person, physical hardware or external service remain NOT RUN until separately verified.
3. **Packaged-app acceptance:** unpack the exact candidate ZIP into an independent test location and launch the actual packaged application with isolated userData and storage. Verify the changed features and relevant regressions using synthetic data and simulated services as applicable. For restart persistence, fully exit the packaged app, verify the process has exited, relaunch it and check the restored position; a Reader test-host restart or page reload is not equivalent. Verify signature, notarization, Gatekeeper, icon and architecture separately. Do not claim Intel hardware acceptance from Universal slices.

Any feature source change after an older artifact was built requires a new version-specific Universal ZIP built and accepted from the corresponding intended source commit; never reuse the older commit's package. Reuse an already accepted ZIP only when its version, exact feature source commit, build report, SHA-256 and applicable acceptance evidence all match the intended release. Documentation-only commits after the build do not move the release tag away from the build commit.

For the vocabulary-backup feature, run `npm run test:e2e:vocabulary-backup` serially. It launches isolated Electron processes and exercises the actual Reader UI, IPC, localStorage allowlist, backup writer, restore transaction and restart recovery with synthetic records. Required safety cases include writes at the backup freeze/snapshot boundary, writes immediately after restore commit, primary-restore plus rollback failure with recovery on a new process, a genuinely capacity-limited temporary APFS image, and an unwritable directory. Preserve the APFS image under the test temp root, verify the kernel returns `ENOSPC`, run the application backup against that volume, record free space versus estimated backup size, then detach and verify the exact image is gone. Never fill a real system or Workspace volume. Record failures honestly; do not convert mock-only evidence to PASS.

The final package gate must run the exact `.app` extracted from the final Universal ZIP with a fresh isolated `userData`, not a previous app or a separately packaged E2E wrapper. A helper that packages a dedicated E2E app is useful supplementary evidence only. Exercise real package UI, files, restore and restart persistence; repeat the applicable failure cases on the artifact. Test both architectures through `lipo` separately from physical-device testing. Apple Silicon execution does not establish Intel hardware acceptance.

**All required source, artifact-integrity and packaged functional/data-safety acceptance must pass before pushing source, creating a tag or publishing a GitHub Release.** If one of these required checks fails or has not run, stop the release and report the exact gap; a previous release is not evidence that the current candidate passed. Do not overwrite existing versioned artifacts. Distribution-risk checks are governed by the limited Beta exception below.

### 有明确风险接受记录的 Beta 发布豁免

Beta 版可以在以下条件全部满足时继续发布，同时保留对应门禁的真实状态：发布负责人针对明确列出的版本和风险作出清晰、当前有效的接受决定；完整中文发布说明显著披露风险和用户影响；GitHub Release、README 及内部发布记录不把未完成门禁写为 PASS；源码测试、外置卷及 Intel helper 完整性、候选包版本/提交/哈希、Universal 资产完整性和打包功能/数据安全验收均通过。此豁免只允许已明确接受的签名、公证、Gatekeeper 或物理架构验收风险不再单独阻断该 Beta；它不证明这些检查通过，不适用于 Stable 发布，也不适用于未列入接受决定的新风险。不得据此跳过其他门禁。

**0.1.14 Beta 的明确接受范围：** 用户明确接受当前候选应用为 ad-hoc 签名、未取得公证票据、Gatekeeper 接受状态未验证，以及 Intel 真机验收未运行；要求在中文 Release 和发布记录中逐项披露，状态保留为未公证/未验证/NOT RUN。该项授权只适用于本次 `v0.1.14` Beta 候选，不是将其标记为 PASS，也不适用于后续版本。

## Before building

For routine tests, use `npm test` from the canonical checkout. It first runs the Workspace verifier and places per-run temp files under the unique `/Volumes/Workspace/Development/Vantilo/test-runs/` directory. It must fail closed when Workspace is unavailable. This does not redirect `npm run build` or Reader build outputs: production builds must use the separate external work copy and documented output routing. See [测试环境与磁盘占用规则](../testing/workspace-test-environment.md).

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
- 本次清理了 5 个旧工作副本的独立 Node 编译缓存（删除前分配 28,397,568 字节）及本次 2,097,152 字节合成下载文件；保留历史安装包、构建工作副本、日志、验收资料和 Intel helper 输入。外置卷可用空间受同时构建等活动影响，不能把单次 `df` 差值等同于上述文件大小。

## 0.1.14 Beta 发布记录与流程改进

- 发布版本：`0.1.14`；Tag：`v0.1.14`，指向构建源码提交 `8ddc82ad253f375d9b2724e224d136f19d408a3c`。发布于 2026-10-30 23:58:53 UTC，为非草稿 Beta 预发布。
- Universal ZIP：`Vantilo-Beta-0.1.14-universal.zip`，485,591,977 字节，SHA-256 `8a935b6344d601b383545414900177c58c6a3b9a981cd8aaa589d11f97123298`。GitHub API digest、上传资产大小和本地文件一致；sidecar 为 100 字节，摘要 `66ee3d72aa1a0feac718728bf2c3f7e9d3e8e5ae646485e65893d1b856af7151`。匿名 sidecar 下载返回正确内容；ZIP 的匿名单字节 Range 请求返回 HTTP 206。
- 中文发布说明：[Vantilo Beta 0.1.14：个人词汇备份与恢复](https://github.com/zhangzhang88/vantilo/releases/tag/v0.1.14)。正文包含五个规定章节及用户摘要；没有把内部开发日志复制为摘要。
- 根目录测试 584 项通过；Reader 离线测试 575 项通过、7 项跳过；类型检查、应用生产构建及独立 Reader 构建通过。最终 Universal 安装包隔离 E2E 覆盖词汇备份/恢复/合并/失败回滚/重启持久化、恢复后新增/编辑/复习，以及 ENOSPC 故障注入、容量受限临时 APFS 卷和不可写目录。逐项证据见 [最终安装包验收报告](../../acceptance/0.1.14/universal-package-final-acceptance.md) 与[补充报告](../../acceptance/0.1.14/universal-package-final-gaps.md)。
- **未完成的门禁仍未标记通过：** 应用为 ad-hoc 签名，无 Developer ID，无 Apple 公证票据；Gatekeeper 接受状态未验证；Intel 真机验收为 NOT RUN。用户针对本次 Beta 明确接受这些已知分发风险，依据本手册有限 Beta 豁免继续发布；这不构成相关测试通过，也不适用于 Stable 或后续版本。
- 有道 `dictvoice` 公开分发书面授权尚未确认。用户已接受当前集成风险；项目不声称取得授权。
- 早前一次自动化启动曾误指向默认用户数据目录；是否写入正式词汇数据仍为 **UNKNOWN**。没有读取、修改或恢复正式用户数据。此次最终包验收使用隔离数据。
- 一次构建曾在规范源码目录产生被忽略的 `dist/`；构建前旧内容未知，保持原样，不声称已恢复。Universal ZIP 来自外置工作副本，未重建或覆盖历史产物。
- GitHub Device Authorization 恢复后，CLI 登录有效；规则变更及原 12 个源码提交已推送。Tag 固定在构建提交；README、中文发布记录及本 SOP 作为后续文档提交更新。
- 本次流程改进：仅允许针对明确版本且由用户具体接受的 Beta 分发风险解除阻断；必须保留 FAIL/NOT RUN/UNKNOWN 状态和风险说明。源测试、外置盘、Intel helper、产物身份/校验、打包功能与数据安全等门禁不在豁免范围内。

## 用户数据保护发布门禁

- 不得未经授权删除用户数据。Keychain 或密钥解密失败不得重建空 API 配置；保存失败必须保留原配置。
- 破坏性迁移前必须创建并验证恢复点。恢复备份前必须验证完整性，失败或异常中断后必须能够安全恢复或回滚。
- 发布前运行数据迁移及备份恢复回归测试，核验测试数据隔离。自动化单元测试不能替代真实跨设备恢复验收，未做的真实验收须如实记录。
- 修改用户数据目录、应用身份或 Reader 存储 origin 前，必须检查旧数据兼容和回退路径；未通过的独立门禁不得跳过。
- 词汇备份和恢复必须在真实词汇写入入口冻结相应存储键，拒绝新的词汇写入并核实不存在待保存项。只有源码证明其他进程可以写入这些词汇键时，才协调这些进程；默认不要求 Reader-wide 维护或停止无关 Agent/服务。Reader 启动加载词汇前必须检查未完成的词汇恢复日志；可安全回滚时先回滚，否则保留日志并阻止词汇写入，不得创建空数据绕过问题。数据保护测试仅使用隔离合成词汇。符合本节完整自动化 E2E 标准的词汇流程可由自动化替代真人手动 UI 操作，但必须测试最终当前源码打包应用；未覆盖的场景仍标记 NOT RUN，不能用单元测试或开发版结果代替。

## 词汇备份范围（用户的明确决定）

- Vantilo 用户可操作的备份范围仅为**个人词汇及其相关学习数据**，不是整个 Reader 或整个 Vantilo。实际字段必须以当前源码模型为准：已保存单词/词组、来源关联、保存的中文释义和语境释义、英文释义及例句、熟悉度、复习计划与次数、个人使用说明/笔记。不得假设存在未由当前数据模型支持的独立词元、音标、标签、收藏标记或逐次复习事件。
- 只保留来源名称、稳定内部 ID、段落/偏移及短语境片段，不导出文章或书籍全文。始终排除 EPUB、电子书、杂志及其图片/音频/视频原始资源，阅读进度和逐句位置，Reader 全局设置、普通词典缓存及可重新生成的临时 AI 缓存。恢复后原始来源缺失时，仍保留词汇和来源引用；提示用户重新导入或关联，不创建空书籍或删除相关记录。
- 普通词汇 JSON 备份不得包含 API Key 明文或密文、OAuth/Codex 凭据、Keychain 内容、Agent 会话/Runtime/项目数据或 Chromium Profile、Cookie、缓存和浏览历史。必须使用明确的词汇存储键及字段 allowlist，不能复制 Reader 数据目录或 Chromium Profile。
- 备份格式必须有版本、记录数量清单和 SHA-256 完整性校验。先写同目录临时文件，校验成功后原子创建最终文件且不得覆盖已有文件。恢复默认使用合并模式：保留现有用户释义、笔记和熟悉度，冲突须显式统计；先创建持久化恢复点，再 staging、核验、提交。重复导入必须幂等且不得重复增加复习次数。任何失败都不得损坏原词汇库或丢失恢复点。
- 只在词汇存储写入入口冻结词汇键并等待待写入项完成；除非源码证明确有其他写入者，否则不停止整个 Vantilo 或无关 Agent/Reader Service。清单必须明确列出排除内容，不能将书刊、文章、媒体、阅读进度或其他平台数据统计为已备份。所有测试使用隔离 userData 和合成词汇。符合 Acceptance gates 中完整标准的、可重复的最终打包应用自动化 E2E 可以替代真人手动 UI 操作；单元测试或 Reader 测试主机不能替代此验收。物理硬件、人工判断或外部服务情形未验证时须标记 NOT RUN。
