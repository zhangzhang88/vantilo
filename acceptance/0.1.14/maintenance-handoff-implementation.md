# Vantilo 0.1.14：独立维护程序与 Reader 安全关闭交接记录

> 后续产品决定：备份功能已限定为词汇及其学习数据，不要求对整个 Reader 数据目录执行离线维护。下文 BLOCKED 仍准确描述独立维护程序，但它不阻止基于 Reader localStorage 词汇键冻结的词汇专属备份/恢复；不得将本报告中的旧 Reader-wide 计划当作当前备份范围。

日期：2026-10-30
状态：**BLOCKED；未接入独立维护程序，未开放任何 Reader 数据维护操作。**

## 执行摘要

本轮按安全门槛检查了现有 OS 锁、Electron 生命周期、Reader Service、Runtime/Codex、TTS 和 Reader Renderer 写入路径。当前代码尚不能证明“Reader 所有写入者已排空并退出”，也没有可通知运行中 Vantilo 的维护进程连接。现有正常退出路径还会在超时后强制结束进程，或在关闭出错时仍以成功退出状态结束。

因此没有把占位锁接成可以操作 Reader 用户数据的维护程序，也没有声称完成了安全交接。没有创建备份/恢复入口，没有启动或关闭正式 Vantilo 实例，没有读取正式用户数据、API Key 或 Keychain。此前工作区改动均保留。本轮只新增本报告。

## 仓库状态

- 路径：`<Vantilo 仓库根目录>`
- 分支：`main`
- HEAD：`16f38f07c26bcd15e3a47683849b65937ebb9dfc`
- 开始时工作区已有 API 配置、Reader、事务/锁和文档相关未提交修改；未 reset、clean、提交或覆盖。
- 当前源码版本：`0.1.13`；本轮未更新。
- 本机：macOS Darwin 27.0，arm64。

## 进程与写入者清单

| 进程/区域 | Reader 数据触点 | 现有关闭/锁证据 | 本轮结论 |
|---|---|---|---|
| Electron Main | Reader API 配置；保有全局 Reader 锁；启动 BrowserWindow、Runtime、Reader Service | Main 在 `app.whenReady()` 前取得共享锁，`will-quit` 才关闭。`before-quit` 目前并行调用 Runtime、Reader、更新服务的 stop | 有启动锁，但没有维护请求 IPC，也没有串行、可失败的 Reader 关闭协调器 |
| Chromium Browser / Renderer | Reader iframe 与宿主页面的 localStorage；Reader 逐句/段落位置；浏览器存储目录 | Renderer 可直接 `localStorage.setItem`。Reader 有 `pagehide` 位置捕获，但没有维护排空确认。Chromium 子进程没有各自持有 Reader 锁 | Main 持锁期间有保护；Main 释放锁时 Chromium 后台写入是否全部结束未被本轮实机证明 |
| Reader Service utility process | EPUB、Reader `data`、学习材料/音频、生成内容、同步及缓存文件 | Service 自身取得共享锁；关闭 HTTP 服务后释放锁。Supervisor 当前停止超时会调用 `child.kill()` 并继续返回 | 锁能阻止维护方越过仍持锁的 Service，但当前 supervisor 可能把强制终止当成正常排空 |
| Reader AI / Runtime utility process | Reader AI 工作区和 Reader 专属会话；结果通过 Reader Service 返回 | Runtime shutdown 会停止 ReaderEngine/Runtime；Main 与 Reader Service 当前并行停止，可能打断正在返回的 Reader 请求 | 没有先停接收、排空在途 Reader API/AI，再停止 Runtime 的完整顺序 |
| Codex CLI 子进程 | 直接管理 Codex Home/线程数据；源码路径未显示它直接写 Reader 书库 | Runtime 记录 Codex PID；CodexDriver 向子进程发送 `SIGTERM`，超时后 `SIGKILL`。Reader AI 可通过 Runtime 返回 Reader 写入 | 不属于 Reader 备份范围；但关闭 Vantilo 时仍需等 Reader AI 调用结束，且不能将 Codex 未退出误判为完成 |
| TTS Python 子进程 | 生成 Reader 学习音频 | Reader 锁 FD 作为 stdio FD 传给 Python 子进程，因此其存活可继续阻止维护排他锁；现有合成超时逻辑可能强制结束子进程 | 锁继承是有效的额外保护，但未完成“等待正常退出”的维护流程验收 |
| 多个 Vantilo 实例 | 共用配置对应的 `userData` / Reader 数据 | OS 共享锁允许多个 Reader 实例同时运行；系统单实例锁只约束同一 Electron 应用实例 | 当前没有维护通知广播/逐实例确认；有其他实例时维护方最多被排他锁阻塞，不能报告交接完成 |

Reader 存储检索中没有发现项目代码直接使用 IndexedDB API；主要 Reader UI 持久化使用 localStorage，Reader Service 使用独立文件存储。该静态检索不能证明 Chromium/依赖没有内部 IndexedDB 或其他持久化写入。

