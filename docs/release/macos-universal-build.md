# macOS Universal 构建与 Release 操作手册

本文记录 Vantilo Universal macOS 构建与公开 Release 的安全步骤，并以 **0.1.10** 的本机执行结果作证据基线。历史产物和记录不等于当前发行批准，也不授权清理、覆盖或分发个人数据。

## 证据状态标记

- **[实测]**：本次 0.1.10 的文件、报告、命令结果或本机检查能够证实。
- **[脚本配置]**：当前脚本会这样执行，但不等于已在 Intel 真机或其他 macOS 环境验证。
- **[未验证]**：没有保留足够证据。不得在后续报告中写成已完成。

## 1. 固定目录与 0.1.10 构建快照

| 用途 | 绝对路径 | 证据/备注 |
|---|---|---|
| 正式源仓库 | 当前 Git checkout 根目录（`git rev-parse --show-toplevel`） | **[实测]** 正式开发工作区；不得把大型构建中间文件写到这里。 |
| 唯一 Vantilo 构建/发布管理根 | `/Volumes/Workspace/Development/Vantilo` | **[实测]** 现有输入仓储与 0.1.9/0.1.10 输出目录所在位置。 |
| 本次独立工作副本 | `/Volumes/Workspace/Development/Vantilo/workspaces/0.1.10-build` | **[实测]** 已迁入统一根；含 `.git`、源工作树、`node_modules` 与构建临时数据。旧路径 `/Volumes/Workspace/Development/Vantilo-0.1.10-build` 是指向此处的兼容 symlink。 |
| 已有 Universal 输入 | `/Volumes/Workspace/Development/Vantilo/universal-inputs` | **[实测]** 可复用输入仓储，不是完整 Vantilo checkout；没有 `.git` 或 `package.json`。保留原位。 |
| 本次输入根目录 | `/Volumes/Workspace/Development/Vantilo/workspaces/0.1.10-build/build/universal-inputs` | **[实测]** Electron、Codex 与 npm cache 均通过 symlink 复用外置资源；目标需逐项核验。 |
| 本次候选构建目录 | `/Volumes/Workspace/Development/Vantilo/workspaces/0.1.10-build/build/universal-candidates-0.1.10-20261029062600` | **[实测]** 留存 arm64/x64 候选 ZIP、Universal `.app`、报告和中间文件。 |
| 0.1.9 产物 | `/Volumes/Workspace/Development/Vantilo/out/0.1.9/` | **[实测]** 原有 ZIP、校验文件和报告已移动到版本目录；`out/` 根保留旧路径兼容 symlink。 |
| 0.1.10 产物 | `/Volumes/Workspace/Development/Vantilo/out/0.1.10/` | **[实测]** 历史 DMG、ZIP、校验文件及报告已集中迁入；历史 DMG 保留原位，不再生成或验收 DMG。 |
| npm cache | `/Volumes/Workspace/Development/npm-cache` | **[实测]** 输入根内 symlink 指向此处。缓存 528 MB，日志显示也被非 Vantilo npm 命令使用；按共享缓存处理，不移动、不清理。 |
| SWC binding 缓存 | backing image `/Volumes/Workspace/Development/Vantilo/workspaces/0.1.10-build/tmp/swc-native-cache.sparseimage`；曾挂载于 `/Volumes/VantiloSWC010`，变量值 `/Volumes/VantiloSWC010/native-bindings` | **[实测]** Vantilo 构建专用 APFS cache image 随工作副本归档；测试完成后已卸载，image 保留。初始化命令及首次目录失败原因 **未找到证据**。 |
| 临时文件、HOME 与 XDG cache | `/Volumes/Workspace/Development/Vantilo/workspaces/0.1.10-build/{tmp,home,xdg-cache}` | **[实测]** 均在统一外置管理根之下；isolated app profile 位于 `tmp/app-smoke/`。 |
| 旧 0.1.10 发布路径 | `/Volumes/Workspace/Vantilo-Releases/0.1.10` | **[实测]** 五个文件迁移并逐项校验后，旧路径改为指向 `out/0.1.10/` 的兼容 symlink；没有其他旧产物。DMG sidecar 的绝对路径仍可解析。 |
| `cache/` | `/Volumes/Workspace/Development/Vantilo/cache` | **[实测]** 目前不存在；没有已确认需要搬入的 Vantilo-only 缓存，因此本轮不创建。 |

