# Vantilo 0.1.14：词汇专属备份与恢复实施报告

日期：2026-10-30
状态：代码、自动化测试、类型检查和生产构建已完成；尚未进行开发版真人验收或安装包验收。
当前 `package.json` 版本仍为 `0.1.13`，本轮未改版本号、未提交、未推送、未打包或发布。

## 1. 范围与执行边界

本功能只处理 Reader 中的个人词汇及其关联学习数据。没有读取正式用户词汇、API Key、Keychain 或正式书库；测试使用合成记录、JSDOM localStorage 和系统临时目录。没有创建 Reader 备份文件到正式用户目录。

备份文件不含 EPUB、电子书、杂志原件、文章全文、媒体文件、阅读进度、逐句位置、Reader 设置、普通词典/临时 AI 缓存、Agent/Codex/Chromium 数据或认证信息。源引用仅保留文档类别、内部 ID、标题、段落/字符位置和最多 320 字符的语境片段。

## 2. 源码核对后的真实词汇数据

当前词汇数据位于 Reader iframe 自己的 origin localStorage。没有发现这些词汇集合使用 IndexedDB。Vantilo 构建入口由 `scripts/reader-variant.mjs` 将原 Reader 的整套 Reader 数据备份面板替换为本报告描述的词汇专属面板；Reader 构建适配测试也确认最终面板不包含旧的整库清除、导入或导出入口。旧 Reader 通用备份模块和针对它的历史单元测试仍留在源码树，但不由 Vantilo 当前设置面板调用。

| localStorage 键 | 源码中的真实记录 | 本备份保留内容 |
|---|---|---|
| `economist-reader-selections-v1` | `SavedSelection`：记录 ID、文档 identity（历史记录可用 issue/article 字段迁移）、文章/章节名称、单词或词组、原文短语境、段落、创建时间、可选字符偏移、用户中文用法说明、释义版本/中文释义/释义来源、熟悉度（兼容旧 `mastered`） | 仅写入当前 schema 支持字段；上下文裁剪至 320 字符；保留用户释义、来源和熟悉度 |
| `economist-reader-word-context-v1` | `WordContextMeaningRecord`：occurrence key、文档 identity、段落/偏移、词形、段落和句子片段、生成/编辑时间、AI/用户释义来源、中文和英文释义/解释、英文例句、词性、模型和 provider | 仅导出能匹配到已保存词汇的语境记录；段落/句子最多 320 字符，例句最多 20 条且每条最多 1000 字符；保留中英释义、解释、POS 和例句 |
| `magazine-reader-vocabulary-review-v1` | `VocabularyReviewScheduleRecord`：归一化词形、熟悉度、间隔天数、累计复习次数、上次复习时间和到期时间 | 保留完整已存在的复习日程字段 |

主要写入入口是 `App.tsx` 中调用 `saveSavedSelections`、`saveWordContextMeanings`、`saveVocabularyReviewSchedules` 的学习操作；三者最终写入上述 localStorage 键。源码没有单独的收藏字段、标签/分类字段、IPA 字段、词形变化表或逐次复习事件表；本实现不虚构这些字段。词性保存在语境释义记录中。独立笔记实体不存在，用户中文用法说明由 `usageExplanationZh` 承载。

### 稳定性边界

- 词汇记录可能包含单词或词组；`text` 原样保留。
- 词汇 ID 用于同设备匹配。跨设备 ID 不同时，只有来源文档、段落、字符偏移和归一化词形都可用时才进行位置匹配。
- 对没有字符偏移量的旧记录，不以相同词形和段落推断它们是同一次出现；跨设备导入时保留为独立项，优先避免错合并。相同稳定 ID 的重复导入仍可幂等识别。
- 语境记录以 Reader 的 occurrence key（来源、段落、偏移、词形）匹配。现有模型每次出现仅存一条上下文记录，并没有独立“同一出现下多个词义”实体。
- 复习日程当前以归一化词形为键；重复导入不累加复习次数，采用两份记录中的较大次数，并按最近复习时间选状态。

## 3. 备份文件格式与完整性

格式为 `vantilo-vocabulary-backup`，当前 `backupFormatVersion: 1`。默认文件名为 `Vantilo-Vocabulary-Backup-YYYYMMDD-HHmmss.json`，最大 25 MB。格式包含：

