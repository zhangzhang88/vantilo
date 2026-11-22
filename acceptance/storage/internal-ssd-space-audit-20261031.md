# Mac mini 内置 SSD 空间占用只读审计

审计时间：2026-10-31 09:15 CST
主机：Mac mini M4
审计范围：内置 APFS Data 卷、用户目录、应用、缓存、开发项目、临时目录及可见的 Time Machine 本地快照

## 执行范围与方法

本轮只读取文件系统和进程元数据：使用 `df -k`、`du`、`stat`、`find`、`mount`、`hdiutil info`、`tmutil listlocalsnapshots` 和 `lsof`。没有打开私人文件正文，没有读取聊天记录、词汇库、书库、API Key、Token 或凭据。没有删除、移动、改名、改权限、改链接、卸载磁盘映像或修改系统设置。

系统 `diskutil`/DiskManagement 不作为本审计依赖，也未用它来计算结果。`df`、目录扫描和 `tmutil` 足以得到本报告的容量与快照证据。`du` 对少数系统目录收到权限拒绝；相关目录标为权限受限/未知，绝不记成 0。

## 1. 内置卷精确容量

审计时的实测结果：

| 路径/卷 | 文件系统总块数 (KiB) | Used (KiB) | Available (KiB) | `df` 容量 | 说明 |
|---|---:|---:|---:|---:|---|
| `/System/Volumes/Data` (`/dev/disk3s5`) | 239,362,496 | 167,200,000 | 36,960,000 | 82% | 用户数据所在 Data 卷；可用约 35.25 GiB。 |
| `/` (`/dev/disk3s1s1`) | 239,362,496 | 13,320,000 | 36,960,000 | 27% | sealed、只读系统卷，与 Data 共用 APFS 容器；不能将两行相加。 |
| `/Volumes/Workspace` (`/dev/disk6s1`) | 999,999,792 | 171,200,000 | 828,000,000 | 18% | 外置 APFS 卷；可用约 789.95 GiB。 |

256 GB 是厂商十进制标称容量，约合 238.42 GiB；当前 Data 文件系统 `df` 的总块数约 228.27 GiB。系统卷、Preboot、Recovery/Update 等辅助卷、APFS 容器布局和格式化开销会造成标称容量与某个单独 `df` 行不同。不能把差额都归为普通文件，也不能从本次只读结果精确拆分容器保留块。

`tmutil listlocalsnapshots /` 与 `tmutil listlocalsnapshots /System/Volumes/Data` 均未列出 Time Machine 本地快照。本轮没有执行 APFS snapshot 删除，也没有使用 DiskManagement 快照枚举接口；因此“没有 Time Machine 本地快照”有证据，其他系统快照/可清除空间的精确字节数仍为 **UNKNOWN**。`df` 的 Available 是当前系统报告可分配的可用空间，不等价于图形界面可能单独显示的 purgeable 分类。

## 2. Data 卷顶层目录

以下为 `du -x -d 1 -k` 的路径占用。`private/var` 扫描有系统权限拒绝，故是可见部分统计，不能视为全目录精确上限。

| 路径 | `du` KiB | 约 GiB | 备注 |
|---|---:|---:|---|
| `/System/Volumes/Data/private/var` | 83,567,516 | 79.72 | 含约 79.9 百万 KiB 的 `folders/`；部分 postfix、root 和系统服务路径拒绝访问。 |
| `/System/Volumes/Data/Users` | 68,511,380 | 65.34 | 主要是 `/Users/world`。 |
| `/System/Volumes/Data/Applications` | 17,872,356 | 17.04 | 已安装 macOS 应用包。 |
| `/System/Volumes/Data/Library` | 2,796,860 | 2.67 | 其中 Developer 约 1.90 GiB。 |

上述四项的 `du` 合计约 172.75 百万 KiB，高于 Data 卷 `df Used` 的 167.20 百万 KiB，差约 5.29 GiB。`du` 遍历目录树，而 APFS 允许克隆文件共享物理 extent；目录统计可能重复计入共享块。系统拒绝访问也会让 `du` 漏项。两种统计口径不能直接相减来推断某个文件的实际物理占用。

## 3. 最大 20 个路径热点

按 `du` 路径规模排序，单位为 KiB。部分行是父目录的子项，不能相加；这张表用于定位热点，不是独占空间账单。大目录扫描只查看名称、大小和时间戳。

