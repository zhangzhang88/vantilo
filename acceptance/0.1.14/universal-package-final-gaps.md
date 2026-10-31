# Vantilo 0.1.14 Universal 安装包剩余验收补充报告

日期：2026-10-31

源码提交：`8ddc82ad253f375d9b2724e224d136f19d408a3c`
结论：**本轮补测项目通过；现有 ZIP 未变化。整体公开发布仍受签名、公证、Gatekeeper 和 Intel 真机验收门禁限制。**

本轮只补充正常词汇使用、空间不足和不可写目录验收，并调查内部 `dist/`。没有修改应用源码、版本号、ZIP、SHA-256 sidecar 或构建目录；没有提交、Push、创建 Tag 或 Release。

## 1. Universal 候选包身份

| 项目 | 实测结果 | 状态 |
|---|---|---|
| ZIP | `/Volumes/Workspace/Development/Vantilo/out/0.1.14-final-8ddc82a-20261030/0.1.14/Vantilo-Beta-0.1.14-universal.zip` | PASS |
| 文件大小 | 485,591,977 字节 | PASS |
| SHA-256 | `8a935b6344d601b383545414900177c58c6a3b9a981cd8aaa589d11f97123298`，与原验收报告及 sidecar 一致 | PASS |
| ZIP 完整性 | `unzip -tq` 未发现压缩包错误 | PASS |
| 应用版本 | `0.1.14` | PASS |
| 主程序架构 | `arm64 x86_64` | PASS |
| 应用图标 | `Info.plist` 指向 `electron.icns`，最终 `.app/Contents/Resources/electron.icns` 存在 | PASS |

未重新构建或改写安装包。解压后的实际应用为：

`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.14-build-8ddc82a-20261030T200000Z/build/package-acceptance-8ddc82a-20261030T201000Z/Vantilo Beta.app`

## 2. 恢复后正常词汇使用 E2E

使用上述最终 ZIP 解压的真实 Universal 应用，运行版本 `0.1.14`。测试数据全部为合成词汇和 `tests/fixtures/minimal-magazine.epub` 合成书籍。隔离检查在 `app.ready` 前设置路径，并比较 `app.getPath('userData')`、Chromium `--user-data-dir` 与预期路径；每份持久化证明中的实际路径都与预期逐字相同。没有回退到默认用户目录。

正常使用测试目录：

`/private/tmp/vantilo-final-gaps-usage-20261031T-final`

使用同一个隔离 `userData` 完成恢复后，实际 UI 流程中新增了 `synthetic`，进入词汇详情将释义改为“恢复后由真实界面修改的合成释义”，再在复习界面将熟悉度评为 3。随后完全退出应用、再次启动同一隔离用户目录，读取实际 Reader 存储并逐项核对：词汇 ID、释义、熟悉度、复习次数和复习日程均保留；复习次数为 1，间隔为 7 天。

该 UI 流程由多个真实打包应用启动衔接：首次操作完成新增和释义保存后，测试驱动在导航到复习页时发生等待超时；我保留该状态，在同一隔离用户目录重新启动最终应用，继续完成真实复习操作，再完全退出并重启核验持久化。后两次的应用内结果及隔离证明为：

- `result-review-after-restore-final.json`：实际复习已完成，熟悉度 3、复习次数 1。
- `result-review-restart-persistence-fixed.json`：重启后 `synthetic` 释义、熟悉度和完整日程与预期一致。
- 两个文件中的实际及预期 `userData` 均为 `/private/tmp/vantilo-final-gaps-usage-20261031T-final/user-data-target-usage`。

因此，恢复后新增、修改、复习及完整退出重启后的持久性：**PASS**。测试期间没有操作正式词汇库。

## 3. 磁盘空间和不可写路径

### 3.1 ENOSPC 写入边界故障注入

最终 Universal 应用通过真实设置界面、IPC 和备份服务发起备份；仅在临时文件写入边界注入 `ENOSPC`。这不是实际填满磁盘的测试。

- UI 明确显示空间不足错误。
- 最终备份未生成，`.partial` 文件已清理。
- 预先存在的同名文件内容不变。
- 合成词汇数据未变，备份冻结已解除。
- 结果：**PASS（ENOSPC 故障注入）**。

证据：`/private/tmp/vantilo-final-gaps-final-20261030224125-30229/result-enospc-injection.json`。

### 3.2 独立 APFS 测试卷的实际低空间测试

此前系统权限阻止挂载测试镜像。本轮通过授权在 `/private/tmp` 创建了上限为 64 MiB 的 APFS sparse image；它不占用 Workspace 容量，也没有填满内置主卷。填充该测试卷的预留文件时，文件系统真实返回 `ENOSPC`。随后在同一测试卷上运行最终 Universal 应用的真实备份 UI：

- 备份可用空间：2,289,664 字节。
- 按实际合成快照估算的备份体积：2,813,011 字节。
- 应用在写文件前报告“所选磁盘空间不足，未创建备份文件。”
- 最终文件不存在；临时文件数为 0；词汇数据不变；写入冻结解除。
- 结果：**PASS（真实容量受限 APFS 卷；应用由空间预检安全拒绝）**。

这证明应用遇到真实低空间文件系统时会安全停止；应用的备份写入本身没有继续到文件系统写操作阶段。写入阶段由上面的 ENOSPC 故障注入覆盖。测试后已卸载并移除本轮创建的 APFS 镜像与挂载目录。

