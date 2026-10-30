# Vantilo 0.1.14 Reader 离线维护实施记录

日期：2026-10-30。**状态：架构障碍已通过真实子进程复现；离线维护程序、完整 Reader 备份和恢复均未完成，也未获得修改用户数据的授权条件。**

## 范围变更

用户决定只备份 Reader 阅读记录、逐句进度、词汇与熟悉度、语境释义、笔记、历史、稍后阅读、学习与用户生成内容、Reader 偏好、书库/刊物索引及 API 服务非敏感元数据。电子书/EPUB、下载杂志原件和附属大型媒体不备份、不复制、不压缩、不迁移、不做完整内容哈希；普通备份不含 API Key 或密文。书刊 ID、标题、作者、源文件引用和记录关联必须保留。

不备份 Agent 会话、Runtime/项目管理数据、Codex CLI 数据或 OAuth、Chromium 程序、完整 Profile、Cookie、浏览记录、GPU/运行时缓存。Reader 存放在 Chromium localStorage 或 IndexedDB 中的**用户数据仍须保留**：通过 Reader 自身的受控接口和独立版本化格式导出，不能复制整个 Chromium Profile。静态搜索未发现本项目 Reader 前端直接调用 IndexedDB 的明确入口；依赖或未来版本是否存在需进一步确认，不能据此排除 IndexedDB 用户数据。

`reader-library/data` 不能整体无条件复制：它可能含认证或其他不应迁移的记录。必须针对实际 schema 分类和允许列表。Reader 用户生成的课程或内容，即便文件名含 `codex-prep`，也要根据用途判断是否纳入，而不能按文件名误当 Agent 会话。API 元数据导出必须显式提取 ID、名称、地址、模型和激活状态，绝不能复制 `encryptedApiKey`；恢复到已有服务时需保留目标机器密钥，新机器重新填写。该完整格式和迁移目前尚未实现。

## 为什么评估离线维护

当前 Reader Renderer 和宿主界面直接写 Chromium 存储；Reader 服务独立处理书库文件和后台任务。离线维护可以在应用完全关闭且所有相关 Reader 写入者确实退出后，降低在线冻结多个写入者的复杂度。它仍须有跨实例的排他协议、正确进程身份、可验证的存储提交及持久恢复；单独等待 Electron 主进程并不充分。

用户已要求只协调实际或可能写入 Reader 数据的进程，不为迁移无关 Agent 数据中断 Agent 工作。若坚持退出整个 Vantilo，当前 Agent Runtime 随主应用生命周期运行，不能简单假定现有 Agent 任务仍会继续；必须先安全等待任务结束或另行设计隔离架构，不能为了备份强制取消任务。

## 进程与 Reader 写入范围

