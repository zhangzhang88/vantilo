# Vantilo 0.1.14 Universal 安装包最终验收报告

日期：2026-10-31
结论：**部分通过；最终安装包验收仍有阻断项，暂不具备完整验收通过结论。**

## 1. 源码提交与工作区

- 发布源码提交：`8ddc82ad253f375d9b2724e224d136f19d408a3c`（`test: validate vocabulary backup digest correctly`）。
- 本地分支：`main`；本地 `main` 比 `origin/main` 超前 12 个提交。未 Push、未创建 Tag、未发布 Release。
- 本轮为恢复隔离 E2E、磁盘空间场景和校验逻辑形成的本地提交依次为：`f6a9e61`、`e2cd3f1`、`8ddc82a`。
- 外置构建副本 HEAD 与发布源码提交一致，构建时源码树干净。
- 报告文件本身是本地未提交的验收材料，不改变上述构建源码提交。

## 2. 外置构建与 Universal 产物

Workspace 卷检查通过：UUID `2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE`，APFS，挂载于 `/Volumes/Workspace`，可写。构建检查时可用空间约 790 GiB。

- 外置构建副本：`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.14-build-8ddc82a-20261030T200000Z`
- 构建日志：`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.14-build-8ddc82a-20261030T200000Z/logs/universal-build-final.log`
- Universal ZIP：`/Volumes/Workspace/Development/Vantilo/out/0.1.14-final-8ddc82a-20261030/0.1.14/Vantilo-Beta-0.1.14-universal.zip`
- 大小：485,591,977 字节
- SHA-256：`8a935b6344d601b383545414900177c58c6a3b9a981cd8aaa589d11f97123298`
- 校验文件：同目录 `Vantilo-Beta-0.1.14-universal.zip.sha256`；与重新计算的 ZIP SHA-256 一致。
- 构建报告：同目录 `Vantilo-Beta-0.1.14-universal.report.json`
- `unzip -tq`：通过。
- 架构：`arm64+x86_64`；解压应用检查到 21 个 Mach-O 文件，均包含两个架构。
- 版本：最终应用 `CFBundleShortVersionString` 和 `CFBundleVersion` 均为 `0.1.14`。
- EPUB：包内数量为 0，未打入个人书库种子。

Intel dictionary helper 严格完整性门禁通过。源码 SHA-256 为 `a926c3f16cb23464a33832e3b5409f350127e8cf0acd0515ffae1f35193151f6`；编译目标为 `x86_64-apple-macosx12.0`，Swift 6.4、macOS SDK 27.0。重新生成比较仅存在既有规则允许的 Mach-O `LC_UUID` 差异，报告字段 `preparedMatchesFreshExceptUuid=true`；没有扩大差异白名单。

### 图标、签名与公证

- 最终解压应用 `Info.plist` 指向 `CFBundleIconFile=electron.icns`。
- `.app/Contents/Resources/electron.icns` 存在，SHA-256 为 `ca595a0a428b5361d463b90010f11f63ac96c52671593ed6efbb49c60a44c9da`，与 ZIP 内资源和已核对的专用图标一致。图标检查通过。
- `codesign --verify --deep --strict` 通过；签名为 ad-hoc，没有 Developer ID Team ID。
- 未公证。`spctl --assess` 未能给出可接受结论（本机返回 Code Signing 子系统内部错误）；`stapler validate` 也未通过。因此 Gatekeeper 接受状态未验证，不能表述为已通过。
- Intel 真机测试：未运行。Universal 二进制切片不等于 Intel 硬件验收。

## 3. 最终打包应用的隔离 E2E

测试使用最终 ZIP 解压出的真实打包应用，而非开发版：

`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.14-build-8ddc82a-20261030T200000Z/build/package-acceptance-8ddc82a-20261030T201000Z/Vantilo Beta.app`

测试证据目录：

`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.14-build-8ddc82a-20261030T200000Z/build/package-acceptance-8ddc82a-20261030T201000Z/universal-vocabulary-e2e-20261030200113-72923`

汇总文件：该目录下 `summary.json`。每个 Electron 运行模式都有独立预期 userData；在 `app.ready` 前设置隔离路径，之后核对 `app.getPath('userData')` 的实际值、Chromium `--user-data-dir` 和 session storage 路径。汇总中的预期与实际路径逐字一致。各模式均以隔离 HOME、appData、缓存、下载和临时目录运行，进程退出码为 0。未回退到正式默认用户目录。

最终包 E2E 结果：**8 项 PASS，1 项 BLOCKED/NOT RUN**。

