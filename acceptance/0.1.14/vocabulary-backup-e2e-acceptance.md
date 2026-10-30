# Vantilo 0.1.14：词汇备份与恢复自动化端到端验收

日期：2026-10-31（测试进程日志为 UTC，记录时间约 2026-10-30 16:06–16:07 UTC）
状态：开发版与当前源码打包的隔离 macOS 应用 E2E 通过；未生成或验收 Universal 发布 ZIP。

## 1. 执行范围与环境

- 仓库：`<Vantilo 仓库根目录>`；分支 `main`；HEAD `16f38f07c26bcd15e3a47683849b65937ebb9dfc`；`package.json` 仍为 `0.1.13`。未改版本号、未提交、未 Push、未打 Tag、未发布。
- 保留了开始时已有的全部工作区修改。没有操作正式 userData、真实词汇、真实 API Key 或 Keychain。
- Electron 每次启动都使用全新的临时 userData、Downloads 和 HOME；源环境 A 与恢复环境 B 相互独立。只注入合成词汇和合成密钥标记。
- E2E 启动 Vantilo 主窗口、Reader Service 和 Reader iframe；通过真实界面点击进入词汇备份、备份、选择并验证 JSON、确认合并。备份、校验、合并、恢复和回滚均调用真实业务代码与 IPC，没有 mock 这些核心逻辑。
- 仅对系统原生保存对话框使用测试适配器；恢复文件通过真实 Reader 文件输入控件选择合成文件。测试阻断所有外部网络请求，只允许本机回环和应用本地资源。
- Reader 生产资源在新临时目录构建；应用和 Reader 的打包输入均不含 EPUB seed。

## 2. 打包应用及启动证据

为实际应用验收，在通过卷身份检查的 Workspace APFS 外置卷上创建了独立工作副本：

`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.13-vocab-e2e-20261030-1607`

Workspace UUID 为 `2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE`，挂载于 `/Volumes/Workspace` 且可写；构建时可用空间约 862 GiB。副本保留当前分支、HEAD、已修改文件和未跟踪源码；排除 `.runtime`、已有 `build`、历史 `out` 和本机用户数据。依赖从当前工作区按原样复制，未运行依赖安装。

应用生产构建和 Reader 生产构建在该外置副本完成。实际启动的测试应用为：

`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.13-vocab-e2e-20261030-1607/build/vocabulary-backup-e2e-package-20261030160706-eddd5d32/Vantilo Vocabulary E2E-darwin-arm64/Vantilo Vocabulary E2E.app`

应用版本为 `0.1.13`，本机 `arm64`，约 566 MB；使用独立测试 Bundle ID `com.vantilo.desktop.vocabulary-e2e` 和测试启动入口。测试入口只负责指定临时用户目录、阻断外网、适配原生文件对话框，然后载入实际打包的 Electron Main、Preload、生产 Renderer 和 Reader 服务。包内未发现 EPUB 文件。它是当前源码生成的隔离验收 `.app`，**不是正式产品身份的应用包，也不是 Universal ZIP**。打包器对 `.icns` 文件扩展名给出跳过提示；测试包使用 Electron 默认图标，该提示不影响备份恢复功能验收。

开发版 E2E 汇总：
`<隔离临时目录>

打包应用 E2E 汇总：
`<隔离临时目录>

开发版三阶段 Electron 进程 PID：32908、32922、32950。打包应用三阶段 PID：33178、33234、33282。每阶段均写入独立结果 JSON 并以 `PASS` 退出。结束后检查未发现残留的测试应用或 Reader 子进程。

## 3. 实际备份文件与数据比较

开发版生成的真实 JSON：

`<隔离临时目录>

- 文件大小：8,324 字节。
- 备份载荷 SHA-256：`c8cde4bc78e552ee22230725cb8d60ac1b05da123efcd685819d2328484bf1b0`。
- 清单：4 个不同词形、5 条已保存词汇记录、3 条语境释义、2 条复习计划。
- 对生成 JSON 解析、字段、记录数量、SHA-256 和整个支持字段对象进行断言；记录集合与合成输入逐字段一致。

打包应用生成的真实 JSON：

`<隔离临时目录>

- 文件大小：8,324 字节。
- 备份载荷 SHA-256：`e99f0c3389a0e65fd2752cfaaa4943fc113f893b9f65e1b409f4457c3a88611f`。
- 清单与开发版相同；由实际打包应用 Main Process 写出并由业务校验器重新验证。

两份 SHA-256 是格式内对规范化备份载荷计算的摘要，不是独立数字签名。

恢复环境 B 原有 5 条记录，其中包含本机 `bank` 笔记/熟悉度、不同义项、不同来源的 `lucid` 和缺少字符偏移的旧式 `legacy`。合并后实际 localStorage 为 9 条词汇记录、4 条语境记录、2 条复习计划。验收确认：

