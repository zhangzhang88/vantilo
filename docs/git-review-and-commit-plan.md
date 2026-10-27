# Vantilo 未提交改动审查与 Git 整理计划

审查日期：2026-10-26。工作分支 `main`，审查时 HEAD `cd60d7a`（领先 `origin/main` 1 个历史提交）。本文件仅记录整理决策：**尚未暂存、提交、推送、清理或重置任何项目文件**。

## 1. 当前工作区基线

- `git diff --stat`：43 个已跟踪文件（37 修改、6 删除），合计约 1,647 行新增、757 行删除。
- `git ls-files -o --exclude-standard`：48 个未跟踪文件，主要是 Electron Reader 服务、构建适配器、测试与文档；大小合计约 240 KB。
- `git status --short`：91 个条目。不存在冲突或已暂存改动。
- `git diff --check`：通过。此检查不覆盖新增的未跟踪文件。
- `.gitignore` 排除 `node_modules/`、`dist/`、`build/`、`out/`、本地凭据、`*.log` 等。检查时 `build` 约 887 MB、`out` 约 503 MB；它们**不是**待提交产物。
- 变更路径筛查没有发现以密钥、私有配置或真实 EPUB 为名的待提交文件；对常见密钥特征的粗略内容扫描未命中。此筛查不能替代完整的凭据与许可审查。
- 原 `magazine-reader` 仓库保持只读，原有 `src/frontend/book-detail-content.css` 修改保持不变。

## 2. 功能审查分组（**分组不等于可以直接按文件提交**）

### A. 移除通用浏览器与整理 Electron 顶部布局

独立为主的删除：`electron/isolated-web-tabs.cjs`、`electron/web-navigation-policy.cjs`、`src/model/browser-address.ts`、`src/ui/isolated-browser-surface.tsx`、`tests/browser-policy.test.ts`、`tests/browser-tabs.test.ts`。

相关实现/样式：`src/ui/workspace-tabs.tsx`、`src/ui/conversation-message.tsx`、`src/ui/markdown-view.tsx`、`src/ui/conversation.css`、`src/style.css`、`licenses/Adobe-React-Spectrum/NOTICE.md`、`docs/independent-ui-reimplementation.md`、`tests/markdown-view.test.tsx`。

**与 B/C 组冲突的共享文件**：`electron/main.cjs`、`electron/preload.cjs`、`src/main.tsx`、`src/ui/main-navigation.tsx`、`index.html`、`tests/ipc-security.test.ts`、`README.md`。

### B. Magazine Reader 的本机服务、页面与期刊资料源

主要新增：`electron/portable-reader-entry.cjs`、`electron/portable-reader-service.cjs`、`electron/portable-reader-supervisor.cjs`、`electron/magazine-reader-navigation.cjs`、`electron/magazine-github-fetch.cjs`、`electron/magazine-sync-controller.cjs`、`electron/reader-library-seed.cjs`、`src/ui/magazine-reader-module.tsx`、`src/ui/magazine-reader-module.css`、`src/model/reader-context.ts`。

对应测试：`tests/portable-reader-integration.test.ts`、`tests/portable-reader-supervisor.test.ts`、`tests/magazine-sync.test.ts`、`tests/reader-library-seed.test.ts`、`tests/magazine-reader-module.test.tsx`、`tests/magazine-reader-app.test.tsx`、`tests/magazine-reader-navigation.test.ts`、`tests/reader-context.test.ts`、`tests/fixtures/minimal-magazine.epub` 等。

旧版源项目启动模式审查完成：已移除未跟随正式执行路径的 `electron/magazine-reader-supervisor.cjs`、`electron/magazine-reader-web.mjs` 和两个旧版专用测试文件。正式版保留 `electron/portable-reader-supervisor.cjs`、`electron/portable-reader-service.cjs` 等模块及其测试。固定 Reader 本机 URL 从导航模块内部定义，不再依赖旧 supervisor。

### C. Agent/Reader 共用 Codex 账户与模型 UI、独立会话和权限边界

已跟踪改动：`electron/codex-driver.cjs`、`electron/runtime.cjs`、`electron/runtime-entry.cjs`、`electron/runtime-protocol.cjs`、`electron/runtime-supervisor.cjs`、`electron/session-store.cjs`、`electron/approval-service.cjs`、`electron/tool-catalog.cjs`、`electron/workspace.cjs`、`src/ui/agent-composer.tsx`、`src/ui/agent-composer.css`、`src/ui/codex-model-picker.tsx`。

