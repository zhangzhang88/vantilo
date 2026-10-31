# Vantilo 统一 E2E Workspace 测试基础设施验收

日期：2026-10-31
项目：`/Users/world/Downloads/code/Vantilo`
外置卷：`/Volumes/Workspace`
结果：基础设施和常规测试 PASS；特殊 APFS 满盘镜像场景本轮 NOT RUN（既有系统挂载限制仍为 BLOCKED）。

## 执行范围与仓库状态

本轮只修改了测试入口、测试脚本路径、Vitest 配置及相关规则，没有修改 Reader、词汇备份恢复等产品业务功能。初始仓库为 `main`，HEAD `1d14d1c8454fffde54f8426a1b6987df8071a7bc`，比 `origin/main` 超前一个此前已有提交。初始工作区包含前一轮的 Workspace 测试修改，以及两份未跟踪审计报告；均保留，没有 reset、clean、Push 或发布。

外置卷验证脚本确认 UUID `2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE`、挂载点 `/Volumes/Workspace`、APFS 和可写状态。入口按测试类别检查可用空间：根目录 Vitest 至少 2 GiB，其他 E2E 至少 8 GiB。挂载、身份、空间、路径、符号链接或写入探针任一检查失败均停止，不回退到内置盘。

## 测试入口盘点与修复

扫描 `package.json`、`scripts/`、Reader 测试入口和临时路径写入点，发现 23 个带 test/E2E/cleanup 名称的 npm 命令；共享运行器允许 22 个 Electron 脚本入口和 9 个 Node/E2E 入口（其中包含 3 个词汇备份流程入口、1 个打包辅助入口和 1 个清理故障夹具）。另有一个受保护的清理命令，不启动测试负载。共有 31 个受管脚本文件内置 Workspace 守卫：22 个 Electron/诊断入口、8 个 Node/E2E/编排入口及 1 个词汇 E2E 子进程入口。另有两个 `build-*` 构建命令，不属于 E2E；公共守卫模块也不是测试入口。

原本已使用统一 Workspace 包装器的主要入口包括 `npm test`、Reader 离线测试、词汇备份开发/打包/Universal E2E。原先可能通过 `os.tmpdir()` 写进内置临时目录的 Reader 手动验收和诊断脚本，现都在启动时调用共享守卫；统一入口只允许仓库内的 allowlist 脚本。根目录和 Reader Vitest 配置也要求活动运行标记，避免直接执行 Vitest 绕过门禁。

路径调整包括：

- 每次测试使用 `/Volumes/Workspace/Development/Vantilo/test-runs/e2e/run-<UTC时间>-<PID>-<UUID>/` 独立目录。
- `TMPDIR`、`TMP`、`TEMP`、`HOME`、`CODEX_HOME`、XDG 配置/缓存、Electron userData、Chromium sessionData、Reader 合成数据、截图、缓存、日志和结果均有本次运行的 Workspace 路径。
- Electron 守卫在 `app` ready 前设置隔离的 userData 和 sessionData，并跟踪测试脚本后续对 `app.setPath` 的调用。ready 事件会实际读取 `app.getPath('userData')` 与 `app.getPath('sessionData')`，规范化后要求与最后一次设置的预期路径完全相同，且都在本次运行目录内；实际路径写入测试日志。
- Electron 手动验收脚本中的应用临时目录使用包装器的 `TMPDIR`；`verify-reader-growth-live` 改用仓库内的小型原创合成 EPUB，不再接收外部个人书库路径。
- Reader 词汇 E2E 的应用包、解压内容、临时库和结果位于本次运行的 `artifacts/`、`reader-data/` 与 `results/`。打包验收要求来源运行记录处于 `COMPLETED_ARTIFACTS_PRESERVED`，防止误用任意安装包路径。
- Vite 缓存和 runtime module inventory 指向 `artifacts/`。Vitest 改用 `--configLoader runner`，避免此前 bundle 模式在源码 `node_modules/.vite-temp` 写配置临时文件。
- npm 子进程继承环境会先过滤变量名中含 API key、token、password、secret、credential、authorization 或 OAuth 的环境项。测试使用本次运行隔离的 home，不复制正式登录文件或凭据。

没有将生产构建命令伪装成测试入口；普通源码 checkout 的 `build`/Reader build 仍由现有 `prebuild` 安全门禁控制。本轮未运行产品构建、Universal 打包、安装包测试或发布。`dist/` 与 `build/reader/seed` 未由本轮写入。

## 运行目录生命周期

