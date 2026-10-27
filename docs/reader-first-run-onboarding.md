# Vantilo Reader — 首次安装与本地模型配置（2026-10-26）

## 用户目标与发布验收标准

面向**一台未安装 Python/MLX、未下载 Qwen、也没有开发者本地路径的普通 Mac**，而非当前开发机的已安装环境。首次启动必须有可跳过的首次使用引导；以后能从界面重新进入。不得以“模型文件存在”替代“可用本地 AI”的判定；不得以打开外部下载网页冒充应用内下载安装完成。

### 第一屏：macOS 系统词典

- 使用 Vantilo 自己打包的 Dictionary Services helper，对固定、安全的单词（例如 `apple`）做真实查询；报告**有中英词典结果、只有英文、没有可用结果、辅助程序不可用**，不从“macOS 版本支持词典”推测一定就绪。
- 对只有英文结果的用户解释：打开 macOS「词典」App → 菜单「词典」→「设置」，勾选所需的英汉词典并等待系统完成下载；然后回到 Vantilo 点击「重新检测」。**系统词典由 macOS 管理，不由 Vantilo 替用户下载。** 参见 Apple 官方使用说明：https://support.apple.com/guide/dictionary/dic34880/mac 。
- 英语学习者也可以选择只用英语词典、暂时跳过；不能阻止进入 Agent 工作台或打开本地 EPUB。

### 第二屏：本地 AI 模型（Qwen，始终明确为可选）

- 默认不启动任何下载或长期运行服务。清楚解释“模型权重”和“推理运行时”是两件事：模型可下载并不意味着 Reader 已能调用。硬件检测至少报告 Apple Silicon/Intel 架构和物理内存大小，但**不能仅根据这两项宣布性能/兼容性合格**。
- 用户手动确认之后，才允许在应用里下载受支持模型；模型列表、模型版本、量化格式、授权声明和来源需要以可信的版本化清单管理；第一版候选参考 `mlx-community/Qwen3.5-4B-MLX-4bit` 的模型卡（约 2.9GB，Apache-2.0；仍需确认当前 Vantilo 推理后端与该格式兼容）：https://huggingface.co/mlx-community/Qwen3.5-4B-MLX-4bit 。
- 发布版模型下载管理器必须具备：明确的磁盘需求/额外空间、可见进度、取消、断点续传、完整性校验、分阶段临时目录、原子完成标记、失败后可重试和清理、离线提示、可预选安装目录以及安装/卸载与版本升级策略。模型放置在应用持久数据目录，而非安装包内或 Git 仓库；禁止默认公网监听。
- 需要**随应用交付真实的本机推理运行时**（MLX 原生/捆绑 Python 组件或经过批准的独立服务方案）。不得依赖开发机的本地 Qwen 项目、其虚拟环境、`.env` 或私有模型目录。也不要求用户打开 Terminal。
- 模型就绪判定必须包括：权重校验通过、运行时存在且兼容、本机安全启动成功、对固定合成英文例句的短语境释义推理成功、受控主进程/隔离服务调用正常；必要时验证 RAM/磁盘与系统版本；并验证没有泄漏本地密钥。未通过只能显示“需要处理”，不能标记“已配置”。

### 第三屏：真实验证与完成

- 分别显示「系统词典」「本地 AI」「Codex 登录」的状态。后两者不应该成为阅读 EPUB 的强制门槛。
- 用户可以「稍后再设置」「继续使用」，记录引导版本和跳过状态；支持从 Reader 或设置页面重开向导、换设备后重新探测，不把旧设备健康状态复制到新 Mac。
- 免费离线基础词典仍可用；若用户登录 ChatGPT，复杂语境可继续走现有 Codex；本地 Qwen 是**可选**的快速语境解释通道，未经真实 UI 验收不得改为默认或替换生产 Provider。

## 当前代码状态与阶段划分

2026-10-26 源码审查：`electron/reader-system-dictionary.cjs` 已有可用 Dictionary Services helper；`electron/portable-reader-service.cjs` 经 `reader-ai-gateway` 调用 Codex Runtime；`scripts/benchmark-reader-qwen.py` 仅使用本机独立 `local-qwen-api` 进行基准测试。**Vantilo 尚无可分发的本地 Qwen 推理运行时、受控本地 Qwen Provider 或应用内下载管理器**。因此不能仅添加一个“下载成功”按钮就宣称首次安装支持完整离线 AI。

阶段 A（本次）：完成引导信息架构、实际词典可用性检测、跳过/重新打开与明确的本地模型准备状态；官方模型页面仅可作为**查看模型详情**，不能称为应用内安装。

阶段 B（需后续单独实施/验收）：明确打包推理后端、模型分发与校验清单；完成用户触发下载/暂停取消/断点续传/安全清理与真实推理健康检查；在干净 macOS 用户目录里实际完成零命令下载、推理、阅读点词测试，随后才能将“安装本地模型”按钮启用。

阶段 C：在独立 Reader 本地 Provider 选择器中提供「系统词典 + 本地 Qwen 快速释义 + 按需 Codex 深入解释」，保留模型来源与缓存版本；测试模型升级/删除/无网络/低磁盘/Intel Mac/失败降级。用户真实 UI 验收后再考虑默认策略。

## 冷启动验收（不得只使用当前 Mac 的现成模型环境）