## 已确认的代码阻塞

1. `electron/main.cjs:358-364` 的 `before-quit` 使用 `Promise.allSettled` 并行停止 Runtime 与 Reader，结果无论成功失败都会继续 `app.quit()`；不是维护所需的有序、失败即停止流程。共享锁在 `will-quit` 关闭。
2. `electron/portable-reader-supervisor.cjs:135-150` 在 2 秒后调用 `child.kill()` 并解析为停止完成，没有把仍运行或未确认状态返回给调用方。
3. `electron/portable-reader-entry.cjs:18-20` 在 `service.close()` 失败时仍经 `finally` 执行 `process.exit(0)`；父进程无法根据退出码区别“正常排空”和“关闭失败”。
4. `electron/runtime-supervisor.cjs:190-203` 超时后终止 Codex 与 Runtime child，并在等待后仍可能 `_onExit(null)`；`electron/codex-driver.cjs:353-363` 超时后会发送 `SIGKILL`。这不满足维护流程的“超时就失败，不能假装退出成功”。
5. Reader 的 `pagehide` 处理调用 React 状态更新（`packages/reader/src/frontend/App.tsx:3095-3105,3180-3182`），而非主进程可等待的持久化确认。`reader-storage.ts:15-22,45-54` 还可能保留未能写入 localStorage 的内存 pending 值；页面关闭前没有排空/失败应答协议。
6. 现有 `reader-data-lock.cjs` 只能约束明确持有共享/排他锁的进程。Chromium 子进程没有直接持锁，因而仅凭 Main 的 OS 锁释放或 IPC 确认，不能证明 Chromium 已停止写入。TTS 继承 FD、Reader Service 自有 FD 是有帮助的独立保护，但不能代替 Chromium 进程退出证据。
7. 缺少独立维护程序、IPC 服务端、维护请求广播、真实关闭状态反馈、排他锁交接及完成后重启验证。已有维护意图与排他锁 API不是完整可执行维护流程。

## 隔离实测与测试结果

### 实际运行的定向测试

执行：

```text
npm test -- tests/reader-data-lock.test.mjs tests/portable-reader-supervisor.test.ts tests/runtime-supervisor.test.ts
```

结果：3 个测试文件、38 项通过。Reader OS 锁用例在 macOS 上运行；另外两组 supervisor 测试是现有模拟子进程测试。它们证明锁模块和当前测试夹具行为，不证明真实 Vantilo shutdown 或维护 IPC。

### Electron/Chromium 隔离探测

尝试通过 Electron 45 启动一个使用临时 `userData`、仅写合成 localStorage 项的隐藏 BrowserWindow，观测 `app.getAppMetrics()` 在窗口关闭及 `before-quit`/`will-quit` 时的进程列表。两次启动均在探测脚本运行前由 Electron 可执行文件以 `SIGABRT` 退出，退出状态为 1；没有取得任何进程指标或 Renderer 关闭证据。临时 profile 未被创建，正式用户目录未访问。失败原因无法从此次输出确认，不猜测原因。

### 本轮交接场景矩阵

下表中的 T01–T15 均为**本轮完整应用维护交接测试**，不是此前 Reader OS 锁原语测试。由于没有安全交接程序，状态均为 NOT RUN；不以锁原语测试冒充端到端通过。

| 编号 | 场景 | 本轮结果 | 说明 |
|---|---|---|---|
| T01 | 真实 Vantilo 运行中请求维护并有序退出 | NOT RUN | 无维护请求到主进程的 IPC |
| T02 | Reader 正在写入时等待排空 | NOT RUN | 无 Writer drain 应答 |
| T03 | Reader AI 任务运行时等待完成 | NOT RUN | 无维护关闭协调 |
| T04 | TTS 运行时等待正常退出 | NOT RUN | 仅已有锁继承测试，不是维护交接 |
| T05 | Reader Service 请求未完成时等待 | NOT RUN | Main 与 Service 当前并行关闭 |
| T06 | Main 退出后子进程仍存活时拒绝排他锁 | NOT RUN | Electron 探测 SIGABRT，未得到 Chromium PID 集合 |
| T07 | 维护程序提前启动 | NOT RUN | 没有维护可执行程序 |
| T08 | IPC 超时不执行维护 | NOT RUN | 没有维护 IPC |
| T09 | 维护期间第二 Reader 被拒绝 | NOT RUN | 没有完整交接/维护持有者 |
| T10 | 两个维护程序竞争 | NOT RUN | 仅锁原语曾有子进程竞争测试 |
| T11 | 释放后重启 Reader 并读取数据 | NOT RUN | 没有维护后的应用重启链路 |
| T12 | 外置卷缺失时停止 | NOT RUN | 现有锁有路径检查；本轮没有维护入口 |
| T13 | 维护程序崩溃 | NOT RUN | 没有维护程序/维护事务执行 |
| T14 | Vantilo 异常退出后不误判 | NOT RUN | 当前 Reader utility 退出码/超时路径不能提供该证明 |
| T15 | 维护后数据完整并可用 | NOT RUN | 本轮不执行读写验收，也没有交接程序 |

