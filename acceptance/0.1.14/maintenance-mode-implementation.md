# Vantilo 维护模式与启动事务检查实施记录

> **2026-10-30 范围更新：** Reader 备份只包含阅读记录、学习数据、设置、书库索引及 API 非敏感元数据。电子书/EPUB、下载杂志原件及附属媒体一律排除，不复制、不压缩、不迁移、不做完整内容哈希；恢复时保留索引引用，缺少原件则提示重新导入/关联。Agent、Runtime/Codex 与 Chromium Profile 排除。以下是历史维护模式实现记录，不代表原始书刊属于备份目标。

日期：2026-10-30。**本轮未完成维护模式，不允许以本轮改动执行备份或恢复。** 已接入部分启动保护；跨进程停写、排空、服务恢复和正式 Electron 实机验收仍未完成。

## 工作区与修改

仓库 `<Vantilo 仓库根目录>`，分支 `main`，HEAD `16f38f07c26bcd15e3a47683849b65937ebb9dfc`；版本仍为 0.1.13。开始时保留上一阶段 API 配置保护、规则、测试、审计报告及未提交的事务日志组件。本轮没有停止正式 Vantilo 实例，未读取真实密钥、访问正式 Keychain 或迁移用户数据。

- 新增 `electron/transaction-startup-guard.cjs`：只读检查 `userData/vantilo-data-transactions-v1/<事务 UUID>/`，复用 `transaction-journal.cjs` 校验日志。目录不存在或全部日志完整且阶段为 `COMPLETED` 时允许；未完成、损坏、读取失败、身份不匹配、符号链接或异常目录内容均不允许业务启动，不删除材料。
- 修改 `electron/main.cjs`：在 `app.whenReady()` 之后、创建窗口、启动 Runtime、软件更新定时器及 Reader 之前等待检查；异常时显示系统提示并退出。用户在检查期间退出时，不再继续启动业务。
- 新增 `tests/transaction-startup-guard.test.mjs`：独立临时目录的真实日志测试、真实 Node 子进程 IPC 检查，以及使用 Electron 测试替身运行实际 main 启动代码的拦截测试。
- 修改 `tests/magazine-reader-host.test.ts`：等待异步启动检查完成再验证现有窗口/IPC 行为。
- 修改 `tests/runtime.test.ts`：完整测试首次出现异步竞争，Reader 增量先于 Agent 会话持久化；增加对 Agent 会话实际完成写入的等待，保留原断言，定向和完整测试重跑通过。
- 更新 `AGENTS.md`、`docs/release/RELEASING.md` 的长期维护及发布规则；调整 `electron/transaction-journal.cjs` 注释，说明现在仅接入启动检查。原事务日志读写实现及前期 API 配置保护保持。

## 进程、写入与现有停止方式

| 进程/存储 | 写入入口和数据 | 当前停止与确认 | 尚缺 |
| --- | --- | --- | --- |
| Electron Main | `electron/reader-custom-api.cjs` API 配置队列；`software-update-service.cjs` 设置/下载；`reader-onboarding.cjs` 首次设置；`reader-session-cookie.cjs` Cookie | 各模块独立停止；`main.cjs` 的退出钩子使用 `Promise.allSettled` | 无统一维护状态、写入门禁、队列排空和跨进程排他 |
| 宿主 Renderer + Chromium | `src/reader/growth.ts`、`src/ui/magazine-reader-module.tsx`、`src/reader/book-discovery.tsx` 直接写 `localStorage`；Chromium 自己管理 Cookie/缓存/浏览器存储 | 窗口关闭不是持久化成功确认 | 无可信主进程控制的冻结、存储提交确认或 IndexedDB 事务排空证明 |
| Reader Renderer + Chromium | `packages/reader/src/frontend/reader-storage.ts` 和 `scripts/reader-data-management.tsx` 直接写 localStorage；阅读进度、学习数据等 | ReaderStorage 的失败项目可留在内存 `pending` 并重试 | Main 无法仅靠内存锁拦截所有浏览器写入；未实现冻结和持久化确认 |
| Reader Service utility process | `electron/portable-reader-service.cjs`、`packages/reader/src/storage/json-storage.ts`、`book-import-service.ts`、`epub-import-service.ts`、学习资料/音频、同步和词典缓存；写 `userData/reader-library` | `portable-reader-supervisor.cjs:stop()` 请求关闭；两秒后可能强制结束并返回 | 没有可信的拒绝新写和等待所有已开始请求/后台任务的维护协议；超时不能用于维护成功 |
| Agent Runtime utility process | `runtime-entry.cjs`，`session-store.cjs`、`project-store.cjs`、`workspace.cjs` 的会话、项目和工作区写入 | 现有 `runtime-supervisor.cjs:stop()` 发送 shutdown，超时可强制结束；Runtime 在关闭时调用 session `flush()` | 无维护门禁；超时后的 supervisor 状态不能证明所有文件已安全落盘 |
| Codex 子进程 | `runtime-entry.cjs` 设置 `userData/codex-home`；Codex 自己维护线程、SQLite、WAL 和身份状态 | `codex-driver.cjs:close()` 发送 SIGTERM；超时可 SIGKILL；Supervisor 也可升级结束进程 | Runtime 退出并不证明所有后代与磁盘写入完成；没有不会中断用户任务的维护排空协议 |
| EPUB / 用户生成文件 | Reader 服务管理的 `reader-library/books`、`issues`、`data` 及学习音频/缓存 | 单项操作有独立异步文件写入与临时文件 | 没有跨文件、跨服务一致性快照或全局停写证明 |

上表基于当前代码；Chromium 和 Codex 内部写入无法仅靠 Vantilo 的 API 调用清单穷尽。

