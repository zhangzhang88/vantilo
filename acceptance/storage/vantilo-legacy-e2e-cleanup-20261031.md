# Vantilo 历史 E2E 临时目录清理记录

执行日期：2026-10-31（Asia/Shanghai）  
范围：仅清理此前审计确认的 34 个 Vantilo 词汇备份 E2E 临时运行目录；没有进行其他系统清理。

## 结论

- 34 个目录全部逐项核验后删除；保留 0 个目标目录。
- 清理前 `du -sk` 合计 **14,583,304 KiB（约 13.91 GiB）**。
- 清理瞬间 Data 卷可用空间从 **36,972,172 KiB** 增至 **51,590,064 KiB**，`df -k` 实测增加 **14,617,892 KiB（约 13.94 GiB）**。
- 后续再次读取时可用空间为 **51,200,000 KiB**。与清理前相比仍净增加 **14,227,828 KiB（约 13.57 GiB）**；与清理瞬间相比减少 390,064 KiB，说明 `df` 读数期间有其他系统写入/空间变化，不能把后续波动归给已删除目录。
- 112 份合成测试摘要/结果 JSON（309,231 字节）先复制到 Workspace 并逐文件比对 SHA-256；副本目录为 `/Volumes/Workspace/Development/Vantilo/test-runs/legacy-e2e-evidence-20261031-01/`。
- 没有发现正式用户数据风险。没有读取词汇、API Key、Token 或书库正文。

## 清理前逐项检查

目标父目录为：

`/private/var/folders/qw/p897z28x02jcry17_3d3dps40000gn/T/`

清理前重新确认恰好存在以下 34 个目录，集合与授权清单完全一致；每项的 `du -sk`、所有者、权限、修改时间、链接状态均逐项采集。目录均由当前用户 UID 501（`world`）拥有，权限均为 `0700`，都位于同一个真实临时目录下。没有发现硬链接。除 `SO88DZ` 外均无符号链接；`SO88DZ` 内的 5 个 Chromium/Codex 测试 Profile 链接在移除父目录前先以 `unlink` 删除，只删除链接本身，不跟随目标。APFS extent 是否共享无法通过此项只读元数据证明；因此物理回收量以 `df` 为准。