每个运行目录有 `.vantilo-test-run.json`，以原子重命名更新所有权、PID/启动时间、命令类别和生命周期阶段。创建唯一根目录后立即写入 `PREPARING` 清单，在测试负载目录创建前即可识别中断；路径与缓存准备完毕后才切换为 `RUNNING`。目录创建逐级进行：先验证父目录为真实普通目录，再仅创建一个子层；不递归跟随未经验证的符号链接。

- 成功：确认子进程组退出后，清理本次拥有的 temp、隔离 profile、合成库及普通 artifacts；保留 owner 标记、日志和结果。
- 失败：先确认子进程组退出；只保留有名称的 JSON/TXT/Markdown 诊断，单文件不超过 10 MiB、总量不超过 50 MiB；用排他复制避免覆盖，再移除受控的大型负载。若不能确认进程退出则保留全部运行数据，标记 `CLEANUP_BLOCKED_ACTIVE_PROCESS`。
- 中断：遗留 `RUNNING` 标记时只提示人工检查，不自动删除。人工清理必须给出唯一 `--run-id`，通过 Workspace 身份、owner 标记、PID 启动时间、进程组、`lsof` 和真实路径检查；只删除本次负载，保留日志、结果和 owner 标记。未知或损坏目录不接受清理。
- 词汇打包 E2E 的 `--keep-artifacts` 是有意例外：成功时保留该应用包，供后续独立验收读取；其他运行的 artifacts 不保留。

## 实际隔离和故障证据

最终真实 Electron E2E：

`/Volumes/Workspace/Development/Vantilo/test-runs/e2e/run-20261031015401-17560-19a9f52d-bc00-489c-8072-a4f985220d7f`

Electron ready 日志实际记录：

- `app.getPath('userData')`: `/Volumes/Workspace/Development/Vantilo/test-runs/e2e/run-20261031015401-17560-19a9f52d-bc00-489c-8072-a4f985220d7f/temp/vantilo-layout-G8Mc3d`
- `app.getPath('sessionData')`: `/Volumes/Workspace/Development/Vantilo/test-runs/e2e/run-20261031015401-17560-19a9f52d-bc00-489c-8072-a4f985220d7f/chromium-profile`
- 两条路径均与该次 owner 标记的运行根目录一致；Electron/Chromium 实际渲染 28 个布局状态后正常退出，最终目录仅保留标记、日志、结果目录。

故障注入/负向检查：

- Workspace 验证器报告中的 UUID 不符、非 APFS、不可写或非零退出码：拒绝（合成报告测试）。
- 最低可用空间不足：拒绝（阈值边界测试）；没有实际填满磁盘。
- 只读目录：真实权限探针拒绝。
- TMPDIR/HOME 越界、Workspace 内符号链接指向外部目录：拒绝。
- 直接启动词汇 E2E 脚本而无活动运行标记：在测试数据创建前失败。
- 人工清理测试只清理指定合成运行 A，保留其日志/结果，另一运行 B 保持原样。
- 故意失败的子进程创建 2 MiB 合成临时负载后退出：运行器标记失败、保留错误日志和合成结果、清理本次临时/大负载；精确清理命令再次验证仅处理这个 owner 目录。
- 没有卸载真实 Workspace，也没有测试真实卷缺失；用校验器故障输入验证 fail-closed。若 Workspace 实际未挂载，入口会因验证器失败而退出，不创建测试目录。

第一次配置定向测试曾因 Vitest bundle loader 把 CommonJS 守卫内联，触发 `Dynamic require of "node:fs" is not supported`。将配置改用 `createRequire` 并让 Vitest 使用 Vite runner loader 后，配置能够正常加载；后续定向、完整测试均通过，`node_modules/.vite-temp` 最终为空。

## 测试结果

| 项目 | 结果 |
| --- | --- |
| Workspace 路径/空间/清理定向测试 | PASS：9 项 |
| 根目录完整测试（最终路径保护版本） | PASS：88 个文件，593 项 |
| Reader 离线测试 | PASS：95 个文件，575 项；7 项跳过（既有测试配置） |
| 真实 Electron/Chromium E2E | PASS：28 个布局状态；真实 userData/sessionData 路径见上 |
| 类型检查 | PASS：根项目及 Reader |
| `git diff --check` | PASS |
| 直接启动无包装器的 E2E | PASS：安全拒绝，未运行用例 |
| 磁盘镜像 APFS 满盘测试 | NOT RUN；既有报告记录 `hdiutil attach` 被系统拒绝，本轮未重试、未降低断言 |
| 真实 Codex/第三方网络 E2E | NOT RUN；属于显式集成验证，不需要访问正式凭据来验证 Workspace 基础设施 |