| 排名 | 路径 | KiB | 约 GiB | 分类 / 备注 |
|---:|---|---:|---:|---|
| 1 | `/private/var/folders` | 79,895,472 | 76.17 | 当前用户临时/缓存根；最大子项是 Chrome code-sign clone 和 Vantilo E2E 临时文件。 |
| 2 | `/Users/world` | 68,511,380 | 65.34 | 用户 Home 总计。 |
| 3 | `/private/var/folders/qw/p897z28x02jcry17_3d3dps40000gn/X/com.google.Chrome.code_sign_clone` | 62,406,380 | 59.52 | 42 个 `Google Chrome.app.bundle` 临时副本；APFS 克隆的独占块数未知。 |
| 4 | `/Users/world/Library` | 47,409,948 | 45.21 | 用户应用数据、缓存和开发工具数据总计。 |
| 5 | `/Users/world/Library/Application Support` | 30,402,032 | 29.00 | 多个桌面应用数据；其中含 Chrome、Codex、Vantilo 等。 |
| 6 | `/System/Volumes/Data/Applications` | 17,872,356 | 17.04 | 安装应用总计。 |
| 7 | `/private/var/folders/qw/p897z28x02jcry17_3d3dps40000gn/T` | 15,678,302 | 14.95 | 临时文件总计。 |
| 8 | `/Users/world/Library/Application Support/Google/Chrome` | 13,573,832 | 12.95 | Chrome 配置/Profile 与模型数据；不读取其内容。 |
| 9 | `/Users/world/Downloads` | 8,915,480 | 8.50 | 下载总目录。 |
| 10 | `/Users/world/Downloads/code` | 8,082,684 | 7.71 | 多个开发项目。 |
| 11 | `/Users/world/Library/Containers` | 4,257,060 | 4.06 | App Sandbox 数据，其中含微信、QQ 等用户数据。 |
| 12 | `/Users/world/Library/pnpm` | 4,219,196 | 4.02 | pnpm store 为 4,158,556 KiB，工具目录约 60,640 KiB。 |
| 13 | `/Users/world/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel` | 4,169,868 | 3.98 | Chrome 本地模型资产；不确定是否当前功能依赖。 |
| 14 | `/Users/world/Library/Caches` | 3,493,544 | 3.33 | Chrome cache、Nuvio、Electron、SwiftPM 等。 |
| 15 | `/Users/world/Downloads/code/Vantilo` | 3,286,572 | 3.13 | 当前项目；build 2,074,672 KiB、node_modules 1,172,424 KiB。 |
| 16 | `/System/Volumes/Data/Library` | 2,796,860 | 2.67 | 系统级 Library。 |
| 17 | `/Users/world/.cache` | 2,720,592 | 2.59 | 其中 Codex runtimes 2,544,892 KiB。 |
| 18 | `/Users/world/.codex` | 2,160,288 | 2.06 | 含 sessions、插件和运行资料；未读会话内容。 |
| 19 | `/Users/world/Downloads/code/Vantilo/build` | 2,074,672 | 1.98 | 已较清理前下降；`build/reader/seed` 和有验收价值的 Profile 仍在。 |
| 20 | `/System/Volumes/Data/Library/Developer` | 1,993,744 | 1.90 | 系统 Developer 工具，主要是 CommandLineTools。 |

### 安装应用的较大项目

以下都是 `/System/Volumes/Data/Applications` 的子项（KiB）。应用包迁移到外置卷可能破坏签名、权限或升级流程；优先卸载确实不用的应用，不建议手动搬 `.app`。

| 应用路径 | KiB | 约 GiB |
|---|---:|---:|
| `/Applications/Xcode.app` | 3,875,532 | 3.70 |
| `/Applications/ChatGPT.app` | 1,886,524 | 1.80 |
| `/Applications/VideoFusion-macOS.app` | 1,571,884 | 1.50 |
| `/Applications/Google Chrome.app` | 1,489,556 | 1.42 |
| `/Applications/Quark.app` | 1,029,744 | 0.98 |
| `/Applications/DeepSeek Harness.app` | 1,023,196 | 0.98 |

## 4. 临时目录中的 Vantilo 测试残留

此前迁移的 E2E 目录仍有 34 个留在 macOS 临时根：

`/private/var/folders/qw/p897z28x02jcry17_3d3dps40000gn/T/vantilo-vocabulary-backup-e2e-*`