- `appVersion`、`createdAt`、格式版本。
- `counts.vocabulary`（不同归一化词形数）以及 selection/context/reviewSchedule 各集合实际记录数。
- 明确的排除清单。
- 三个 allowlist 数据集合。
- `integrity` 中的 SHA-256、规范化载荷字节数和最终 JSON 文件字节数。

SHA-256 对键排序后的规范 JSON 载荷计算；整个 `integrity` 字段都不参与摘要，避免自引用。校验同时核对格式/字段白名单、来源 identity、各记录 schema、数组上限、清单数量、载荷摘要和最终文件大小。Main Process 在写盘前再次独立验证。该摘要用于检测意外损坏，不是发布者身份认证或数字签名。

写入流程：用户通过系统保存对话框选择路径；Main 检查目标目录存在且可写、磁盘剩余空间和文件类型。数据先写入同目录唯一 `.partial` 文件，权限为 `0600`，同步文件后以原子 hard link 创建目标文件，再移除临时项并重新读取验证。若同名文件已经存在则拒绝覆盖；验证失败时只清理由本次创建且 inode 身份仍匹配的文件。默认 Downloads 不可用时不回退到陈旧路径，由用户另选位置。

备份数据由明确的三键读取白名单和字段投影创建；Main IPC 只接受精确结构。含有额外字段（例如模拟的 `apiKey` 或 `encryptedApiKey`）会被拒绝。备份文件中没有 API 配置键，因此不包含 API Key 明文或密文、OAuth/Keychain/Codex 凭据。

## 4. 合并恢复与失败保护

恢复先选文件并在 Renderer 中验证 JSON、格式、SHA-256、字段和清单，随后展示备份词汇数、本机词汇数、预计新增、已存在、可合并记录、字段冲突和不兼容记录数。用户确认后才冻结三个词汇键。

合并策略：

- 先按稳定 ID 与 occurrence identity 匹配；跨设备 ID 不同且字符偏移有效时，按来源 identity、段落、偏移和归一化词形匹配。
- 缺字符偏移的跨设备记录不作猜测性匹配，以免误把同词不同位置或义项合为一条。
- 不覆盖本机已存在的个人用法说明和熟悉度。备份中的用户自定义释义可补入本机自动/词典释义；本机与备份均为用户自定义且不同时，保留本机值并计为冲突。
- 同 occurrence 的上下文冲突保留本机用户释义；备份用户释义可替换本机生成释义。例句/解释按已存在内容优先补缺。
- 复习历史使用较新的最近复习时间并取复习次数最大值，不把同一份备份重复相加。
- 来源书籍/杂志不在本机时，词汇记录和必要来源引用仍然合并保留；界面显示缺失来源，并提供“前往书库重新导入”。不会创建空书籍或删除词汇。

恢复开始前将三个键的原始字符串写入 `vantilo-vocabulary-restore-journal-v1`，状态为 `PREPARED`；写入合并结果后重新读取并比较规范化数据，再标记 `COMMITTED`，最后清理日志。同步 localStorage 操作在一个 Renderer JS 执行片段中完成；在真正写入入口冻结指定键，ReaderStorage 与原生 `Storage.setItem/removeItem/clear` 都会拒绝对冻结词汇键的写入。词汇数据没有异步 IndexedDB 写事务。若 UI 预览期间数据变化，会在创建日志前中止。

正常写入失败时立即恢复原始字符串并逐键核对。进程在 `PREPARED` 阶段中断时，`main.tsx` 最先导入的启动恢复模块在加载 App 前尝试回滚；`COMMITTED` 日志只清理、不回滚。日志损坏或恢复点异常时保留日志并设置恢复阻断标记，词汇写入被锁定，不自动创建空数据。恢复过程未操作其他 Reader 键、书库文件或 Agent 数据。

## 5. UI 与长期规则

设置页中的 Reader「数据管理」区域显示“词汇备份与恢复”、词汇数、上次备份、选择位置、写入/校验状态、取消、SHA-256、Finder 定位、备份文件验证、合并预览和确认恢复。选择位置期间不显示无效的取消操作；开始快照后才可取消。取消 IPC 返回后界面显示“已取消”，不会将取消误报为失败。正在原子写文件阶段不接受取消，避免留下看似完整的半成品。

