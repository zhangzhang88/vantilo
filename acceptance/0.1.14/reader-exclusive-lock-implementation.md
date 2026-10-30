# Vantilo 0.1.14：Reader 与独立维护进程排他锁实施报告

> 后续产品决定：用户备份仅限词汇及其学习数据，不操作整个 Reader 数据目录。此 OS 排他锁作为既有维护基础保留；词汇备份使用 Reader 词汇键写入冻结，不依赖独立维护程序或整库锁。具体范围见 `vocabulary-backup-implementation.md`。

| 项目 | 值 |
|---|---|
| 审计日期 | 2026-10-30 |
| 仓库 | `<Vantilo 仓库根目录>` |
| 分支 | `main` |
| HEAD | `16f38f07c26bcd15e3a47683849b65937ebb9dfc` |
| 源码版本 | `0.1.13`（本轮未修改版本号） |

## 1. 执行摘要

已将原先“启动时检查一个普通锁目录”的做法替换为 macOS 内核管理的目录 vnode 共享/排他锁。Electron 主进程和 Reader Service 在打开 Reader 持久化数据前同步取得共享锁；维护侧 API 只有在存在匹配的持久化维护请求后才能取得同一资源的排他锁。锁由打开的文件描述符持有，进程或最后一个继承该描述符的子进程退出后由内核释放，不依赖 PID 文件或租约过期。

真实 macOS 子进程测试覆盖了 15 个场景；其中两组 100 轮测试均使用真实独立子进程。Reader 的合成写入子进程在父进程释放句柄后仍能阻止维护方，直到写入子进程退出。

**总体状态：锁原语与已接入的 Reader 启动路径通过测试；完整生产维护闭环仍未验收。** 仓库中没有可执行的独立 Reader 维护程序，也没有“维护请求通知正在运行的应用并触发有序关闭”的连接。另未实际卸载/重挂外置卷，且 Chromium 子进程没有逐一继承锁描述符。因此本报告不把端到端维护安全标记为全部 PASS；未连接的维护流程必须继续 fail closed。

## 2. 仓库与本地数据路径检查

- 当前工作区包含本任务前已经存在的未提交 API 配置保护、事务日志、维护模式及文档变更。本轮未 reset、clean 或覆盖它们；未提交、未推送、未更新版本。
- `package.json` 版本为 `0.1.13`。
- Main 从 `app.getPath('userData')` 取得并保留 Electron 实际路径，然后才设置应用名称；Reader 路径为该目录下的 `reader-library`。该逻辑见 `electron/main.cjs:20-23,66`。
- 只检查了目录元数据，没有打开或读取目录内文件。用户目录下存在 `~/Library/Application Support/Vantilo` 和 `~/Library/Application Support/Vantilo Beta` 两个目录；由于没有找到可确认的 Vantilo `.app` 安装包，无法据此确认当前真实安装实例选用哪一个目录，也未确认已安装版本。
- `/Volumes/Workspace` 当前存在；源码默认使用 Electron `userData`，没有证据表明正式 Reader 数据默认放在 Workspace。若通过显式 `--user-data-dir` 使用 `/Volumes/...`，锁模块会检查挂载点与卷设备身份，且不创建缺失卷的替代目录。

## 3. 数据写入进程与锁覆盖范围