这些目录合计 `du` 14,583,304 KiB（约 13.91 GiB）。其中 34 个最近 7 天修改、单个超过 100 MiB 的文件合计 8,498,391,392 字节（约 7.92 GiB）；路径名为每次 E2E 生成的 `reader-assets/codex`，文件只检查了路径、大小和 mtime，没有读取内容。目录时间分布在 2026-10-30 23:42 至 2026-10-31 02:20 CST。对整个 `/private/var/folders/.../T` 执行 `lsof +D` 没有发现打开文件；该结果不能代替确认每个文件都是可删除的唯一审计资料，但与命名、时间和已迁往 Workspace 的新 E2E 路径相符，是当前最明确的可再生成测试残留。

本轮没有重复删除它们。旧路径的测试资料应先按 E2E 运行记录确认是否需要保留摘要/证据，再只清理明确的 34 个测试目录；后续测试入口已写到 Workspace 的唯一 `test-runs/`，不再默认生成这些内置临时路径。

## 5. Chrome code-sign clone 临时树

`/private/var/folders/.../X/com.google.Chrome.code_sign_clone` 有 42 个形如 `code_sign_clone.*` 的 `Google Chrome.app.bundle` 目录，`du` 计 62,406,380 KiB（约 59.52 GiB）。目录 mtime 跨 2026-10-02 至 2026-10-29；树的父目录最近在 10-29 更新。`lsof +D` 当前至少报告一个 Google 进程（PID 80881）仍持有该树中的 `txt` 文件。

名称显示它是 Google Chrome 的 code-sign clone 临时区，但只读证据不能确认每个副本的物理 APFS 独占空间、Chrome 的清理策略或哪些副本仍必需。`du -A` 也约 62.32 百万 KiB；这只是表观字节数，不能消除 APFS 克隆共享造成的不确定性。**不要手动删除这个系统/应用临时树，也不要在 Chrome 运行时尝试清理。** 需要优先检查 Chrome 是否反复产生未清理的签名克隆；关闭并正常重启 Chrome 后再观察 `df` 和目录规模，必要时用 Chrome 官方更新/支持渠道处理。

## 6. 已删除但仍被挂载映像持有的安装文件

`hdiutil info` 显示两个 Quark 卷（`/Volumes/Quark 1`、`/Volumes/Quark 2`）均源于同一个本地 QuarkInstaller DMG。源路径当前不存在；`lsof +L1` 显示 diskimage 的两个进程仍持有同一设备/节点的已删除文件，大小 `432,453,194` 字节（约 412.3 MiB）。这是一个文件被两个挂载引用，不能按两份相加；在映像正常退出前，这些块不会释放。

另有一个约 `398,611,403` 字节的已删除 Baidu DMG 被 diskimage 持有，但它位于 `/Volumes/Workspace/.Trashes/501/`，属于外置盘，不占内置 SSD。

建议在确认没有从 Quark 挂载卷运行程序后，通过 Finder 正常推出两个 Quark 卷。因为本地 DMG 已无目录链接，推出后系统会释放该文件；不需要手工删除文件。本轮没有推出。

## 7. 其他开发与应用数据

| 路径 | KiB | 约 GiB | 建议/保护边界 |
|---|---:|---:|---|
| `/Users/world/.cache/codex-runtimes` | 2,544,892 | 2.43 | Codex 运行时缓存；只在 Codex 支持的维护入口确认旧版本后清理/迁移。 |
| `/Users/world/Library/Application Support/Codex` | 1,259,332 | 1.20 | Codex 应用数据，含用户状态；保留，不手动迁移。 |
| `/Users/world/Library/Application Support/Code` | 1,967,744 | 1.88 | VS Code 类应用数据/扩展；逐项经应用确认。 |
| `/Users/world/Library/Application Support/Open Design` | 2,276,288 | 2.17 | 应用数据，内容未检查；未知归属保留。 |
| `/Users/world/Library/Application Support/Quark` | 1,819,116 | 1.73 | 应用数据，保留。 |
| `/Users/world/Library/Caches/Google/Chrome` | 1,474,144 | 1.41 | 可考虑通过 Chrome 自身“仅清理缓存文件”释放；勿选择 Cookie、历史记录或密码。 |
| `/Users/world/Library/Caches/Nuvio` | 950,980 | 0.91 | 应用缓存；用 Nuvio 内置维护能力确认后处理。 |
| `/Users/world/Library/pnpm/store` | 4,158,556 | 3.97 | 可用 `pnpm store prune` 清理未引用包；不是手动删除，也不要移走正在使用的 store。未来可把 pnpm store 配置到 Workspace。 |
| `/Users/world/.nvm/versions` | 1,044,224 | 0.996 | Node 版本可用 nvm 官方卸载命令逐个处理；保留正在使用版本。 |
| `/Users/world/.codex/sessions` | 816,092 | 0.78 | 用户会话数据；本轮未读内容，不能按缓存清理。 |
| `/Users/world/Library/Python` | 720,532 | 0.69 | Python 环境/包；先由对应环境工具盘点，不手动移动。 |
| `/Users/world/.rustup` | 553,240 | 0.53 | Rust toolchain；不需要的 toolchain 用 rustup 管理命令卸载。 |
| `/Users/world/.pi-terra-test` | 723,940 | 0.69 | 名称类似测试目录但来源/唯一资料未确认；不因名称直接清理。 |
| `/Users/world/.grok` | 482,280 | 0.46 | 用户应用状态，保留。 |