- 来源与备份记录 ID 不同，但来源、段落、字符偏移和词形匹配的 `bank` 按既定策略合并，保留本机 ID、笔记“本机笔记必须保留。”和熟悉度 5。
- 同词不同义项及不同位置的 `bank` 均保留；复习次数仍为 9，没有重复相加。
- 来自不同书籍 ID 的两个 `lucid` 均保留。
- 两条缺少字符偏移且 ID 不同的 `legacy` 不作猜测性合并，均保留。
- 原书来源缺失时，词汇和来源引用仍保留；不会创建空书籍或删除记录。
- 在真实 Reader UI 再次选择同一备份并确认合并，记录总数和笔记、复习历史均保持不变。
- Electron 完整退出后，以同一隔离 userData 再启动，9 条记录、4 条语境、复习次数 9 均仍存在。

## 4. 敏感信息扫描

在隔离 Reader localStorage 中放置合成标记 `E2E_SYNTHETIC_API_KEY_PLAINTEXT`、`E2E_SYNTHETIC_API_KEY_CIPHERTEXT` 和 `E2E_SYNTHETIC_OAUTH_TOKEN`，通过完整 UI/IPC 备份后扫描 JSON 及序列化内容，三种标记均不存在。备份实现只读取登记的词汇存储键；没有读取真实 Keychain、API 配置或认证信息。

## 5. E2E 异常流程结果

- 取消系统保存对话框：PASS；没有生成文件，Reader 恢复词汇写入。
- 同名备份：PASS；界面显示拒绝覆盖，原文件字节不变。
- 无效 JSON 和被截断文件：PASS；明确拒绝，词汇数据未改变。
- SHA-256 不匹配：PASS；明确拒绝，词汇数据未改变。
- 不支持的备份格式版本：PASS；明确拒绝，词汇数据未改变。
- 取消恢复确认：PASS；确认框返回取消后，三组词汇数据与确认前完全相同。
- 恢复写入中途失败：PASS；在隔离真实 `localStorage` 的语境键写入点注入一次 `QuotaExceededError`，真实事务回滚后逐键比对原数据，PREPARED 日志清理，词汇写入冻结解除。
- 中断恢复启动恢复：PASS；在环境 B 中持久化 `PREPARED` 恢复日志并将词汇键改为空数据后退出 Electron。下一次打包应用启动时，在 Reader 页面加载前恢复原始记录、删除已完成日志，数据逐项仍完整。
- 备份后解除写入冻结：PASS；在备份完成后通过 Reader 实际 localStorage 新增标记并读回成功。

备份期间、恢复期间另一个写入者精确并发发起修改的时序未在 Electron E2E 中单独注入（NOT RUN）；Reader 存储冻结单元测试覆盖冻结键拒绝、解除后恢复写入，27 项词汇备份与冻结定向测试通过。回滚本身再次失败、磁盘满、真实只读卷/不可写目录也未在 Electron E2E 中注入（NOT RUN）；失败时的保留行为有对应的事务与存储单元测试，但这不等同于真实磁盘故障验收。

## 6. 验收矩阵

| # | 场景 | 结果 | 实际证据或边界 |
|---:|---|---|---|
| 1 | 正常备份 | PASS | 开发版及打包应用真实 UI→IPC→Main→JSON 完成 |
| 2 | 单词和词组 | PASS | `bank`、`look after` 等字段逐项验证 |
| 3 | 不同词性/义项 | PASS | 同词不同位置、POS 和含义分别保留 |
| 4 | 中文/英文释义 | PASS | 导出数据逐字段深比较 |
| 5 | 语境释义 | PASS | 3 条备份，合并后 4 条 |
| 6 | 例句和个人说明 | PASS | 例句与 `usageExplanationZh` 完整核对 |
| 7 | 熟悉度与复习记录 | PASS | 本机熟悉度保留；复习次数 9 不重复累加 |
| 8 | 标签/分类 | NOT RUN（当前模型无字段） | 不虚构当前数据结构不存在的标签或分类 |
| 9 | 来源关联/来源缺失 | PASS | 内部来源引用保留；缺失来源不删词、不建空书籍 |
| 10 | API Key 明文排除 | PASS | 合成明文标记不在 JSON 中 |
| 11 | API Key 密文排除 | PASS | 合成密文标记不在 JSON 中 |
| 12 | 损坏 JSON | PASS | 真实 UI 验证拒绝且不改数据 |
| 13 | SHA-256 不匹配 | PASS | 真实 UI 验证拒绝且不改数据 |
| 14 | 同名备份不覆盖 | PASS | 已存在的真实测试文件内容保持不变 |
| 15 | 重复导入幂等 | PASS | 真实 UI 第二次导入后 9 条记录及复习次数不变 |
| 16 | 跨设备词汇记录 ID 不同 | PASS | occurrence 匹配后合并并保留本机 ID |
| 17 | 同词不同义/不同来源 | PASS | `bank` 分义项保留；不同来源的 `lucid` 保留两条 |
| 18 | 旧记录缺少字符位置 | PASS | 两条跨设备 `legacy` 保留，不猜测合并 |
| 19 | 恢复写入失败后的回滚 | PASS | 真实 localStorage 写入点注入失败并逐键核对原值 |
| 20 | 备份期间并发写入尝试 | NOT RUN（Electron E2E） | 专属冻结单元测试通过；未做时序并发注入 |
| 21 | 备份完成后正常写入 | PASS | 完成后实际 localStorage 写入和读取成功 |
| 22 | 取消备份/恢复 | PASS | 保存对话框取消适配器；UI 恢复确认取消 |
| 23 | 不兼容格式版本 | PASS | 真实 UI 拒绝版本 99，数据未改变 |
| 24 | 中断事务启动恢复 | PASS | 打包应用退出后重启，Reader 加载前回滚 PREPARED 数据 |
| 25 | 恢复期间并发写入尝试 | NOT RUN（Electron E2E） | 同步恢复事务与冻结保护有单元测试；未模拟并发任务交错 |
| 26 | 回滚自身再次失败 | NOT RUN（Electron E2E） | 未注入回滚阶段的第二次写失败 |
| 27 | 磁盘满/不可写目录 | NOT RUN（Electron E2E） | 未对系统文件系统制造磁盘或权限故障 |
| 28 | 正式 Universal ZIP 安装验收 | NOT RUN | 本次没有改版本/提交；0.1.13 历史输出目录已存在。只构建并验收了当前源码 arm64 隔离 `.app`，没有生成或覆盖正式 ZIP |