| 进程/存储 | Reader 数据写入或访问 | 本轮保护方式 | 边界 |
|---|---|---|---|
| Electron Main | 在同一 `userData` 下初始化 Reader、设置、事务及 Chromium 页面入口 | 主进程启动早期取得共享锁，持有到 `will-quit`；创建窗口和启动 Reader IPC 时复核句柄 | Main 也会持有 Agent 运行期间的锁；这是离线维护的保守关闭边界，不代表 Agent 数据进入 Reader 备份 |
| Chromium Browser/Renderer | Reader 的 `localStorage`、IndexedDB 及页面存储 | BrowserWindow 只在 Main 取得锁、启动检查通过后才创建；Main 运行期间保持锁 | Chromium 子进程未逐一持有该 fd；需要依赖 Electron 进程生命周期。隔离 Electron 主进程崩溃探测在前一阶段观察到渲染器脉冲停止且无残留进程，但不等同于对所有系统故障的监督器证明 |
| Reader Service（Electron utility process） | `reader-library` 中的 EPUB、阅读状态、词汇、配置、缓存和用户生成数据 | Supervisor 传递精确 `userData` 根路径；Service 在创建子目录、seed 初始化和构建 API 前取得自己的共享锁；关闭 HTTP 服务后释放 | 生产路径要求有效绝对数据根；缺失或路径变化会失败关闭 |
| Reader TTS Python 子进程 | Reader 学习音频等生成文件 | Main/Reader Service 将共享锁 fd 作为额外 stdio 描述符传给 Python 子进程，使锁生命周期覆盖它 | 测试使用真实 Python 子进程写入合成文件，不读取正式学习数据 |
| Agent Runtime/Codex CLI | 会话、项目、Codex Home 等 Agent 专属数据 | 不纳入 Reader 备份。Main 运行锁会阻止离线维护排他锁直到应用关闭 | 源码未发现其直接写 Reader `reader-library`；Runtime 内 Reader Engine 使用单独路径，不因此将 Agent 数据纳入维护范围 |
| 独立维护程序 | 未来备份/恢复将访问 Reader 数据 | 新锁模块提供维护请求、等待和排他锁 API | **当前仓库没有实际维护可执行入口，也没有已连接的运行中 Reader 关闭通知；这是端到端门禁缺口** |

源码依据：`electron/runtime-entry.cjs:16-24,33-36`；`electron/main.cjs:20-38,311-337,358-365`；`electron/portable-reader-supervisor.cjs:58-62`；`electron/portable-reader-entry.cjs:13`；`electron/portable-reader-service.cjs:21-40,49-50,243-254`；`packages/reader/src/server/app.ts:53-58,264`；`packages/reader/src/server/services/learning-audio-service.ts:17-26`。

本锁保护 Reader 数据的并发访问。当前 Reader 备份目标为阅读/学习数据、设置、书库索引及 Reader API 非敏感配置；原始 EPUB、下载杂志及其附属媒体均不备份，索引 ID、名称、作者、源文件引用及记录关系仍须保留。Agent 会话、Codex 凭据、Chromium 缓存/Cookie/浏览历史不属于备份内容。当前锁可能覆盖同一 `userData` 根下的整个应用生命周期，但这不授权复制 Agent 或 Chromium Profile。

## 4. 锁协议与实现

### 操作系统机制

`electron/reader-data-lock.cjs` 使用 Darwin `open(2)` 的 `O_SHLOCK`（共享）与 `O_EXLOCK`（排他）标志原子打开目录 vnode。Node 未公开这两个 Darwin 标志，因此模块保留对应常量；非 macOS 直接报不支持。fd 关闭或所属进程退出时由内核释放。没有可替换的锁文件，也没有陈旧 PID 或基于时间的租约。

为避免 `userData` 目录被重命名后形成两个不同锁对象：内部路径在稳定的 `/` vnode 上协调，`/Volumes/<卷>/...` 路径在 `/Volumes` vnode 上协调。每次锁获取都会校验数据路径、设备号和 inode；租约 `assertHeld()` 会校验数据根和锁资源身份。真实维护程序仍须在操作前调用该校验。

### Reader 启动顺序

1. Main 保留原 `userData` 路径。
2. macOS Main 同步取得共享 OS 锁；没有锁或数据卷身份异常时记录错误并在窗口、Runtime、Reader 启动前退出。
3. Main 执行事务日志和维护意图只读启动检查。
4. 只有检查安全后才创建窗口和 Runtime。
5. Reader utility process 收到 `VANTILO_READER_USER_DATA_ROOT` 后，再次取得共享锁，之后才创建 `issues/books/data/config` 目录、初始化内容及监听服务。
6. 正常退出等待 Runtime/Reader Supervisor 停止，Main 在 `will-quit` 释放自己的锁；Reader Service 在 API/web server 关闭后释放自己的锁；TTS 子进程持有继承 fd 时继续阻止排他锁。

