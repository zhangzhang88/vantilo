# Vantilo 0.1.14：Reader 原生备份与恢复架构评估

审计日期：2026-10-30（Asia/Shanghai）
仓库：`<Vantilo 仓库根目录>`
分支：`main`
HEAD：`16f38f07c26bcd15e3a47683849b65937ebb9dfc`
审计方式：只读源码、规则和既有验收报告检查；未读取正式用户数据、API Key 或 Keychain，未运行恢复/备份，也未重跑测试。

> **后续产品范围决定（2026-10-30，优先于本文早期方案）：词汇备份只包括个人词汇及其相关学习数据，不备份整个 Reader、Reader 设置、阅读进度或书库索引。只保留词汇必要的来源 ID、名称和短语境引用；不得读取、复制、压缩、迁移或完整哈希电子书、EPUB、杂志、文章全文及其媒体。本文对 Reader-wide 数据的盘点是审计资料，不构成备份范围；早期建议已由 `vocabulary-backup-implementation.md` 的词汇专属决定取代。**

> 本文是在已有未提交工作区上完成的源码审计。审计开始时，`AGENTS.md`、Electron、Reader Service、测试等已有修改均保留；本轮只新增本报告，不覆盖或清理这些工作。

## 1. 执行摘要

**推荐以 Reader 原生数据接口为主，采用 Reader-only 的冻结、导出和恢复事务；不推荐把复制 Chromium Profile 或独立维护程序作为默认备份路径。** 目前源码没有发现 Reader 显式调用 IndexedDB API 或 SQLite；可见的主要存储是 Reader iframe 与宿主页面各自的 `localStorage`，以及 `userData/reader-library` 下的 EPUB 和 JSON 文件。因此，现阶段不需要复制整个 Chromium Profile，也没有证据要求先实现 IndexedDB 文件级复制。

Vantilo 已有一个局部 JSON 备份原型：它白名单导出 16 类 Reader `localStorage` 数据，构建期适配再加入模型区分翻译缓存和宿主页面阅读成长记录。但它**不是完整 Reader 备份**：没有 EPUB、Reader Service 持久文件、书籍分类/中文目录、用户保存的科普文章和媒体，也没有 API 服务元数据；部分 Renderer 设置遗漏。当前恢复跨 localStorage 与宿主成长记录是内存快照加尽力回滚，不是可断电恢复的事务。

更合适的边界是：备份 Reader 内容和用户状态，排除 Agent/Codex 会话与凭据、Agent Runtime、Chromium Cookie/缓存/浏览历史；API 服务只允许导出经净化的名称、Base URL、模型、服务 ID 和激活 ID，绝不导出 API Key 或密文。Reader 导出可以在 Vantilo 继续运行时进行，但前提是所有 Reader 写入者都实现可验证的停写与排空。恢复也不必然要求退出整个 Vantilo，但需要暂时冻结 Reader 页面和 Reader Service，并让启动前事务恢复可以覆盖两个 Renderer origin 与文件存储。**目前尚无这样的全 Writer 屏障，不能把现有导出/恢复标为完整或并发安全。**

## 2. 当前源码中的 Reader 数据清单

下表描述可由源码确认的持久化路径和入口。`U` 表示 Electron `app.getPath('userData')`；`L = U/reader-library`。这只是代码路径关系，不读取或断言本机真实用户数据目录。Reader Service 在 `portable-reader-service.cjs:36-50` 创建 `L/issues`、`L/books`、`L/data`、`L/config`；Main 在 `main.cjs:62,66` 配置 `U` 和 `L`。