本次工作副本 `build/universal-inputs` 的重要 symlink 为：

- `electron-v45.0.0-darwin-arm64.zip`、`electron-v45.0.0-darwin-x64.zip` → `/Volumes/Workspace/Development/Vantilo/universal-inputs/` 下的对应归档；两个归档 SHA-256 分别为 `896c3a50b148e89a158dca08a6996a022ddf39b23aac871e107f5b4087f8caa9` 与 `7877c282e74a52f8d87949536a25735cf9982de1265b544c9cd258dd14eff4de`。
- `electron-x64` → `/Volumes/Workspace/Development/Vantilo/universal-inputs/electron-x64`。
- `codex-x64` → `/Volumes/Workspace/Development/Vantilo/universal-inputs/codex-x64`。
- `npm-cache` → `/Volumes/Workspace/Development/npm-cache`。该缓存不是 Vantilo 专属：其 `_logs` 还记录 `npm view` 等 Pi 工具查询；保持共享路径，不搬入 `cache/`。
- `native-x64/vantilo-dictionary` 是本次从 Vantilo 的 Swift 源码为 x86_64 编译的 helper；0.1.10 工作副本和现有输入仓储中均有该输入，不要盲目重新编译或覆盖。

统一管理根的实际结构为 `universal-inputs/`、`out/0.1.9/`、`out/0.1.10/` 和 `workspaces/0.1.10-build/`。`out/` 根还保留 3 个指向 `0.1.9/` 的兼容 symlink，以维持旧报告中的 `out/<filename>` 引用；物理文件只保留在版本子目录。共享 npm cache 不属于此管理根。

不要把 symlink 目标存在当成版本/完整性证明。先检查链接目标，再验证版本、校验和、归档内容及架构。

### 0.1.10 源码状态

- **[实测]** 源仓库和外置副本的 branch 均为 `main`，HEAD 均为 `6ff5329e366ab611dfac032abbb696074fc8f2b1`（2026-10-28 22:47:05 CST）。
- **[实测]** 复制时保留了工作副本的 Git metadata、依赖、未提交修改和未跟踪文件；当时核对了 source/copy Git 状态、tracked diff 与未跟踪文件内容哈希。没有找到一份持久化的完整逐文件 snapshot manifest；不能声称 artifact 可由 HEAD 单独重建。
- **[实测]** 本次构建准备开始时的源工作树有 43 个 modified tracked status rows、22 个 untracked paths。准备期间仅将 `package.json` 和 `package-lock.json` 的版本字段更新为 `0.1.10`，随后复制当前工作树；没有提交或推送。这个计数是构建快照，不是本文编辑后的 Git status 计数。
- **[历史构建副本记录]** 旧外置副本曾单独修改 `electron/main.cjs` 与 `scripts/build-mac-beta-candidates.mjs` 以省略默认 seed；该副本差异未构成可追溯的发行快照。本次将“仅当 manifest 存在才选择 seed”及默认不复制 seed 的逻辑合并到正式源工作树；build 会拒绝旧的 `build/reader/seed` 而不自动删除，并增加最终 ZIP EPUB 拒绝策略与报告字段。新脚本尚未在干净快照上构建，故这些是已实现、未通过实际打包验证的策略。
- **[实测]** Reader 源码来源记录在 `packages/reader/SOURCE_PROVENANCE.md`：来自受保护 Magazine Reader 项目的用户工作树快照。项目所有者已确认拥有 Magazine Reader 项目及集成 Reader 源码的版权；没有选择 Vantilo 源码许可证。项目所有者另已确认 Worm 项目布局/键盘生命周期代码属于其版权并授权 Vantilo 公开发布；这不涵盖其他依赖、媒体或服务。本次历史测试 ZIP 不含 EPUB。

## 2. 外置卷预检与空间

每次写入、复制、安装依赖、下载、构建或生成安装包之前执行：