### 维护请求与交接

- 维护请求写入 Reader `userData` 根的 `.vantilo-reader-maintenance-intent-v1.json`，以 `O_EXCL|O_NOFOLLOW` 创建，内容写入和目录均 `fsync`。已存在、损坏或身份不匹配的请求不自动覆盖/删除。
- Reader 在取得共享锁后检查维护请求；存在请求则释放锁并拒绝启动。这样请求在 Reader 获锁之后创建时，维护方只能等待该 Reader 释放共享锁；请求先创建时，新的 Reader 即使与维护方竞争，也会在取得共享锁后看到请求并退出，不能进入 Reader 数据初始化。
- 维护侧必须提供匹配请求 ID，通过 `acquireMaintenanceDataLockSync/ acquireMaintenanceDataLock` 取得排他锁，再复核请求 ID 和数据根身份。等待有超时及取消，不会超时后继续访问。
- 只有持有排他租约且上层明确确认事务完成，才可清除请求。锁释放不会自动清理残留请求。

**当前尚未接通的部分：** 没有维护程序创建该请求、通知 Main 有序停止 Reader、等待 Chromium/utility/写入子进程并最终执行备份/恢复。当前运行中的应用不会自动监听维护意图；维护方只会等锁或超时。因而只能由遵守 API 的维护进程安全等待，不能宣称已有完整按钮/CLI 维护交接。

## 5. 真实子进程测试结果

测试文件：`tests/reader-data-lock.test.mjs`。以下 15 项均 PASS；T06/T11/T15 使用独立真实进程，T14 也已升级为实际进程重启循环。

| 编号 | 结果 | 实际验证及限制 |
|---|---|---|
| T01 | PASS | Reader 持共享锁时独立维护子进程被拒；释放后维护子进程取得排他锁并完成请求 |
| T02 | PASS | 维护先持排他锁阻止 Reader；释放后残留意图继续阻止 Reader；完成事务后才恢复启动 |
| T03 | PASS | Reader/维护真实子进程同时竞争，一方取得、一方因锁忙拒绝 |
| T04 | PASS | Reader 子进程正常退出后，维护子进程取得排他锁 |
| T05 | PASS | 真实 Reader 子进程在维护意图期间启动失败，意图仍在 |
| T06 | PASS | 真实 Python 子进程取得继承 fd 后向独立临时目录写合成记录；父进程关闭 fd 后维护仍被拒；写入进程退出后维护获锁 |
| T07 | PASS | 正常退出 Reader 子进程后由内核释放共享锁 |
| T08 | PASS | 对合成 Reader 锁进程注入 `SIGKILL`，进程退出后内核释放锁；不是正常关闭流程 |
| T09 | PASS | 维护子进程持排他锁时被 `SIGKILL`，OS 锁释放但持久化意图保留，Reader 仍被拦截 |
| T10 | PASS | 两个真实维护子进程竞争，仅一个取得排他锁 |
| T11 | PASS | 锁持有期间重命名并替换合成 `userData` 目录；新维护子进程仍在同一稳定锁 vnode 上被拒，旧租约识别路径身份变化 |
| T12 | PASS（合成缺失路径） | `/Volumes` 下不存在的测试挂载路径安全失败且未创建；**真实卸载/重挂外置盘未运行** |
| T13 | PASS | 残留维护意图不会被 Reader 自动删除，Reader 安全拒绝启动 |
| T14 | PASS | 100 轮真实 Reader 与维护子进程依次正常退出/重启，共 200 次子进程启动，无陈旧锁 |
| T15 | PASS | 100 轮真实并发竞争，共 200 次锁尝试、200 个唯一 PID；100 次获锁、100 次锁忙拒绝，每轮恰有一个获锁 |

