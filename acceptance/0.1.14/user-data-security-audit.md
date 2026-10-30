# Vantilo 0.1.14 用户数据、密钥、备份与升级安全只读审计

> **后续产品决定（2026-10-30）：** 备份范围进一步收窄为仅个人词汇及其相关学习数据；不备份整个 Reader、书库索引、Reader 设置、阅读进度或文章全文。保留词汇必要的书籍/杂志来源 ID、名称和短语境引用，但不复制或哈希来源文件。API 服务配置、密钥、Agent/Codex 和 Chromium 数据均排除。本文的全面用户数据资产清单仍是审计事实，不代表这些资产均进入备份；此前 Reader-wide 备份计划由词汇专属范围取代。

审计日期：2026-10-30（Asia/Shanghai）
范围：源码、打包脚本、相关测试、Git 历史及本机文件元数据；未读取任何真实密钥、令牌、用户数据正文或 Keychain 项目。未启动、升级或迁移应用，未运行真实 API/Codex 请求。**本轮没有运行测试**，下文测试状态均为 `NOT RUN`；已有测试代码不是本轮通过证明。本报告是唯一获准的新文件，没有修改代码、配置、用户数据或发布状态。

## 1. 执行摘要与审计对象

- 外置 `/Volumes/Workspace/Development/Vantilo` 是构建、产物与历史工作副本管理目录，并非正式 Git 源码检出。正式仓库为 `<Vantilo 仓库根目录>`；`git rev-parse --show-toplevel`、根目录 `AGENTS.md` 和发布手册共同支持这一判断。外置 `workspaces/` 有多个历史副本，不应将它们误认成当前源码。
- 正式仓库当前为 `main`，HEAD `16f38f07c26bcd15e3a47683849b65937ebb9dfc`，`git status --porcelain` 为空；`package.json:3` 为 `0.1.13`。最近提交为 `16f38f0`、`928a559`、`e774e7a`。未向远端发起读写请求，远端实时状态 `UNKNOWN`。
- 本机进程 66828 的可执行路径经 `ps` 和 `lsof` 核对为 `/Volumes/Workspace/Development/Vantilo/out/0.1.13/Vantilo Beta.app/Contents/MacOS/Vantilo Beta`；该应用 `Info.plist` 为版本 `0.1.13`、Bundle ID `com.vantilo.desktop.beta`、名称 `Vantilo Beta`。源码与**该正在运行的应用**版本一致。另有 0.1.12 等旧产物；未确认是否还在其他目录安装过副本，因此“唯一安装位置”为 `UNKNOWN`。
- 两个应用数据目录元数据可见：`~/Library/Application Support/Vantilo Beta` 与 `~/Library/Application Support/vantilo`，两者目录权限均为 `0700`。前者有 `reader-custom-api-v1.json`（701 字节、`0600`）、`codex-home/auth.json`（4240 字节、`0600`）、`reader-library`、`Local Storage` 和 `Cookies`。仅检查了文件元数据，没有读取这些文件内容。`vantilo` 目录可能对应开发版，未通过内容或启动验证归属。
- 当前 0.1.13 Beta 的应用数据位于 `.app` 之外。打包入口明确把 `userData` 固定到 `appData/Vantilo Beta`，之后主入口保持原路径；因此**同系列 Beta 替换 `.app` 在代码设计上应保留数据**。但没有执行真实旧版到新版升级，也没有对真实 Keychain 做解密验证，不能宣称升级一定无损。
- 现有“导出阅读备份”是 **Reader 局部 JSON 备份**，不是整个桌面应用备份；它遗漏 EPUB、服务配置和密钥、Agent/Codex 资料、Reader 服务端缓存及部分界面状态。更换 Mac 目前不能完整恢复。

路径简写：以下 `U` = `~/Library/Application Support/Vantilo Beta`；`L` = `U/reader-library`。这是当前打包 Beta 的设计路径，不代表其他产品名或开发版。`localStorage` 指 Reader origin 的 Chromium Local Storage，实际底层文件在 `U/Local Storage`，不能把某个应用键直接等同于磁盘上的独立文件。

## 2. 用户数据资产清单

“升级保留”表示**同一 Beta 数据路径下替换应用包的源码预期**，不是已完成的真实升级测试。`是` 表示现有 Reader 备份明确覆盖；`否` 表示不覆盖。部分服务端文件可能是可再生缓存，但也可能含用户生成内容，不应未经判别清理。