| 场景 | 结果 | 实际证据 |
|---|---|---|
| 从真实 UI 发起备份、通过 IPC 写出 JSON | PASS | 合成词汇 4 条；保存记录 5 条、语境释义 3 条、复习计划 2 条；JSON 8,324 字节。取消保存和同名文件不覆盖也通过。 |
| 备份完整性 | PASS | 文件内规范化 payload SHA-256 为 `abf732e4b71cf6e0d4ea929364231a43548f9d584fc315462372eabdbb845946`；原始 JSON 文件 SHA-256 为 `5943af8e668688e8056bf5f7d5b9ad8bf08e85581da1a5e983c80c6db2c601fc`。两者用途不同，均已分别核对。 |
| 敏感信息排除 | PASS | 合成 API Key 明文、密文和 OAuth sentinel 均未出现在备份中。没有读取真实 Keychain 或真实密钥。 |
| 第二套 userData 导入、实际确认、合并完成 | PASS | 损坏 JSON、错误 SHA、未知格式、截断文件均拒绝；取消不启动事务；点击应用内确认层后，恢复状态进入 `COMPLETED`，完成状态携带同一请求 ID。 |
| 合并策略与幂等 | PASS | 新词增加；本机笔记、熟悉度按规则保留；学习次数不重复累加；同词不同义、不同来源和缺字符位置的旧记录分别保留；重复导入后数据逐项不变。 |
| 恢复写入失败和回滚 | PASS | 在真实隔离 localStorage 写入入口注入一次失败，验证词汇数据完全回滚、事务日志清理、写入冻结解除。回滚失败/恢复材料重启恢复模式也通过。 |
| 恢复期间并发写入 | PASS | 真实 Electron Renderer 的恢复提交竞态测试验证：提交后排队写入得到执行，笔记、熟悉度、语境、复习计划和新记录保留。 |
| 关闭后重新启动及异常事务恢复 | PASS | 相同隔离 userData 重启后，词汇、语境、笔记和复习次数仍存在；PREPARED 日志按恢复流程处理后清除。 |
| 不可写目录 | PASS | 实际文件系统返回 `EACCES`，未生成备份，原词汇未变，写入冻结解除。 |
| 磁盘空间不足 | **BLOCKED / NOT RUN** | 为避免触碰真实卷，脚本尝试挂载隔离 APFS 测试镜像；本机 `hdiutil attach` 被拒绝，DiskManagement 不可用，非交互管理员授权要求密码。未提供或绕过管理员授权，也未用正式磁盘模拟。 |

恢复提交后真实 UI 的常规词汇新增、编辑和复习全流程没有由本轮证据单独覆盖；并发测试覆盖了恢复提交后的实际存储写入、笔记、熟悉度、语境和复习计划保留，但不能替代常规 Reader 词汇界面的操作验收。此项记为 **NOT RUN**。

## 4. 测试、类型检查和构建

- 词汇备份定向测试：7/7 通过；相关用例也包含在完整根目录测试中。
- 根目录完整测试：87 个测试文件，584 项通过；串行运行。
- Reader 离线测试：95 个测试文件通过，1 个文件跳过；582 项中 575 项通过、7 项跳过。
- TypeScript 类型检查：通过。
- 应用生产构建：通过。
- 独立 Reader 生产构建：通过，使用新的独立输出目录，未覆盖 `build/reader/seed`。
- 外置 Universal 构建：通过，包括 Reader 构建、架构检查、helper 完整性门禁和 ZIP 生成。
- `git diff --check`：源码提交前通过；本报告创建后再次检查。
- 初次完整测试遇到 SWC 原生绑定路径配置问题，按隔离缓存路径重跑；另一次事务启动测试检测到已有 Vantilo 进程持有 Workspace 只读句柄，未终止该用户进程，改用 `/private/tmp` 运行合成测试后整套通过。这些是运行环境限制，不是被屏蔽的产品断言。

## 5. 隔离事故与正式用户数据状态

此前 E2E 曾误启动指向默认用户目录的 Vantilo。旧报告仅检查了该正式 userData 的文件元数据，没有读取文件正文：2026-10-31 01:30–01:40 时间窗内有 16 个文件（合计 32,414,394 字节）显示修改；自 2026-10-30 起有 221 个文件（合计 66,169,578 字节）显示修改。仅凭时间和大小不能把变化归因于误启动，也不能证明词汇文件是否变化。**此前是否发生正式词汇数据写入仍为 UNKNOWN。** 本轮没有读取、修改、删除或恢复正式词汇库、Keychain 或应用安装。

另有一次生产构建命令误在内部 SSD 的规范源码目录启动；应用生产资源写入了被 Git 忽略的 `dist/`，随后 Reader seed 保护门禁拒绝继续。该次没有生成 Universal ZIP，也没有覆盖 `build/reader/seed`。该 `dist/` 的先前内容状态无法确认，本轮没有清理或恢复它。真正的 Universal 构建和安装包验收都在已验证的外置 Workspace 副本中进行。

## 6. 仍未通过的门禁与结论

本轮已证明最终打包版的隔离路径、备份、恢复确认、数据合并、失败回滚、持久化和恢复状态流程有效；Universal ZIP、哈希、架构和图标检查也通过。但磁盘空间不足场景因系统拒绝挂载隔离 APFS 镜像而没有实际完成，且恢复后常规 Reader 词汇新增/编辑/复习 UI 流程没有单独验收。因此，按“不降低门禁”的要求，**最终安装包验收状态为 PARTIAL/BLOCKED，不标记整体 PASS，也不能据此继续发布**。

解除剩余阻断需要在允许挂载隔离 APFS 测试镜像的受控环境中，针对同一最终 `.app` 重新执行磁盘不足失败路径，并补上隔离环境中的恢复后常规新增、修改、复习流程。不得改用正式用户数据或真实 Workspace 容量耗尽来测试。

## 7. 产物保留与发布边界

- 0.1.12 及此前历史 ZIP、helper 和报告均保留，没有覆盖或删除。
- 新 ZIP 及其 SHA-256、构建报告均位于新的版本化外置输出目录。
- 没有 Push、创建 Tag、创建 GitHub Release、替换 Applications 中的应用或操作正式用户数据。
- 本地源码提交保持在 `8ddc82ad253f375d9b2724e224d136f19d408a3c`；等待剩余最终安装包门禁完成后再讨论下一步。
