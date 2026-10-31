# Vantilo 测试环境与磁盘占用规则

## 默认入口

Vantilo 中所有会创建 E2E 数据的测试必须先通过共享入口 `scripts/run-tests-on-workspace.mjs`。包括根目录 Vitest、Reader 离线测试、Electron 界面测试、打包应用验收，以及测试生成的 userData、Chromium Profile、合成书库、截图、解压目录和日志。优先使用 `package.json` 中的 `npm run test:*` 命令；根目录测试为 `npm test`，Reader 离线测试为 `npm run test:reader:offline`。

没有专属 npm 命令时，可使用仓库内的 allowlist 入口，例如：

```sh
node scripts/run-tests-on-workspace.mjs --electron scripts/verify-reader-layout.cjs
node scripts/run-tests-on-workspace.mjs --node scripts/verify-tts-server.cjs
node scripts/run-tests-on-workspace.mjs --e2e scripts/run-vocabulary-backup-e2e.mjs
node scripts/run-tests-on-workspace.mjs --vitest tests/workspace-test-infrastructure.test.mjs
```

只允许共享入口中列明的脚本；未知脚本拒绝启动。所有受管独立 E2E 脚本在开始创建测试数据前自行调用同一环境守卫。根目录和 Reader Vitest 配置也会检查活动运行标记，因此直接执行 Vitest 不会绕过外置卷门禁。纯单元逻辑若使用系统临时目录，也应从 `npm test` 或 Reader 包装入口启动。

## 每次运行的路径和门禁

入口先运行 `/bin/sh /Volumes/Workspace/_System/verify-workspace-volume.sh`，并检查已知卷 UUID `2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE`、APFS、真实挂载点 `/Volumes/Workspace` 和可写状态。再检查运行所需可用空间、规范真实路径和符号链接边界。任一条件不满足即停止，不会回退到系统 `/tmp`、内置 SSD、源码目录 `build/` 或正式用户数据。

每次运行创建独立目录：

`/Volumes/Workspace/Development/Vantilo/test-runs/e2e/run-<UTC时间>-<PID>-<UUID>/`

目录按需容纳 `temp/`、隔离 `home/`、`codex-home/`、XDG 配置与缓存、Electron userData、Chromium Profile、合成 Reader 数据、`artifacts/`、`logs/` 和 `results/`。子进程的 `TMPDIR`、`TMP`、`TEMP`、`HOME`、`CODEX_HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 及 `VANTILO_TEST_*` 都指向本次目录。共享守卫核对这些实际解析路径及所有权标记。Electron E2E 脚本还必须在 `app.whenReady()` 前设置 userData，并将实际 `app.getPath('userData')` 与本次隔离目录核对；不得仅凭环境变量宣称隔离成功。

每个目录带有 `.vantilo-test-run.json` 所有权和生命周期记录，日志写入 `logs/test-run.log`。入口不会自动递归清理历史目录。启动时只提示仍标记 RUNNING 的旧目录，不会据时间戳或名称删除任何运行。

## 生命周期和人工清理

- 测试正常成功后，先确认测试进程组已退出，再清理本次所有受控临时 Profile、合成书库、temp 和解压/构建负载；保留 owner 标记、日志和结果摘要。
- 测试失败时，保留受限大小的诊断 JSON/TXT/Markdown 到 `results/`，保留日志，然后清理可重新生成的大型负载。若子进程组仍存活或无法确认退出，则保留全部数据并将状态标记为 `CLEANUP_BLOCKED_ACTIVE_PROCESS`。
- 运行器崩溃或机器重启留下的目录不会自动清理。先检查 owner 状态、记录的 PID 与启动时间、进程组及 `lsof` 文件占用。只有来源和所有权明确、进程已结束且没有打开文件时，才可使用 `npm run test:cleanup -- --run-id <完整运行ID>` 清理该目录的受控 payload；日志、结果和 owner 标记保留。未知目录、路径异常、符号链接、日志和结果不会被该命令递归删除。
- `package:e2e:vocabulary-backup` 使用 `--keep-artifacts`，以便后续打包验收；该 artifacts 目录由下一步独立验收消费，不视作普通成功运行的临时负载。

## 内置缓存例外与外部组件限制

SWC 1.16.20 原生 binding 使用小型本地版本目录 `~/Library/Caches/Vantilo/swc-native/1.16.20`。SWC 曾因 Workspace 的共享挂载父目录权限/所有者特性拒绝原生缓存；该缓存路径经权限检查、拒绝符号链接，按 SWC 版本隔离。它是唯一明确允许的小型本地缓存，不代表大型测试文件可留在内置盘。

依赖 macOS 原生应用或系统服务的测试可能产生系统无法按进程环境重定向的文件。例如通过 Playwright 启动已安装 Google Chrome 时，macOS code-sign clone 数据由系统/Chrome 管理，不保证跟随测试 TMPDIR。此类测试必须单独识别、注明实际路径和影响；不要把系统托管写入描述为已迁移，也不要为了迁移它删除或改动 Chrome 用户数据。需要特殊 APFS 镜像权限的 ENOSPC 测试若系统拒绝挂载，应标记 BLOCKED，不能用故障注入替代真实容量测试，也不得填满 Workspace 或内置 SSD。

## 构建与受保护目录

普通测试不得写源码 `dist/`、覆盖 `build/reader/seed`，也不得更改正式 Universal 发布产物。源码 checkout 的 `npm run build` / `npm run build:reader` 保留 `prebuild` 门禁；正式构建从独立 Workspace 工作副本执行。需要测试构建时也必须把输出明确放入本次 Workspace `artifacts/` 或已验证的 Workspace 副本。

不要修改 macOS 全局 `TMPDIR`、用户 shell 配置或其他项目缓存。共享 npm 缓存 `/Volumes/Workspace/Development/npm-cache` 保持原位；只有确认 Vantilo 独占的缓存才可单独迁移。清理磁盘时逐项检查归属、大小、修改时间、进程占用、唯一审计价值和可重建性；`du` 逻辑大小不等于 APFS 实际释放空间。