根目录完整测试后临时目录只保留 `.vantilo-test-run.json`、`logs/`、`results/`，Reader 与 Electron 成功目录也采用同一生命周期。故障夹具目录保留小型日志和合成结果；不再有 2 MiB 负载文件。

## 内置盘和 Workspace 实测

在本轮测试开始、完成后使用 `df -k` 测量：

| 卷 | 开始可用 KiB | 完成可用 KiB | 净变化 |
| --- | ---: | ---: | ---: |
| 内置 Data 卷 `/` | 51,200,000 | 51,200,000 | 0 KiB |
| Workspace `/Volumes/Workspace` | 828,000,000 | 828,000,000 | 0 KiB |

测试过程中的中间 `df` 数字曾波动，完成测量回到基线；APFS、系统并发活动和共享块使这些波动不能直接归因于某项文件。最终检查没有在已知用户临时目录发现近 30 分钟内以 `vantilo*` 命名的新目录；Vite 临时配置目录为空。小型 SWC 原生缓存仍按规则保留在内置盘：`~/Library/Caches/Vantilo/swc-native/1.16.20`，逻辑占用 23,896 KiB。该数值是 `du` 目录大小，不代表可回收物理块。内置 SSD 本轮净可用空间没有下降，但不能据此声称操作系统完全没有任何内部写入。

## 剩余限制

- Playwright 启动系统安装的 Google Chrome 时，Chrome/macOS 可能生成系统管理的 code-sign clone 数据，无法由 Node 的 `TMPDIR` 保证重定向。该入口有 Workspace 守卫，但本轮没有运行 `verify-magazine-progress`；不能声称 Chrome 的所有系统级写入都位于 Workspace。
- 需要系统挂载受限 APFS 镜像的容量测试继续与普通 E2E 分开；系统拒绝时必须 BLOCKED/NOT RUN，不得填满真实卷或用模拟代替真实容量验收。
- 生产构建、Universal 打包和 0.1.14 安装包流程不属于本轮验证。

## 修改文件与提交

本轮修改测试基础设施和规则：

- `AGENTS.md`、`docs/release/RELEASING.md`、`docs/testing/workspace-test-environment.md`、`package.json`
- `vitest.config.ts`、`packages/reader/vitest.config.ts`、`vite.config.ts`
- `scripts/run-tests-on-workspace.mjs`、`scripts/workspace-test-environment.cjs`、`scripts/cleanup-workspace-test-run.mjs`
- Reader E2E/诊断入口：`diagnose-reader-*.cjs`、`verify-*.cjs`、`verify-real-codex-*.cjs`、`verify-tts-server.cjs`
- 词汇测试 runner：`package-vocabulary-backup-e2e.mjs`、`run-vocabulary-backup-*.mjs`、`vocabulary-backup-e2e-main.cjs`
- 新增：`tests/workspace-test-infrastructure.test.mjs`、`scripts/test-fixtures/workspace-runner-failure.mjs`

新增和调整的路径校验、失败保留和清理逻辑均在上述测试中验证。`acceptance/storage/internal-ssd-space-audit-20261031.md` 和 `acceptance/storage/vantilo-legacy-e2e-cleanup-20261031.md` 是开始本轮前已经存在的未跟踪审计资料，保持原样。

本轮测试基础设施已由本地提交 `01313fc4bbe4c843fe8cde1d76222a0a24da179f` 纳入（44 个文件，含本报告）。提交后仍保留两份此前未跟踪的审计报告：`internal-ssd-space-audit-20261031.md` 与 `vantilo-legacy-e2e-cleanup-20261031.md`；它们未被暂存或修改。没有 Push、创建 Tag 或发布版本。

## 结论

**以后要求 Agent 运行 Vantilo 的标准根目录、Reader 离线、Electron UI、词汇备份/打包/Universal E2E 时，默认使用统一 Workspace 入口，不需要再次提醒。** 直接运行受管脚本或 Vitest 会因缺少活动 Workspace 运行标记而停止；未知入口也不会被包装器放行。

明确例外：依赖 macOS/Chrome 管理自身缓存的测试不能保证系统级副产物重定向；APFS 满盘镜像受系统挂载权限限制；本轮未运行真实 Codex/外部网络 E2E。这些限制不会被报告成 PASS。