```sh
/bin/sh /Volumes/Workspace/_System/verify-workspace-volume.sh
diskutil info /Volumes/Workspace
df -h /Volumes/Workspace /
```

**[实测]** 本次核验时外置 Workspace 挂载在 `/Volumes/Workspace`，APFS 且可写；项目级预检脚本也通过。核验时外置卷有约 913 GiB 可用、系统盘约 63 GiB 可用；这不是原始构建开始时的空间快照。本文不记录卷 UUID。

预检脚本验证卷身份、挂载点、APFS 与写权限，**不检查可用空间阈值**。每次根据源码/`node_modules`、候选应用、临时缓存、已有缓存和发布物实际大小估算并留足余量；0.1.10 的已交付 ZIP 与 DMG 合计约 1.02 GB，工作副本和中间产物会额外占用空间。没有发现项目配置的固定最低空间数字，不要杜撰阈值。

若脚本失败、UUID 不符、盘未挂载/只读、symlink 跑到内置盘，或容量不足：**停止**。不要创建同名空挂载目录，不要把 `TMPDIR`、`out`、npm/Electron/SWC cache 或下载路径静默回退到内置盘。长时间任务开始前及发生卷异常后重新验证。

## 3. 创建独立构建副本

每版使用从未存在过的外置目录；不得在源目录直接打包，也不得复用旧版本副本做未经审查的覆盖构建。以下是安全复制参考，不是已保留的 0.1.10 原始复制命令：

```sh
SRC="$(git rev-parse --show-toplevel)"
MANAGER=/Volumes/Workspace/Development/Vantilo
VERSION=0.1.11 # 示例：按本次构建版本修改
BUILD="$MANAGER/workspaces/$VERSION-build"

/bin/sh /Volumes/Workspace/_System/verify-workspace-volume.sh
test ! -e "$BUILD" || { echo "STOP: build path already exists" >&2; exit 2; }
mkdir "$BUILD"
# 保留 .git、隐藏文件、所有非忽略的修改/未跟踪源码；不要带入 ignored build/out、凭据、日志或本机运行数据。
rsync -a \
  --exclude='/node_modules/' --exclude='/build/' --exclude='/dist/' --exclude='/out' \
  --exclude='/.env' --include='/.env.example' --exclude='/.env.*' --exclude='/*.local' --exclude='/*.local.*' \
  --exclude='/*.pem' --exclude='/*.key' --exclude='/secrets/' --exclude='/credentials/' \
  --exclude='/.runtime/' --exclude='/runtime-data/' --exclude='/logs/' --exclude='*.log' \
  "$SRC/" "$BUILD/"
# 仅在审查 node_modules 内容/链接并确认目标不存在后，复制依赖以免重复安装下载。
test ! -e "$BUILD/node_modules" || { echo "STOP: node_modules exists" >&2; exit 2; }
rsync -a "$SRC/node_modules/" "$BUILD/node_modules/"
# Universal script writes to repo/out/<version>; route repo/out to the canonical release root.
test ! -e "$BUILD/out" && test ! -L "$BUILD/out" || { echo "STOP: out already exists" >&2; exit 2; }
ln -s "$MANAGER/out" "$BUILD/out"
# Reuse validated shared inputs without copying or downloading them.
INPUTS="$BUILD/build/universal-inputs"
mkdir -p "$INPUTS"
for name in electron-v45.0.0-darwin-arm64.zip electron-v45.0.0-darwin-x64.zip electron-x64 codex-x64 native-x64; do
  test -e "$MANAGER/universal-inputs/$name" || { echo "STOP: missing input $name" >&2; exit 2; }
  test ! -e "$INPUTS/$name" && test ! -L "$INPUTS/$name" || { echo "STOP: input link already exists $name" >&2; exit 2; }
  ln -s "$MANAGER/universal-inputs/$name" "$INPUTS/$name"
done
test ! -e "$INPUTS/npm-cache" && test ! -L "$INPUTS/npm-cache" || { echo "STOP: npm cache link already exists" >&2; exit 2; }
ln -s /Volumes/Workspace/Development/npm-cache "$INPUTS/npm-cache"
```