| 数据类型 | 存储位置 | 存储方式 | 敏感级别 | 升级是否保留 | 现有备份是否覆盖 | 恢复方式 |
| --- | --- | --- | --- | --- | --- | --- |
| Agent 会话消息、标题、模型、reasoning effort、置顶、权限、关联线程与工作区 | `U/sessions.json` | 版本 6 JSON，原子替换 | 高 | 同路径应保留 | 否 | 目前无应用内恢复；需安全迁移设计 |
| Reader 发起的 Agent 任务会话 | `U/reader-engine/sessions.json` | JSON | 高 | 同路径应保留 | 否 | 无应用内恢复 |
| Codex 对话、线程、缓存及状态 | `U/codex-home/`（实际可见 SQLite、WAL 等） | Codex 自身存储 | 高 | 同路径应保留 | 否 | 需按 Codex 兼容性单独设计；不能直接打包登录凭据 |
| Codex 登录状态及令牌 | `U/codex-home/auth.json` 与系统凭据的确切关系 `UNKNOWN` | 实际存在的私有文件；正文未读 | 极高 | 同路径是否可继续认证 `UNKNOWN` | 否 | 新机重新登录；不得纳入普通备份 |
| Reader 旧式 Codex 授权状态 | `L/data/codex-auth.local.json`（源码路径，实际存在性未确认） | JSON，可能含 refresh token | 极高 | 同路径应保留 | 否 | 不迁移凭据，重新登录；核对正式构建是否仍使用 |
| Workspace 授权根目录 | `U/workspace.json`；`U/reader-engine/workspace.json` | JSON 绝对路径 | 高 | 字节保留，外置盘断开时不可用 | 否 | 新机/盘重新选择并授权 |
| 用户项目列表、置顶与移除状态 | `U/projects.json`；`U/reader-engine/projects.json` | JSON 绝对路径 | 中 | 字节保留，路径可能失效 | 否 | 重新映射项目路径；需新备份支持 |
| Runtime 状态/默认工作区 | `U/agent-workspace`、`U/reader-engine/reader-task-workspace` 及 Runtime 内存 | 目录及临时状态 | 中 | 目录应保留，运行态不保留 | 否 | 重新启动/重选工作区；实际可迁移范围 `UNKNOWN` |
| 自定义 API 服务名称、Base URL、模型、激活服务 | `U/reader-custom-api-v1.json` | v2 JSON 元数据 | 高 | 同路径应保留，解密失败时当前 UI 无法读取 | 否 | 目前无导出恢复；0.1.14 应加入普通备份 |
| 自定义 API Key | 同文件的 `encryptedApiKey`；加密密钥由 macOS Keychain 提供 | Electron `safeStorage` 加密字节的 Base64 | 极高 | 原机同签名条件下预期可解密，未实测 | 否 | 原机修复 Keychain 访问；新机重新输入或密码加密迁移包 |
| Reader 原始 `ai-providers.local.json` 服务 | `L/config/ai-providers.local.json`（源 Reader 逻辑） | 源码会明文保存 API Key；**Vantilo 正式构建通过适配器替换该服务初始化** | 极高 | 若历史文件存在则字节保留，正式版是否读取为否 | 否 | 先查历史来源；不得误当作当前正式配置 |
| 阅读位置、文章/书籍进度、逐句位置 | Reader `localStorage` 的 `economist-reader-state-v1` | JSON | 高 | 同 origin 应保留 | 是 | 阅读备份导入 |
| 精选/课程阅读位置、学习练习结果 | Reader `localStorage` 的 lesson/learning 键 | JSON | 中 | 同 origin 应保留 | 是 | 阅读备份导入 |
| 学习活动标志与临时阶段视图 | Reader `localStorage` 的 `learning-active`；`sessionStorage` 的阶段键 | 字符串/会话数据 | 低 | 活动标志应保留，sessionStorage 不保证 | 否 | 重新进入活动 |
| EPUB 书库及导入刊物 | `L/books/*.epub`、`L/issues/*.epub` | 用户文件 | 高 | 同路径应保留 | 否 | 目前只能另行保存/重新导入原 EPUB |
| EPUB 派生记录、章节/期刊元数据 | `L/data/*.json` | JSON | 中到高 | 同路径应保留 | 否 | 重建能力与原数据等价性 `UNKNOWN` |
| 词汇、熟悉度、语境释义与复习日程 | Reader `localStorage` 对应 3 个键 | JSON | 中 | 同 origin 应保留 | 是 | 阅读备份导入 |
| 阅读历史、笔记、稍后阅读 | Reader `localStorage` 对应 3 个键 | JSON | 高 | 同 origin 应保留 | 是 | 阅读备份导入 |
| 段落、句子、选区翻译及阅读助手缓存 | Reader `localStorage` 的 4 个基础键；模型隔离键带 `:vantilo-v2:` | JSON | 中到高 | 同 origin 应保留 | 是；模型键由构建适配器扩展覆盖 | 阅读备份导入；旧备份保留旧版未知模型键 |
| 阅读偏好、学习游戏外观/声音 | Reader `localStorage` | JSON | 低 | 同 origin 应保留 | 是 | 阅读备份导入 |
| 阅读成长记录 | 宿主 `localStorage` 键 `vantilo-reading-growth-v1` | JSON | 中 | 同 origin 应保留 | 是；宿主通道单独读写 | 阅读备份导入；旧备份缺项时保留现值 |
| 中文听书位置与语速 | Reader `localStorage` | JSON | 中 | 同 origin 应保留 | 是 | 阅读备份导入；音频不包含 |
| 中文目录、节段翻译、导读准备状态 | `L/data/book-toc-chinese.json`、`section-translations.json`、`guide-preparation-status.json` 等 | JSON | 中到高 | 同路径应保留 | 否 | 当前无统一恢复 |
| 按模型目录翻译与选择 | `L/data/catalog-translations-v1/` | JSON | 中 | 同路径应保留 | 否 | 当前无统一恢复 |
| 课程准备对话、课程内容与模型偏好 | `L/data/codex-prep-*.local.json`、`book-lessons.local.json`、`learning-materials/` | JSON | 高 | 同路径应保留 | 否 | 当前无统一恢复 |
| 学习音频与清单 | `L/data/learning-audio/` | MP3/JSON | 中 | 同路径应保留 | 否 | 可再生性依赖服务与原材料，不能直接假定可重建 |
| 书籍分类、发现目录、科学文章等服务端记录 | `L/data/book-categories.json`、`content-discovery.json`、`science-articles.json`、媒体目录等 | JSON/媒体 | 中 | 同路径应保留 | 否 | 当前无统一恢复 |
| 本机词典缓存 | `L/data/vantilo-system-dictionary-cache-v3.json` | JSON | 低 | 同路径应保留 | 否 | 可由系统词典重新查询；原个性化数据不在此处 |
| Gutenberg 中文简介缓存 | `U/gutenberg-intros-v1/` | JSON | 中 | 同路径应保留 | 否 | 可按服务/模型重建，产生费用或结果差异 |
| 阅读器/页面布局辅助状态 | Reader `localStorage` 布局键及 `sessionStorage` 导航键 | 浏览器存储 | 低 | 视 origin、会话而定 | 否 | 重新选择布局/导航 |
| 首次启动向导 | `U/reader-onboarding.json` | JSON | 低 | 同路径应保留 | 否 | 重新进行向导 |
| 杂志同步状态与开关 | `L/data/vantilo-magazine-sync.json` 及 `.preferences.json` | JSON | 低 | 同路径应保留 | 否 | 重新检查/设置 |
| 软件更新自动检查设置、上次检查/下载状态 | `U/software-update-preferences.json`；检查与完成路径主要在服务内存，下载 ZIP 在用户选定目录 | JSON/内存/ZIP | 低到中 | 开关应保留；内存状态重启不保证 | 否 | 重新检查；已下载 ZIP 单独核验 |
| Reader 会话 Cookie、Chromium Local/Session Storage、缓存 | `U/Cookies`、`U/Local Storage`、`U/Session Storage`、缓存目录 | Chromium 私有文件 | 中到高 | 同路径通常保留，运行会话有例外 | 仅白名单 localStorage 键 | 登录重建/缓存重建；Cookie 不应普通导出 |
| 本地模型设置/权重 | `U/local-models` 等可能路径，正式 0.1.13 未集成本地 Qwen 安装 | `UNKNOWN` / 预览代码 | `UNKNOWN` | `UNKNOWN` | 否 | 不纳入 0.1.14 默认迁移，先确认是否为正式功能 |

