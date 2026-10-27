# Reader 本地 Qwen 安装器 B2：可信文件管理基础（2026-10-26）

## 本轮结论

B1 已在 Mac mini M4 / 16GiB 真实验证 MLX Swift 3.32.3 和 Qwen3.5 4B 4-bit 原生推理。B2 第一轮已经建立独立模型安装器及验证清单，但尚未接入正式界面、Electron IPC、签名原生运行时或生产 Reader Provider。**目前没有可向普通用户宣称的一键安装功能，更不能显示模型已就绪。**

新增三个文件：

- electron/reader-model-manifest.cjs：固定 Hugging Face 的 mlx-community/Qwen3.5-4B-MLX-4bit 版本 32f3e8ecf65426fc3306969496342d504bfa13f3，Apache-2.0，十个精确文件名、字节数和 SHA-256。
- electron/reader-model-installer.cjs：设备和磁盘空间预检、只读本地模型验证、用户同意后安装、可信 HTTPS 下载/有限跳转、Range 断点续传、取消、校验和原子发布、未知文件及符号链接防护、进程锁恢复、无拷贝地引用已存在模型。
- tests/reader-model-installer.test.ts：使用原创极小模拟文件的离线单元测试，没有向 Hugging Face 下载实际模型。

模型来源：https://huggingface.co/mlx-community/Qwen3.5-4B-MLX-4bit/tree/32f3e8ecf65426fc3306969496342d504bfa13f3

官方公开的 3GB 权重 SHA-256：5fb9acd0246866381cf8c5c354c6db1019f6498eec4ccb4f5edcc71ffeacb2db；开发机现有模型十个文件的只读 SHA-256 检查全部通过（累计 3,061,129,077 字节，约 1.5 秒）。没有复制或删除现有 Qwen、没有读取私人 EPUB、没有运行真实 Codex E2E。

## 关键设计约束

- 下载固定提交和固定 SHA-256，不使用浮动 main；用户同意前不创建下载任务。下载器没有向渲染器暴露任意 URL 或网络接口。
- Apple Silicon 最低 8GiB 允许尝试、低于已验证的 16GiB 会明确警告；Intel 和低于 8GiB 拒绝这条 MLX 下载路径。当前新安装文件约 3.06GB，额外保留 2GiB 可用空间。安装/升级和实际硬件性能要求还需进一步验证。
- 使用专用隐藏暂存目录和有限清单；只有文件大小与 SHA-256 全部校验成功，才能原子搬到正式模型文件夹。HTTP 206 严格验证起点、范围和总长；HTTP 200 忽略 Range 时不错误追加；中断留下可续传部分。
- 禁止符号链接与未知暂存文件混入发布模型；同一模型的并发安装使用专用锁，退出遗留锁仅对已不存在的进程做恢复。
- 采用已有模型目录前要由用户确认，并验证全部清单文件；只记录外部引用，不重新下载和拷贝权重。
- 验证通过返回状态 needs-native-runtime-check，**不是 ready**。还必须验证签名版 Swift 推理助手、进程通信、固定合成英文测试和实际 Reader UI，才能视为模型真正就绪。

## 验收与待办

本轮 12/12 小型合成单元测试 PASS；包括磁盘不足、路径安全、损坏哈希、拒绝非可信重定向、取消与续传、服务器忽略 Range、暂存目录意外文件、异常安装锁及无拷贝采用已有文件。线上真实 3GB 下载、Hugging Face Xet/CDN 重定向、复杂网络故障、应用退出/休眠、完整安装包、签名公证、模型卸载和升级未测。

下一阶段：
1. 在 Electron 主进程以受限 IPC 包装以上模块，GUI 提供用户明确确认、安装目录选择、下载进度、取消与重试，Renderer 不能提供任意 URL。
2. 将已验证的 Swift MLX 引擎编译和签名后随安装包分发，并实际运行健康探针；不依赖开发机 Python 虚拟环境。
3. 用隔离空白用户数据进行首次安装到 Reader 点词的完整测试；最后由用户验收。
4. 卸载和版本升级必须明确保护外部用户模型、私人书库及已有数据。

本轮没有开启产品界面的安装按钮、没有下载 3GB 模型、没有清理 build/out、没有修改受保护的原版 Reader 仓库，不提交或推送。

## B2 后续：原生配置隔离预览（2026-10-26）

