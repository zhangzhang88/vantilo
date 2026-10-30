# Vantilo 0.1.14 Universal 安装包恢复验收阻断修复报告

日期：2026-10-31
仓库：`/Users/world/Downloads/code/Vantilo`
版本：`0.1.14`（未修改）

## 结论

定位并修复了恢复确认没有启动合并事务的根因。使用真实 Electron 应用、真实 Reader UI、真实 localStorage、文件系统和隔离 userData 的开发构建 E2E 已通过，包含合并完成、重启持久化、重复导入、写入竞争、失败回滚及磁盘错误场景。

**最终 Universal 安装包验收当前不能标记 PASS。** 本轮修改后的源码尚未进入新的 Universal ZIP。既有构建脚本要求干净的 Git 源码快照；本轮禁止提交，而工作区包含本次修改，因此构建在安全门禁处停止。未绕过门禁，未覆盖旧 ZIP。旧 ZIP 的 SHA-256 仍为 `f421c3d97a911f9a0a96379df9924605c18e95d22146d97bdb895aa5ca4b5449`，大小 `485,595,902` 字节。

## 1. 恢复按钮不完成的根因与修复

词汇备份界面由 `scripts/reader-data-management.tsx` 注入 Reader iframe。宿主 iframe 的 sandbox 配置不包含 `allow-modals`，而原恢复按钮使用 `window.confirm()`。在该隔离上下文中，浏览器会阻止原生确认框；用户看见预览，但确认处理没有真正进入恢复事务。旧 E2E 驱动把 `window.confirm` 替换为自动返回 true/false，因而掩盖了该产品问题。

最小修复是在 Reader 页面内实现可访问的 `role="alertdialog"` 确认层，不扩大 iframe 权限。用户明确点击「开始合并恢复」后才执行事务；取消不会开始事务。界面和恢复日志贯穿唯一请求 ID，并显示 `AWAITING_CONFIRMATION`、`RESTORING`、`COMPLETED`、`FAILED`、`RECOVERY_REQUIRED` 或 `CANCELLED` 状态。完成状态和请求 ID 在重新加载后仍能被读取；如果写入完成通知失败，界面不会因强制刷新丢失成功状态。

E2E 不再覆盖 `window.confirm`。它通过实际界面打开确认框、取消或提交，随后检查请求 ID、日志、完成状态和存储数据。恢复调用链是 Renderer 内的 Reader 业务逻辑和 localStorage 事务；备份生成才经过 Main IPC 文件服务。报告没有把恢复误称为 IPC 调用。

## 2. 隔离 userData 的证据

E2E 根目录：

`/private/var/folders/qw/p897z28x02jcry17_3d3dps40000gn/T/vantilo-vocabulary-backup-e2e-20261030180143-ArnfQr`

每个应用模式使用新的独立配置目录。以 source 进程 PID `82842` 为例，测试在 app ready 后核对并精确比较：

- 预期 `app.getPath('userData')` 与实际值完全相同，均为 `.../user-data-a`。
- Chromium `--user-data-dir` 与该目录相同。
- `app.getPath('sessionData')` 与 `session.defaultSession.getStoragePath()` 均为该目录下 `session-data`。
- HOME、appData、temp、logs、crashDumps 和 Downloads 路径均位于该唯一测试根目录内。
- Electron 主进程在隔离路径验证前等待启动闸门；校验失败时不能继续启动 Runtime、Reader 或窗口。
- 测试环境过滤继承的秘密变量，应用网络测试也拒绝外部请求。

`summary.json` 中 9 个应用模式均有对应的实际路径证明和 PID；各模式证明文件记录了 expected/actual userData、Chromium 参数及存储路径。完整证据保留在上述临时目录，未清理。这里证明的是本次 E2E 的应用数据与 Chromium 数据路径隔离；应用仍然读取仓库中的程序源码、测试夹具和构建资源。

## 3. 此前误启动与正式用户数据

此前自动化曾打开过默认用户目录对应的 Vantilo。该期间进程记录目前无法从 `ps` 获得，操作系统返回 `operation not permitted`；本轮 CUA 状态检查未发现仍在运行的 Vantilo 进程。