## 7. 测试与构建门禁

- 词汇备份服务及 Reader 备份应用定向测试：11 项通过。
- Reader 词汇备份与存储冻结定向测试：2 个文件、27 项通过。
- 根目录完整测试：85 个文件、578 项通过。
- Reader 离线完整测试（串行）：95 个文件通过、1 个文件跳过；574 项通过、7 项按项目配置跳过。
- `npm run typecheck`：通过。
- `npm run build`：通过；Vite 对超过 500 KB 的 chunk 给出体积提示。
- 独立 Reader 生产构建：通过，输出至 `/private/tmp/vantilo-reader-production-e2e-20261031-final`；未写入或覆盖 `build/reader/seed`。
- 开发版自动化 E2E：通过。
- 当前源码打包应用 E2E：通过，覆盖备份、恢复、异常回滚、重复导入、中断日志恢复和重启持久化。
- `git diff --check`：通过（含根仓库与 Workspace 副本）。
- 首次以受限权限运行根/Reader 集成套件时，本机监听返回 `EPERM`；仅在获准的本机回环网络权限下重跑后，全套通过。Reader 离线测试未访问真实 OAuth/Codex 服务；本轮所有 E2E 网络访问均被阻断。

## 8. 本轮代码和长期规则变更

- 新增隔离 E2E 合成数据、真实 Electron 启动器、UI/IPC 驱动、打包测试应用生成器和打包应用运行器；`package.json` 增加相应 E2E 命令。
- `src/ui/magazine-reader-module.tsx` 修复了真实 E2E 暴露的状态竞态：Main 的备份 Promise 先结束而 `resume` 事件稍后到达时，旧代码过早清除请求 ID，Reader 会丢弃 `resume`，造成词汇存储一直被冻结。现在由 `resume` 事件确认后清除；取消等提前结束路径单独清理。
- `electron/main.cjs` 使保存对话框取消、对话框异常和无效扩展名路径都发送结束状态并恢复 Reader 写入。
- `scripts/reader-data-management.tsx` 增加仅供稳定 UI 定位的测试 ID。
- `AGENTS.md` 第 67 行及 `docs/release/RELEASING.md` 第 96 行明确了可由满足条件的完整自动化 E2E 替代手动 UI 验收的规则，同时保留 Universal、签名、公证、架构及其他独立发布门禁。

## 9. 结论与尚未验证事项

在本次实际运行的开发版和当前源码 arm64 隔离打包 `.app` 上，完整词汇 JSON 备份、跨 userData 合并、损坏/篡改拒绝、写失败回滚、重复导入、PREPARED 中断恢复和退出重启持久化均通过真实 Electron 自动化验收。对这组可自动化的词汇备份用户流程，可以按新规则免除真人重复操作。

这不代表正式 Universal ZIP、Intel 硬件、正式产品 Bundle ID/签名公证或真实用户数据升级已经验收；这些仍是独立门禁。并发写入交错、回滚再次失败和真实文件系统故障还没有 Electron 级注入，按上表保留 NOT RUN。没有创建正式安装包，也没有改动 `out/0.1.13` 历史产物。