| 数据类型 | 实际存储位置 | 写入入口 / 所属进程 | 当前导出情况 | Reader 完整备份建议 |
|---|---|---|---|---|
| 期刊阅读进度、阅读位置、精选阅读进度/逐句位置 | Reader origin 的 Chromium `localStorage`；键包括 `READER_STATE_KEY`、`LESSON_READER_STATE_KEY` | Reader Renderer 经 `reader-storage.ts:65-73` 同步写入 | 已在 `user-data-backup.ts:63-80` 白名单 | 纳入；冻结 Renderer 后读快照 |
| 词汇、熟悉度、词汇语境释义、复习安排 | Reader origin 的 `localStorage`：保存选词、语境义、复习日程键 | Reader Renderer；`selection-state.ts`、`word-context-state.ts`、`vocabulary-review-schedule.ts` | 已列入白名单 | 纳入；保留原始完整记录 |
| 笔记、稍后阅读、阅读历史 | Reader origin 的 `localStorage` | Reader Renderer；对应 state 模块调用 ReaderStorage | 已列入白名单 | 纳入 |
| 段落/句子翻译、选区辅助、阅读助手缓存 | Reader origin 的 `localStorage`；Vantilo 构建适配另含按模型隔离的变体键 | Reader Renderer；`reader-backup-adapter.mjs:8-12,21-40` 枚举变体键 | 基础键在白名单；Vantilo 适配包含部分变体键 | 纳入缓存键与 schema；缓存可标记为可重建，但避免模型间混并 |
| 学习进度、游戏偏好、中文听书位置/语速 | Reader origin 的 `localStorage` | Reader Renderer | 白名单已含这些类别（`user-data-backup.ts:63-80`） | 纳入；音频播放进度在这里，音频本身另见下行 |
| 阅读成长统计 | 宿主 Renderer 的 localStorage，键 `vantilo-reading-growth-v1`；与 Reader iframe 的 origin 分开 | 宿主 `magazine-reader-module.tsx:77-93` 通过带 token/requestId 的 `postMessage` 响应备份请求 | 构建适配通过宿主桥导出/恢复（`reader-backup-adapter.mjs:114-147`） | 纳入；必须在两个 origin 同一冻结窗口内读取 |
| 额外 Reader 偏好（例如 Gutenberg 简介模型选择、备课讨论字体、备课版式） | 宿主/Reader origin 的 `localStorage`；另有 `sessionStorage` 页面/标签状态 | `src/reader/book-discovery.tsx:50,76`、`codex-prep-panel.tsx:100,127`、`book-prep-layout.tsx:11,39`；导航和学习阶段使用 sessionStorage | 当前 allowlist 未覆盖上述 localStorage 键；sessionStorage 本来是临时会话状态 | 逐项审核后纳入用户可见且应跨设备保留的偏好；临时导航态可明确不恢复 |
| Reader 应用 IndexedDB | **未在当前项目源码找到显式 `indexedDB` / `IDBDatabase` / Dexie / localForage 使用** | 未确认应用自有 IndexedDB Writer | 无应用导出实现 | 现阶段不复制 Chromium 存储文件。此结论仅针对检索到的项目源码；Chromium/Electron 内部或未展开依赖的私有存储仍为 UNKNOWN |
| EPUB 书籍原件 | `L/books/*` | Reader Service 的 `BookImportService`；导入写入见 `book-import-service.ts:158-191` | 未纳入现有 JSON 备份 | 持续排除原始文件；只保留稳定 ID、标题、作者、源文件名、章节/分部索引和关联状态。排除清单只列路径/类型，不读内容、不做内容哈希 |
| 下载的杂志原件 | `L/issues/*` | Reader Service 的 `EpubImportService`；导入写入见 `epub-import-service.ts:80-103` | 未纳入现有备份 | 持续排除原始文件；只保留刊物 ID、名称、日期、文件名引用、文章索引和用户状态。不读原件、不做内容哈希 |
| 期刊记录、文章阅读状态、导读/翻译内容 | `L/data/<safeIssueId>.json`、`section-translations.json`、`guide-preparation-status.json` | Reader Service 的 `IssueService`/`JsonStorage`；`json-storage.ts:8-19,32-55,72-85` | 未纳入当前前端 JSON 备份 | 纳入用户产生的阅读状态/手工标记；缓存类字段可以按版本策略纳入或重建，但需明确字段所有权 |
| 电子书分类与中文目录 | `L/data/book-categories.json`、`L/data/book-toc-chinese.json` | Reader Service 的 `BookCategoryService`、`BookTocChineseService` | 未纳入现有备份 | 分类是用户设置应纳入；中文目录可作为可重建缓存纳入或重算，备份格式需区分 |
| Reader 备课内容、精选文章与对话记录 | `L/data/book-lessons.local.json`、`codex-prep-chat.local.json`、`codex-prep-pending.local.json`、`codex-prep-model-preferences.local.json`；学习材料在 `L/data/learning-materials/` | `CodexPrepService`：路径见 `codex-prep-service.ts:74-80`，队列/写入见 `:103-113,127-155,176-195`；`LearningMaterialService` 写版本文件见 `learning-material-service.ts:58-61,141-145,171-174` | 未纳入当前备份 | Reader 专属已保存内容、用户草稿和可见讨论历史应纳入审查后的 allowlist；不得把其 Agent/Codex 认证或独立会话数据库带入 |
| Reader 学习音频文件与 manifest | `L/data/learning-audio/*` | Reader Service `LearningAudioService` 和 Python TTS 子进程；写入/manifest 见 `learning-audio-service.ts:29-44,63-77` | 不在 JSON 备份中 | 排除音频二进制和播放资源；保留 localStorage 中的听书进度与语速。媒体目录只列路径/类型，不读内容、不哈希 |
| 用户保存的科普文章和配图 | `L/data/science-articles.json`、`L/data/science-article-media/<id>/...`；发现缓存 `content-discovery.json`、自动收录状态 `science-article-auto-import.json` | Reader Service `ScienceArticleService` / `ScienceArticleAutoCollector`；JSON 与媒体分别写入见 `science-article-service.ts:185-208,221-252`、`science-article-auto-collector.ts:119-125` | 未纳入当前备份 | 保留白名单中的结构化文章记录和用户状态；文章附属图片/其他媒体一律排除并列清单，不计为已备份数据 |
| 本地词典查询缓存 | `L/data/vantilo-system-dictionary-cache-v3.json` | Main 启动的 Reader Service 提供者；`reader-dictionary-cache.cjs:26-29,49-64` | 未纳入 | 可重建缓存，默认可排除；如纳入需有大小上限、schema 校验和完整性哈希 |
| Gutenberg 阅读简介生成缓存 | `U/gutenberg-intros-v1/` | Electron Main 的 `gutenberg-intro.cjs`；位置见 `main.cjs:45-50`，原子文件写入见 `gutenberg-intro.cjs:165-173` | 未纳入 | 可从来源重新生成，建议默认不纳入；其缓存不等于用户手工创作 |
| Reader 自定义 API 服务元数据及密钥 | `U/reader-custom-api-v1.json` | Electron Main 的 `reader-custom-api.cjs`；路径见 `main.cjs:53-55`。配置含多服务和 activeId，密文存储流程见 `reader-custom-api.cjs:111-126` | 未纳入 | 仅通过净化 DTO 导出 name/baseUrl/model/ID/active ID；普通备份绝不含 API Key 或密文；恢复后要求重新输入 Key |
| Reader API 配置的兼容/遗留文件 | `L/config/ai-providers.local.json`（`AiProviderSettingsService` 的固定路径） | Reader Service `ai-provider-settings-service.ts:115-138`，路径为 `projectRoot/config/ai-providers.local.json`；其 `persist()` 序列化整个 state，包括 `apiKey`，见 `:353-365` | 未纳入现有备份 | **高风险排除项**：不能打包整个 `config/`。先确认 Vantilo 部署中的实际用途与遗留迁移，再仅由专用净化导出器输出非敏感字段；任何 Key/ciphertext 都不得进入普通备份 |
| Codex OAuth/Reader prep 授权状态 | Reader Service 原始实现路径 `L/data/codex-auth.local.json`（`codex-auth-service.ts:98`）；Vantilo 构建适配将 auth 运输改为宿主账户桥，`reader-variant.mjs:243-248` | Reader Service/宿主 Agent 账户；凭据性质敏感 | 不在 Reader 备份内 | 按用户决定排除；换机后重新登录/授权，不导出 Token、Keychain 项目或账户文件 |
| Agent、Codex CLI、Runtime、项目管理数据 | `U/sessions.json`、`projects.json`、`codex-home/`、`agent-workspace/`、`reader-engine/` 等 | Runtime 独立写入，路径见 `runtime-entry.cjs:19-41,126-135` | 不在 Reader 备份内 | 明确排除；`reader-engine` 中的会话也属于 Agent 会话状态，不因服务名含 Reader 而并入 Reader 备份 |
| Chromium Cookie、缓存、GPU 缓存、浏览历史、其他 Profile 文件 | Electron userData 下 Chromium 管理的 Profile 存储 | Chromium Browser/Renderer | 不能按普通文件复制为 Reader 备份 | 全部排除。不能复制整个 Chromium Profile；Reader own localStorage 只通过 Reader origin 的受限 API 导出 |