新增：`electron/reader-engine.cjs`、`electron/reader-ai-gateway.cjs`、`src/ui/reader-shared-composer.tsx`、`src/ui/reader-shared-composer.css`、`src/ui/codex-model-picker.css`、`src/ui/permission-mode-picker.tsx`、`src/ui/permission-mode-picker.css`，以及关联 Runtime、模型、权限、账户和 Reader 测试。

**当前安全措施**：运行中的 Agent Runtime 使用 `enableWriteTools: false`，写文件工具暂不发布；底层 `writeTextFile` 仍包含未解决的目录替换 TOCTOU 风险，不应通过任意 UI/配置重新启用。Reader AI 超时会发送关联取消请求。

### D. 构建适配、可分发性及合规文档

`scripts/build-reader.mjs`、`scripts/reader-variant.mjs`、`scripts/reader-assistant-adapter.mjs`、`scripts/codex-runtime-assets.mjs`、`scripts/prepare-reader-library.mjs`、`scripts/package-mac.mjs`、`scripts/verify-packaged-reader.cjs`、`scripts/verify-reader-host.cjs`、`scripts/verify-reader-layout.cjs`、`licenses/OpenAI-Codex/*`、`package.json`、`package-lock.json`、`docs/magazine-reader-integration.md`、`docs/implementation-roadmap.md`、`README.md` 及相应测试。

构建输出、Codex 二进制、第三方 Reader 编译包、预置书籍和离线 EPUB 全部位于忽略目录，**不得凭当前本机使用成功就视为可以公开再分发**。Mac 安装包发布流程仍暂停。

## 3. 合并前阻断检查

1. **EPUB 初始资料（已获明确授权，不再是提交阻断项）**：用户确认，原版 Magazine Reader 的期刊和电子书就是 Vantilo 指定的初始阅读资料。`scripts/prepare-reader-library.mjs` 从原项目顶层 `issues/` 和 `books/` 只读复制 EPUB 到 Git 忽略的 `build/reader/seed`，用于本机预置书库；不能复制账户、配置、笔记或其他私人数据，不能更改原仓库或覆盖用户已有书籍。`AGENTS.md` 已明确这一有限例外。此授权支持本机开发与初始书库功能，**不等于已取得对外分发这些 EPUB 的版权许可**；公开安装包的内容授权仍需单独审核。不得擅自清理既有书籍，也不得将 EPUB 加入 Git。
2. **共享文件冲突**：`electron/main.cjs`、`preload.cjs`、`src/main.tsx`、`README.md`、`package.json`、`index.html` 同时涉及不同功能。若要求多个提交，各共享文件需要按 hunk 精确拆分并验证各中间版本可编译，不能简单 `git add <文件组>`。
3. **旧 Reader 路径（已处理并复测）**：正式启动链路经检查只使用 portable supervisor，旧版 source-supervisor 和 Vite dev-server 文件及两项专属旧测试已经移除。删除后 `npm test`、`npm run build`、隔离 Electron 布局测试与 Reader host 测试全部通过。
4. **真实推理验收**：隔离 Electron UI 和合成模型目录测试已通过；真实 ChatGPT/Codex 登录、推理与 Passage E2E 仍未运行。不能把测试覆盖延伸为真实账号已经验收。
5. **许可及可再分发证据**：第三方包 notices、原 Reader 构建来源及 Codex 可执行文件许可需要在任何公开分发之前单独完成审核。开发使用不等于拥有所有内容的再分发权。

## 4. 推荐提交策略

**当前先形成一个逻辑批次的审查记录，不直接拆暂存区，也不提交。** 四组差异相互依赖；EPUB 本机初始资料的授权范围已经明确，不再阻碍后续开发提交，其他安全/依赖检查仍然适用。提交策略如下：

- 首选：经独立 Code Review 后，以一个有清晰范围和测试记录的整体集成提交保存「移除浏览器 + Reader 模块 + Runtime 边界 + 打包准备」，并在提交信息中说明这是仍需真实账号验收的开发阶段。避免产生无法独立构建的中间提交。
- 若要分成多个可独立回滚的提交：先在隔离临时索引/工作树中按 hunks 生成 A，再逐步生成 B+C、D；每个候选提交必须通过 `npm test`、`npm run build`、`git diff --check` 和关键 Electron fixture。不得在当前脏工作区直接混用 `git add -A` 或 `git reset --hard`。
- 先人工审核 `git diff --cached`、未跟踪新增文件、`git status`、受保护项目状态及许可证与来源清单，然后**另外取得提交/推送授权**。

