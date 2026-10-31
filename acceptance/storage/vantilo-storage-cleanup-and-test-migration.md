# Vantilo 磁盘清理与测试环境外置迁移报告

日期：2026-10-31
正式仓库：`/Users/world/Downloads/code/Vantilo`
外置管理根：`/Volumes/Workspace/Development/Vantilo`

## 执行结论

- SWC 1.16.20 原生 binding 缓存报错的原因已确认：Workspace APFS 挂载使用共享所有权父目录，SWC 的原生加载器拒绝在权限过宽且没有可信 sticky 保护的缓存/TMPDIR 父路径中使用缓存。没有发现 SWC 包损坏或缓存文件属于其他用户。
- 测试入口将 SWC 小缓存限定在 `~/Library/Caches/Vantilo/swc-native/1.16.20`；测试临时文件、Electron Profile、Reader 数据、E2E 产物和日志位于 Workspace 上每次独立的 `test-runs/run-<时间>-<PID>/`。没有把系统级 `TMPDIR` 改到 Workspace。
- 清理了 5 个已确认是可再生成 Reader 构建输出、无 profile/用户数据、无脚本引用且无进程占用的旧目录。未整体删除 `build/`，未触碰 `build/reader/seed` 或 `dist/`。
- 删除了 0.1.11、0.1.12、0.1.13 本地冗余 ZIP 前，分别核验公开 Release、远端资产大小和 SHA-256 digest、sidecar 内容及匿名下载响应。保留这些版本的 sidecar、构建报告及其他历史材料。
- 根目录测试 **584/584 通过**；Reader 离线测试 **575 通过、7 跳过**；词汇备份真实 Electron 常规 E2E **通过**；类型检查 **通过**。完整词汇 E2E 的容量受限 APFS 镜像场景仍因系统拒绝 `hdiutil attach` 而 **BLOCKED**，没有降低断言，也没有填满真实磁盘。
- 源码仓库中的应用构建和 Reader 构建保护均实际阻止了写入。没有从源码目录运行完整生产构建。

## 卷身份与清理前后空间

Workspace 验证脚本确认 UUID `2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE`、APFS、挂载路径 `/Volumes/Workspace` 和可写状态。系统 `diskutil info` 不可用，项目验证脚本通过 I/O Registry、挂载表和可写探测完成检查。没有卸载真实 Workspace。

| 指标 | 清理前记录 | 清理后实测 | 说明 |
|---|---:|---:|---|
| 内置卷 `/` 可用空间 | `df -h` 记录为 34 GiB | `df -k` 为 36,960,000 个 1 KiB 块（约 35.25 GiB）；`df -h` 显示 35 GiB | 前值只保存了 `df -h` 的整数显示，无法据此精确计算字节级净增量；可确认显示值增加约 1 GiB。没有把删除文件的逻辑大小冒充实际释放量。 |
| Workspace 可用空间 | `df -h` 记录为 790 GiB | `df -k` 为 828,000,000 个 1 KiB 块（约 789.95 GiB）；`df -h` 显示 790 GiB | 前值仅有整数显示，故不能声称精确净变化；在 `df -h` 精度下无可辨变化。 |
| 内置 `build/` | 3,639,496 KiB | 2,074,672 KiB | `du` 遍历值，不等同 APFS 可释放物理块。 |
| Workspace `out/` | 11,169,560 KiB | 9,744,292 KiB | `du` 遍历值；APFS 克隆/共享块会使其与实际释放量不同。 |

实际可用空间以清理前后 `df` 记录为准。由于清理前没有保留 `df -k` 精确计数，本报告不推算精确净释放字节数。

## 内置 `build/` 最大占用项

以下为清理后的最大 15 项（`du -sk`，KiB）。前 5 个可再生成旧输出目录已在本轮清理；其余保留。项目内容只检查路径、清单、大小、时间戳、文件类型、引用及进程占用，没有读取正式词汇数据正文。

| 清理后排名 | 路径 | KiB | 判断与处理 |
|---:|---|---:|---|
| 1 | `build/reader` | 656,208 | 当前 Reader 输出，含受保护 `seed/`；保留。 |
| 2 | `build/update-acceptance-20261030` | 508,028 | 验收应用/Profile 材料，归属与唯一证据价值不能排除；保留。 |
| 3 | `build/reader-dev` | 313,156 | 被开发启动流程引用；保留。 |
| 4 | `build/universal-inputs` | 148,908 | 构建输入；保留。 |
| 5 | `build/package-smoke-019` | 104,468 | Electron Profile/测试数据；保留。 |
| 6 | `build/desktop-dev-validation-20261030` | 102,316 | Electron Profile/验收数据；保留。 |
| 7 | `build/verification-0.1.7` | 97,876 | 历史验证目录，唯一资料状态未充分确定；保留。 |
| 8 | `build/reader-default-magazines` | 80,484 | 可能含书库/seed 数据；保留。 |
| 9 | `build/swift-module-cache-final-acceptance-0.1.14-20261031T0250` | 29,912 | 构建缓存来源与复用状态未完全确定；保留。 |
| 10 | `build/desktop-smoke-018` | 11,448 | Electron Profile；保留。 |
| 11 | `build/verification-0.1.6` | 10,756 | 历史验证材料；保留。 |
| 12 | `build/verification-0.1.5` | 10,684 | 历史验证材料；保留。 |
| 13 | `build/electron-release-v45.0.0.json` | 204 | Electron 版本元数据；保留。 |
| 14 | `build/runtime-modules` | 112 | Runtime 清单；保留。 |
| 15 | `build/chinese-toolbar-check.png` | 112 | 验收截图；保留。 |