证据：`/private/tmp/vantilo-final-gaps-real-apfs-e2e-20261031/result-real-apfs-disk-full.json`。隔离 `userData` 为 `/private/tmp/vantilo-final-gaps-real-apfs-e2e-20261031/user-data-real-apfs-full`。

### 3.3 不可写目录

对隔离目标目录设置只读权限，以最终 Universal 应用真实发起备份。文件系统返回 `EACCES`；界面没有报告成功，不存在输出文件，原词汇数据保持不变，写入冻结解除。结果：**PASS**。

证据：`/private/tmp/vantilo-final-gaps-final-20261030224125-30229/result-unwritable.json`。

## 4. 回归验证

所有测试使用串行方式，Reader 离线测试按照套件配置保留 7 项跳过项。

| 检查 | 实际结果 | 状态 |
|---|---:|---|
| 词汇备份服务及根目录 E2E 驱动定向测试 | 2 个文件，7 项通过 | PASS |
| Reader 词汇备份定向测试 | 1 个文件，26 项通过 | PASS |
| 根目录完整测试 | 87 个测试文件，584/584 项通过 | PASS |
| Reader 离线测试 | 95 个文件通过、1 个文件跳过；575 项通过、7 项跳过 | PASS |
| TypeScript 类型检查 | `npm run typecheck` 成功 | PASS |
| `git diff --check` | 无空白错误 | PASS |
| 生产构建 / Reader 构建 | 本轮未运行。没有应用源码变化，且禁止重建现有候选包；原最终验收报告记载对应生产构建已通过 | NOT RUN（本轮） |

初次在受限执行环境运行根目录测试时，本机回环监听返回 `EPERM`，并有系统词典服务无法获取测试词的失败。获准使用本机测试监听权限后重跑，最终 584 项全部通过；没有跳过或删除这些断言。生产构建未重跑，避免改写内部 `dist/` 或误触现有构建产物。

## 5. 内部 `dist/` 只读调查

当前路径：`/Users/world/Downloads/code/Vantilo/dist/`。它被 `.gitignore` 中的 `dist/` 规则忽略，不属于跟踪的源码。当前清单：

| 路径 | 大小 | 修改时间 | 文件类型 |
|---|---:|---|---|
| `dist/index.html` | 692 字节 | 2026-10-31 03:50:40 | HTML 文本 |
| `dist/assets/index-D4tKD0pk.css` | 201,894 字节 | 2026-10-31 03:50:40 | UTF-8 CSS 文本 |
| `dist/assets/index-D61MJ8c5.js` | 1,330,070 字节 | 2026-10-31 03:50:40 | JavaScript 文本 |

这些文件名和时间与先前误在规范源码目录运行的 Vite 生产构建输出相符；历史记录也确认该命令曾将生产资源写入 `dist/` 后，Reader seed 保护门禁停止。根据当前文件类型与位置，没有发现 EPUB、用户书籍、用户数据库、Keychain 内容或 Chromium Profile。它是应用渲染资源，而非运行时用户数据。

证据边界：没有构建前的清单或快照，所以无法确认这些路径原来是否已存在、是否有旧文件被覆盖，也无法恢复其先前内容。本轮没有删除、替换、清理或尝试恢复 `dist/`。`dist/` 不在 Git 源码中；Vite 生产构建会重生成它，打包应用使用的是外置构建副本中的资源。本轮检查及测试没有改变这些文件。

## 6. 状态汇总与发布判断

| 验收项 | 状态 |
|---|---|
| 最终 ZIP 存在、校验和匹配、ZIP 完整 | PASS |
| 包装版恢复后 Reader UI 新增词汇 | PASS |
| 包装版 UI 修改释义 | PASS |
| 包装版 UI 复习及复习日程 | PASS |
| 完全退出重启后词汇、释义、熟悉度和日程持久化 | PASS |
| ENOSPC 写入边界故障注入 | PASS |
| 独立 APFS 卷真实低空间预检 | PASS |
| 实际文件系统不可写目录 | PASS |
| 本轮根目录 / Reader 测试、类型检查及差异检查 | PASS |
| 真实系统卷被填满测试 | NOT RUN；没有填充 Workspace 或内置卷 |
| 此前误启动期间正式 `userData` 是否被写入 | UNKNOWN；沿用前一报告的证据边界，本轮没有访问正式数据 |

本轮补齐了前报告中“恢复后常规词汇操作”和“磁盘空间不足”的两项缺口。现有 ZIP 的版本、源码提交、哈希、架构及最终包仍一致，**可以保留为 0.1.14 功能验收候选包，不需要因本轮补测而重新构建**。

但这不等于完整公开发布门禁全部通过：前一最终报告中的签名仍为 ad-hoc、未公证，Gatekeeper 接受状态未验证，Intel 真机测试未运行；项目发布手册将签名/公证/Gatekeeper 与物理架构验收列为独立门禁。另外，早前误启动正式 `userData` 的写入影响仍为 UNKNOWN。根据现行发布手册，**本轮不建议据此直接进入公开 Release；应先处理或明确批准这些独立发布门禁**。没有执行 Push、Tag、Release 或打包。

## 7. 工作区和产物保留

- HEAD 仍为 `8ddc82ad253f375d9b2724e224d136f19d408a3c`，`main` 比 `origin/main` 超前 12 个提交。
- 原有未提交/未跟踪的验收报告保留；本轮只新增本补充报告，没有修改产品源码。
- ZIP、sidecar、构建目录、`build/reader/seed` 及旧构建材料均未改动。
- 64 MiB APFS 测试卷已卸载，且本轮专门创建的镜像已移除。
- 正式用户数据、正式 Keychain、已安装应用均未触碰。