## 已实现的启动保护与限制

当前 main 启动流程在 `app.whenReady()` 内先执行 `checkStartupTransactions`，返回安全后才创建 BrowserWindow、初始化 Runtime、启动软件更新定时器；Reader 服务由后续入口按需启动。未完成事务返回保护状态，格式错误或读取失败也按保护状态处理。提示仅说明应保留记录并退出，**不是恢复界面，也没有自动回滚**。已完成日志仅通过日志链判断；组件没有读取实际快照或验证快照文件。

此检查只约束**新启动的本实例**。现有应用没有经过验证的跨实例维护所有权，另一个已运行的 Vantilo/Codex 仍可能写同一数据；Chromium 在 main 的 `app.whenReady()` 检查前可能已初始化 profile。本轮没有真实 Electron 启动拦截验收，因此不能宣称整个操作系统进程树或所有数据写入在检查前完全静止。事务目录名是本轮代码固定的本机路径，完整恢复功能尚未创建或消费事务。

## 维护模式、停写、恢复服务

**NOT IMPLEMENTED。** 目前没有跨进程维护锁、所有权和超时策略；没有冻结 Renderer、等待浏览器存储持久化、拒绝 Reader Service 新请求、等待 Agent/Codex 完成、Main Process 统一排空、按逆序恢复服务的实现。现有强制停止流程未被用作维护模式，也不表示 QUIESCED。没有维护 IPC，因此普通 Renderer 无法调用一个不存在的维护操作；这不能证明现有写入路径受保护。

## 测试与验收状态

| 编号 | 场景 | 结果 | 实际证据 |
| --- | --- | --- | --- |
| T01 | 正常进入维护 | NOT RUN | 未实现维护模式 |
| T02 | Reader 写入期间维护 | NOT RUN | 未实现可信浏览器停写及排空 |
| T03 | Agent 执行期间维护 | NOT RUN | 未实现任务等待协调 |
| T04 | Reader 请求未完成 | NOT RUN | 未实现服务端拒写及排空 |
| T05 | 两进程请求维护 | NOT RUN | 事务日志修订竞争测试不能替代维护锁 |
| T06 | 维护中拒绝新写 | NOT RUN | 未有维护屏障 |
| T07 | 停止超时恢复 | NOT RUN | 未实现维护流程 |
| T08 | 部分停止后逆序恢复 | NOT RUN | 未实现维护流程 |
| T09 | 正常退出维护 | NOT RUN | 未实现维护流程 |
| T10 | 未完成日志阻止业务 | 部分 PASS | 真实日志、真实 Node 子进程 IPC 和实际 main 启动代码的 VM 测试；未运行真实 Electron/Reader/Agent 全链路 |
| T11 | 日志损坏保留并保护 | 部分 PASS | 临时真实损坏文件、实际 main 启动代码 VM 测试；未运行真实 Electron 全链路 |
| T12 | 应用启动前拦截 | 部分 PASS | 代码顺序及 VM 测试确认窗口和 Runtime 不创建；未验证 Chromium 初始化前及其他正在运行的实例 |
| T13 | 子进程异常退出 | NOT RUN | 日志组件的子进程 SIGKILL 测试不等于维护参与者退出验收 |
| T14 | 重复进入退出 | NOT RUN | 未实现维护模式 |

事务日志、启动检查及现有进程监督定向测试：5 个测试文件、36 项通过。启动检查测试使用真实隔离日志及真实 Node 子进程；main 的 Electron 对象由测试替身提供，**不是实际 Electron 图形界面验收**。没有运行真实 Keychain、真实 Codex E2E、真实用户书库或跨版本迁移。

根目录完整测试：81 个测试文件、543 项通过；首次运行 1 项既有异步等待竞争失败，修正测试等待后通过。Reader 离线测试：93 文件通过、1 文件跳过；547 项通过、7 项跳过。`npm run typecheck` 通过。主界面生产构建输出 `/private/tmp/vantilo-maintenance-ui-20261030`，主进程代码构建输出 `/private/tmp/vantilo-maintenance-main-20261030.cjs`，独立 Reader 构建输出 `/private/tmp/vantilo-maintenance-reader-20261030`；均通过，Vite 有大 chunk 提示。未覆盖 `build/reader/seed` 或正式安装包。

## 下一阶段必须完成

1. 在可信进程实现跨实例独占所有权、参与者身份及失败时 fail closed；确认现存实例和所有 Codex 后代的生命周期，禁止用超时或 SIGKILL 作为维护成功。
2. 对 Main、Reader Service、Agent Runtime 分别实现拒绝新写、等待已有请求/异步队列以及真实退出确认；处理后台任务和服务恢复，不重复启动或重复执行用户任务。
3. 针对宿主和 Reader Chromium 存储设计可信冻结与落盘验证，处理 pending 与 IndexedDB；明确 Electron profile 在检查前初始化的边界，并验证异常退出后的行为。
4. 在真实隔离 Electron、独立端口、真实子进程和实际 IPC 上完成 T01–T14；再实现快照完整性验证、恢复点、幂等回滚及恢复入口，最后接入完整备份。

## 直接回答

- Reader 所有异步写入完成：**不能确认**。
- Agent 和 Codex 子进程安全停止：**不能确认**。
- Main 阻止维护期间所有新写入：**不能**，维护模式未实现。
- 启动前事务检查：**main 的业务窗口与 Runtime 启动前已接入检查**；真实 Electron 和 Chromium 启动前写入边界未验收，无法约束已有实例。
- 维护失败后安全恢复原有服务：**尚不能**，逆序恢复机制未实现。