缺失来源提示在预览和恢复后均保留，并可跳转书库重新导入。当前没有独立的“将现有词汇关联到 ID 已变化的新来源”交互；若重新导入后的稳定内部 ID 与备份不同，来源自动重绑尚未实现，应作为后续验收/功能项，不能声称已覆盖这种情况。

`AGENTS.md` 和 `docs/release/RELEASING.md` 已加入长期规则：用户数据备份范围仅为词汇及学习数据；排除原始书刊、整 Reader、Agent/Codex/Chromium 与 API 凭据；恢复默认合并；校验失败不得损坏原词汇；备份期间只冻结实际词汇存储键。

## 6. 22 项验收矩阵

| # | 场景 | 结果 | 证据/边界 |
|---:|---|---|---|
| 1 | 正常备份 | PASS | 合成 localStorage → Renderer DTO → Main 文件服务写入 JSON → SHA-256 解析恢复的隔离往返测试 |
| 2 | 单词与词组导出 | PASS | 覆盖 `bank` 与 `look after` |
| 3 | 不同词性/不同出现义项保留 | PASS | 同一词形不同偏移分别保存，POS 各自保留；模型没有同一 occurrence 的多义项集合 |
| 4 | 中文、英文释义保留 | PASS | 词汇中文释义及上下文中英释义/解释断言通过 |
| 5 | 语境释义保留 | PASS | 中文/英文语境记录、来源与位置匹配测试通过 |
| 6 | 例句与个人说明保留 | PASS | `examplesEn` 与 `usageExplanationZh` 合成记录通过 |
| 7 | 熟悉度与复习记录 | PASS | 熟悉度、间隔、次数、最近/到期时间覆盖；重复导入不累加次数 |
| 8 | 标签/分类 | NOT RUN（当前模型无该字段） | 当前 `SavedSelection`/上下文/复习 schema 没有标签或分类字段，未编造数据 |
| 9 | 来源关联 | PASS | 文档 ID、类型、书/期刊 ID、章节/文章 ID、段落/偏移保留；缺来源不会丢弃词汇 |
| 10 | API Key 明文排除 | PASS | 合成 secret 与非白名单 storage key 不进入导出 |
| 11 | API Key 密文排除 | PASS | 合成 `encryptedApiKey`/额外字段被排除或拒绝；未读取真实密钥 |
| 12 | 损坏 JSON 拒绝 | PASS | 无效 JSON 测试拒绝且未进入写入 |
| 13 | SHA-256 不匹配拒绝 | PASS | 修改备份载荷后摘要校验失败 |
| 14 | 同名备份不覆盖 | PASS | 原子文件服务测试验证拒绝覆盖并清理 `.partial` |
| 15 | 重复导入幂等 | PASS | 相同备份重复合并不新增重复 occurrence、不重复增加复习次数 |
| 16 | 跨设备 ID 不同匹配 | PASS | ID 不同但来源/段落/偏移/词形相同可合并 |
| 17 | 同词不同义/位置不误合并 | PASS | 不同偏移分开；旧记录缺偏移时拒绝猜测性跨设备合并 |
| 18 | 恢复失败时原数据完整 | PASS | 合成写入部分失败后回滚原始三键并核对；启动日志恢复也有单元测试 |
| 19 | 备份时阻止词汇写入 | PASS | 对冻结键的原生 Storage 与 ReaderStorage 写入均拒绝；未登记键保持可写 |
| 20 | 备份结束后恢复写入 | PASS | 释放冻结后重新写入成功 |
| 21 | 取消操作 | NOT RUN（完整 Electron 流程） | Renderer→宿主取消事件与取消态映射有合成测试；真实 Electron IPC、原生保存对话框、文件写入中的交互未做真人/Electron E2E |
| 22 | 不兼容格式版本 | PASS | 未支持版本明确拒绝且不写本机数据；不兼容记录按严格 schema 整份拒绝，不做部分导入 |

另完成一次全新 JSDOM origin profile 的合成数据往返：源 profile 创建备份，通过真实临时 JSON 文件服务写入，再解析并合并至空 target profile，比较还原前后数据一致，确认合成 API secret 未被复制。此为自动化隔离集成测试，不是打包应用或真实换机验收。

## 7. 测试和构建

最终源码状态执行结果：