### 本轮删除的内部旧输出

确认以下目录只有可再生成的 Reader 生产构建输出（如 `web/`、`api.cjs`、provenance/native helper 元数据），没有符号链接、Electron Profile、用户数据或唯一验收材料；`lsof +D` 未发现打开句柄，`rg` 未发现项目脚本依赖。删除具体目录：

- `build/reader-sentence-task`
- `build/reader-sentence-task-final`
- `build/reader-dictionary-preview-test`
- `build/reader-final-acceptance-0.1.14-20261031T0245`
- `build/reader-final-acceptance-0.1.14-20261031T0250`

删除前这些目录合计 `1,564,760 KiB`（逻辑 `du` 值）；`build/` 总计减少 `1,564,824 KiB`。这不是实际物理空间释放量。

### 继续保留的敏感或不确定材料

- `build/reader/seed`：未读取、未删除、未覆盖。
- 其余含 Chromium/Profile 的 smoke、验收目录：保留。
- `build/reader-default-magazines`：保留。
- `dist/`：原有内容来源不明，未删除、未改写；当前 3 个文件清单、大小及 mtime 已记录，但无法证明误构建前是否覆盖过旧内容。
- `build/runtime-cache`：未清理；此前尝试用 `rmdir` 时目录非空，归属未确认。
- 任何归属不明或可能含唯一审计材料的目录：保留。

## Workspace 历史 ZIP 核验与清理

只删除 0.1.11、0.1.12、0.1.13 下与公开 Release 完全匹配的本地 ZIP，保留全部 sidecar、报告、版本目录、0.1.14 包和回退材料。每个资产均核对公开 Release/API 资产存在、大小与 digest、sidecar SHA-256，以及匿名 ZIP Range 响应（HTTP 206）和 sidecar 内容：

| 版本 | ZIP 大小 | SHA-256 |
|---|---:|---|
| 0.1.11 | 485,517,117 字节 | `c798a98e916f079abd382f2e2968f5f79977dfed314aba6c4f61f4483696a970` |
| 0.1.12 | 485,521,368 字节 | `62d4250f668d97f53c0f06c8e00324fa1c359d9ec42be871f3266ad2406b6752` |
| 0.1.13 | 485,563,015 字节 | `4a09de774468761d34472e973ea6638d65ceaa94c939e12425d874316d99de53` |

没有改动 GitHub Release 历史，没有删除 ZIP 以外的历史文件。

## SWC 根因、缓存和测试路径

SWC 1.16.20 的报错来自其原生 binding 缓存目录安全校验：Workspace 的共享挂载父目录权限不符合 SWC 对可信 cache/TMP 父目录的要求。实际 Node 包可加载；没有发现旧缓存 owner 错误。使用用户私有缓存根目录后，根目录 Vitest 与 Reader Vitest 均可启动。

允许的小型本机缓存：`~/Library/Caches/Vantilo/swc-native/1.16.20`。本机缓存约 23.9 MiB，按工具版本分隔，权限限制为用户可访问。测试临时数据及大体积产物仍在 Workspace。

默认 `npm test` 和 `npm run test:reader:offline` 调用 `scripts/run-tests-on-workspace.mjs`。每次创建唯一目录：

`/Volumes/Workspace/Development/Vantilo/test-runs/run-<时间>-<PID>/`

其中包括 `temp/`、`electron-profiles/`、`reader-test-data/`、`artifacts/`、`cache/` 和 `logs/test-run.log`。脚本在创建测试目录前验证 Workspace UUID、APFS、可写和路径；失败即退出，不切换到内置盘或正式 userData。E2E 还在该目录下独立设置 Electron `userData`、Chromium `--user-data-dir`、session data、临时目录、下载目录和日志目录，并用 `app.getPath('userData')` 与预期绝对路径精确比较。Reader Vite cache 跟随 `VANTILO_READER_BUILD_OUTPUT` 放在输出目录旁边；E2E 不再把它写到源码 checkout 的 `build/`。

已实测 E2E 隔离路径，例如：

`/Volumes/Workspace/Development/Vantilo/test-runs/run-20261031002440-70589/temp/vantilo-vocabulary-backup-e2e-20261031002440-cEHrrb/`