此参考命令故意不复制被 `.gitignore` 忽略的本机构建数据；如果确有需要的缓存或输入，逐项审查来源/内容后从外置存储复用，不要整体复制个人 `build/` 或 `out/`。也不要复制 `.env`、token、cookie、认证目录或个人用户数据库。若目标已部分创建或复制失败，不要自动删除/覆盖它；先检查，再另选一个新路径或经授权恢复。

复制后核对：

```sh
git -C "$SRC" status --short
git -C "$BUILD" status --short
git -C "$SRC" branch --show-current
git -C "$BUILD" branch --show-current
git -C "$SRC" rev-parse HEAD
git -C "$BUILD" rev-parse HEAD
git -C "$SRC" diff --binary | shasum -a 256
git -C "$BUILD" diff --binary | shasum -a 256
```

比较 HEAD、branch、status、diff hash，并对 `git ls-files --others --exclude-standard` 列出的每个未跟踪文件核对相对路径与内容哈希。检查复制后的所有 symlink 的 `readlink`/`realpath`。不要只复制 HEAD 或使用 `git archive`，因为这会漏掉本项目当前的重要 uncommitted/untracked work。不要把比较文件写回源仓库；若需保存清单，仅保存经审查的相对路径/哈希，不保存未经脱敏的 diff、文件内容或秘密。

**[未找到证据]** 0.1.10 使用的原始复制命令、排除列表和完整逐文件 hash manifest 没有保留；上面是今后建议流程，不是对历史 shell 命令的复述。现有 0.1.10 ZIP 因而不能仅凭其内部 Reader provenance 声称对应一个干净的 Vantilo Git commit。创建输入链接前还必须逐项校验版本、SHA 和架构；命令示例中的 Electron 版本应从当前 `package.json`/Electron dependency 取值。

## 4. 版本、缓存、输入和路径布置

### 更新版本

只在已经审查过的外置工作副本中升级版本。更新 `package.json` 的 `version`，以及 `package-lock.json` 顶层和 `packages[""]` 的对应版本；检查 diff 确认没有其他依赖版本被意外改动。不要用会提交、打 tag 或改写源工作树的版本命令。

打包脚本读取根 `package.json` 版本并将它写入候选 app 的 package metadata；Electron Packager 再生成 `Info.plist`。打包后必须逐一核对 `package.json`、lockfile、`.app/Contents/Info.plist`（`CFBundleShortVersionString`/`CFBundleVersion`）、报告、ZIP、DMG 命名与内容版本一致。

**[实测]** 本次 app package version 和 Info.plist 均为 `0.1.10`。0.1.10 具体使用的版本更新 shell 命令 **未找到证据**。

### 验证/复用输入

**[实测]** 本次使用 Electron `45.0.0` arm64+x64 归档；Codex `0.163.0-darwin-arm64` 来自 `node_modules`，x64 `0.163.0-darwin-x64` 来自已准备的外置输入；两种 Codex 可执行文件及 `codex-code-mode-host` 的切片正确。两种 Electron 的已解压主程序切片也分别为 arm64 与 x86_64。Intel Dictionary helper 由本次 Swift 源码构建为 x86_64。归档/解压内容在 0.1.10 构建前已检查；本手册只保留 Electron 归档 SHA，不保留 Codex tarball 的 SHA 或每个解压文件的 hash manifest。

后续复用前至少确认：

1. symlink 目标位于已验证的 Workspace；路径不能只因名字含 `Workspace` 就视为外置。
2. Electron 版本与项目 `electron` 依赖完全匹配；归档 SHA-256 与 Electron 官方 release checksum 相符；解压后检查 Electron executable 的 `lipo -archs`。
3. ARM 与 Intel Codex package 版本相同，分别检查 `package.json` 版本、`codex` 和 `codex-code-mode-host` 文件存在及 `lipo -archs`；tarball/缓存完整性要有可验证依据。
4. npm cache 只在 `npm cache verify` 或对精确归档校验不会导致清理/变更既有用户缓存时使用；不为通过构建而清除缓存。项目 `build-mac-universal.mjs` 在 Codex x64 缺失时会用 `npm pack ... --ignore-scripts --cache <inputRoot>/npm-cache`，有缓存则直接复用。
5. 不匹配或校验失败时停止，保留坏文件供调查；脚本当前对已有 Electron ZIP 会比对 GitHub 官方 checksum，错误时不会自动覆盖。