### 关于存储完整性的边界

- 全仓源码范围检索未找到 `indexedDB`、`IDBDatabase`、Dexie、localForage 或 SQLite 使用；可见 Reader Service 是文件系统 JSON、EPUB、媒体/音频文件，不是应用自有数据库。**不能据此断言 Chromium/Electron 本身或所有第三方依赖绝无内部数据库。**
- Reader 的 `localStorage` 有两个逻辑来源：Reader origin 的 iframe，以及宿主窗口 origin 的阅读成长数据。当前宿主通过 `postMessage` 桥接，并非同一份 localStorage。
- `reader-storage.ts:15-22,45-56` 会把失败写入值留在 Renderer 内存 `pending`，并只提供 retry/discard，没有可供维护流程调用的 flush/closed 状态。备份 build 经 `getItem` 可读到 pending 值，但断电/Renderer 崩溃前该值可能还未落入 localStorage。
- Reader 服务存在多种后台队列和异步任务：`GuidePreparationService.jobs`（`guide-preparation-service.ts:18-20,60-89`）、`LearningMaterialService.pending`（`learning-material-service.ts:62-81`）、TOC 生成、内容发现、文章同步、TTS 子进程和 Reader AI 请求。当前没有统一的 Reader 维护态和总排空 API。服务启动还可能恢复未完成的导读任务（`app.ts:1023-1025`）；需要在维护锁定前阻止新任务、等待已有任务结束。