证据：`electron/runtime-entry.cjs:16-40`、`electron/session-store.cjs:7-23,95-147,315-334`、`electron/workspace.cjs:45-78`、`electron/project-store.cjs:6-30`、`electron/main.cjs:18-50`、`electron/portable-reader-service.cjs:25-50,147-168`、`packages/reader/src/server/services/issue-service.ts:373-378`、`packages/reader/src/frontend/user-data-backup.ts:63-80`、`scripts/reader-backup-adapter.mjs:21-29,85-109,139-145`。本机可见 `L/issues` 有若干 EPUB，但未读取文件名或内容，也未统计个人书库为发布包资产。

## 3. API Key 与 macOS Keychain 审计

### 当前正式调用链

`electron/main.cjs:36-38,49` 在 Main Process 创建 `createReaderCustomApi()`，配置路径为 `U/reader-custom-api-v1.json`；`electron/portable-reader-service.cjs:163-168` 通过 Reader 服务暴露受限配置操作。`reader-custom-api.cjs:63-80` 读取 v1 单服务或 v2 多服务，逐条使用 `safeStorage.decryptString`，保存时把名称、URL、模型放在 JSON 的 `config`，把 API Key 加密后 Base64 写入 `encryptedApiKey`。`save()` 保留输入空密钥时的旧值；`activate()` 会重写 v2 文档。正式 Reader 构建的 `scripts/reader-variant.mjs:473-477` 用占位适配替换源 Reader `AiProviderSettingsService.create()`，所以源文件 `packages/reader/src/server/services/ai-provider-settings-service.ts:308-360` 的**明文 Key 写盘实现不应被直接算作当前 Vantilo 正式配置路径**。这条适配必须保持回归测试；历史/独立 Reader 使用该源服务时仍有明文风险。