### 本次脚本与环境

**[实测]** 本次 Universal ZIP 的真实命令为：

```sh
cd /Volumes/Workspace/Development/Vantilo-0.1.10-build # legacy alias; realpath is /Volumes/Workspace/Development/Vantilo/workspaces/0.1.10-build
npm run build:mac:universal
```

源仓库现有 `out` symlink 指向管理根 `out/`。未来外置工作副本也必须令 `<workcopy>/out` 指向 `/Volumes/Workspace/Development/Vantilo/out`；Universal 打包脚本现在在该路径下追加 `<version>/`。新版本工作副本应位于 `workspaces/<version>-build/`。

对应 package script 为 `npm run build && npm run build:reader && node scripts/build-mac-universal.mjs`。在运行前将环境和链接全部指向外置卷。0.1.10 的路径布置可供复核：

```sh
BUILD=/Volumes/Workspace/Development/Vantilo/workspaces/0.1.10-build
export HOME="$BUILD/home"
export XDG_CACHE_HOME="$BUILD/xdg-cache"
export TMPDIR="$BUILD/tmp" TMP="$BUILD/tmp" TEMP="$BUILD/tmp"
export npm_config_cache=/Volumes/Workspace/Development/npm-cache
export ELECTRON_CACHE="$BUILD/electron-cache"
export ELECTRON_BUILDER_CACHE="$BUILD/electron-builder-cache"
# 仅当经核验的外置 APFS cache image 已挂载时设置：
export SWC_NATIVE_BINDING_CACHE=/Volumes/VantiloSWC010/native-bindings
```

`CODEX_HOME` 在本次 isolated app smoke 使用 `$BUILD/runtime/codex-home`，不是签入的用户登录目录；不得复制真实用户 CODEX_HOME 或任何登录 token。若构建环境需该变量，也要指向新建的隔离外置目录。

**[脚本配置]** `build-mac-universal.mjs` 要求 Apple Silicon macOS；从 `build/universal-inputs` 解析官方 Electron 输入，缺 x64 Codex 时才 `npm pack`，缺 native helper 时用 Xcode SDK 执行 `xcrun swiftc -target x86_64-apple-macosx12.0 ...`，之后分别打 arm64/x64 候选、合并 Universal app、逐个签名 Mach-O/bundle，再 ad-hoc 签名。候选默认目录是 `build/universal-candidates-<version>-<timestamp>`；`VANTILO_UNIVERSAL_CANDIDATES` 仅接受 `build/` 内已存在的候选目录，不是通用输出目录变量。

Universal 产物目录计算位于 `scripts/universal-output-path.mjs`，并由测试覆盖版本隔离、prerelease、显式独立输出根、路径穿越拒绝及脚本接线。构建报告记录干净源码的 Git commit、lockfile SHA-256 和 Reader 来源 commit；构建脚本拒绝 dirty Git 快照。没有加入 Electron Builder 配置，因为 Universal 输出由 `@electron/universal`/`ditto` 实现，不经 Electron Builder 的 release 输出配置。

脚本将 ZIP、`.sha256` 和 `.report.json` 写到 `repo/out/<version>/`；可用 `VANTILO_UNIVERSAL_OUTPUT_ROOT` 指定新建的独立外置输出命名空间，脚本随后追加版本子目录。构建前必须核对输出根的真实路径、外置卷身份及目标不存在；脚本对同名 ZIP、checksum、报告拒绝覆盖。历史兼容 symlink 保留原位，不作为新输出目标。

**[未找到证据]** 本次完整 export 命令、SWC sparse image 创建/挂载命令、DMG 生成命令及 zip-to-DMG 的确切暂存路径没有保留。以上 env 值由外置工作副本、symlink、缓存文件及测试启动记录核验；不应伪称它们是完整 shell history。共享 npm cache 的全局默认配置目前仍是内置盘 `~/.npm`，故外置构建必须显式设置 `npm_config_cache=/Volumes/Workspace/Development/npm-cache`。