本页前半部分记录首轮底层安装器的历史状态，以下记录后续实际集成：

- 主进程新增受信任主窗口限定的五个零参数模型 IPC：检查状态、选择已有模型、再次验证、确认下载、取消下载。渲染器无法直接指定本机路径或下载 URL。普通正式版仍保持安装尚未开放；仅独立预览版可操作。
- 服务 electron/reader-model-service.cjs 先校验固定模型哈希，再执行签名尚未完成的本机 Swift MLX 健康探针。精确生成“树皮”才返回 verified-native；这不意味着 Reader 已使用 Qwen。
- 原生程序源码存于 native/qwen-health，锁定 MLX Swift LM 3.32.3。使用 scripts/stage-reader-qwen-health.mjs 将编译程序与 SwiftPM 资源放入 build/reader/native；从该位置和实际打包后的 .app 中均已对已有模型真实离线推理成功，返回“树皮”。
- 新的独立 Vantilo Qwen Setup Preview.app 位于 out/reader-qwen-preview；Bundle ID com.vantilo.desktop.qwen-setup-preview，独立数据目录 ~/Library/Application Support/Vantilo Qwen Setup Preview，Reader 端口 5194/5195。只含一份原创合成 EPUB，不含私人书刊或模型权重，未覆盖已验收的原 Reader Setup Preview。
- 在隔离的临时用户数据目录中验证过：通过文件选择后的 adoptExisting 校验现有十个模型文件、不复制权重、原生 Swift 健康检查返回 verified-native。实际打包版 Electron DOM 与 preload 隔离烟测已通过（执行 npm run test:qwen:preview，不访问网络）；真人视觉与 Finder 选择器仍需用户验收。
- 新增服务层 3 条和 UI 1 条专项测试，项目全量 285/285 PASS，TypeScript 类型检查 PASS。Vitest 排除第三方 SwiftPM .build 测试，但没有移除任何 Vantilo 测试断言。

尚待完成：真实 3GB 下载/CDN Range 网络测试、完整一键安装/卸载/升级、正式代码签名与公证、新 Mac 全新安装测试、Reader 点词 Qwen Provider 与真实 UI 时延。仅作为隔离预览交付，不声明已具备正式分发能力。未提交或推送。

## 2026-10-26 下一轮：模型元数据展示与 Reader 点词实验入口

- 独立 Qwen Setup Preview 模型区现在显示模型名称、来自用户文件夹选择器的绝对路径、最近一次文件 SHA-256 与原生推理健康结果。服务重启后不把仅保存的路径误报为“健康已验证”。
- 原生 Swift 助手新增有限参数的 `--gloss MODEL WORD SENTENCE`（汉字短释义）。在现有本机权重上实际验证 `bark` / `The tree's bark is rough.` → `树皮`；不调用 Python 或云服务。
- Reader 原版仓库未修改；Vantilo 在构建时通过只读 `scripts/reader-variant.mjs` 注入“用 Qwen 解释”按钮。该按钮仅在预览版、本机 Reader 服务检测到已选择模型及原生助手时出现，需要用户主动点击。保持原系统词典与 Agent 释义不变。
- 仅在 Qwen 预览版开启受控的同源 Reader API `GET /api/vantilo-qwen/status` 和 `POST /api/vantilo-qwen/gloss`，限制词语和句子长度、拒绝额外字段、跨站 Origin 及 DNS rebinding。不在正式版开放该路由。Reader 服务采用与 Vantilo 已有端口相同的专用本机边界。
- 真实端到端本机接口实测：临时用户数据目录采用现有权重 → 原生健康检查 → Reader HTTP POST → `HTTP 200` / `树皮`，首次接口请求约 **6.3 秒**；这个速度包含冷启动 Swift 进程，尚未优化为常驻模型。
- 通过既有模型单次推理和打包版 Reader 代理接口验证。因 GitHub 下载超时，不能重新获取 Electron 发行运行时；先前独立 Qwen Preview .app 的原有 Electron 可执行壳未更改，**只通过 rsync 更新包内已经构建并检查过的 Electron/Reader 资源**。旧的已经验收的 Reader Setup Preview 保留，Qwen 预览版没有私人 EPUB（仅一份原始合成 fixture）。
- 固定 Hugging Face 提交的小文件（7,756 字节）真实下载验证失败：Node fetch failed、curl 连接被对端重置；未下载模型权重。真实联网安装/CDN 断点续传**仍未完成验证**，不可标记 PASS。
- `npm test` **289/289 PASS**，`npm run typecheck` PASS，`npm run test:qwen:preview`（实际打包 Electron UI + preload，无网络）PASS，`git diff --check` PASS。
- 仍待用户在 Qwen 预览 App 中通过首次引导选中已有模型后进入 Reader，用原创合成 EPUB 的单词进行实际点击验收；点词完整 UI 延迟也没有声称通过。正式公开分发所需的签名、公证、真实模型下载和升级/卸载仍未完成。不得运行真实 Codex E2E、不得提交推送，亦不得修改原版 Magazine Reader 或个人数据。
## 2026-10-26 16:28：Reader 白屏的真实根因与修复