| 目录名（与上述父目录拼接即完整原路径） | 清理前 `du` KiB | 最后修改时间（CST） | 链接 |
|---|---:|---|---|
| `vantilo-vocabulary-backup-e2e-20261030154247-EsDpKM` | 342,888 | 2026-10-30 23:42:52 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030154307-1VtSCV` | 445,788 | 2026-10-30 23:43:44 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030154411-irBzLi` | 446,720 | 2026-10-30 23:44:50 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030154520-jOfM3u` | 448,260 | 2026-10-30 23:45:57 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030154624-wwMauM` | 371,904 | 2026-10-30 23:46:32 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030154646-spg22O` | 342,892 | 2026-10-30 23:46:50 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030154726-2aL6H7` | 446,192 | 2026-10-30 23:48:04 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030154917-FSkLyZ` | 404,044 | 2026-10-30 23:49:32 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030155003-Ek1a8g` | 342,888 | 2026-10-30 23:50:06 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030155022-SO88DZ` | 436,012 | 2026-10-30 23:50:31 | 已先移除 5 个链接 |
| `vantilo-vocabulary-backup-e2e-20261030155148-lLoQkE` | 397,624 | 2026-10-30 23:52:02 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030155254-CBC8uD` | 403,032 | 2026-10-30 23:53:08 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030160111-7TWXiB` | 402,116 | 2026-10-31 00:01:27 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030160501-YH9sm8` | 400,832 | 2026-10-31 00:05:15 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030160632-hkTbC6` | 403,876 | 2026-10-31 00:06:48 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030162253-JBS9Wq` | 342,888 | 2026-10-31 00:22:57 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030162313-63gwwR` | 421,452 | 2026-10-31 00:23:29 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030162347-PDbIFe` | 555,896 | 2026-10-31 00:24:39 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030162502-mmsQcA` | 548,932 | 2026-10-31 00:25:52 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030162634-7lboPu` | 468,220 | 2026-10-31 00:28:14 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030162938-FSLrws` | 374,088 | 2026-10-31 00:29:48 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030163022-AyaTWj` | 371,372 | 2026-10-31 00:30:31 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030163105-AHHkiX` | 342,888 | 2026-10-31 00:32:19 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030163140-tmZ4LU` | 342,888 | 2026-10-31 00:31:46 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030163225-ON4ol7` | 342,888 | 2026-10-31 00:32:32 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030163412-ReL2ck` | 471,448 | 2026-10-31 00:35:50 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030163617-s8jxQN` | 523,864 | 2026-10-31 00:36:45 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030175617-vAcv7S` | 367,568 | 2026-10-31 01:56:25 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030175637-reJjbj` | 368,116 | 2026-10-31 01:56:41 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030175657-iBgRU2` | 492,084 | 2026-10-31 01:57:19 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030175804-wmSChh` | 553,084 | 2026-10-31 01:58:31 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030180143-ArnfQr` | 553,784 | 2026-10-31 02:02:13 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030180628-SgRf8j` | 554,572 | 2026-10-31 02:06:57 | 无 |
| `vantilo-vocabulary-backup-e2e-20261030182054-FJvYKl` | 552,204 | 2026-10-31 02:21:24 | 无 |

### 为什么确认是合成 E2E 数据

- 命名统一为本项目 `vantilo-vocabulary-backup-e2e-<运行时间>-<随机后缀>`，时间集中在 2026-10-30 晚至 2026-10-31 凌晨；所有者和权限一致。
- `scripts/run-vocabulary-backup-e2e.mjs` 为每次运行创建该前缀的唯一目录，并在其中创建独立的 `HOME`、Codex 临时目录、Reader 测试资源、下载目录、Electron `user-data-a/b`、结果文件及合成备份。E2E 主进程校验独立 `userData` 路径。
- `lsof -nP +D` 对临时父目录扫描没有发现打开文件；提升权限后的进程列表没有发现相关 E2E/Electron 测试进程。
- 删除前将所有 112 个 `summary.json` / `result-*.json` 复制并逐一校验，原始内容没有被打印或检查。没有迁移 Chromium profile、日志、缓存或其他临时测试数据。
- 清理操作只接受 34 个逐项盘点的确切路径，并在删除前再次校验目录集合、所有者/权限、证据副本数量与哈希、无打开文件；没有递归删除父目录或使用删除通配符。

## 磁盘测量

即时清理前后测量使用 `df -k`：

| 卷 | 清理前可用 KiB | 清理后即时可用 KiB | 即时变化 |
|---|---:|---:|---:|
| 内置 Data（`/dev/disk3s5`，`/System/Volumes/Data`） | 36,972,172 | 51,590,064 | **+14,617,892 KiB（+13.94 GiB）** |
| Workspace（`/dev/disk6s1`，`/Volumes/Workspace`） | 828,548,456 | 828,548,456 | 0 KiB |

| 统计口径 | 清理前数据 | 说明 |
|---|---:|---|
| 34 个目标目录 `du -sk` 合计 | 14,583,304 KiB（13.91 GiB） | 逻辑目录占用，不等于必然可回收的物理块。 |
| Data 卷即时 `df` 可用空间变化 | +14,617,892 KiB（13.94 GiB） | 本次释放的主要实测证据；比 `du` 高 34,588 KiB。 |
| 之后再次读取 Data 卷 | 51,200,000 KiB 可用 | 比即时清理后少 390,064 KiB；属于时间窗口内的净变化，来源无法仅凭 `df` 归因。相对清理前仍增加 14,227,828 KiB（13.57 GiB）。 |

`df` 反映 APFS 卷可用空间，`du` 统计路径所占块；APFS 克隆/共享 extent、快照及同时发生的系统写入可能使二者不完全一致。本轮没有扫描或删除快照，也没有据 `du` 推断克隆独占空间。

清理前 Workspace 已验证 UUID `2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE`、APFS、挂载于 `/Volumes/Workspace` 且可写。保留的 112 份结果和清单共 113 个文件，Workspace 证据目录 `du -sk` 为 620 KiB。

## 测试路径防回退验证

- `npm test`、`npm run test:reader:offline`、词汇备份开发/打包/Universal E2E 均经过 `scripts/run-tests-on-workspace.mjs`。该入口每次创建 `/Volumes/Workspace/Development/Vantilo/test-runs/run-<时间>-<PID>/`，并将 `TMPDIR`、`TMP`、`TEMP`、Chromium/Electron E2E 相关目录及日志配置在该运行目录下。
- 直接运行词汇开发版、打包版或 Universal E2E 脚本时，现在先导入 `scripts/assert-workspace-test-environment.mjs`：再次验证 Workspace UUID/APFS/可写状态，并要求运行根目录、临时目录和 Node 实际 `os.tmpdir()` 均落在 Workspace 本次运行目录内。缺少隔离环境会在创建任何 E2E 文件前退出。
- 用现有 Workspace 测试运行目录验证了保护器的有效路径；分别直接启动三个 E2E 入口且不提供运行根目录，均在创建测试数据前按预期拒绝。
- 四个相关脚本通过 `node --check`；`git diff --check` 通过。本轮未运行完整 npm/Reader/Electron 业务套件，因为这里只改了测试启动隔离保护，清理使用的目标与测试数据均已退出；之前的测试通过记录见存储迁移报告。
- 已有文档化入口覆盖上述标准测试与词汇 E2E。项目中个别非默认、单次运行的 Reader 视觉/人工验收脚本仍使用 `os.tmpdir()` 或旧的 `build/` 路径，不能据此宣称所有临时 E2E 命令都已统一迁移；运行这些辅助脚本前仍须单独检查路径。本轮没有扩大修改范围去改造它们。
- Workspace 未挂载/身份不符/不可写时，标准入口的卷验证和 E2E 保护器都会失败关闭，不会改用内置临时目录。

## 其他对象

- **Chrome `code_sign_clone`：未触碰。** 本轮不进一步调查或清理它；此前审计显示有 Google 进程持有其内容且 APFS 共享块不明，仍需单独通过 Chrome 正常退出/重启后的只读观察调查，不能手工删除 42 个克隆目录。
- **Quark：未推出、未强制卸载。** 只读检查发现 `/Volumes/Quark`、`/Volumes/Quark 1`、`/Volumes/Quark 2` 仍挂载；本次 `lsof +D` 未发现对这些挂载路径的打开文件。挂载本身不代表应用一定未在使用，若要释放审计所述约 412 MiB 的已删除安装映像，建议用户确认无 Quark 程序正在运行后通过 Finder 正常推出对应卷。本轮没有执行推出。
- 没有触碰正式用户数据、Chrome 用户资料、Quark 文件、Reader seed、源码 `dist/`、发布 ZIP 或其他历史构建产物。

## 文件变更与 Git

- 新增本报告：`acceptance/storage/vantilo-legacy-e2e-cleanup-20261031.md`。
- 新增测试环境保护器：`scripts/assert-workspace-test-environment.mjs`。
- 三个词汇 E2E 入口增加保护器导入：`scripts/run-vocabulary-backup-e2e.mjs`、`scripts/run-vocabulary-backup-packaged-e2e.mjs`、`scripts/run-vocabulary-backup-universal-e2e.mjs`。
- `docs/testing/workspace-test-environment.md` 记录直接调用的 fail-closed 行为。
- 未提交、未推送。开始前已有的 `acceptance/storage/internal-ssd-space-audit-20261031.md` 未改动。