## 5. 未来输出规则与 0.1.10 历史产物

今后每个 macOS Universal 版本只需输出 Universal ZIP、对应 SHA-256 sidecar 和构建报告，统一放在 `/Volumes/Workspace/Development/Vantilo/out/<version>/`。不再生成 DMG，也不要求 DMG 验收。0.1.10 已有 DMG 是历史产物，继续留在原路径；不得删除、移动或覆盖。

**[实测]** 已交付文件：

| 文件 | 大小 | 修改时间（CST） | SHA-256 |
|---|---:|---|---|
| `/Volumes/Workspace/Development/Vantilo/out/0.1.10/Vantilo-Beta-0.1.10-universal.dmg` | 528,387,402 bytes | 2026-10-29 14:28:14 | `9d6ee7c6164faad4e158639f91c2ef20892e783cffbac87cf9d0cf5f9dc640a2` |
| `/Volumes/Workspace/Development/Vantilo/out/0.1.10/Vantilo-Beta-0.1.10-universal.zip` | 483,403,050 bytes | 2026-10-29 14:27:17 | `0f26059ddc1625fce4178a8b1d4b4ecf41e72bdc7b6e58807b9f40570afe7ff7` |
| `/Volumes/Workspace/Development/Vantilo/out/0.1.10/Vantilo-Beta-0.1.10-universal.dmg.sha256` | 143 bytes | 2026-10-29 14:28:15 | `b65bdc216288dfc67fd97f3fa035104ea2c7a416dede60c39ece3e3870db95c2` |
| `/Volumes/Workspace/Development/Vantilo/out/0.1.10/Vantilo-Beta-0.1.10-universal.zip.sha256` | 100 bytes | 2026-10-29 14:27:18 | `b7348acfa1955caf7f05e0f98235aad0ace1e269c343832c9a2c8bb379d19ce8` |
| `/Volumes/Workspace/Development/Vantilo/out/0.1.10/Vantilo-Beta-0.1.10-universal.report.json` | 343 bytes | 2026-10-29 14:27:18 | `204aed7cfc3f797859f38a21979ad40b43550cf688096eb07dc608d2764ffcc9`；声明 `ad-hoc; not notarized`、`intelHardwareTest: NOT RUN` |

ZIP 和 DMG 各有 `.sha256` sidecar；迁移前后均验证了 ZIP/DMG 摘要，sidecar 中 DMG 原有的绝对路径由旧发布路径兼容 symlink 保持有效。`unzip -t` 完整性检查通过，`hdiutil verify` 报 DMG checksum valid。DMG 是压缩只读 UDIF。0.1.9 ZIP 现位于 `/Volumes/Workspace/Development/Vantilo/out/0.1.9/Vantilo-Beta-0.1.9-universal.zip`（565,735,646 bytes，SHA-256 `657311797e5c0a67560dc562d3aabdf0fc13a8d1e09fa6cdea0054ffd4b45a6c`）；99-byte sidecar（SHA-256 `83330eb5f022dce3ecb375ac954232924cd7ac26bc04d792559ec0ca3db2a25f`）和 341-byte report（SHA-256 `632a54e02256f8e8f63abb06599e0410b5be5386b3db350c5289952edafca9ce`）也在同一目录。三者 mtime 均保留为 2026-10-28 22:11:58 CST，未覆盖或删除。

本手册后续的架构与资源验收应针对 Universal ZIP 解包后的 `.app` 执行。0.1.10 的历史 DMG 实测记录仅作历史证据，不构成未来 DMG 生成或验收要求。

## 6. 架构、签名、资源和隐私验收

从 Universal ZIP 解包 `.app` 后，检查 Info.plist/package version、全部 Mach-O、资源文件。可用以下只读检查；输出不应包含秘密：

```sh
APP="<只读挂载点>/Vantilo Beta.app"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv --verbose=4 "$APP" 2>&1
spctl --assess --type execute --verbose=4 "$APP"
xcrun stapler validate "$APP"
```