仅检查了正式 userData 的文件元数据，没有打开任何文件正文：目录修改时间为 `2026-10-31 01:35:32 +0800`；在 01:30–01:40 窗口发现 16 个文件、合计 32,414,394 字节有修改时间；自 2026-10-30 起共 221 个文件、合计 66,169,578 字节显示修改。仅凭这些时间和大小无法证明变化由误启动导致，也无法证明词汇文件是否改变。**是否发生过正式词汇数据写入：UNKNOWN。** 本轮没有访问、修改、删除或恢复正式词汇数据。

## 4. 图标核查

复核发现旧报告所称“缺少应用图标”是检查器使用了错误的资源名。现有正式资源名为 `electron.icns`，不是 `vantilo.icns`。旧 ZIP 解压后的应用 `Info.plist` 设置 `CFBundleIconFile=electron.icns`，`Contents/Resources/electron.icns` 存在且可识别为 ICNS；其内容与 `resources/vantilo.icns` 一致，SHA-256 为：

`ca595a0a428b5361d463b90010f11f63ac96c52671593ed6efbb49c60a44c9da`

同一图标资源也存在于既有 Universal ZIP 中，ZIP 内字节哈希与源码资源一致。另在 `scripts/build-mac-universal.mjs` 增加了对 arm64、x64、合并应用和最终 ZIP 的图标配置、有效 ICNS 及字节一致性检查。不过本轮改动后的新 ZIP 未生成，因此**新源码候选包的图标门禁尚未执行**；现有包图标核验 PASS，新候选包核验 BLOCKED。

## 5. 开发构建真实 Electron E2E

执行 `npm run test:e2e:vocabulary-backup`，在最终一轮使用唯一临时 userData 的真实 Electron 环境中完成 9 个模式。每个模式均在 app ready 后校验实际路径；不是通过 mock 业务恢复逻辑。恢复和备份数据存于隔离 Chromium localStorage 与临时文件。

| 模式 / PID | 结果 | 验证内容 |
| --- | --- | --- |
| source / 82842 | PASS | UI 显示词汇数；取消保存；真实 UI 生成 JSON；记录数量和字段逐项比对；SHA-256；敏感标记排除；重复文件不覆盖 |
| target / 82855 | PASS | 损坏 JSON、错误 SHA、未知格式、截断文件拒绝；取消不启动事务；真实写入失败回滚；合并结果和重复导入幂等；中断日志保留 |
| verify / 82913 | PASS | 重新启动后数据仍在；启动恢复可以处理此前中断的事务 |
| race-source / 82924 | PASS | 真实 Renderer 写入在快照冻结边界前后执行；冻结期间拒绝，解冻后重试；快照包含冻结前数据、不包含冻结期间写入 |
| race-target / 82937 | PASS | 恢复提交期间排队写入；提交后本机笔记、熟悉度、语境、复习计划和新增记录保留 |
| rollback-failure / 82982 | PASS | 回滚失败进入隔离/恢复状态，不丢弃事务日志，不开放进一步写入 |
| rollback-recovery / 82999 | PASS | 再启动时从保留的恢复材料执行并校验待处理回滚 |
| disk-full / 83033 | PASS | 实际容量受限的 APFS 测试卷触发 ENOSPC；不产生最终或部分备份，原词汇不变，冻结释放 |
| unwritable / 83090 | PASS | 不可写目录拒绝输出，原词汇不变，冻结释放 |

实际源备份：8,324 字节，SHA-256 `c982f57b76fe2f093cd55d065957171d11453e647bae3ef5f587d832c2720071`。包含 4 个词汇实体、5 条保存词汇记录、3 条语境释义、2 条复习计划；合成词汇的支持字段逐项比较通过。恢复后验证了新增、去重、不同词义保留、原有笔记与熟悉度、学习历史和缺失来源关联。持久化数据在同一隔离环境重启后仍存在。

秘密排除测试在 Reader localStorage 放入合成明文 Key、合成密文标记和 OAuth 标记，并扫描整个导出 JSON；三种标记均不存在。未读取真实 API 配置、Keychain 或真实凭据。该测试证明词汇导出没有把这些合成标记带入 JSON；不构成对系统 Keychain 或生产 API 配置文件的访问测试。