| 问题 | 源码可证明的行为与限制 |
| --- | --- |
| Key 是否始终加密保存 | 当前正式 `persist()` 对所有 profile 的 `apiKey` 调用 `safeStorage.encryptString()`；未见该路径明文写盘。文件中的服务名称、URL、模型**未加密**。真实文件内容未读，故无法证明其每一条记录或历史遗留文件均符合格式。空 Key 也会被加密；是否原本有 Key 不能仅从文件元数据判断。 |
| 日志/异常泄漏 | `publicProfile()` 仅返回 `hasApiKey`，`responseJson()` 对远端错误正文中的**完整当前 Key**做替换，见 `reader-custom-api.cjs:36-56`。未见该模块显式打印 Key；但不应声称“所有错误路径零泄漏”：远端错误可含变形/部分 Key，通用错误对象可能包含 URL，整个应用/依赖日志未做动态验证。Agent 消息持久化有规则式脱敏（`session-store.cjs:29-50,214,277`），不能证明覆盖任意秘密形式。 |
| 原机升级解密 | 同一 `U` 和可访问原 Keychain 密钥时预计可解密；**未做真实旧版升级或 Keychain 解密测试**。 |
| 重签名/Bundle ID/开发正式切换 | Electron 官方文档明确指出 macOS `safeStorage` 依赖 Keychain，签名不稳定可能在每次更新时重新提示。当前 Beta 使用 ad-hoc 重签名（`build-mac-universal.mjs:187-213`），Bundle ID 为 `com.vantilo.desktop.beta`；开发版与 Beta 使用不同数据路径。是否只是授权提示，还是无法读到同一密钥，必须用隔离的旧版密文与不同签名实测。不能保证开发版配置自动出现在正式版，也不能盲目复制密文。 |
| 用户拒绝/暂时无法访问 Keychain | `get()` 解密抛错后 `read()` 把任何非 `ENOENT` 都归为“自定义 API 配置无法读取”；`save()` 在 `isEncryptionAvailable()` 为 false 时拒绝写入，否则仍需 `read()` 和 `encryptString()` 成功。磁盘原文件通常未被覆盖，但 UI 不展示元数据；本轮未模拟系统授权弹窗。 |
| 加密密钥丢失 | 旧 ciphertext 无法解密时当前代码没有独立恢复路径；不应尝试用空 Key 自动重建。服务名称/URL/模型仍在 JSON 中，但当前 `read()` 会在任一 profile 解密失败时整体失败，UI 无法读取这些元数据。 |
| 再次保存是否覆盖 | `read()` 抛错时 `save()` 在写盘前失败，正常不会覆盖原文件；在成功解密时空 Key 保留旧值（`reader-custom-api.cjs:111-114`）。但是 `read()` 返回缓存对象，`save()`/`activate()` 原位修改后才 `persist()`；若加密或写盘失败，内存状态可能先变化而磁盘仍旧，需修正为副本提交。临时文件写入/重命名失败后没有清理逻辑。 |
| 可否无损恢复授权 | 如只是 Keychain 临时拒绝，维持原文件、不执行覆盖写入，恢复系统授权后重试读取可能成功。若密钥实际丢失，原 Key 不可恢复；可从**验证安全的元数据读取模式**找回服务列表，再由用户重填 Key，或从独立密码加密迁移包恢复。 |

`read()` 故障分类现状：配置不存在 `ENOENT` → `null`；文件损坏/JSON 解析失败、版本不支持、Ciphertext 格式无效、Keychain 不可达和解密失败 → 全部同一错误文本；API Key 真为空 → `hasApiKey:false`（前提是解密成功）。v1→v2 为内存读入并在下次保存/切换时写 v2，**没有原 v1 文件的独立迁移副本或可回滚迁移事务**。`persist()` 是临时文件加 rename，保护完整写入的目标，但没有 `fsync`、旧版本快照和临时文件失败清理。证据：`electron/reader-custom-api.cjs:63-80,110-118`。