遍历 `.app` 所有普通文件，对 `file -b` 判为 Mach-O 的文件运行 `lipo -archs`; 检查每个应为 Universal 的主程序、Electron helper/framework、Codex、`codex-code-mode-host`、native dictionary helper 至少同时含 `arm64`、`x86_64`。只检查主 executable 不够。ZIP 内关键 executable 也要检查或与已验收 `.app` 哈希对应。不要把 slices 等同于 Intel 真机通过。

**[历史实测]** 0.1.10 DMG 中检查到 17 个 Mach-O，17/17 均含 arm64 与 x86_64；main app、Codex、code-mode host 和 dictionary helper 均在其中。`codesign --verify --deep --strict` 成功，但签名为 ad-hoc、无 TeamIdentifier。`spctl` 返回 rejected（exit 3），`stapler validate` 表示没有票据（exit 65）。这是历史候选的限制，不是“已公证”，且不替代对新 ZIP 的复验。

**[历史 ZIP 实测]** Reader 的 `web/index.html`、`api.cjs`、ARM/x64 Codex runtime、`codex-code-mode-host`、`native/vantilo-dictionary`、`provenance.json`、`THIRD_PARTY_NOTICES.txt` 和 licenses 均存在。对该历史 Universal ZIP 的条目检查未发现 `.epub` 文件；没有随包个人书库或真实 EPUB。343-byte 旧构建报告记录 artifact 大小、SHA、签名及 Intel 硬件测试状态，不含 EPUB 计数或根源码 commit。ZIP 内 Reader notices 有 16 个 `undefined@undefined` 标题，不能视为依赖归属核验完成；源码生成器已修复为向上查找完整 package identity，但尚未重新构建核验。发行前须核对新 notices 中每个包与锁文件/许可证元数据及实际 app bundle 的对应关系。测试 fixture 只能是审查过 provenance 的合成内容，不能拿真实书刊替代。

对未 notarized 包，另一个 Mac 的首次打开可能被 Gatekeeper 拦截；用户可以按其 macOS 提示在 Finder 中 Control-click → Open，并在 **System Settings → Privacy & Security** 查看是否有允许打开选项。受管理设备的策略可能仍会拒绝。不要指导用户全局关闭 Gatekeeper，不要称这属于已完成的安装验收。正式对外发布还需适用的 Developer ID Application 签名、hardened runtime/entitlement 审查、公证、stapling、Gatekeeper 验收；本项目当前脚本采用 ad-hoc 签名，不能仅靠重跑现有脚本得到公证包。

## 7. 自动化测试与启动验收

在外置副本和外置 cache/TMPDIR 下运行，并保存退出码/测试摘要到本版外置日志目录：

```sh
npm run typecheck
npm test
npm run build
npm run build:reader
npm run test:reader:host
npm run test:reader:growth-page
npm run test:reader:growth-navigation
npm run build:mac:universal
npm run test:reader:packaged -- "$APP/Contents/Resources/app"
git diff --check
```

执行顺序要满足测试脚本依赖（先 build Reader，再做需要 packaged Reader 资源的测试）；具体 workspace script 名称以当前 `package.json` 为准。

**[本次工作树实测，非发行快照]** 根目录 `npm test`：76 files / 478 tests 通过；根目录 `npm run typecheck` 通过（包括 Reader workspace 的 app/node TypeScript 检查）；Reader 独立的合成音效单测：1 file / 4 tests 通过。根目录 Vitest 明确排除 `packages/reader/src/**/*.test.*`，所以 75/476 不代表整个 Reader 源项目测试套件。该工作树尚未提交；本次没有运行 `npm run build`、`npm run build:reader` 或 macOS 打包，也没有在实际 packaged app 上验证 seedless first-run。Universal 构建脚本要求干净 Git 快照，故在改动未提交时未启动。

**[历史报告，非快照证明]** 0.1.10 外置工作副本记录了 72 files / 464 tests，以及 typecheck、app/Reader build、Reader host/growth tests、Universal packaging 和 `git diff --check` 通过。另有 DMG packaged Reader utilityProcess 合成 EPUB 导入/幂等检查通过。原构建副本没有完整持久化逐文件快照清单，故这些结果不能证明现有 ZIP 对应当前 source HEAD。后续工作区测试结果必须另行注明 commit 与测试时间。