## 3. 现有备份/恢复代码能做什么

1. `packages/reader/src/frontend/user-data-backup.ts:63-80,222-244` 用明确白名单读取 Reader localStorage，校验数据并产生 `{app, version, exportedAt, data}` 的 V1 JSON。适配器可枚举并导入 Vantilo 特定模型缓存，也添加阅读成长记录（`scripts/reader-backup-adapter.mjs:21-40,82-109`）。未知键会被拒绝，不会把随意 localStorage 项都打包。
2. 当前 UI 明确声明 EPUB、中文目录缓存、API 服务与密钥、ChatGPT 登录和 Agent 会话不包含在 JSON 内；“书籍需另行导入”（`scripts/reader-data-management.tsx:54-65`）。所以它是**Reader 浏览器状态备份**，不是更换 Mac 可直接还原的完整阅读环境。
3. `restoreUserDataBackup()` 先将白名单当前值放进进程内 Map，再依次 `setItem/removeItem`；异常时逐键尽力回滚（`user-data-backup.ts:277-305`）。Vantilo UI 再分别快照/写入宿主 growth，出错时回滚（`reader-data-management.tsx:32-51`）。进程或系统在中间崩溃后没有可证明的原子性。
4. 导出下载使用浏览器 Blob 和 Electron 下载对话框；没有 Main/Reader Service 的版本化全库 export API。电子书原始文件已有 Reader API `/api/books/:bookId/original-file`（`app.ts:806-810`），但期刊 EPUB 没有对应已审阅到的下载路由。
5. 旧 JSON 导出存在超过 25 MB 即拒绝下载的限制（适配器 `reader-variant.mjs:228-231`、管理 UI `reader-data-management.tsx:9-10,25`）。该限制仍不等价于 Reader 数据归档；新归档应只计算纳入的结构化阅读数据与用户状态，不因被排除的书刊原件/大型媒体而估算或扫描容量。

## 4. 离线维护与 Reader 原生方案比较

