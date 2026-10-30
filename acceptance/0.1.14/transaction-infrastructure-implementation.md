# Vantilo 事务基础设施实施记录

> **2026-10-30 范围更新：** Reader 备份只包含阅读记录、学习数据、设置、书库索引及 API 非敏感元数据。电子书/EPUB、下载杂志原件及其附属媒体不备份、不复制、不压缩、不迁移、不做完整内容哈希；恢复时保留引用并对缺失原件提示重新关联。Agent、Runtime/Codex 和 Chromium Profile 仍排除。此文件描述的是事务基础设施历史实现，不表示这些未纳入内容属于备份目标。

日期：2026-10-30。**本轮未达到完成标准：不存在可用于生产恢复的统一停写屏障或启动恢复机制。**不得将本记录中的独立日志组件用作备份恢复安全保证。

## 工作区和范围

正式仓库 `main`，HEAD 为 `16f38f07c26bcd15e3a47683849b65937ebb9dfc`。开始时保留上一阶段全部未提交的 API 配置、测试、规则与审计报告。本轮新增 `electron/transaction-journal.cjs`、`tests/transaction-journal.test.mjs` 和本报告；未修改用户数据格式、真实用户数据或 Keychain，未接入备份 UI、提交、打包或发布。

## 进程与写入入口清单

| 写入者 | 存储与入口 | 并发、延迟和停机问题 |
| --- | --- | --- |
| Electron 主进程 | `electron/reader-custom-api.cjs` 的 `save/activate/remove`；`electron/software-update-service.cjs` 的 `setAutomatic` 和下载；`electron/reader-onboarding.cjs` 的 `finish`；Cookie 在 `electron/reader-session-cookie.cjs` 设置 | API 写队列仅约束该实例；更新下载和 Cookie 为独立异步任务。没有与事务协调的全局停写或持久化所有者。 |
| 宿主 Renderer / Chromium | `src/reader/growth.ts`、`src/ui/magazine-reader-module.tsx` 的成长记录；`src/reader/book-discovery.tsx` 的模型选择；Chromium 自身 Cookie、Local Storage 等 | `localStorage.setItem/removeItem` 可直接写，绕过 Main Process。Chromium 的内部持久化和 flush 不能仅通过封闭 JavaScript 写入 API 证明停止。 |
| Reader Renderer / Chromium | `packages/reader/src/frontend/reader-storage.ts`，阅读位置、笔记、词汇和缓存等；`scripts/reader-data-management.tsx` 有直接操作 localStorage 的路径 | 失败数据会保留在 `pending` 内，之后可 `retry()`；不是磁盘提交确认。Reader 与宿主分属不同 origin，均需要明确阻止新写入并处理挂起数据。 |
| Reader 服务 utility process | `electron/portable-reader-service.cjs`，`packages/reader/src/server/app.ts` 的服务；书库 `book-import-service.ts`、`epub-import-service.ts`；`json-storage.ts`、学习资料/音频、目录、词典缓存及杂志同步 | API 请求、后台作业及文件操作可继续；`portable-reader-supervisor.cjs:stop` 两秒后会杀子进程，不能证明所有已开始写入已完成。 |
| Agent Runtime utility process | `electron/runtime-entry.cjs` 初始化；`electron/session-store.cjs`、`project-store.cjs`、`workspace.cjs` | 会话/项目使用独立异步写队列，工作区有独立持久化；启动本身可创建目录和初始记录。`runtime-supervisor.cjs:stop` 超时可杀进程。 |
| Codex 子进程 | Runtime 启动的 Codex，使用 `userData/codex-home`，由 Codex 管理 SQLite、日志、认证及线程数据 | Vantilo 未控制全部内部文件句柄与 WAL 的提交/关闭；即使不把凭据打入备份，也必须保证 restore 时不会与其并发写入。 |
| EPUB / 用户生成文件 | `reader-library/books`、`issues`、`data`；Reader 服务导入、删除、临时文件、学习资料和音频生成 | 除单文件临时写入/重命名外，不具备跨目录一致快照；后台下载和导入需单独完成或明确取消后确认。 |

以上清单识别了关键路径，不等于已完成所有第三方 Chromium/Codex 内部写入的穷尽证明。特别是 `electron/main.cjs:291-305` 在 `app.whenReady()` 后直接创建窗口和启动 Runtime，没有事务检查；Electron/Chromium 自身可能在 JavaScript 启动门禁之前初始化其 profile。仅在 `main.cjs` 中增加一个检查不能证明“任何进程在检查前都不写入正式数据”。

## 已实现的日志组件