官方依据：[Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage/) 明确 macOS 密钥在 Keychain、同步 API 可能等待用户输入、建议稳定代码签名，并说明新版异步 API 更能处理暂时不可用。Apple 的[代码签名技术说明](https://developer.apple.com/library/archive/technotes/tn2206/)说明 Keychain 访问策略与代码签名身份有关。本审计**没有检查真实 Keychain ACL、密钥或授权历史**，不能根据文档推断本机已经失败。

## 4. 升级安全审计

1. **安装方式与位置。** 当前更新器下载并校验 ZIP，随后只提示 Finder 与手动替换；不会自动替换正在运行的 `.app` 或删除 `U`，见 `electron/software-update-service.cjs:96-121`、`README.md:38`。下载到用户选定目录，与用户数据目录分离。源码能证明更新器没有自动清除配置，但用户手动操作是否只替换应用包需要实际验收。
2. **路径稳定性。** `scripts/build-mac-beta-candidates.mjs:123-126` 固定 Beta 的 `userData` 为 `appData/Vantilo Beta`，允许绝对 `--user-data-dir` 用于隔离；`electron/main.cjs:18-21` 取得路径后仅改显示名称并恢复相同路径。当前 0.1.12/0.1.13 产物的 Bundle ID 都是 `com.vantilo.desktop.beta`。更改应用名、Beta/Stable 包名、入口脚本、`userData` override 或 origin/端口会创建/读取另一数据命名空间；现有目录可能仍在但界面看似“丢失”。
3. **迁移与回退。** Agent `sessions.json` 有 v1–v5→v6 解析迁移，坏文件改名保存再创建空历史（`electron/session-store.cjs:105-147`）；Reader 备份仅认 envelope v1 与白名单键，部分状态各自带 version。没有发现**全应用跨版本迁移事务、升级前自动快照、失败后原样回滚、降级保护**。旧版回退是否能读取新格式 `UNKNOWN`，且旧版写入可能破坏新格式。`projects.json`、Workspace、服务端 Reader 数据有各自解析逻辑，不等于统一迁移。
4. **外置盘未挂载。** `workspace.json` 的路径加载会返回“不可用”且不自动更改保存设置（`electron/workspace.cjs:56-78`）。应用主 `U` 默认在本机，外置 Workspace 是被授权项目/构建盘，不能把验证过的外置盘身份误用于用户 `userData`。若用户主动把 `--user-data-dir` 指向外置盘，打包入口只验证“绝对路径”，没有挂载身份检查；未挂载时可能创建错误路径或启动失败，这一风险需隔离测试。
5. **已确认与未确认。** 已确认：实际运行的 app 0.1.13 与源码版本相同、Beta 数据目录及配置文件存在、数据目录不在 `.app` 内。未确认：0.1.12→0.1.13 真实迁移、旧 Key 在重签名后的解密、程序异常退出时所有 Reader 服务端记录一致性、旧版降级安全。不能把本次文件元数据检查写成升级成功。

## 5. 现有备份机制审计

`packages/reader/src/frontend/user-data-backup.ts:63-80,203-253` 定义并校验 16 类 Reader 浏览器数据。Vantilo 构建适配 `scripts/reader-backup-adapter.mjs:21-29,55-67,85-109,139-145` 添加模型隔离的段落/句子翻译缓存与宿主阅读成长记录。UI `scripts/reader-data-management.tsx:18-29,32-66` 提供导出、预览和确认恢复；Electron `electron/reader-backup-download.cjs:4-15` 只给合规的 Reader JSON 下载提供系统保存对话框。备份不含 EPUB、API 配置或 Key、Agent/Workspace、Codex 登录、中文目录与 Reader 服务端数据；UI 自身也明确写明这些排除项。普通 JSON 备份会直接包含阅读内容、笔记、译文，因此应提示用户妥善保管，不能把它描述为加密备份。

格式是 `app:"magazine-reader"`、`version:1`、`exportedAt`、`data`，可选 `variantKeysIncluded`。未知键和无效值在导入前拒绝；旧备份可读，旧版不含模型隔离键时保留目标机现有模型缓存。恢复会对管理键覆盖或删除；缺失的白名单项可能被清空。`user-data-backup.ts:277-304` 有内存快照和写失败的尽力回滚，Vantilo UI 还试图分别回滚宿主成长数据，但**没有跨 Chromium localStorage 与宿主数据的持久事务日志**；崩溃/断电后不能保证回滚。Reader 旧备份兼容性已有模拟测试代码（`tests/reader-backup-app.test.mjs:58-74`），本轮未运行，也未进行真实旧版备份导入。更换 Mac 只能恢复这部分阅读记录；原书需要另存/重新导入，API Key 要重填，Codex 需重新登录。

特别区分：A = 现有 Reader 局部 JSON 备份；B = 用户要求、尚不存在的完整 Reader 备份。**A 不等于 B**；B 不包含 Agent 或 Chromium Profile。

## 6. 风险分级

| 级别 | 问题与源码证据 | 实际后果 | 已验证情况 | 建议 |
| --- | --- | --- | --- | --- |
| Critical | **当前没有完整 Reader 的可恢复备份。** Reader 白名单仅浏览器数据：`packages/reader/src/frontend/user-data-backup.ts:63-80,222-243`；UI 排除项：`scripts/reader-data-management.tsx:54-61`；桌面数据路径：`electron/runtime-entry.cjs:19-25`。 | 磁盘故障/换 Mac 时可能失去书库、API 服务元数据和 Reader 服务端数据；Agent 会话按用户决定不在备份范围。 | 源码证实范围；本机确有相关目录；未做恢复实验。 | 0.1.14 目标是完整 Reader 备份/恢复，排除 Agent、密钥与登录凭据。 |
| High | **Keychain/解密任一异常遮蔽全部服务元数据。** `electron/reader-custom-api.cjs:63-75,110-118`。 | 用户无法确认服务列表或安全重填 Key；误以为配置消失。 | 静态确认；真实系统拒绝/丢钥未验证。 | 分离元数据解析与解密状态，区分故障码，只读展示，禁止失败时覆盖。 |
| High | **当前 ad-hoc 签名与后续签名身份变化可能使 Keychain 重新授权或解密失败。** `scripts/build-mac-universal.mjs:187-213`，`scripts/build-mac-beta-candidates.mjs:123-126`；Electron 官方 safeStorage 文档。 | 正常换版后 Key 可能暂不可用；可能出现“配置无法读取”。 | 签名状态源码确认；真实跨版解密 `NOT RUN`。 | 先做 0.1.12/0.1.13→0.1.14 隔离签名矩阵与拒绝授权测试；保持旧文件及回退路径。 |
| High | **恢复缺少崩溃安全的跨存储事务。** `user-data-backup.ts:285-304`、`scripts/reader-data-management.tsx:40-50`。 | 恢复中断后可能只写入部分 Reader 或成长数据。 | 静态确认；真实断电/崩溃未验证。 | 恢复前持久快照、阶段标记、原子提交/启动恢复或可靠回滚。 |
| High | **无降级保护与全应用迁移机制。** `electron/session-store.cjs:105-147`、`electron/reader-custom-api.cjs:67-80`。 | 新版写入格式后旧版可能无法读，甚至另建空记录；迁移中断风险。 | 源码未发现统一机制；真实降级未验证。 | 数据 schema 版本门禁、升级前快照、旧版只读拒绝写入、迁移可回滚。 |
| Medium | **配置写失败可能使内存与磁盘状态分叉。** `electron/reader-custom-api.cjs:77-80,111-117`。 | 运行中显示已切换/修改但重启回退；后续操作基于错误缓存。 | 静态确认；故障注入未运行。 | 先构造不可变新状态，原子落盘成功后才更新缓存；清理临时文件。 |
| Medium | **Beta/开发/Stable 路径隔离与外置 userData override 风险。** `scripts/build-mac-beta-candidates.mjs:123-126`、`electron/main.cjs:18-21`。 | 用户看到新空目录，以为升级丢数据；未挂载卷上可能建错目录。 | 当前两数据目录确实存在；迁移/外置故障未测。 | 显示实际数据路径并做旧目录发现/只读迁移提示；override 做卷身份检查。 |
| Medium | **已有普通阅读 JSON 含笔记/译文等内容且未加密。** `user-data-backup.ts:222-269`。 | 备份文件泄露会暴露私人阅读资料。 | 源码证实；未读取真实备份。 | 明确标注敏感性；可选密码加密备份及安全保存位置。 |
| Medium | **源 Reader 存在明文 Key 存储代码，正式版依赖构建适配排除。** `packages/reader/src/server/services/ai-provider-settings-service.ts:308-360`、`scripts/reader-variant.mjs:473-477`。 | 若以后适配失效/独立 Reader 路径启用，Key 可能明文落盘。 | 静态确认适配；本轮未构建核对最终 bundle。 | 保持构建断言与测试，禁止在正式版启用原始服务。 |
| Low | **错误分类与文件权限一致性不足。** `electron/reader-custom-api.cjs:74`，Reader 服务端部分 `writeFile` 未统一 `0600`：`packages/reader/src/storage/json-storage.ts:50-85`；本机个别派生文件元数据为 `0644`，但父目录为 `0700`。 | 诊断困难；目录权限被手工放宽时内容暴露面增大。 | 源码与文件元数据确认；未读取正文。 | 明确错误码；Reader 私有文件统一权限和目录保护。 |

没有证据表明本机已有密钥泄漏或当前升级已丢数据；风险级别描述的是**可能后果与当前保护缺口**，不是事故断言。

## 7. Vantilo 0.1.14 最小改进方案

### 发布前必须修复

1. **API 配置容错与迁移。** 将文件解析/格式检查、服务元数据展示、密钥解密状态分层。明确 `missing`、`corrupt_json`、`unsupported_version`、`keychain_unavailable`、`decrypt_failed`、`empty_key`；任一 profile 解密失败不能隐藏其他服务元数据。故障态仅允许安全读与恢复授权，不允许以空 Key、默认配置或另一服务覆盖原文件。旧 v1/v2 先制作受保护快照，再在落盘成功后提交内存状态；迁移失败保持原文件。
2. **同机升级守护。** 固定 Beta 的应用名、Bundle ID、`userData`、Reader origin；显示/记录实际 `userData` 路径（不泄密）。升级前从隔离数据集做版本化快照，恢复点与 schema 兼容检查；无降级支持时拒绝旧版写入新 schema。对外置 `--user-data-dir` 进行真实挂载/目标身份校验，失效时停止而不是在挂载点下建新目录。
3. **统一普通备份与恢复。** 在主进程提供用户主动的 Reader 数据备份，包含 Reader 白名单状态、书库/刊物索引及必要引用、经过分类和筛选的 `L/data` 用户内容、API 服务**非密钥元数据**和 Reader 设置；明确排除 EPUB、杂志原始文件和附属大型媒体。manifest 对已备份条目逐项列出大小与 SHA-256；被排除原文件只列路径/关联和排除状态，不计算其内容哈希或计入备份大小/文件数。导出前检查一致性与目标卷空间，临时打包、校验后原子完成。未来恢复先完整校验并建立恢复点，再阶段提交；不得因找不到原始文件而丢弃阅读记录、创建空书籍或覆盖记录。不要包括 `codex-home/auth.json`、OAuth refresh token、系统 Keychain、Cookie、临时下载/缓存或模型权重。
4. **真实隔离升级验收。** 使用合成多服务、多模型、阅读/书库/Agent 数据与可测试 Keychain 项目；测试旧版→0.1.14 同机升级、Keychain 拒绝/暂不可达/丢钥、签名变化、异常退出与旧版降级。不得使用正式用户数据。

### 可以分阶段完成，但需明确产品限制

- **普通备份**：服务元数据可恢复，Key 由用户重新填写；是最小安全方案，可先发布。明确“更换 Mac 后需要重登 ChatGPT、重填 API Key”。
- **可选密码加密迁移包**：仅在有独立备份密码时导出 API Key。建议用经过审查的 Argon2id（若无稳定依赖则 `scrypt`，例如随机 16–32 字节 salt、按设备内存限制选择参数）派生 256 位密钥，再用 AES-256-GCM（每包随机 96 位 nonce、认证关联数据含格式/版本/清单）加密；所有子项纳入认证，密码错误/文件篡改统一返回“验证失败”，**不得开始覆盖旧数据**。参数与格式版本写入清单，限制资源消耗，避免明文 Key 进入日志、临时 JSON、普通备份或崩溃报告。密码无法找回；恢复后在目标机重新写入目标 Keychain/safeStorage。实现前做密码学审查与跨机模拟，不自行发明加密算法。
- 可再生缓存（字典、音频、目录）的取舍可后续做用户选项，但先把用户编辑或昂贵生成的内容与纯缓存分清。Agent/Codex 历史不保证跨版本可直接复制 SQLite；Reader 备份不迁移 Vantilo Agent 会话或 Codex 内部数据库。

## 8. 回归测试计划

本轮没有执行测试。以下状态均为 `NOT RUN`，不能把静态检查或既有测试代码算作本轮 PASS。所有用隔离 `userData`、合成 EPUB、模拟网络/Keychain，不碰正式目录；真实旧新版安装包测试仅在用户另行授权开发阶段执行。

| 编号 | 输入与步骤 | 预期结果/验收标准 | 本轮状态 |
| --- | --- | --- | --- |
| T01 | 合成 0.1.12 v1/v2 配置，启动 0.1.14 | 服务名称/URL/模型、数量原样保留；原文件可回退 | NOT RUN |
| T02 | 同机模拟 Keychain 密文，升级后解密 | Key 与旧版一致；不出现新授权时提示被误报为空 Key | NOT RUN |
| T03 | 三个服务，其中一个无 Key、一个有 Key | 顺序、ID、服务元数据均保留 | NOT RUN |
| T04 | 旧版激活第二服务，升级 | activeId 不变；请求仍选第二服务 | NOT RUN |
| T05 | Keychain 暂不可用后恢复 | 仅显示可恢复错误；磁盘配置逐字节不变；重试成功 | NOT RUN |
| T06 | 一条密文解密失败，用户点击保存/切换 | 不以空配置覆盖；其他元数据可见；错误有单独状态 | NOT RUN |
| T07 | 普通备份导出多服务 | 明文备份无任何 API Key、密文、令牌或 Cookie；有非密钥服务信息 | NOT RUN |
| T08 | 源设备加密迁移包，在独立目标模拟 Keychain 恢复 | 密码正确时所有 Key 与服务匹配，并重新写目标安全存储 | NOT RUN |
| T09 | 错密码/篡改 GCM tag | 拒绝并保持目标数据逐字节不变 | NOT RUN |
| T10 | 截断/损坏备份、缺少 manifest 项 | 校验阶段拒绝，目标数据不变 | NOT RUN |
| T11 | 恢复中强制退出/磁盘写失败 | 重启识别中断，完整回滚或安全续行，不留半迁移状态 | NOT RUN |
| T12 | 旧 Reader v1 与未来 Vantilo v1 备份 | 兼容项目能恢复；未知 schema 不静默丢弃；旧模型缓存保护 | NOT RUN |
| T13 | 指向未挂载外置盘的工作区与 `--user-data-dir` | 不在内部挂载点创建替身目录；原路径和文件不变 | NOT RUN |
| T14 | 下载中断/安装替换失败 | 旧 `.app` 与旧 `U` 原样可用；无自动删除 | NOT RUN |
| T15 | 0.1.12→0.1.14、开发版→Beta、ad-hoc→不同签名矩阵 | 清楚区分自动沿用与需用户操作；密钥失败不误删配置 | NOT RUN |
| T16 | 旧版读取 0.1.14 新 schema | 受控拒绝写入或安全兼容，不重建空数据 | NOT RUN |
| T17 | 多个 EPUB/杂志原文件及附属媒体存在时，备份 Reader 索引、模型译文和成长记录 | 原始内容不进入 ZIP、不做内容哈希或计入已备份数据；索引引用与关联保留；排除项清单明确；不含 Agent 数据和凭据 | 原审计未运行；后续归档测试见 Reader 备份实施报告 |

已有相关测试源码：`tests/reader-custom-api.test.mjs`、`tests/reader-backup-app.test.mjs`、`packages/reader/src/frontend/user-data-backup.test.ts`、`electron/session-store.cjs` 周边测试。当前 API 测试主要覆盖正常加密、空输入保留及远端响应遮盖，**没有** Keychain 拒绝、密文损坏、多 profile 部分失败、真实跨签名升级；新增测试不能只镜像实现。考虑本轮严格只读且测试运行器可能创建缓存/临时文件，未执行测试，也未据既往发布测试给本审计打 PASS。

## 9. 最终结论

- **正常升级是否会丢 API 配置？** 同系列 Beta 仅替换 `.app`、不改变 `U` 时，源码预期不会删除 JSON；但真实升级未测，不能保证。换名称、路径或数据目录时可能“看不见”原配置；密钥解密失败也会让整个服务列表在 UI 不可读。
- **正常升级是否会丢 API Key？** 当前密文文件不会因更新器自动删除；同机原 Keychain 且稳定应用身份下预期可用。当前 ad-hoc 签名下跨版授权/解密风险未验证，因此不能保证“不丢”。密钥丢失时密文无法复原。
- **更换 Mac 后能否完整恢复？** **不能。** 现有阅读备份可迁移部分阅读状态，不能迁移 EPUB、Agent 会话、API 服务/Key 和所有 Reader 服务端记录；Codex 必须重新登录。
- **最急的三个风险：** ① 缺少完整 Reader 可恢复备份；② 审计时 Keychain/解密失败会遮蔽 API 服务元数据（后续部分修复见实施报告）；③ 升级、恢复与降级没有统一的事务/回滚及真实跨签名验收。
- **0.1.14 发布前最低门槛：** 完成 API 故障分类和无损恢复、完整 Reader 普通备份与事务恢复、固定 Beta 数据路径/降级保护，并用隔离合成数据完成升级、备份恢复、Keychain 与异常退出测试。密码加密 Key 跨机迁移可作为单独功能延后，但须明确告知用户需重填 Key；若产品宣称“完整无密钥重填迁移”，则必须先实现并验收加密迁移包。

审计限制：未读取真实 Keychain、密钥、Cookie、数据库或 EPUB；未运行安装/升级/迁移/测试。文件存在和权限不证明内容可正确解密或恢复。所有 `UNKNOWN` 应在 0.1.14 隔离验收中缩小范围，不得以推测代替验证。