Vantilo 项目仍占约 3.13 GiB，其中 `build/` 约 1.98 GiB、`node_modules/` 约 1.12 GiB。此前已清理的 5 个可再生成 Reader build 目录不再出现；其余 `build/` 包含 `build/reader/seed`、被开发流程引用的 `reader-dev`、历史 Profile/验收资料和构建输入。`dist/` 约 1.5 MiB，来源未知；本审计未触碰。项目附近的 `magazine-reader` 约 1.07 GiB，属于受保护项目，未读取书籍或文章内容，不建议在本任务范围内迁移或清理。

## 8. Disk image 与 Workspace 状态

`mount` 显示 Workspace 为独立 `/dev/disk6s1` APFS 卷，不计入内置 SSD。`hdiutil info` 显示 0.1.10、0.1.12、0.1.13 和 0.1.14 的 Vantilo SWC sparse image 均位于 `/Volumes/Workspace/Development/Vantilo/workspaces/...`；它们的挂载卷约 23,880 KiB 已用，容量 128–512 MiB，但 backing image 文件在 Workspace，不是内置空间来源。

## 9. 从 61.42 GiB 到 35.25 GiB 的变化

此前记录的可用空间约 61.42 GiB；本次 `df -k` 得到 36,960,000 KiB，即 35.248 GiB。按这两个值估算，Available 下降约 **26.17 GiB**。之前 Vantilo 清理时从 `df -h` 记录的 34 GiB 到 35 GiB 是取整显示；当前精确值不能回填成那个历史时点的精确数。

**有证据的解释：**

1. 内置临时目录仍有 34 个 Vantilo 词汇 E2E 数据目录，合计约 13.91 GiB `du` 占用；最近一周有 34 个约 250 MB 的 E2E `codex` 构建文件，合计约 7.92 GiB。它们与最近开发测试时间相符，是近期下降的强证据，但 APFS 克隆/共享块使真实可释放量未知。
2. Chrome code-sign clone 临时树有 42 份应用包，目录 `du` 约 59.52 GiB，时间覆盖本月且当前 Chrome 进程仍在使用其中至少一个文件。它是很大的占用候选，但实际独占物理块和增长量未能从只读测量中分离。
3. 本地 Quark 安装映像源文件已从目录删除但仍被两个挂载持有，同一节点约 412.3 MiB；正常推出后这部分才可能释放。
4. 用户数据中的 Chrome 模型资产约 3.98 GiB、缓存 1.41 GiB；pnpm store 约 3.97 GiB，Codex runtime cache 约 2.43 GiB。这些是当前可见的大型目录，但没有旧快照/历史 `df` 记录，不能证明它们是在 61.42 GiB 后新增长的。

**仍未知：**

- 61.42 GiB 测量的精确 `df -k`、时间戳、当时的 APFS clone 和运行进程状态未在本次审计环境中找到。
- 没有可比较的历史容量时间序列，因此无法把 26.17 GiB 按目录精确归因，也无法确定是一次性增长还是多日累积。
- Chrome clone、E2E 副本及其他 APFS clone 实际共享了多少物理 extent，`du` 无法回答。
- 系统权限拒绝的 root/spool 路径，以及非 Time Machine 的 APFS snapshot、purgeable bytes 的精确规模未知。

因此目前最可信的判断是：**近期 Vantilo E2E 临时目录提供了约 13.9 GiB 的可见占用证据；Chrome code-sign clone 是最大的逻辑空间热点；两者连同 Quark deleted-open image 可以解释下降的大部分候选来源，但不能证明它们合计实际释放 26.17 GiB。**