| 维度 | 方案 A：离线维护程序复制/操作数据 | 方案 B：Reader 原生 API 导出与恢复 |
|---|---|---|
| 实现复杂度 | 进程发现、跨进程锁交接、Chromium/utility 后代生命周期、外置卷身份和恢复事务都要处理；当前交接报告已 BLOCKED | 需要实现受控 DTO、Reader 写入冻结、跨 origin 状态桥、服务文件 API 和恢复日志；范围更贴近 Reader 数据模型 |
| 数据完整性 | 直接复制可抓到未声明文件，但 Chromium Profile 混入 Cookie/缓存/Agent 外状态；只复制 `reader-library` 又漏 localStorage | 可按 schema/allowlist 校验与迁移，但必须枚举每个 Writer，不能只导出已知 UI 白名单 |
| 并发写入风险 | 依赖所有写入进程真实停止；Reader 锁模块本身通过过隔离竞争测试，但没有可用完整维护程序/关闭交接 | 可由 Reader 进入维护态、拒绝新写、排空已有 API/任务，再快照；当前尚未实现此屏障 |
| 崩溃恢复 | 需维护器、锁和事务日志共同恢复；当前独立维护接入被 BLOCKED | 可共享已有 transaction journal 与启动保护，把恢复事务放入 Reader 维护态；localStorage 和文件系统仍需跨存储日志/幂等恢复 |
| 跨版本兼容 | 复制内部文件会受 Chromium Profile、LevelDB/SQLite 等实现和 schema 变化影响 | 版本化数据格式、schema 校验、迁移函数较稳定；原始书刊由用户在目标设备重新导入/关联 |
| 外置盘 | 能直接复制到卷，但需卷 UUID/挂载/空间、链接和写入完整性控制 | 导出文件可由保存对话框选择目标卷；先校验写入/剩余空间，再临时文件、校验、原子改名。此机端能力尚未验收 |
| 真实用户验收 | 需安装包关停、重启、异常退出和卷卸载/重挂测试；容易影响用户运行会话 | 可在 Reader 独立维护页验收导出、导入和跨版本恢复，同时保留 Vantilo Agent 界面；也必须用隔离数据做崩溃测试 |
| 长期维护 | OS/Chromium 进程生命周期和系统升级带来维护负担 | Reader 数据 schema 随业务维护；新增数据必须同步声明导出策略和测试 |

方案 B 的优势不是无需停写，而是**冻结 Reader 写入域即可**，不必把整个 Agent 平台、Codex CLI、Cookie、Chromium Cache 纳入，也不需要复制 Chromium Profile。方案 A 的 OS 锁可保留为底层保护或文件维护的 fail-closed 保险，但不需要继续把独立维护程序作为用户备份主路径。已有 `reader-data-lock.cjs` 对遵守协议的进程有用；OS advisory lock 本身无法阻止 Chromium Renderer 或其他不取锁的同权限写者。

## 5. Reader 原生方案的关键问题

### 5.1 IndexedDB 与 localStorage

当前没有找到 Vantilo/Reader 明确使用 IndexedDB 的源码 API。因此，当前 Reader 数据备份不应为了假设中的 IndexedDB 数据去复制 Profile。若未来新功能引入 IndexedDB，必须将 object store、keyPath、索引、版本和导出 adapter 纳入注册表；使用只读 transaction 游标完整读取，在 transaction `complete` 后结束快照。必须通过 schema 列表发现/拒绝未知数据库，不能默默漏数据。

`localStorage` 的单次 get/set/remove 是同步调用，但这不意味着多个键能组成一个原子快照。最小方案是先在 Reader origin 和宿主 origin 分别广播/设置维护态：冻结用户交互写入口和计时器，拒绝新的写请求；排空已进入的同步保存/异步桥接；处理 ReaderStorage `pending`（成功 retry 后才能继续，否则中止并报告未保存数据）；随后两边各自生成 schema 化快照，Main 对两个快照和 Service 文件清单统一打包。宿主 growth bridge 已有 token/requestId 与超时，但目前只做单次 snapshot/replace/clear，并不冻结 growth 状态或阻止 state 更新。

由于 `src/reader/growth.ts`、`book-discovery.tsx`、备课组件和 Reader state 各自直接访问 `localStorage`，仅给 `getReaderStorage()` 加锁不够。实施前应集中所有 Reader 持久化入口，或建立能实际使相关组件停止写入的 React 维护上下文；不得依赖一个主进程内存 bool 声称 Renderer 已冻结。

### 5.2 Reader Service 与书库索引导出