关键场景重复 50 轮：NOT RUN。没有通过等待时间或 mock 将场景标成通过。

## 安全结论

| 验收项 | 结果 |
|---|---|
| 维护程序能通知真实运行中的 Vantilo | **FAIL / NOT IMPLEMENTED** |
| Reader 能报告所有写入已排空 | **FAIL / NOT IMPLEMENTED** |
| 能证明所有 Reader 写入进程已退出 | **NOT PROVEN**；Reader Service/TTS 持锁可阻止部分交接，Chromium 进程关闭探测未运行 |
| 维护程序能在真实应用关闭后取得排他锁 | **锁 API 已有；端到端 NOT RUN** |
| 维护完成后 Reader 能重新启动 | **NOT RUN** |
| 是否仍有无法证明安全的写入者 | **有：Chromium 存储后端及其退出后的内部写入；Reader localStorage pending；当前 shutdown 失败分支** |

因此本轮不开放备份/恢复入口，不清理既有意图/日志，不清除或替换锁文件，不做 Reader 数据访问。OS 锁继续保持 fail closed。

## 下一阶段的最低实施门槛

1. 先定义维护模式专用的关闭状态机：停止新 Reader/AI 请求；显式等待在途 Reader AI、API 请求、同步和 TTS；任一等待超时或关闭报错时取消维护并保留锁。所有 supervisor 必须以真实 child `exit` 和明确的 shutdown 响应确认成功，不能 `SIGKILL` 后返回成功。
2. 处理 Reader Renderer 写入：增加宿主→Reader 的维护准备消息，保存最终阅读位置并同步 flush Reader storage；若仍有 pending 写入或页面未确认，拒绝继续。需要独立测试异步 React 状态更新、页面关闭和恢复位置。
3. 让独立 helper 在主进程退出期间继续持有共享锁（传递继承的锁 FD），接收 Main 记录的 Chromium/utility 进程身份，并等待实际进程终止后才关闭共享 FD、尝试同一 OS 锁上的排他获取。PID 存活检查单独不足；需要附带创建时间/可验证进程身份，并测试 PID 重用与崩溃。
4. 在共享用户数据的每个 Vantilo 实例注册单独的私有 IPC endpoint；维护请求必须向所有活动实例广播并获得真实关闭结果。IPC 目录应限制权限，request ID、capability 与请求状态需原子绑定；无法识别的实例、身份变化、残留请求或卷更换均失败关闭。
5. 维护端获得排他锁后才检查卷设备身份、数据目录 inode、事务日志和磁盘状态；仅执行无数据更改的预检并成功释放后，才接入 Reader-only 备份。重新启动必须通过实际应用验证，而不是只以 `spawn/open` 成功作为 Reader 可用证明。
6. 在隔离 `userData` 中运行 Electron/Chromium 的真实子进程故障注入，并修复当前 Electron 探测启动问题。至少完成 T01–T15，T03/T06/T09/T10/T13 使用真实子进程，关键竞争各重复 50 次；实际记录 PID、进程创建身份、锁获取/释放时间与退出码。

## 验证范围

- 定向：38/38 通过（`reader-data-lock.test.mjs`、`portable-reader-supervisor.test.ts`、`runtime-supervisor.test.ts`）。这是已有锁/监督器测试，不是本轮 handoff 测试。
- 完整根目录测试：**失败**，83 个测试文件中 9 个文件失败、74 个通过；566 项中 546 项通过、20 项失败。主要失败为测试监听 `127.0.0.1` 收到 `EPERM`；另外 macOS 系统词典未收录测试词 `imposed`，相关两项也失败。未屏蔽或跳过。
- Reader 离线测试：**失败**，94 个文件中 4 个失败、89 个通过、1 个跳过；554 项中 539 项通过、8 项失败、7 项跳过，另有 1 个未处理错误。多个 loopback server 监听收到 `EPERM`，OAuth 系统代理用例超时；一个 Reader 登录路由期望 200、实际返回 409。未屏蔽或跳过。
- TypeScript 类型检查：通过（根项目及 Reader app/node）。
- Electron 隔离启动/Chromium 进程探测：两次均在应用脚本运行前以 `SIGABRT` 退出；没有取得渲染进程关闭证据。
- 应用生产构建、独立 Reader 生产构建：未运行。本轮因安全门禁停止了生命周期接入；未覆盖 `dist/`、Reader seed 或构建目录。
- `git diff --check`：通过；本报告无尾随空白。
- 没有打包、版本更改、Git 提交/推送、Tag 或 Release。