## 6. 测试和构建结果

| 检查 | 结果 |
| --- | --- |
| Reader 词汇备份定向测试 | PASS，26 项 |
| 根目录完整测试 | PASS，578 项 |
| Reader 离线完整测试（串行） | PASS，575 项通过、7 项跳过；95 个测试文件通过、1 个文件跳过 |
| TypeScript 类型检查 | PASS |
| 应用生产构建 `npm run build` | PASS；存在既有的大 bundle 提示 |
| 独立 Reader 生产构建 | PASS，输出到本轮隔离临时目录，没有覆盖 build/reader/seed |
| 真实 Electron 词汇备份/恢复 E2E | PASS，9 个隔离模式 |
| `git diff --check` | PASS |
| 新源码的 Universal ZIP 构建 | BLOCKED：正式脚本要求干净 Git 源码快照；当前工作区有本轮修改且禁止提交。脚本在写任何产物前停止，没有覆盖旧文件 |
| 修改后源码对应的打包应用恢复 E2E | NOT RUN：没有新 Universal ZIP，不能用旧包冒充包含修复的候选包 |

早期非特权执行的 loopback 测试曾受 `listen EPERM` 阻止；在获准 loopback 的环境下按项目既有串行方式重跑后，完整根目录和 Reader 套件通过。旧 ZIP 未重新下载或覆盖，也未用于声称验证新代码。

## 7. 修改文件

- `scripts/reader-data-management.tsx`：原生确认框改为应用内确认，显式事务阶段、请求 ID 和结果状态。
- `packages/reader/src/frontend/styles.css`：确认对话框样式。
- `packages/reader/src/frontend/vocabulary-backup.ts`：事务日志关联请求 ID。
- `packages/reader/src/frontend/vocabulary-backup-startup.ts`：兼容旧日志和新增请求 ID 日志。
- `packages/reader/src/frontend/vocabulary-backup.test.ts`：增加中断日志恢复覆盖。
- `electron/main.cjs`：隔离 E2E 路径验证前阻止业务启动。
- `scripts/vocabulary-backup-e2e-main.cjs`：启动前路径配置、启动后真实路径断言和失败关闭。
- `scripts/run-vocabulary-backup-e2e.mjs`：唯一临时根目录、隔离环境与证明汇总。
- `scripts/run-vocabulary-backup-packaged-e2e.mjs`：打包 E2E 使用相同隔离和 fail-closed 路径规则。
- `scripts/vocabulary-backup-e2e-driver.cjs`：不再 mock `window.confirm`，验证 UI 确认、事务状态和真实数据。
- `scripts/build-mac-universal.mjs`：增加候选 app 与 ZIP 图标完整性门禁。
- `acceptance/0.1.14/vocabulary-backup-release-report.md`：更正既有图标资源名误判。
- `acceptance/0.1.14/universal-package-restoration-fix.md`：本报告。

本轮未更新版本号，未提交、推送、创建 Tag 或 Release。未覆盖或删除历史构建文件。

## 8. 未解决风险与下一步

1. 误启动期间正式 userData 是否被改写仍为 UNKNOWN。当前证据只能给出文件元数据，不能归因；不应将 UNKNOWN 表述为“无影响”。
2. 真实 Electron 开发构建完整恢复 E2E 已通过，但修改后的最终 Universal 安装包尚未构建和验收。0.1.14 仍不可发布。
3. 新候选 Universal ZIP SHA-256 不存在。旧 ZIP SHA-256 仍为 `f421c3d97a911f9a0a96379df9924605c18e95d22146d97bdb895aa5ca4b5449`，其代码未包含本轮恢复界面修复。

解除阻断需要在不放宽 `scripts/build-mac-universal.mjs` 的干净源码门禁前提下，为本轮确切源码形成获准的干净构建快照，然后使用外置 Workspace 规则构建新的版本化 ZIP，并在该 ZIP 解压出的应用中复跑隔离备份、恢复、重启持久化和图标检查。届时再记录新 ZIP 的大小和 SHA-256，并重新判断发布门禁。