T15 输出记录了每个尝试的 PID、获锁/拒绝时间、获锁者的释放时间和实际结果；测试日志的样例来自首两轮与第 100 轮。另有 Electron Main 启动守卫测试验证锁忙/维护意图时不创建窗口或 Runtime。

T15 最近一次实际运行的证据样例（UTC）：

```text
round 1: Reader PID 66067 在 2026-10-30T13:34:06.278Z 被拒绝（ERR_READER_DATA_LOCK_BUSY）
round 1: maintenance PID 66070 于 2026-10-30T13:34:06.278Z 获排他锁，并于同一时间释放
round 2: maintenance PID 66072 于 2026-10-30T13:34:06.321Z 获排他锁，并于同一时间释放
round 2: Reader PID 66071 于 2026-10-30T13:34:06.321Z 被拒绝（ERR_READER_DATA_LOCK_BUSY）
round 100: maintenance PID 66306 于 2026-10-30T13:34:10.622Z 获排他锁，并于同一时间释放
round 100: Reader PID 66305 于 2026-10-30T13:34:10.622Z 被拒绝（ERR_READER_DATA_LOCK_BUSY）
总计：100 轮、200 次尝试、200 个唯一 PID；100 次获锁、100 次被拒绝。
```

## 6. 安全验收门槛

| 门槛 | 结果 | 说明 |
|---|---|---|
| Reader 在 Reader 数据初始化前取得锁 | PASS（代码路径） | Main 与 Reader Service 均先同步取锁；真实服务在临时数据路径测试 |
| 维护排他锁之前不得修改 Reader 数据 | PASS（锁 API/子进程） | 锁 API 先获排他再返回维护租约；没有生产维护可执行入口，业务操作端到端 NOT RUN |
| Reader 与维护不得同时持有互斥访问权 | PASS（测试范围内） | Darwin OS lock，100 轮并发子进程竞争均单一获胜 |
| Main 崩溃时无未保护 Reader 写入子进程 | PARTIAL | Reader TTS 明确继承 fd，T06 实测；Electron 主进程崩溃探测曾观察到 Chromium 进程退出，但未把 fd 注入所有 Chromium 子进程，也未证明所有异常环境都绝无孤儿进程 |
| 维护程序崩溃不留下虚假 OS 锁 | PASS | 内核释放排他锁，持久化意图保持并阻止 Reader；不删锁文件/标记 |
| 锁资源不会被普通锁文件替换 | PASS（目录替换测试） | 没有普通锁文件；内部 `/`、外置 `/Volumes` 为稳定资源；合成数据根被替换时没有分裂成两把锁 |
| 外置卷异常时不创建错误数据目录 | PASS（合成路径）/ NOT RUN（真卸载） | 代码检查挂载设备与路径；未物理弹出真实 Workspace 卷 |
| 维护请求与 Reader 启动之间无放行窗口 | PASS（协议与并发测试）/ NOT RUN（实际维护程序） | 共享锁后检查意图、维护请求后独占锁；生产请求者/有序关闭尚未接入 |

## 7. 未解决风险与阻塞