- 用户发现独立 Qwen 预览版主框架正常，Reader iframe 完全白屏。通过真实 Electron 嵌入调试复现 `ERR_BLOCKED_BY_CSP`；Reader 服务端本身（5195 网页、5194 API）均返回 HTTP 200，独立加载 Reader 时 React 页面渲染正常。
- 根因：预览 .app 的 `dist/index.html` 仍包含 `frame-src http://127.0.0.1:5175;`，而隔离 Qwen 预览使用 `http://127.0.0.1:5195/`。前端 JS 中预览端口替换正确，CSP 源地址遗漏，导致主窗口拒绝嵌入 iframe。
- 修复仅替换 Qwen 预览包（及其 staging）的 CSP 为 `frame-src http://127.0.0.1:5195;`；生产 `dist/index.html` 与已验收的 `Reader Setup Preview.app` 均未修改。并在 `scripts/package-reader-setup-preview.mjs` 内加上受校验的 CSP 端口改写，使以后 Reader 5185/Qwen 5195 各自仅放行自己的本机 Reader origin，不放宽其他来源。
- 修复后由真实 packaged Vantilo 主窗口嵌入 5195 页面：子 iframe 的 React `#root` 长度为 4259，内容包含“期刊 / 电子书 / 词汇 / 阅读空间”，无 CSP 阻断，调试结果 PASS。已在 `npm run test:qwen:preview` 的打包 UI 冒烟中增加 CSP 断言；TypeScript 和 Git 差异检查通过，并已经退出、重新打开 Qwen 预览 .app。
- 尚需用户视觉确认和实际点击合成 EPUB 中单词验证 Qwen 解释；不要把合成测试 EPUB 的书籍少误认为白屏，也不要推断已完成联网 3GB 下载测试。没有下载权重或触碰原版 Reader。
## 2026-10-26 16:54：点词卡片精简（独立 Qwen 预览版）

- 用户确认移除两处显示冗余：快捷键提示条（0、1–4、5、Enter、Esc）和词典释义下方的“小字：macOS 本机词典”来源说明。只修改 Vantilo 自身的 `scripts/reader-variant.mjs` 构建时适配，不修改原版 magazine-reader 文件。
- 保留实际按键事件、`aria-keyshortcuts`、词汇状态圆钮、更多详情、完整词条/例句、自动朗读及美英发音功能，去掉的是冗余提示文字，而不是功能。
- 点词卡片显示顺序调整为“词典释义 → 可选本地 Qwen 语境释义 → 已有成功或用户修改过的 AI 语境结果 → 词汇状态”。原 AI 未得到有效结果时不再渲染失败/加载的整块内容；有效旧语境数据及“更多”页功能仍在，后台旧服务行为未更改。
- 新增专项静态语法与功能契约测试。全量 `npm test` 为 **290/290 PASS**；`npm run typecheck` 和 `git diff --check` PASS。只读原 Reader 前端经 Vite 成功生成新 Reader bundle。
- 已仅覆盖独立 `Vantilo Qwen Setup Preview.app` 中的 `reader/web` 可再生资源（替换时预览进程已关闭），保留该应用的数据目录、原生 MLX 助手、CSP 5195 端口、合成 EPUB，以及旧版 `Reader Setup Preview.app` 和正式 Vantilo。然后重新启动新的 Qwen 预览，等待用户视觉验收。
- **注意：** 该轮未测试真实 Qwen 多轮速度优化；旧 AI 失败原因也未修复（只是避免无意义的红色失败卡片占空间）。用户需要实际在预览版点词确认间距与功能体验。未下载模型、未执行 Codex E2E、未提交或推送。