**[实测]** 主 Vantilo executable 从只读挂载的 DMG 启动，使用 `workspaces/0.1.10-build/tmp/app-smoke/user-data` 等全新外置隔离目录，初始化 userData/Codex home，运行数秒后退出码 0。这个直接 executable smoke 不是 Intel 机测试，也没有验证首次启动完整 UI、交互式登录或真实 Reader 阅读体验；直接执行还绕过了 Finder/Gatekeeper 的首次打开路径。不得据此宣称完整安装验收。

**[未验证]** Intel 实机安装与功能、手动真实时长阅读计时、macOS 锁屏/睡眠验收、所有 Reader UI 在正式 app 中的完整点击流程，均未完成。Universal `lipo` 结果不替代这些测试。

## 8. 常见故障与不可执行的操作

- **Workspace 未挂载/身份不匹配/只读/容量不足：** 停止并报告。不可创建同名目录假装挂载，不可回退到内置盘，不可继续大下载。
- **输入或 `out` symlink 指向旧仓库、错误版本或内置盘：** 停止。先检查 `ls -ld`、`readlink`、`realpath`，确认正确的只读缓存/新 release 目标；不可盲目重指向或覆盖旧链接目标。
- **Electron archive checksum 错、Codex 版本不匹配、native 架构不符：** 停止，保留既有文件供检查。先找官方校验/匹配版本，不要清 cache 或覆盖下载。
- **SWC native cache 写入失败：** 0.1.10 用外置 APFS sparse image 解决，但失败原因和可复用的初始化命令未找到。核验 mount 来源、写权限与可用空间；若要新建 image，必须使用全新名字并先验证不存在，保留旧 image，禁止删除/重建用户已有 cache。
- **候选目录/ZIP/checksum/report 已存在：** 当前打包逻辑设计为拒绝覆盖；选择新的、未存在的版本化工作区/输出名。不要加 `--force` 或删除旧文件。
- **Ad-hoc app 的 `spctl` rejected：** 0.1.10 是已知/预期状态；signature verification success 不等于 Gatekeeper accepted。不要伪称 notarized，也不要为让测试“通过”而关闭 Gatekeeper。
- **Universal merge/signing 失败：** 保留候选目录和日志。脚本先移除每架构签名，合并后逐个签 Mach-O 与嵌套 bundle，再验签；不要用手工 `codesign --deep` 绕过失败或更改原有 artifact。
- **打包体积告警：** 0.1.10 Vite 仍报告 large bundle warning；它不是本次测试失败，不得通过削弱测试或随意剥除资源来消除。
- **其他打包入口：** 此处的 `out/<version>/` 配置针对 Universal 打包脚本。`package:mac`（单架构）仍将 app 输出到 `repo/out/` 且配置 `overwrite:true`，若要继续使用必须单独审查/改造；若干 Reader preview 脚本也有自己的 `out/` 布局。本轮未修改、未验证它们符合 Universal release 目录约定，不要将其当作 Universal release 入口。
- 任何步骤都不得执行 `git reset`、`git clean`、覆盖源工作区、删除旧缓存/旧 release、覆盖 0.1.9/0.1.10 artifact、修改独立 Magazine Reader 项目、复制真实 EPUB/阅读数据或记录 secret。未获明确授权不得 commit/push。

## 9. 发布与权利边界

项目所有者已确认拥有 Reader 自有源码，以及 `assembly-typing-game.tsx` 中 Worm 项目布局/键盘生命周期代码的版权，并授权其随 Vantilo 公开发布；这些确认不涵盖第三方依赖、其他媒体或在线服务，也不等于选择了 Vantilo 源码许可证。公开发布仍须审查实际打包依赖/notices、在线服务及杂志内容权利，建立干净且可追溯的发行 commit，并从该快照重建并核验 ZIP。历史 0.1.10 保持 ad-hoc、未公证状态；Intel 真机验收仍未完成。公开仓库 Release 是公众可下载的，不能称为私人测试下载。