1. **高：缺少真正的独立维护程序及退出协调。** 当前仅有锁库和测试子进程。后续任何维护代码必须使用同一模块，先原子建立意图，再等待 Vantilo 正常退出及所有 Reader 写进程退出，再取得排他锁。不能仅凭 Main 退出或锁标记认定完成。本轮没有备份/恢复操作，因此没有可供用户实际运行的维护流程。
2. **高：Chromium 子进程未直接持有共享锁。** 启动顺序使页面只能在 Main 锁后打开；Main 正常运行时锁稳定持有。前一阶段隔离 Electron 探测中 Main PID `50994` 被 `SIGKILL` 前后 localStorage 脉冲计数均为 `13`，随后进程检查没有发现该隔离实例的 Chromium 子进程。该探测支持“此环境下 Electron 退出了其子进程”，但不是针对每种崩溃/系统故障的强制进程监督机制。若未来发现可能存活的 Chromium 写进程，应让其持锁或由独立 supervisor 保持租约，不能继续假设 Main 锁足够。
3. **中：OS advisory lock 只约束遵守协议的进程。** 用户或不使用该模块的同权限程序仍可以直接读写文件。它不是文件系统强制 ACL，也不阻止 SQLite/Chromium 自身写入；安全依赖所有 Vantilo 维护入口都先取得同一锁。
4. **中：锁资源保守且范围宽。** 内部路径统一锁 `/`，外置路径统一锁 `/Volumes`，可避免数据目录替换造成锁分裂，但同一系统/挂载命名空间上的多个隔离 Vantilo 配置会互相阻塞。后续若缩小锁范围，需保持对路径替换和卷重挂的证明。
5. **中：真实外置盘热拔插未测。** 缺失路径测试通过；真实 Workspace 的突然断开、同名卷重挂以及事务材料恢复仍待专门硬件/虚拟卷验收。
6. **低：非 macOS 环境不启用此 OS 锁。** 本任务目标为 macOS；其他平台需各自实现并验证跨进程锁，不能把 macOS 结果外推。

## 8. 下一阶段接入方案（Reader-only）

1. 增加独立 Reader 维护入口；该入口必须调用 `createMaintenanceIntentSync`，并以同一 userData 路径调用有超时的独占锁 API。
2. 将维护意图通知 Main。Main 禁止新的 Reader 工作、等待在途 Reader 写入、正常停止 Reader Service、等待 TTS 子进程、关闭 Chromium Reader 页面/相关进程，再退出。未确认所有 Writer 退出时维护进程只能超时失败。
3. 维护进程取得排他锁后复核数据路径、设备/Inode、事务日志和空间。外置盘缺失、路径更换或状态不明时不得创建新目录或触碰数据。
4. 只通过 Reader 自身数据接口导出版本化 Reader 备份；包含 Reader localStorage/IndexedDB 用户数据、阅读学习数据、设置和书库索引，但不包含书籍/杂志原件或附属媒体，不复制整个 Chromium Profile；不备份 Agent/Codex 数据、Cookie、缓存或凭据。恢复时找不到原文件要显示缺失状态，保留既有阅读记录并提供重新导入/关联入口。
5. 快照、校验、提交/回滚都沿用现有原子事务日志；在实际备份/恢复完成前保留所有恢复材料和维护意图。
6. 增加 Electron/Chromium 故障注入与真实卷卸载测试，然后才可将“应用与维护程序绝不同时访问 Reader 数据”标为完整 PASS。

## 9. 测试与构建门禁

| 检查 | 结果 |
|---|---|
| Reader OS 锁定向测试 | PASS：15 项；含 T14 100 轮重启、T15 100 轮并发 |
| Reader 启动事务守卫及服务进程相关测试 | PASS：定向测试通过；Main 在锁忙/意图/事务未完成时不打开窗口或 Runtime |
| 根目录完整测试 | PASS：83 个测试文件，566/566 项通过 |
| Reader 离线测试 | PASS：93 个测试文件通过、1 个跳过；547 项通过、7 项跳过 |
| TypeScript 类型检查 | PASS：根目录与 Reader app/node 检查通过 |
| Electron/应用生产前端构建 | PASS：输出 `/private/tmp/vantilo-reader-exclusive-app-20261030`；存在既有的大 JS chunk 提示 |
| Reader 独立生产构建 | PASS：输出 `/private/tmp/vantilo-reader-exclusive-reader-20261030`；Swift 编译缓存重定向到临时 HOME 后通过；没有覆盖 `build/reader/seed` |
| `git diff --check` | PASS（报告写入后再次检查通过） |

Reader 第一次构建因系统拒绝写入默认 `~/.cache/clang` 而失败；将本轮临时 HOME/TMPDIR 指向 `/private/tmp` 后，同一源码、工具链构建通过。构建输出写入独立临时目录；项目现有 `build/reader/seed` 保留。

本轮未修改正式用户数据、API Key、Keychain、版本号或发布状态；未提交、Push、打 Tag、打包或发布。