## 2026-10-26 17:10：本地 Swift MLX 常驻推理（只在 Qwen 预览）

- 把 `native/qwen-health/Sources/VantiloQwenHealth/main.swift` 增加独立的 `--serve MODEL_DIR` JSONL 协议；本地模型仅首次加载一次，此后每个请求建立新的 ChatSession，避免前一个单词的对话上下文污染下一个。原 `--health` / `--gloss` CLI 保留兼容。子进程的标准输出只用于有限 JSONL 请求/结果，不输出私人文本日志；输入单词与句子的限制保持不变。
- 新建 `electron/reader-qwen-worker.cjs`，在 Reader utilityProcess 中**用户首次点击才启动**，无 Python/网络/API Key/任意命令执行；同一时间只处理一个词，响应 ID 必须严格对应。错误响应、超时、意外崩溃会结束进程并使后续请求重新校验。闲置 **3 分钟**自动结束，释放约 3GB MLX 权重相关运行内存。Reader 关闭时主动清理子进程。
- `electron/reader-model-service.cjs` 使用可选 `persistentGloss:true`；正式版和设置窗口仍保持原 `--health` 模式，真正驻留只在 Qwen Preview 的 Reader 服务里启用。意外闲置释放后状态不误报已就绪，下一次需要重新校验。新增 worker 5 项单测与 model service 驻留生命周期 1 项测试。
- 在 Mac M4 16GB 上使用已经安装的真正 Qwen3.5 4B（不复制权重）：独立模型服务初次校验 + 加载约 **4706ms**；连续解释 bark / paragraph / river bank 分别 **329ms / 332ms / 326ms**。
- 真实 Reader 同源 HTTP API 试验：首次含校验/加载 **8318ms**，随后 `bank` **352ms**、`bark` **342ms**。这些是后端实测，不代表应用窗口视觉渲染的端到端时间。
- 使用已验证离线 Swift 版本构建并在 `build/reader/native` 暂存。仅离线重新编译 Qwen Preview 的 `portable-reader-entry.cjs`/服务包（正确保留 API/Web 5194/5195 和禁止杂志同步），之后在关闭应用时有范围地更新独立 Qwen Preview .app 的两个服务包和 native health executable。旧文件备份在 `build/qwen-resident-rollback`；应用界面资源、个人 EPUB、现有模型和原 Reader Setup Preview 均保留，CSP 仍只允许 5195。
- `npm run test:qwen:resident` 是**仅本开发机有效的真实模型/打包 utilityProcess E2E 测试**，需要提前安装上述模型；它使用临时独立 profile，绝不作为生产版无模型条件下的 CI。与普通 `npm test`（合成模型和协议测试）分开。
- 限制：真实 Hugging Face 在线下载/签名公证仍未验收；用户视觉测试和长时间内存/电池消耗监控未完成。正式发行未启用持久 worker，启动界面不会自动加载权重。
## 2026-10-26 17:33：自动 Qwen 语境词义为主 + 正文小中文（用户新验收目标）

- 目标：用户点击一个英文词后 **不再额外点击“用 Qwen 解释”**，默认自动请求所在句子的本地 Qwen 词义；弹窗的**主中文义项**是 Qwen 当前语境释义，macOS 字典解释改为“查看词典释义与例句”的辅助折叠区，不移除字典原文、发音、完整词条、手动编辑、词汇熟悉度和“更多”。
- 在 `scripts/reader-qwen-gloss.tsx` 中按实际单词+句子自动请求同源 Reader API；模型加载中显示提示。前端采用一个请求序列队列，快速切换单词后上一单词完成不得覆盖当前词义；缓存已验证本地语境释义/用户手动修改释义后不再重复联网或推理；模型不可用时明确降级到可展开词典内容。
- 在 Vantilo Reader 源码构建时适配层 `scripts/reader-variant.mjs` 中按词语出现位置保存新模型释义到原有 `WordContextMeaningRecord`，provider 为 `qwen-mlx`（数据兼容检查允许该值），避免把一词多义的特定词义写成全局字典意义。已有显式用户编辑的词义不覆盖；正文里已学习词语的 **小中文** 使用原 Reader 自身的按出现位置缓存与渲染机制，优先呈现语境释义。
- 取消点词即自动发起旧 Agent 语境请求的行为（仅隔离 Qwen 预览版），避免旧 AI 失败/覆盖 Qwen；原来的高级 Agent 功能仍可从“更多”单独使用。**不禁用系统词典、朗读或熟悉度功能。**
- 自动 Qwen 主释义、词典折叠、旧 Agent 自动发起的停用全部**通过显式 `VANTILO_QWEN_READER_PREVIEW=1` 构建开关**控制；正式 Reader 不含实验性自动模型 UI，保持原默认词典与上下文路径。
- 新增模拟客户端测试 `tests/reader-qwen-auto-popup.test.tsx`：自动请求与无按钮、快速切词防陈旧响应/串词、已缓存词义免再次请求及失败降级；适配层测试确认旧版不注入 Qwen、词典和快捷键仍在、语境数据兼容。已重建隔离 Reader web bundle。
- **项目全量测试 300/300 PASS**、TypeScript PASS、打包版预览 UI+preload smoke PASS、`git diff --check` PASS。还需要用户在实际应用中点选不同英文词检查主要释义、已学习词正文小中文和展示节奏；自动推理完整视觉交互未标记为人工通过。