| 进程 | 启动/写入范围 | 当前退出行为及 Reader 维护判断 |
| --- | --- | --- |
| Electron Main | `electron/main.cjs` 创建窗口、Runtime/Reader supervisor；`reader-custom-api.cjs` 保存 Reader API 配置元数据及密文 | `before-quit` 并行请求停止；未证明所有写入落盘。保存 Reader API 元数据时必须协调，绝不导出密钥。 |
| Chromium 主/Renderer/GPU 等 | Reader iframe 的 localStorage、宿主 Renderer 的 `vantilo-reading-growth-v1`；Chromium 进程管理真实存储文件 | `BrowserWindow` 关闭不是提交成功或所有子进程退出证明。应通过 Reader 接口导出用户数据并确认写入持久化，再验证 Chromium 不再写相关存储；不复制 Profile。 |
| Reader Service | Main 的 `utilityProcess.fork`，`portable-reader-entry.cjs` 与 `portable-reader-service.cjs`；写 `reader-library/books`、`issues`、`data`、生成内容等 | `portable-reader-supervisor.cjs:stop()` 两秒超时可强制杀死；尚未提供安全排空确认。Reader 库、后台任务和正在执行的请求均需协调。 |
| Agent Runtime / ReaderEngine | Main 以 utility process 启动 `runtime-entry.cjs`；普通 Agent 会话保存在 `sessions.json`；Reader AI 任务的工作区和会话位于 `reader-engine` | `ReaderEngine.run` 将结果返回 Reader 服务，后者仍可能更新 Reader 数据；`ReaderEngine.stop()` 会取消 Reader 请求。应等待相关 Reader 任务和服务写入完成，不将 Runtime 会话作为备份数据。 |
| Codex CLI | `CodexDriver` 用 `spawn` 启动，两个执行通道共用 `userData/codex-home`；Reader 任务工作目录为 `reader-engine/reader-task-workspace` | `runtime.cjs` 对 Reader 任务清空动态工具；`codex-driver.cjs` 启用只读沙箱并禁用 shell 等功能。源码未展示 Codex 直接写 `reader-library` 的路径，但不能证明任意后代、系统句柄或外部代码绝无写入；需确认 Reader 任务完成及相关进程/写入能力。非 Reader Agent 数据排除备份。 |
| 独立/遗留进程 | 现有代码只记录部分 Codex PID；没有持久记录所有子孙或跨实例 Reader 写入者 | 主进程退出不证明孤儿进程退出，PID 复用不能作为安全判断。不得以 `ps` 一次快照或锁文件删除代替确认。 |

证据：`electron/main.cjs`、`electron/portable-reader-supervisor.cjs`、`electron/portable-reader-entry.cjs`、`electron/runtime-entry.cjs:19-40`、`electron/runtime.cjs:193-218,250-289`、`electron/reader-engine.cjs`、`electron/codex-driver.cjs:46-62,246-249,298-308,353-362`、`packages/reader/src/frontend/reader-storage.ts`、`scripts/reader-backup-adapter.mjs`。独立维护程序不能因此假设所有 Codex/Chromium 后代已退出。

## 本轮代码与已复现的阻碍

新增 `electron/offline-maintenance-lock.cjs`，仅为**未接入维护任务的占位预留机制**：要求已存在的规范化目录，使用排他 `mkdir` 创建 `0700` 锁目录，记录 PID、创建时间和随机令牌摘要；只有当前所有者和令牌可释放。写入不完整或持有者崩溃时保留残留目录，不依据 PID 自动删除。目录缺失、符号链接/未知材料等 fail closed。它不检查卷 UUID、挂载状态、全部进程、写入句柄或 Agent/Reader 状态，不授权对 Reader 数据执行读取、备份、恢复或修改。

`electron/transaction-startup-guard.cjs` 在已有事务检查前检测该锁；锁存在（包括残留、无记录或符号链接）时阻止**新实例的业务窗口与 Runtime 启动**，`electron/main.cjs` 显示保留材料的提示并退出。当前检查发生在 `app.whenReady()`，不能证明 Chromium 在此之前没有初始化 profile，也不能约束已经运行的实例。

**真实竞争证据：** `tests/offline-maintenance-lock.test.mjs` 启动独立 Node 子进程，以真实 IPC 等待其通过启动检查；父进程随后取得锁；该子进程仍能向隔离临时目录写入。说明“启动检查一次 + 随后建立锁”存在竞态；单靠当前锁不能形成排他。另以两个真实子进程验证同一锁只有一个可预留，并在持有者被 `SIGKILL` 模拟崩溃后验证锁保留、新实例检查被阻断。该 `SIGKILL` 仅用于隔离崩溃注入，未用于正常维护关闭。

锁创建前仅检查目录存在、非符号链接与真实路径一致；不能识别一个未挂载的外置卷路径恰好在系统盘上仍有同名空目录。实际卷身份、可写性、剩余空间、PID 启动时间/复用及其他实例都未验证。完成共享排他握手、卷身份与相关 Reader 写入进程退出确认之前，**不得使用该锁启动数据操作**。目前没有独立维护可执行程序、用户关闭协调器、恢复事务或重新启动流程。