`electron/transaction-journal.cjs` 是**未接入应用启动或恢复流程的独立实验组件**。它支持 `PREPARING → QUIESCING → SNAPSHOTTING → RESTORING → VERIFYING → COMMITTING → COMPLETED` 以及受限的 `ROLLING_BACK/RECOVERY_REQUIRED` 转移；记录事务 ID、操作、时间、阶段、前次成功阶段、存储名称、相对快照/目标路径和 SHA-256 字符串。

每个修订先写唯一临时文件、`fsync` 文件，再以排他硬链接发布固定序号并同步目录。加载时检查序号连续、状态链、前一条摘要、内容 SHA-256、相对路径格式和文件类型。重复修订发布会失败，不能覆盖已提交记录。摘要用于发现意外损坏，不提供抗恶意篡改的身份认证；组件不读取快照内容，也不验证记录中的快照哈希与真实文件是否匹配。

组件没有维护锁、锁拥有者生命周期、超时/租约、跨进程停写协议、快照创建、回滚执行、启动守卫或恢复界面。目录中断时残余临时文件可被识别，但日志写入各阶段突然断电、磁盘故障和 APFS 持久性尚未实测。日志仅作为后续工程的实验原件，**不得连接正式恢复操作**。

## 测试结果和限制

独立日志定向测试 5 项通过：在临时目录由真实 Node 子进程创建两条记录，发送 `SIGKILL` 后由父进程读取最近已提交阶段；两个独立子进程竞争同一修订仅一个发布成功；损坏日志被拒绝且合成快照文件仍存在；同进程重复发布及路径穿越被拒绝；合成文件哈希可在快照阶段后记入日志。这些测试没有启动真实 Electron、Reader、Agent 或实际执行恢复，不能证明停写或崩溃回滚。

| 用户要求的场景 | 结果 | 说明 |
| --- | --- | --- |
| 停写前崩溃 | NOT RUN | 未有完整维护流程 |
| 停写过程中崩溃 | NOT RUN | 未有跨进程屏障；单独日志进程的 QUIESCING 标记测试不是停写测试 |
| 等待已开始写入时崩溃 | NOT RUN | 未有写入追踪与排空 |
| 创建快照时崩溃 | NOT RUN | 未实现快照 |
| 恢复写入过程中崩溃 | NOT RUN | 未实现恢复写入 |
| 校验过程中崩溃 | NOT RUN | 未实现快照内容验证 |
| 提交时崩溃 | NOT RUN | 未实现恢复事务提交 |
| 回滚中再次崩溃 | NOT RUN | 未实现回滚 |
| Reader 和 Agent 同时写入 | NOT RUN | 未有统一写入屏障 |
| 相关进程异常退出 | NOT RUN | 未接入应用监督；日志单独子进程 SIGKILL 不等价于实际业务进程崩溃 |
| 锁超时 | NOT RUN | 未实现锁 |
| 事务日志损坏 | 部分 PASS | 日志组件拒绝损坏 JSON；应用启动时阻断未实现 |
| 恢复点缺失 | NOT RUN | 未接入快照验证 |
| 应用重启识别未完成事务 | NOT RUN | 仅独立进程重新读取日志，尚未接入应用启动 |

最终核验：根目录完整测试 80 个文件、536 项通过；Reader 离线测试 93 个文件通过、1 个文件跳过，547 项通过、7 项跳过；`npm run typecheck` 通过；主界面生产构建输出到 `/private/tmp/vantilo-transaction-ui-build-20261030`，Reader 生产构建输出到 `/private/tmp/vantilo-transaction-reader-build-20261030`，均通过并有 Vite 大文件提示；`git diff --check` 和新日志模块的 `node --check` 通过。构建未覆盖正式输出或 Reader seed。所有测试使用模拟/合成数据；不将单元测试称作真实用户恢复验收。

## 后续接入完整备份的必要工作

1. 明确主进程唯一所有者与跨进程排他方式；对单实例和残留子进程建立可验证退出协议。锁失主时保持 fail closed，不能以超时自动放行或删除恢复点。
2. 为主进程写入、Agent 队列、Reader API/后台任务建立禁止新写入与等待已开始写入的应答协议，并验证子进程真正停止；进程超时必须中止维护，不能继续快照。
3. 在宿主和 Reader 分别冻结直接 localStorage 写入、处理 pending、验证 Chromium 落盘和所有页面销毁；明确如何处理 Electron 在主脚本前的 profile 初始化，并在任何业务服务启动前检查持久事务。
4. 使用受限路径、隔离 staging、经过实际内容和完整性校验的持久快照，以及幂等回滚；若日志或快照损坏则保留材料，阻止业务启动并提供清晰恢复入口。
5. 实现真实多进程崩溃注入、并发写入和上述 14 个场景，通过后再接入统一备份/恢复 UI。不能只测试状态字符串或模拟成功返回值。