Reader Service 已有语义化的 `BookImportService` 和 `IssueService`，能够提供书刊索引与用户标记。当前产品要求明确排除原始 EPUB/杂志内容，因此备份不调用 `/api/books/:bookId/original-file`，也不增加原文件导出路由。服务快照只允许返回稳定 ID、名称、作者、文件名引用、章节/文章索引及用户状态；原始文件只通过目录枚举和 `lstat` 元数据形成排除清单。

其余 JSON 和媒体有明确 service/schema，可建立版本化 manifest 读取接口，而非通配复制 `L/data`。内容/用户数据与可重建缓存需分别分类。普通备份不应把 `L/config` 直接打包；源码 `AiProviderSettingsService.persist()` 会写整个包含 `apiKey` 的 state，因此要特别防止遗留配置泄露。

原始书刊和附属媒体不进入 staging，因此不会发生其内容读取、复制、压缩或内容哈希。未来恢复时匹配用户现有文件与保留的稳定 ID/文件名引用；找不到时显示“内容缺失”并提供重新导入/关联操作，不创建空书籍、不覆盖阅读记录。

### 5.3 AI 阅读任务和后台写者

Main 将 Reader AI 请求转给 Runtime（`main.cjs:66`），Reader Service 在收到结果后写入自己的学习材料、导读、翻译等文件。Runtime 的工作区位于 `U/reader-engine/reader-task-workspace`，Agent 普通会话/项目则在 `U/sessions.json`、`projects.json`、`codex-home` 等（`runtime-entry.cjs:19-41`）；源码没显示 Agent workspace 直接写 `L/reader-library`。因此，用户决定不备份 Agent 数据可继续成立；但在维护窗口开始时必须等待或取消**Reader 发起的在途 AI 操作**，因为调用结果可能回写 Reader 文件。不能为此备份 Runtime 或 Codex 会话。

服务任务需要提供 `beginMaintenance()` 一类真实 API：关闭新写 gate，等待请求计数、Guide/TOC/learning/audio/Content Discovery/Sync 等后台任务和写队列归零。现有实现未提供统一 `flushAndDrain()`；一些路由使用 `void` 启动后台工作，必须纳入任务注册表或维护时暂停启动。超时则不生成成功快照，保留 Reader 当前状态并明确报告阻塞任务。

### 5.4 崩溃、恢复和是否需要独立维护程序

**导出**：先写到目标目录中的临时 `.partial` 文件；数据块/条目和最终目录清单全部完成，SHA-256 校验成功后才写入完整标记并原子改名。应用或系统中途退出时，只能留下未完成临时文件；下次不得将其显示为可恢复备份。源数据只读，不需要独立进程取得 Profile 排他锁。

**恢复**：先全量校验归档版本、所有条目、相对路径、类型、长度和哈希；将文件数据写到 `L` 同卷 staging；生成旧 Reader 文件与前端状态恢复点；持久写入事务日志后冻结 Reader，再提交文件系统状态和两个 origin 的 allowlist。每个存储域要有明确的阶段记录，启动业务界面前由 Main 检查已有 `transaction-startup-guard`，再进入恢复 bootstrap：Reader Service 的文件恢复可由 Main/Reader Service API 执行，Reader origin 与宿主 origin 的 localStorage 恢复必须在各自受信页面的早期 bootstrap 完成。任一环节异常时，按日志幂等恢复旧版本，不能清日志或新建空书库继续启动。现有启动保护在 `main.cjs:322-336` 会拦截未完成事务，但尚无跨 Reader origin 的恢复消费者。

这条方案**不要求 macOS 独立维护程序**。备份可由 Vantilo Main 调度，Reader UI/Service 共同冻结；Agent 页面可保持可用但不得通过 Reader API 写入。恢复时可让应用显示 Reader-only 维护页面并暂时关闭 Reader Service/iframe，不关闭整个 Electron/Vantilo。若 Writer gate、跨 origin bootstrap 或旧数据恢复点还不能证明安全，则该轮恢复必须 fail closed；这不应通过增加等待秒数或绕开锁来解决。

## 6. 上一轮测试失败分析

只使用既有报告 `acceptance/0.1.14/maintenance-handoff-implementation.md:110-113`，本轮没有重跑测试：