1. 隔离的**空白** Electron userData 首次启动显示引导；无任何模型文件也能进入工作台和 Reader。
2. 词典可用时显示真实查询结果；关闭系统英汉词典后显示「只有英文」，打开并下载词典后能重新检测。
3. ARM Mac 与不满足要求的设备显示不同提示，但均可跳过；Intel 不被诱导下载不兼容的 MLX 模型。
4. 本地无 Python/MLX、无模型时，绝不显示「模型已就绪」；模型文件存在但推理运行时故障时也不得显示就绪。
5. 下载开始必须用户明确点击；用户取消、断网、磁盘不足、重启后可恢复或安全重试，校验失败不能启用模型；新版本升级不会覆盖/删除用户资料。
6. 独立模型首次合成句运行通过才可显示“就绪”；实际点词到结果可见的耗时另测，禁止用 MLX 直接生成耗时冒充 UI 耗时。
7. 已完成引导后重启不重复弹出；可在 Reader/设置中重新进入并重新探测，所有跳过状态可重置用于测试。
8. 不使用私人 EPUB、API 密钥或开发机路径完成首次安装验收；无真实 Codex E2E、无模型自动下载、无 Git 提交推送。

## 2026-10-26 阶段 A 真实验证记录

- 新增 `electron/reader-onboarding.cjs`：将首次选择写入 Electron userData 下 0600 文件，不把开发机模型路径当作就绪证据；`check()` 通过 macOS Dictionary Services helper 查询固定词 `apple`；硬件来自当前 Mac 物理架构和内存。
- 新增可跳过的首次使用界面 `src/ui/reader-onboarding.tsx`，并接到 Vantilo 主界面。Reader 顶部提供「阅读环境设置」入口以便日后重新检测。
- **阶段 A 不提供任何模型下载/启动功能**：官方 Qwen 页面按钮明确标识「模型详情（非安装）」，本地 AI 状态标识「应用内安装尚未开放」。
- 使用 `npm run test:reader:first-run` 对**隔离的全新 Electron 用户数据目录**执行真实浏览器/预加载层烟测，不启动 Codex，不读私人 EPUB 或已有模型：首次弹出引导、真实系统词典探测结果「已检测到中文释义」、跳过后记录状态、同用户目录重新加载不再弹出，全部通过。
- 阶段 A 的新单元测试及既有全量测试：`npm test` **269/269 PASS**；`npm run typecheck` 与 `npm run build` 均 PASS。尚未执行正式 macOS 安装包分发/签名验证，完整模型下载与首次推理**尚未实现/未测试**。

## 隔离的可视化验收应用（2026-10-26）

**当前已准备并在 Mac 上实际启动：**

`out/reader-setup-preview/Vantilo Reader Setup Preview-darwin-arm64/Vantilo Reader Setup Preview.app`

- Bundle ID：`com.vantilo.desktop.reader-setup-preview`；隔离数据目录：`~/Library/Application Support/Vantilo Reader Setup Preview`，没有覆盖正式版 Vantilo 的数据目录、名称或安装包。
- Reader API/Web 端口专用 `5184/5185`，不抢正式版的 `5174/5175`。底层渲染使用正式生产 Vantilo 的 React 构建和 Reader 代码，仅对**预览分发副本**应用端口变更及新刊同步禁用；正式项目源码的服务端口不变。
- 包内只有 `tests/fixtures/minimal-magazine.epub` 改名后的一份**原创合成测试 EPUB**。从 `build/reader` 只复制 `web`、`api.cjs`、`codex`、`codex-code-mode-host`、`native` 和来源说明文件；**没有复制**私人 `build/reader/seed`（30 本实际书刊、335 MB）及任何 `ai-bench`。模型未下载，下载功能仍不可用。
- `npm run package:reader:preview` 使用已有编译产物生成该 .app；`npm run test:reader:preview` 通过 Electron utilityProcess，从**实际打包后的 Reader 服务**读到了 UI 和健康 API，在独立临时用户书库只导入上述合成 EPUB，**没有产生网络请求**，通过。测试后临时目录清除。
- 首次打开后应显示「准备你的阅读环境」。建议依次验收：词典状态 → 打开系统「词典」→ 返回「重新检测」→ 「本地 AI 尚未开放」 → 「稍后设置」→ 切换左侧「阅读」→ 右上角「阅读环境设置」→ 「进入 Vantilo」→ 重新打开预览不应再次主动弹窗。
- 该预览 `.app` **未经开发者签名、公证和对外分发 QA**，不可作为普通用户正式安装包。安装版的完整下载/Qwen 推理、ChatGPT 登录和 Codex E2E 仍未验收。
- 已知旧验收脚本 `scripts/verify-packaged-reader.cjs` 仍要求 `/api/prep/auth` 返回 404，与当前统一 Reader 登录桥接不相符，因此它在此轮运行失败。**未为通过旧断言而删除现有接口或降低测试要求**；专门的隔离预览服务检测独立通过。这项旧脚本断言应另行对照接口契约更新。

## 关键产品原则

**引导必须能真实检查现状，未来完整发布必须能真实完成下载与推理。** 未完成功能显式标注，不通过伪造状态或依赖开发环境掩盖发布缺口。Mac Dictionary 的设置归操作系统管理，Vantilo 做检测和指导；Qwen 下载与使用才属于后续由 Vantilo 接管的安装流程。
