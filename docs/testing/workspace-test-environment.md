# Vantilo 测试环境与磁盘占用规则

## 默认测试入口

从规范源码仓库运行 `npm test`。入口脚本 `scripts/run-tests-on-workspace.mjs` 会先执行 `/Volumes/Workspace/_System/verify-workspace-volume.sh`，核对已知 Workspace UUID、APFS 和可写状态；随后创建唯一运行目录：

`/Volumes/Workspace/Development/Vantilo/test-runs/run-<时间>-<PID>/`

Node/Vitest 子进程的 `TMPDIR`、`TMP`、`TEMP`、`XDG_CACHE_HOME` 及 `VANTILO_TEST_*` 路径均指向该次运行目录。由 `os.tmpdir()` 创建的临时测试资料因此落在外置盘。每次运行的输出同时写入 `logs/test-run.log`。运行记录保留在该目录；清理前必须按保留规则检查，不得删除未知资料。

SWC 1.16.20 的原生 binding 缓存使用受用户权限保护的小型本地目录 `~/Library/Caches/Vantilo/swc-native/1.16.20`。这是为兼容 SWC 对缓存父目录权限的检查而保留的例外，不会把大型测试输出迁回内置盘；目录按 Vantilo 和 SWC 版本隔离，入口拒绝权限过宽或路径含符号链接的缓存目录。

若 Workspace 未挂载、UUID/APFS/可写验证失败或目标目录异常，入口立即失败；不得在 `/Volumes/Workspace` 的内置盘同名目录回退运行，不得改用正式 userData。

## 范围与限制

- 普通根目录 Vitest 测试通过 Node `TMPDIR` 使用外置临时目录。测试中硬编码 `/private/tmp` 的脚本和其他独立 E2E 入口不因这个 wrapper 自动迁移；运行前须检查具体脚本。打包词汇 E2E 已要求应用包和测试根位于 Workspace 工作副本。
- Electron/SWC 原生 binding 可能拒绝 Workspace 的共享父目录作为缓存位置。SWC 当前使用上述受限的小型本地缓存；其余测试输出仍在 Workspace。完整词汇 E2E 的受限 APFS 空间测试需要系统允许挂载隔离镜像；如果系统拒绝，完整套件必须标记 BLOCKED，不得降低断言。
- `npm run build` 和 `npm run build:reader` 在源码 checkout 中会先由 `prebuild`/`prebuild:reader` 拒绝，避免写入未知的 `dist/` 或覆盖 `build/reader/`。应用构建必须从 Workspace 的独立构建副本运行；Reader 构建必须从该副本运行，或显式指定已验证 Workspace 内的 `VANTILO_READER_BUILD_OUTPUT`。构建保护会解析真实父目录并拒绝通过符号链接逃离 Workspace 的输出路径。
- `build/reader/seed` 是保护数据，不得清理或覆盖。源码目录 `dist/` 的历史内容有不确定性，默认保留；忽略规则不等于可删除授权。
- 不修改系统级 `TMPDIR`、用户 shell 配置或其他项目缓存。共享 npm cache `/Volumes/Workspace/Development/npm-cache` 保持原位；只有经过确认的 Vantilo 独占缓存才能单独迁移。

## 磁盘清理

按路径、版本、文件类型、大小、修改时间、进程占用、Git 状态、唯一日志/源码资料和远端资产校验逐项分类。`du` 的目录占用可能受 APFS 克隆/共享块影响，不能等同于删除可释放的物理空间。归属未知、含用户 profile 数据或有唯一审计价值的资料保留并报告。严禁对整个构建管理根目录执行递归删除。