| 失败现象 | 证据 | 判断 |
|---|---|---|
| 根目录 20 项失败 | 546/566 通过；9 个文件失败。报告记录多个测试监听 `127.0.0.1` 收到 `EPERM` | 至少一部分是当前受限环境禁止 loopback bind 的环境失败，不足以证明产品回归。既有摘要没有把 20 项逐条映射到错误，本轮不推算余下精确数量 |
| macOS 系统词典缺少 `imposed` | 报告记录系统词典测试依赖该词条，实际系统词典未收录；两项失败 | 机器词典内容差异属环境/测试设计依赖；更稳健测试应使用固定合成 provider 测逻辑，并将真实系统词典覆盖作为环境验收，但本轮未改测试 |
| Reader 离线 8 项失败及 1 个未处理错误 | 539/554 通过；4 个文件失败；多个 loopback `EPERM`，OAuth 系统代理用例超时，prep auth 路由预期 200 得到 409 | loopback `EPERM` 是环境信号。代理超时可能由本地代理/回环服务权限造成，但证据不足以定因；409 可能是前置 Runtime/代理启动失败的下游结果，也可能是真实路由回归，不能仅凭报告排除。都应在允许本机回环的环境按失败项隔离复验 |

结论：这些摘要不能证明 Reader 产品代码回归，也不能证明没有回归。下一轮测试需要分别记录每个失败的测试名、错误栈、监听地址/权限、代理依赖和路由前置状态，再在系统能力正常的 macOS 环境复测。不得跳过、屏蔽或降低断言。

## 7. 最小实施方案与开发阶段

建议 **4 个开发阶段**，逐阶段停下验收，且不要求复制 Chromium Profile：

### 阶段 1：Reader 数据注册表和导出 schema

- 创建 Reader-only 持久数据注册表：每类数据指定 owner/service、路径/API、schema 版本、敏感级别、必须备份/可重建/排除、迁移策略。
- 补齐遗漏的 Reader localStorage 用户偏好；确定 Reader prep 对话/草稿、精选文章等结构化用户数据是否应按 allowlist 保存；原始书刊及附属大型媒体无论用途均排除。
- 增加净化的 API 配置元数据导出；排除 Key、safeStorage 密文、OAuth/Keychain 和 `ai-providers.local.json` 中的敏感字段。

**验收：** synthetic 数据夹具逐项确认清单和导出集合一致；原始 EPUB/杂志/媒体未进入 ZIP、未被内容哈希，且在排除清单中明确列出；阅读记录索引引用完整；注入敏感键/字段时拒绝导出；API Key 和密文扫描为零；覆盖现有 V1/Vantilo 模型缓存备份兼容。

### 阶段 2：Reader 原生一致性冻结与完整导出

- 建立 Reader maintenance 状态机和实际 write gate；Renderer 维护页面冻结各 origin 写入，Reader Service 关闭新变更路由，排空在途 HTTP、AI、导读、TTS、同步和原子写队列。
- 为 Renderer pending 提供 flush/失败可见；导出 Reader 记录、索引、允许的结构化 Reader 文件和 schema 快照；原始书刊及大型媒体排除；支持用户选择外置目标，校验目录/容量，采用临时文件、清单、逐项 SHA-256 和最终完整标记。
- 对所有直接 `localStorage` 写调用逐项改为可冻结入口。导出阶段 Agent/Codex 与 Vantilo 主窗口不必退出。

**验收：** 合成书籍/期刊索引、进度/笔记/词汇/语境义/阅读成长/用户内容端到端导出；逐项比较结构化数据；确认合成 EPUB 与附属媒体未进入 ZIP、未执行内容哈希且未计入已备份数据；并发写入被拒或排空；导出进程在每个阶段故障注入后不得留下被标记完整的归档；仅允许 Reader 数据，不含 Profile/Agent/凭据。

### 阶段 3：staging、恢复点和崩溃可恢复导入

- 导入前先验证全部包及兼容版本；在 Reader 文件所在卷创建恢复点和 staging；持久日志覆盖 PREPARE、QUIESCE、STAGE、VERIFY、COMMIT、ROLLBACK/RECOVERY_REQUIRED。
- 文件 stores 与每个 Renderer origin 的 localStorage 逐项提交；Main 启动 Reader 前检查 journal。为两个 origin 增加不会执行正常 Reader 写操作的恢复 bootstrap。
- 回滚只依据校验过的 recovery point；恢复点缺失、损坏或磁盘满时停止并保留所有材料，不创建空数据。