源环境和目标环境实际 `userData`、Chromium 用户目录、session、HOME、appData、tmp、crash dumps、downloads 和 logs 均位于该唯一根目录。测试未使用正式用户数据。

Workspace 未挂载及不可写状态没有通过实际卸载/改权限模拟，因为当前 Workspace 正在使用，不能为测试破坏它。入口和 verifier 的代码路径在验证失败时明确退出、无内置路径 fallback；这两种环境故障注入标记 **NOT RUN**。

## 构建保护

- 从规范源码仓库运行 `npm run build`：**预期拒绝，PASS**。`prebuild` 在 Vite/TypeScript 构建前报“拒绝在正式源码工作区写入 dist”；未启动构建。
- 从规范源码仓库运行 `npm run build:reader`：**预期拒绝，PASS**。`prebuild:reader` 在构建前报“拒绝在正式源码工作区写入 build/reader”；未启动构建。
- `VANTILO_READER_BUILD_OUTPUT` 检查要求输出绝对路径位于 Workspace 管理根目录，解析真实父目录并拒绝符号链接逃逸和符号链接输出目标。
- 普通测试与 E2E 使用外置临时输出；E2E Reader bundle 写入本次 Workspace `temp/.../reader-assets`，未修改 `build/reader/seed`。
- 本轮未在正式源码仓库运行生产构建；Universal 发布仍须按 `docs/release/macos-universal-build.md` 使用新的外置构建副本。没有覆盖或改动 0.1.14 已发布安装包。

## 测试和检查结果

| 检查 | 结果 | 证据/说明 |
|---|---|---|
| Workspace verifier | PASS | UUID、APFS、挂载路径和可写探测通过。 |
| 定向根目录测试 `npm test -- tests/workspace.test.ts` | PASS | 7/7；SWC 修复后的前序验证。 |
| 根目录完整测试 `npm test` | PASS | 87 个测试文件，584/584；运行目录 `run-20261031002204-68600`，日志在其 `logs/test-run.log`。 |
| Reader 离线测试 `npm run test:reader:offline` | PASS | 95 个文件通过、1 个跳过；575 通过、7 跳过；运行目录 `run-20261031002220-69305`。 |
| 词汇备份真实 Electron 常规 E2E | PASS | `VANTILO_VOCABULARY_E2E_ONLY=source-target npm run test:e2e:vocabulary-backup`；真实 UI/IPC/备份/恢复流程 source、target、verify 均 PASS，目录 `run-20261031002440-70589`。 |
| 完整词汇 E2E 的容量受限 APFS 镜像测试 | BLOCKED | 系统拒绝 `hdiutil attach`（权限被拒绝）。没有填满内置卷或 Workspace；没有删除或弱化该测试断言。 |
| 类型检查 | PASS | `npm run typecheck`。 |
| 源码仓库应用构建保护 | PASS | `npm run build` 在写入前拒绝。 |
| 源码仓库 Reader 构建保护 | PASS | `npm run build:reader` 在写入前拒绝。 |
| `node --check` / `git diff --check` | PASS | 所有变更脚本语法及差异空白检查通过。 |
| Workspace 未挂载故障注入 | NOT RUN | 未卸载正在使用的真实卷；代码 fail-closed 路径已审阅。 |
| Workspace 不可写故障注入 | NOT RUN | 未更改真实外置卷权限；代码 fail-closed 路径已审阅。 |

常规 E2E 日志中有一条预期的“同名备份拒绝覆盖”IPC 错误；该步骤按预期通过并被 E2E 记录为 `no-overwrite-existing-backup: PASS`，随后目标环境恢复及持久化验证通过。

## 修改文件与 Git 状态

本次改动仅涉及测试入口、构建输出保护及文档：

- `AGENTS.md`
- `docs/release/RELEASING.md`
- `docs/testing/workspace-test-environment.md`
- `package.json`
- `scripts/run-tests-on-workspace.mjs`
- `scripts/run-vocabulary-backup-e2e.mjs`
- `scripts/build-reader.mjs`
- `scripts/verify-workspace-build.mjs`
- `acceptance/storage/vantilo-storage-cleanup-and-test-migration.md`

词汇备份/恢复业务逻辑未修改。以上 9 个文件已逐项审查并纳入本地提交；未 Push、未打 Tag、未发布。

## 以后推荐命令

```sh
npm test
npm run test:reader:offline
npm run test:e2e:vocabulary-backup
```

词汇 E2E 若只运行不依赖特殊受限 APFS 镜像的常规源/目标流程，可使用：

```sh
VANTILO_VOCABULARY_E2E_ONLY=source-target npm run test:e2e:vocabulary-backup
```

完整词汇 E2E 仍应保留 APFS 容量测试，并在系统允许挂载隔离测试镜像的环境中执行；本机当前结果继续标记 **BLOCKED**，不可用常规 E2E 的 PASS 替代。