## 5. 已有验证证据

- 2026-10-26：`npm test`，35 个测试文件、242 项测试全部通过；`npm run build` 通过，保留 JS 大块警告。
- `test:reader:layout`：实际 Electron/Chromium 28 场景 PASS。
- `test:reader:host`：在隔离 profile、临时书库、合成 EPUB/模型目录条件下 PASS，没有真实 Codex 调用和外网请求。
- 本轮 `git diff --check` PASS；未跟踪文件尚待提交时逐个检查。
- 真实用户会话、公开安装包、真实新刊下载及真实账号推理 NOT RUN。

旧 Reader 辅助代码已完成审查和清理。后续优先核验共享文件的提交依赖，再选择最小安全提交方式。EPUB 初始资料属于用户明确要求的本机功能，不再反复询问其用途；公开分发权另行确认。未经许可，不提交、不推送、不删除原项目资料。


## 6. 最终提交候选清单核验（同日补充）

**本节更新前文的历史快照，不代表执行 Git 提交。** 当前 Git 工作区为 44 个已跟踪文件的变更及 46 个未跟踪文件（包含本审查文档），暂存区为 0，HEAD 仍为 `cd60d7a`。历史快照中写的 43/48/91 已因后续整理变化，不应用作当前准确数字。

- 对 `git ls-files -o --exclude-standard` 返回的 46 个未跟踪文件检查，全部合计约 226,766 字节；唯一二进制候选是 **1,867 字节的原创合成 EPUB 测试夹具** `tests/fixtures/minimal-magazine.epub`。通过 ZIP 目录及五个内部条目的内容检查，确认它只含合成文章、结构清单和 EPUB 元数据，没有来自原期刊、用户书库的真实文本。它属于测试资产，可随代码保留。项目规范 `AGENTS.md` 已明文限定这一唯一的“合成测试夹具”例外。
- 46 个未跟踪文件的 UTF-8 文本逐行扫描：没有行尾空白或合并冲突标记。已跟踪文件通过 `git diff --check`。
- 常见凭据字符串特征与路径名称筛查未发现待提交密钥、令牌、数据库或用户配置；这只是静态启发式排查，并不构成绝对的泄漏保证。
- `build/`、`dist/`、`out/`、`node_modules/`、真实初始 EPUB 资料及本机登录配置均保持 Git 忽略，不应使用 `git add -f` 强制加入。若将来进行全局暂存，必须先复查 `git diff --cached --name-status` 与 `git diff --cached --check`。
- 构建脚本把 Reader 原项目源码读入本地的编译产物，并生成许可证与来源哈希清单；第三方 Codex Notice 标示其官方版本和 Apache-2.0 来源。用户允许本地重用 Reader 源码与原 EPUB，但**个人阅读资料尚不允许随公开安装包发行**。公开版打包流程在 `scripts/package-mac.mjs` 先校验 seed 的分发授权清单，个人开发标记会拒绝该流程。
- 当前唯一的产品执行方案是 PortableReaderSupervisor，已清理旧版 Vite/source-supervisor 运行代码和两项历史测试；Reader 导航只允许固定本机来源，未恢复通用浏览器。

### 收尾测试与待办

- 旧版辅助代码删除后已实际运行：`npm test` **33 个文件/228 项全部通过**；`npm run build` **PASS**；隔离 Chromium/Electron 布局 28 项 **PASS**；隔离 Reader host **PASS**；`git diff --check` **PASS**。这些结果比第 5 节较早的 35/242 快照更新；少的 14 项专属旧测试因其测试对象一同删除。
- Vantilo 正式用户账号登录、真实 Codex 推理/Passage E2E、真实 GitHub 新刊下载及对外可分发安装包仍标记 **NOT RUN**，不阻碍保存开发阶段代码，但不应宣称发布验收通过。
- 建议提交前只执行最后一次 Git 暂存区检查，然后在**明确授权提交**后做一个整体开发里程碑提交。由于 Browser/Reader/Agent 三组文件交错，贸然按路径拆分容易产生不可构建的中间 commit。本轮不提交、不推送、不重置，也不触碰原 `magazine-reader` 的未提交 CSS。