- 词汇备份/冻结定向测试：2 个文件、27 项通过。
- 根目录完整测试：85 个文件、578 项通过。
- Reader 离线完整测试：95 个文件通过、1 个文件跳过；574 项通过、7 项跳过。
- `npm run typecheck`：通过。
- `npm run build`：通过；Vite 对大于 500 KB 的 JS chunk 发出既有体积提示。
- Reader 独立生产构建：通过，输出目录 `/private/tmp/vantilo-reader-vocabulary-final-20261030-merge-safety`；Swift module cache 也在对应 `/private/tmp` 路径。大于 500 KB bundle 提示不是构建失败。
- `git diff --check`：通过。
- `build/reader/seed` 仍存在，最后检查为 160 bytes、修改时间 2026-10-29；本轮 Reader 输出使用独立 `/private/tmp` 路径。

Reader 全量套件曾在与根目录测试和两个构建并行时出现一次 `codex-prep-runtime` 500 ms 合成请求超时。该文件单独运行 7 项通过，之后在不与其他测试/构建并行时重跑完整 Reader 离线套件，574 项通过、7 项跳过。该项是无关的时间敏感测试；已保留并如实复测，没有调整测试超时或断言。

## 8. 修改文件

本功能相关文件包括：

- `packages/reader/src/frontend/vocabulary-backup.ts`
- `packages/reader/src/frontend/vocabulary-backup-startup.ts`
- `packages/reader/src/frontend/reader-storage.ts`
- `packages/reader/src/frontend/main.tsx`
- `electron/vocabulary-backup-service.cjs`
- `electron/main.cjs`
- `electron/preload.cjs`
- `src/ui/magazine-reader-module.tsx`
- `src/main.tsx`
- `scripts/reader-data-management.tsx`
- `scripts/reader-variant.mjs`
- `scripts/reader-backup-adapter.mjs`
- 定向测试：`packages/reader/src/frontend/vocabulary-backup.test.ts`、`packages/reader/src/frontend/vocabulary-storage-freeze.test.ts`、`tests/vocabulary-backup-service.test.mjs`、`tests/magazine-reader-growth.test.tsx`、`tests/reader-variant.test.mjs`、`tests/ipc-security.test.ts`
- 长期规则与说明：`AGENTS.md`、`docs/release/RELEASING.md`、`README.md`，以及此前数据保护审计/架构报告的范围更新说明。

当前工作区原本已有 API 配置保护、Reader 维护/事务、服务端 Reader 变更等未提交内容；本轮保留，未提交或推送。不要把整个脏工作区归为本功能独占修改。

## 9. 尚未完成及真人验收步骤

尚未完成或未验证：

1. 未在真人开发版界面操作完整选择文件、取消、Finder 与跨设备流程；未运行打包安装版。
2. 未做真实 Electron IPC 到 Main 的取消 E2E。原生保存对话框取消与实际活动快照取消应在开发版验收。
3. 当备份来源 ID 在新电脑重新导入后变化，目前没有显式重绑向导；词汇及原始来源引用会保留，但自动关联不作保证。
4. 非兼容字段/记录按严格 schema 拒绝整个文件；目前不提供部分接受或逐条兼容记录计数。
5. 未在真实外置盘、满盘、卷卸载/重新挂载和 macOS 文件权限变化场景真人验收。

真人验收建议（先使用合成词汇或专门隔离 userData）：

1. 打开设置中的数据管理，确认只看到“词汇备份与恢复”，词汇数正确。
2. 备份含词组、用户中文说明、多个语境释义、词性、例句和复习状态的测试词汇；确认文件名、SHA-256、Finder 定位和文件大小。
3. 确认保存目录中没有 EPUB 或其他原始内容；用文本查看 JSON 的 `exclusions` 和三个数据集合。
4. 在另一隔离 userData 选择该 JSON，检查来源、计数、冲突预览，再确认合并；确认词汇数据能显示。
5. 重复导入，确认不重复添加相同 occurrence、不增加复习次数；本机笔记和熟悉度冲突应保留本机值。
6. 使用错误版本或破坏 SHA-256 的复制文件，确认被拒绝且本机词汇不变。
7. 在快照阶段取消，确认显示“已取消”；若在 Finder 保存对话框中取消，确认不产生文件。
8. 使用备份中不存在的来源记录验证“来源缺失”提示和“前往书库重新导入”按钮。更换新来源 ID 的重绑流程仍需单独评估。

只有这些真人验收完成后，才能报告开发版体验通过；当前报告不代表 0.1.14 发布就绪。