**验收：** 新 Mac/新临时 userData 的合成恢复；错误版本/损坏/缺字段/恶意路径/错 hash 拒绝；在每个提交步骤硬退出后重启，自动回滚或进入明确恢复界面；旧 V1 JSON 能迁移但不误清除新字段；API 服务元数据恢复后必须重新填 Key。

### 阶段 4：UI、容量/外置卷和真人验收

- 在 Reader 数据管理页提供完整 Reader 备份和恢复预览、容量估计、排除项、目标目录和恢复后重启 Reader 说明；保留现有轻量 JSON 格式的兼容入口或迁移导入。
- 测外置卷身份/挂载变化、权限、磁盘不足、同名文件、取消、退出、恢复中的崩溃；在隔离 userData 和合成书刊索引/原始资源上做安装版验收，确认原文件被排除但记录关联不丢失。

**验收：** 真人在开发版备份到外置盘、在另一隔离 userData 验证包结构；核对书刊索引与阅读进度、句子位置、词汇、笔记和用户内容；确认原件列为排除，目标端缺少原件时保留记录并显示内容缺失；Agent 会话与凭据未迁移；正式用户数据不参与破坏性测试。

## 8. 最终结论

1. **是否推荐 Reader 原生备份？** 是。以受限 API/数据适配器和明确 schema 导出为主。现有局部 Reader JSON 实现是可复用起点，但并非完整备份。
2. **是否还需要独立维护程序？** 完整 Reader 导出/恢复不需要把独立维护程序作为默认路径。底层文件锁可留作辅助保护；在 Reader 写入者未完全纳入维护态之前，任何实现都不得宣称并发安全或执行恢复。
3. **是否可以不关闭整个 Vantilo？** 可以作为目标架构：导出时冻结 Reader；恢复时进入 Reader-only 维护页并停 Reader Service/iframe，Agent 和整个 Vantilo 可继续运行。源码尚未证明该屏障已经存在，因此这是实施目标，不是当前已验证能力。
4. **哪些数据能够完整导出？** 当时审计时只能确认白名单 localStorage、模型隔离缓存和宿主成长记录。后续实现状态以 `reader-backup-implementation.md` 为准；原始书刊始终不是备份目标，书库索引及其与记录的关联应纳入。
5. **哪些仍有风险？** Renderer 的 pending 写入无 flush；宿主与 iframe localStorage 分 origin；Reader Service 后台 AI/导读/音频/目录/内容任务无统一 drain；V1 data backup 仅尽力回滚；其他直接写 localStorage 偏好目前遗漏；第三方私有存储只能列为 UNKNOWN。
6. **最小方案是什么？** 明确 Reader-only 注册表 + 双 origin 写入冻结 + Reader Service 写入 gate/drain + 索引和状态快照 + 版本化 manifest/SHA-256 + 外置目标临时原子提交；原始 EPUB、下载杂志和附属媒体只列排除项，不读/复制/压缩/迁移/内容哈希。恢复使用恢复点、staging 和持久 journal；缺失原件时保留记录并提示重新导入/关联。排除 Agent 平台和 Chromium Profile，API Key/密文/OAuth 均不导出。
7. **需要多少阶段？** 四阶段：数据注册表/schema；冻结与完整导出；恢复事务与崩溃恢复；UI、外置卷与真人验收。每一阶段均以合成数据和隔离 userData验收。

### 当前可以/不能声称的状态

- **可以声称：** 项目源码中的 Reader 主要使用 localStorage 和 Reader Service 文件存储；已存在版本 1 的局部浏览器数据备份；已看到书籍 EPUB 读取接口。
- **不能声称：** 当前已经有完整 Reader 备份、所有 Reader 写入已统一停写、跨 origin/文件恢复具备崩溃原子性、期刊 EPUB 已可经完整导出 API 获取、或换机可完整恢复 Reader 环境。
- **测试失败：** 本轮未重跑；上一轮证据不能把所有失败归为环境问题，需在可用 macOS 环境按单项复验。