## 15 项测试状态

| 编号 | 场景 | 结果与实际范围 |
| --- | --- | --- |
| 1 | 正常关闭所有相关进程 | NOT RUN；无安全关闭协调器 |
| 2 | Agent 任务尚未完成 | NOT RUN；不能强制取消无关任务 |
| 3 | Reader 正在写入 | NOT RUN；未实现真实 Reader 排空 |
| 4 | Codex 子进程仍运行 | NOT RUN；无可靠子孙退出确认 |
| 5 | 进程无法退出 | NOT RUN；无维护协调器 |
| 6 | 维护程序提前启动 | NOT RUN；独立维护程序尚不存在 |
| 7 | 等待主进程退出 | NOT RUN；未实现 |
| 8 | 两个维护程序竞争 | 部分 PASS：两个真实 Node 子进程竞争预留目录；不是完整维护程序 |
| 9 | 维护程序异常退出 | 部分 PASS：真实锁持有子进程 SIGKILL 后记录保留；无维护事务 |
| 10 | 重启时锁存在 | 部分 PASS：真实文件上的启动检查及 main 代码 VM 测试拒绝；真实 Electron 重启未测 |
| 11 | 外置盘未挂载 | 部分 PASS：不存在的用户目录被拒绝；未挂载卷残留目录和卷 UUID 未测，不能声称已保护 |
| 12 | 备份中途断电 | NOT RUN；无备份实现 |
| 13 | 恢复中途断电 | NOT RUN；无恢复实现 |
| 14 | 恢复失败回滚 | NOT RUN；无回滚实现 |
| 15 | 原始/恢复数据完整性 | NOT RUN；无恢复实现 |

另有真实子进程竞态测试复现启动检查后写入，证明当前机制不满足最终门禁；这是**发现的失败条件**，不是维护安全 PASS。Reader 旧备份的模拟 localStorage 测试确认白名单项可导出、无关 Agent/凭据标记不被导出；这不能证明未来完整 Reader 备份已覆盖所有 Reader 数据或 IndexedDB。按照后续产品决定，原始 EPUB 和杂志文件不是备份内容，只保留书库索引引用。

本轮定向测试：锁、事务启动检查、事务日志及现有 Reader 备份 4 个文件、23 项通过；根目录完整测试 82 个文件、549 项通过；Reader 离线测试 93 个文件通过、1 个跳过，547 项通过、7 项跳过。`npm run typecheck`、`git diff --check` 及新增锁模块的语法检查通过。主界面构建输出到 `/private/tmp/vantilo-offline-reader-ui-20261030`，主进程代码构建输出到 `/private/tmp/vantilo-offline-reader-main-20261030.cjs`，独立 Reader 构建输出到 `/private/tmp/vantilo-offline-reader-build-20261030`；均通过，Vite 报大 chunk 提示。未覆盖正式构建输出或 `build/reader/seed`。

## 修改与后续

本轮新增 `electron/offline-maintenance-lock.cjs`、`tests/offline-maintenance-lock.test.mjs` 和本报告；修改启动检查及错误提示、启动测试，新增旧 Reader 备份白名单排除测试；更新 `AGENTS.md`、发布手册及先前审计/实施报告，明确新范围。前期 API 配置与事务日志改动保留。未更新版本号、未提交、未推送、未发布或打包。

下一阶段先设计适用于 Reader 数据的跨进程、跨实例共享/排他握手：Reader 启动和维护程序必须争用同一底层权利，锁获取与启动不可分割；确认目标卷身份及全部 Reader 写入者（含 Reader AI 结果回写、Chromium、Reader 服务、可能的后代），超时失败时保留材料并不修改用户数据。只有隔离环境证明写入冻结、恢复点、事务和崩溃回滚后，才接入 Reader 版本化导出、书刊索引关联、记录/设置导出及验收。原始 EPUB、杂志和附属媒体明确排除。不得将 Agent 数据或 Chromium Profile 纳入 Reader 备份。