## 10. 按预计空间回收排序的后续建议（本轮未执行）

下表的“空间”是 `du` 逻辑/分配统计上限，不保证等于 `df` 可用空间增加。所有建议都需要下一轮单独授权；本次没有进行清理或迁移。

| 顺序 | 项目与预计空间 | 建议操作 | 安全前提与限制 |
|---:|---|---|---|
| 1 | Chrome code-sign clone：目录逻辑约 59.52 GiB，实际可回收量 UNKNOWN | 先正常退出并重启 Chrome，观察该临时树是否由应用/系统自动回收；若仍增长，再通过 Chrome 官方支持渠道排查。 | 当前有 Google 进程持有文件；不要手工删除或搬迁。不能把 59.52 GiB 当作承诺释放量。 |
| 2 | Vantilo E2E 临时目录：约 13.91 GiB，其中近期大文件约 7.92 GiB | 确认 34 个目录仅为旧合成 E2E 运行输出、无须保留唯一审计证据且无进程使用后，逐个删除这些准确目录。 | `lsof +D` 未报告打开文件；保留任何唯一报告/失败现场后再清理。可回收物理量受 APFS clone 影响。 |
| 3 | pnpm store：约 3.97 GiB | 在所有项目安装状态确认后用 `pnpm store prune`；以后把 store-dir 配置到已验证 Workspace。 | 只用 pnpm 自身管理；迁移配置前 Workspace 必须挂载，严禁 fallback 到同名内置目录。 |
| 4 | Chrome on-device model：约 3.98 GiB | 在 Chrome 自身维护界面确认未使用模型并让应用管理清理/重新下载。 | 不直接删除模型目录；会影响依赖这些本地模型的功能。 |
| 5 | Codex runtimes：约 2.43 GiB | 通过 Codex 支持的更新/缓存管理方式移除旧运行时版本。 | 不手动移动；确认当前进程和运行版本。 |
| 6 | Xcode：约 3.70 GiB；CommandLineTools：约 1.61 GiB | 如确定不再进行相关开发，使用 Apple 支持的卸载流程卸载不需要的完整工具链。 | 不能搬 `.app` 到外置盘来替代卸载；会影响开发工具链。 |
| 7 | Chrome disk cache：约 1.41 GiB | 用 Chrome UI 只清理缓存文件。 | 不勾选 Cookie、历史、密码或站点数据；实际回收受活跃文件和 APFS 影响。 |
| 8 | Quark 已删除但仍打开 DMG：约 412.3 MiB（同一文件） | 确认不再从两个 Quark 挂载卷运行程序后，用 Finder 正常推出 `/Volumes/Quark 1` 和 `/Volumes/Quark 2`。 | DMG 源路径已不存在；正常关闭映像后释放。不要强制终止 diskimage 进程。 |
| 9 | `.nvm/versions`：约 996 MiB | 通过 nvm 卸载确认不用的 Node 版本。 | 不移走正在使用的版本；项目需要时可重新安装。 |
| 10 | Vantilo build：约 1.98 GiB；node_modules：约 1.12 GiB | 继续用外置独立构建副本；未来需要回收时先单独核对 seed/Profile 和依赖再决定。 | `build/reader/seed`、reader-dev、Profile 和验收资料保留；不得整体删除 `build/`。 |

## 11. 最终结论

- 当前内置 Data 卷精确可用空间为 **36,960,000 KiB（约 35.25 GiB）**。
- 最大热点是 `/private/var/folders`：约 79,895,472 KiB；其下可见 Chrome code-sign clone 临时树约 62,406,380 KiB，Vantilo E2E 临时目录约 14,583,304 KiB。
- 可直接归因近期测试的强证据是 34 个 Vantilo E2E 临时运行目录及其 34 个近期大文件；这些本轮未删除。
- Google Chrome clone 逻辑占用很大，但 APFS 独占块量未知，而且当前有 Chrome 进程在使用；不能手动清理。
- Quark 安装映像源文件已删除但仍被挂载持有，约 412.3 MiB；只有安全推出映像后才可能释放。
- 从约 61.42 GiB 降到约 35.25 GiB 的约 26.17 GiB 变化有上述强候选，但缺少历史 `df` 和 APFS extent 证据，仍不能完全或精确归因。
- 本轮没有执行清理、迁移、卸载或推出映像。