## 2026-10-26 17:52：首次安装引导与 Reader 能力对齐（独立 Qwen 预览）

- 发现原版引导仍写“本地 Qwen 未接入 Reader”，与用户已实测的自动点词和原生 Swift MLX 常驻模型不符。修正 **仅隔离 Qwen Setup Preview** 的引导提示为“已接入 Reader”；其他 Reader Setup Preview 保持“原生验证预览”，正式版继续“安装未开放”。
- 主进程仅当打包预览标志存在且 userData 精确属于 `Vantilo Qwen Setup Preview` 时设置 `readerQwenIntegrated`，并通过这同一条件决定 Reader 是否启用本地推理服务，避免仅凭泛化的 `modelSetupPreview` 意外开启实验性 API。
- 引导区明确区分“已选择模型但本次未验证”“文件 + Swift 原生健康检查通过”“未选择模型”。原生 Reader 在首次点词时自动重新验证；**不得**把保存的外部路径当作推理 ready。磁盘不足时禁用约 3GB 下载动作；点击“开始阅读”会保存引导决定并真正启动 Reader，而不是仅关闭弹窗。
- 新增 2 项首次引导 UI 测试；合计 `npm test` **302/302 PASS**、`npm run typecheck` PASS、`git diff --check` PASS。实际**打包 Electron 渲染器 + preload** 的 `npm run test:qwen:preview` 已验证模型采用状态及单击 Reader 启动，且无外部网络请求。
- `npm run test:qwen:resident` 的实际打包 utilityProcess 本地模型推理再次 PASS：`paragraph` 初次约 4956ms，后续 `bank` 334ms、`bark` 334ms（单次后端 HTTP，非视觉耗时）。
- `npm run build` 后，利用 `scripts/stage-qwen-onboarding-preview.mjs` 离线编译隔离的主进程并仅修改该预览的 CSP / 5175→5195 iframe 端口与禁止杂志同步。实际更新**仅独立 Qwen .app 中的 electron/main.cjs 和 dist/**；旧文件备份在 `build/qwen-onboarding-rollback`。正式 Vantilo、已验收 Reader Setup Preview、独立原版 Magazine Reader 和本地 Qwen 权重不变。
- **安全与发布限制**：未重新签名/公证，没有在全新 Mac 测试安装，不宣称真实 Hugging Face 下载成功；原始 GitHub/CDN 网络阻断仍待网络条件允许时复测。未运行真实 Codex E2E、未提交或推送。
- **磁盘只读审计**：`build/` 约 1.2GB，`out/` 约 1.7GB，`native/qwen-health/.build/` 约 1.3GB，`/System/Volumes/Data` 约剩 13GiB；其中包含仍在使用的 app、Swift 构建缓存、预览 stage 和回退资源，本轮不执行删除。后续需先确认可回退版本和 Apple Swift toolchain 状态，再分批清理且核算 APFS 实际可回收空间。

## 2026-10-26 18:12：Reader 词汇详情去重与 Qwen 语境同步

- 用户在 Qwen 预览版点击 **synthetic → 更多**，指出自动复制的词典定义在“你的释义/中文词典释义”重复、真正的 Qwen 当前语境未显示，而旧 Agent 语境接口显示失败、英文定义和例句出现空提示。
- 根因是 Reader 详情 `WordDetailContent` 读取 `SavedSelection.translationZh`（可能自动来自字典），但从未检查 `translationSource === "user"`；`openActiveWordDetails()` 又因 Qwen 记录不含英文解释而触发旧 Agent 分析，使 `contextStatus:error`；弹窗和详情数据通路不一致。
- 新增 Vantilo **仅 Qwen Preview** `scripts/reader-qwen-detail-adapter.mjs`，基于受校验的上游源码切点（变更上游时构建 fail-closed），不修改原版 `magazine-reader`：详情优先运行/显示按句子和出现位置保存的 Qwen 汉语语境释义，同时显示对应源句；字典/完整例句改为可展开区域；明确仅 `translationSource:user` 才显示“你的释义”，仍支持添加个人释义、修改语境义、美英发音和词汇熟悉度；无内容英文定义、例句与已失败旧 Agent 语境不会占界面；打开详情不再自动执行旧 Agent 语境请求，原数据保留且普通 Reader 分支不变；准确标注“当前语境：本地 Qwen”而非统一 Agent。
- `scripts/reader-dictionary-card.css` 增加独立词汇详情布局规则；未改 Electron IPC、真实 Qwen 权重、用户 EPUB、普通 Vantilo、旧 Reader Setup Preview。
- 新增 **3 项源码适配专项测试**和 **真实 Chromium + 完整 Reader 合成 EPUB 操作烟测** `scripts/verify-reader-qwen-detail-view.cjs`。烟测采用独立临时 userData、单本原创 synthetic fixture、无外网、模拟固定 Qwen 词义，完整自动点击“电子书 → 打开书 → 打开文章 → synthetic → 1 生词 → 更多”，实测详情主释义为 Qwen 的“合成语境义”、自动词典含义不会冒充个人编辑、中文词典处于默认折叠、美英发音按钮仍存在、空英文/旧失败/空例句隐藏。这里的“合成语境义”来自受控测试桩，不是对真实模型准确性的声称。
- `npm test` **305/305 PASS**、`npm run typecheck` PASS、`npm run test:qwen:preview` PASS、`git diff --check` PASS。
- 仅在关闭独立 Qwen Setup Preview 进程后更新该 .app 的 `reader/web`，旧资源暂存 `build/qwen-detail-web-rollback`。原模型、原 Reader 库、旧 Reader Setup Preview、正式 Vantilo 及 Git HEAD 均未改动。用户真实 UI 人工验收仍待进行。

## 2026-10-26 18:26：Qwen 详情词典取消两层折叠，完整词条直接连续展示

- 用户在 `original` 详情指出“查看中文词典释义与完整词条”与“查看完整词条与例句”叠加成双层折叠，要求**默认展开、连成一块**。仅在 Qwen Preview 的 `scripts/reader-qwen-detail-adapter.mjs` 将外层 `details` 改为普通 `section`；将内层 `VantiloDictionaryDisclosure` 替换为直接显示的 `VantiloDictionaryExpanded`。
- 如 macOS 已返回完整词条（`macos-dictionary-full`），省略重复的单行简义；无完整词条时保留简义作为降级。词典、词性、原形、音标、例句仍由原 Dictionary Services 结构化纯文本呈现。同步调整 `scripts/reader-dictionary-card.css` 的详情连续布局，**原 Reader、预览弹窗内的展开逻辑与独立旧版本不变**。
- 更新适配测试；项目 `npm test` **305/305 PASS**，`npm run typecheck`、`npm run test:qwen:preview`、`git diff --check` PASS；重新构建 Reader。
- 在真实 Electron Chromium 的独立 synthetic EPUB E2E (`scripts/verify-reader-qwen-detail-view.cjs`) 逐步点击并验证：完整 `synthetic` macOS 词条直接显示、没有词典折叠节点、没有重复的简义，Qwen 合成测试释义、句子、独立美英发音及词汇状态保留。测试桩释义不可视为真实模型翻译准确性测试。
- 关闭独立 Qwen Preview 后仅更新其 `reader/web` 并在 `build/qwen-expanded-dictionary-rollback` 保存旧资源。原模型与个人 EPUB 不变，未下载或删除文件，未提交/推送。仍待用户窗口视觉验收。
