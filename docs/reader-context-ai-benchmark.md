# Vantilo Reader 语境释义：本机 AI 实测（2026-10-26）

## 测试范围及结论

这是独立性能与内容质量实验，**没有将任何模型切换到 Vantilo 生产 Reader 中，也没有读取用户 EPUB、Codex 凭据、API Key 或执行真实 Codex E2E**。原版 Magazine Reader 和本地 Qwen API 项目均作为只读来源。

本机：Mac mini M4 / 16 GB / macOS 27.0.1 (arm64)。

| 推理路径 | 环境检测 | 实测结果 |
|---|---|---|
| **Qwen3.5 4B MLX 4bit** | 已存在模型、运行环境 | 20/20 成功；平均 **845.9 ms**；中位 **824.1 ms**；最小 **758.3 ms**；最大 **1088.0 ms**；加载 **3075.1 ms** |
| Qwen MLX direct streaming（不同调用方式，仅测 5 题） | MLX `stream_generate` 可运行 | 首 token 中位 **434.0 ms**，完整生成中位 **834.4 ms**，加载 **2190.5 ms** |
| Apple Foundation Models | 原生 Swift 检测 | `SystemLanguageModel.default.availability = unavailable(deviceNotEligible)`，**未运行推理** |
| Ollama + Qwen | Ollama 无安装/无运行进程 | **NOT RUN**；没有必要另下模型，本机已有 Qwen 推理项目 |
| Codex Reader AgentRuntime | 内置 CLI 二进制存在、正式入口需要独立登录 | **NOT RUN**；没有获许可创建真实 Codex 线程，未做伪造对比 |

**注意**：本机 Qwen 20 题指标是 `mlx_lm.generate` **完整答案**耗时，不是 Vantilo 完整用户点击到 UI 显示耗时。它没有包含 Reader 页面渲染、进程消息、服务排队、登录等时间；Codex 没有同条件结果，**不能给出“比 Codex 快 X 倍”的数字**。

## 使用的现有资源（没有下载或安装）

以下路径是占位环境变量：如需复现实验，请自行把 `VANTILO_LOCAL_QWEN_ROOT` 和 `VANTILO_QWEN_MODEL` 设置为已有环境及模型的绝对路径。实验不会自行下载模型。

- 已存在的本地量化模型：`${VANTILO_QWEN_MODEL}`（权重约 2.8 GiB，`model_type=qwen3_5`，MLX 4-bit）。
- 已存在 Python 环境：`${VANTILO_LOCAL_QWEN_ROOT}/.venv/bin/python`（Python 3.11、MLX、`mlx_lm`）。
- 原来的代码：`${VANTILO_LOCAL_QWEN_ROOT}/app/model_runtime.py`；脚本通过现有类 `ModelRuntime` 加载并生成，**不读取 `.env`、不启动监听端口、不调用 HTTP 云端**。
- 现有服务的 `/v1/chat/completions` 与 `/v1/responses` **不支持 `stream=true`**。单独的 stream_generate 测试只是证明技术潜力，不能推定现有 API 已具备首字流式交付能力。

## 20 组语境实验（人工粗略判读）

统一测试提示要求：目标单词的 2–8 字中文义项 + 不超过 25 字依据；`temperature=0`、`max_tokens=85`、关闭 thinking；每题使用**自编短句**，从未使用私人电子书内容。

| 序号 | 词语及语境简述 | 参考义 | Qwen 输出释义 | 判读 |
|---:|---|---|---|---|
| 1 | imposed a curfew | 实施 | 强加的 | 不准确（词性不对） |
| 2 | café did not charge | 收费 | 收费 | 合适 |
| 3 | soldiers charge | 冲锋 | 冲锋 | 合适 |
| 4 | special issue of magazine | 期／特刊 | 特刊 | 合适 |
| 5 | issue a correction | 发布 | 发布 | 合适 |
| 6 | dog bark | 吠叫 | 吠叫 | 合适 |
| 7 | tree's bark | 树皮 | 树皮 | 合适 |
| 8 | charity runs a library | 运营 | 经营 | 合适 |
| 9 | software can run | 运行 | 运行 | 合适 |
| 10 | after a long break | 休息 | 休息 | 合适 |
| 11 | bag was light | 轻 | 轻的 | 合适 |
| 12 | room was lit | 照亮 | 照亮 | 合适 |
| 13 | first draft | 草稿 | 初稿 | 合适 |
| 14 | cold draft | 气流 | 冷风 | 合适 |
| 15 | plants can bear heat | 承受 | 经受 | 合适 |
| 16 | muddy football pitch | 足球场 | 场地 | 大体合适，但不够具体 |
| 17 | pitch to investors | 推介 | 简短介绍 | 合适 |
| 18 | parking fine | 罚款 | 罚款 | 合适 |
| 19 | in this case | 情况 | 情况 | 合适 |
| 20 | set a deadline | 设定 | 设定 | 合适 |

**粗略判读：19/20 语境方向基本合理，其中 1 题解释不准确，1 题略宽泛。** 这是少量人工审阅的合成例题表现，不能将其视为大规模质量评测或与 Codex 的公平准确率比较；较长句、俚语、多义隐喻、复杂语法和教育场景仍待测试。

第一轮 5 题另测得到：首次加载 3309.8ms；首题生成 2882.3ms（初次生成预热）；其余分别 844.9、929.5、843.0、781.4ms。第二轮 20 题加载 3075.1ms，首题 1088.0ms；表明**冷加载与首次生成需单独考虑，长驻服务可以避免每次加载模型的延迟**。

Direct MLX streaming 5 题：首 token 731.0/434.0/436.7/433.1/434.0ms，中位 434.0ms；完整生成 1107.3/841.1/788.7/834.4/784.3ms。这是独立 MLX stream generator，**不等于实际 Reader 页面现在能流式展示**。

## 推荐的下一阶段（尚未实现）

1. **优先验证本机 Qwen 作为语境释义可选通道**。它只承担当前句子+单词的短结构化解释；macOS 词典即时显示仍不依赖任何模型。复杂阅读问答、文章分析仍由 Codex 完成。
2. 首先使用用户现有的 `local-qwen-api` OpenAI-compatible 本机服务，通过 Vantilo 主进程受控代理，避免从 Reader iframe 直接获取/API Key 或请求任意 URL。必须校验本机回环地址、限制接口与 payload、统一超时/取消，并将模型未运行视为清晰的“不在线”；不要自动启动公网服务、读其他项目 `.env` 或把 API 密钥写进 Vantilo 日志。
3. 当前服务不支持 streaming；可以先采用一次性结构化回复（中位约 0.8 秒，仅推理部分），有需要再给该服务增加独立、经授权的流式接口。**不能擅自修改 local-qwen-api 受保护配置或启动长期服务**。
4. 语境解释缓存仍保留；按文档/段落/词位置区分，同词异义不能错误复用。若 Qwen 输出无效、语义不明或与本机词典不符，应提示人工校正或显式使用 Codex，不自动重复消耗模型请求。
5. 真正开启 Qwen 通道前，先用真实 UI 隔离回归测量“点词到释义可见”的耗时。让用户在体验与质量上自行验收后，再考虑把 Qwen 设为默认轻量通道。

## 可复现命令（需在 Vantilo 工作区执行）

```bash
# 仅生成自编测试样本，不读取用户 EPUB。
mkdir -p build/reader/ai-bench
PATH=/opt/homebrew/bin:$PATH node --input-type=module -e \
  'import {READER_AI_CASES} from "./scripts/reader-ai-benchmark-cases.mjs"; import {writeFileSync} from "node:fs"; writeFileSync("build/reader/ai-bench/cases.json", JSON.stringify(READER_AI_CASES,null,2));'

# 复用已经安装的 MLX 环境和模型（只读），生成 20 项本机基准。
${VANTILO_LOCAL_QWEN_ROOT}/.venv/bin/python scripts/benchmark-reader-qwen.py \
  --runtime-root ${VANTILO_LOCAL_QWEN_ROOT} \
  --model ${VANTILO_QWEN_MODEL} \
  --cases build/reader/ai-bench/cases.json \
  --output build/reader/ai-bench/qwen-20.json --limit 20

# 可选：独立 direct-MLX TTFT 测试（不是现有 HTTP API）。
${VANTILO_LOCAL_QWEN_ROOT}/.venv/bin/python scripts/benchmark-reader-qwen-stream.py \
  --runtime-root ${VANTILO_LOCAL_QWEN_ROOT} \
  --model ${VANTILO_QWEN_MODEL} \
  --cases build/reader/ai-bench/cases.json \
  --output build/reader/ai-bench/qwen-ttft-5.json --limit 5
```

完整单次测试原始数值与模型回答存储在 Git 忽略的 `build/reader/ai-bench/`，不要将这些结果误标为 Codex 对照组。性能依赖温度、后台负载、模型预热、max_tokens、实际请求格式和 macOS 内存压力。

**Git 状态**：仅增加独立基准脚本、合成测试样本及本文档；不暂存/commit/push，不改原版 Reader、local-qwen-api 或原书籍资料。


## 补测：接近 Reader 实际完整 JSON 语境格式

先检查了原 Reader `src/server/services/word-context-service.ts` 的实际响应契约：**不仅要返回中文含义，还要求 meaningZh、explanationZh、meaningEn、explanationEn、examplesEn（至少两个字符串的数组）、partOfSpeech**，部分一致性校验还要求整句翻译。**这个契约比前面的“一行中文释义”长得多**，两种任务耗时不能混为一谈。以下测试仅使用短句模拟主要字段，并未覆盖上下文前后段落、整句翻译、UI 渲染与全部实际 JSON 校验。

| 测试方式（5 题） | 有效完整结构 | 完整生成中位 | 平均 | 最慢 |
|---|---:|---:|---:|---:|
| 初版提示，只罗列字段 | **1/5** | **3521.6 ms** | 3860.8 ms | 5137.9 ms |
| 强化提示：展示示例 JSON，明确 examplesEn 必须是两个元素的数组 | **4/5** | **2898.2 ms** | 3027.5 ms | 3451.1 ms |

初版的主要失败是 4 道题将 `examplesEn` 输出为带换行的**字符串**，而非 Reader 要求的字符串数组。强化提示后剩余失败例的中文义项仍正确，但 JSON **缺少必填的 `partOfSpeech`**。这说明即使内容基本合理，也**不能将未经验证的 Qwen 原始 JSON 直接存储为 Reader 完整语境结果**。

强化提示下 `imposed` 的核心中文含义修正为「强制实施」，这也说明输出质量对任务描述和示例格式敏感。5 题不足以证明更广泛的结构合格率，正式集成前仍需校验、自动重试上限或确定性的安全降级策略。

**推荐顺序**：先给 Vantilo 单词弹窗增加可选的 `Qwen quick gloss`（短释义、约 0.8 秒模型计算，实际 UI 往返另测），保留原 Codex 深入双语解释；若未来想由 Qwen 生成完整 JSON，必须在本机服务的受控边界增加 Reader schema 检验和合理的失败处理。不要把 0.8 秒简短输出当成完整双语解释的响应速度，后者此批约 2.9–3.5 秒。

### 额外可复现命令

```bash
${VANTILO_LOCAL_QWEN_ROOT}/.venv/bin/python -B scripts/benchmark-reader-qwen.py \
  --runtime-root ${VANTILO_LOCAL_QWEN_ROOT} \
  --model ${VANTILO_QWEN_MODEL} \
  --cases build/reader/ai-bench/cases.json \
  --output build/reader/ai-bench/qwen-reader-json-strict-5.json \
  --limit 5 --task reader-json
```


## 2026-10-26 完整六字段 JSON：20 题实测（本轮）

本轮在同一台 Mac mini M4 上直接复用现有 `local-qwen-api/.venv` 和已安装的 Qwen3.5 4B MLX 4bit 权重；没有调用云端、Codex E2E、HTTP 服务或私人 EPUB。首次生成前修复基准脚本的两处**统计可靠性**问题：不再将超出 500 字符的答案截断后才解析；严格检查 `examplesEn` 元素确实是非空字符串，并分别记录 JSON 解析状态、结构问题及 token 上限是否触及。提示词、温度 0、JSON `max_tokens=270` 没有变化。输出：`build/reader/ai-bench/qwen-reader-json-20.json`（Git 忽略）。

| 项目 | 本轮结果 |
|---|---:|
| 推理完成，无 Python 运行异常 | 20 / 20 |
| 严格 JSON 解析成功 | 16 / 20（80%） |
| 六字段及至少两条非空字符串例句通过结构校验 | 16 / 20（80%） |
| 模型加载耗时 | 3534.5 ms |
| 生成平均 / 中位 | 3093.6 / 3095.0 ms |
| 最快 / 最慢 | 2654.1 / 3635.2 ms |
| 达到 270-token 输出上限 | 0 / 20 |
| 简短中文释义旧批次中位（不同运行） | 824.1 ms |

**四个结构失败样本（未见 token 上限耗尽）**：#4 `issue`（特刊）：遗漏 `partOfSpeech`，末尾还出现多余反引号；#7 `bark`（树皮）：`examplesEn` 数组闭合错误，导致后面的词性字段没有成为有效 JSON 属性；#14 `draft`（冷风）：缺少结尾右花括号及 `partOfSpeech`；#18 `fine`（罚款）：数组括号缺失、混入第三条例句，字段边界错误。即使宽容去除外层无关字符，也无法满足当前 Reader 的全部必填项。

**人工内容检查**：20 题的中文核心义项大体契合句子；`imposed` 已正确表述为「强制实施」；`pitch`（足球场）仍只写「场地」，略泛化。不能把这当作经过独立标注的准确率。部分**结构合格**的输出依然有不自然或错误例句，例如 #6 `bark`（狗叫）例句把猫写成会 bark，#16 `pitch` 的两条例句把赛马和网球场称作 pitch，不能当作适合学习者的优质范例；#6 的英文定义 `to bark` 还有循环定义问题。形式校验通过不等于教学质量通过。

**使用边界**：本次只有简短合成句、六字段 JSON；未覆盖原 Reader 的段落上下文、`verifyConsistency` 时额外必填的 `sentenceTranslationZh`、实际 Adapter/HTTP、UI 点词往返、并发/缓存效果、长期稳定性、真实书刊难句或与 Codex 的同题实验。时间数字是 **ModelRuntime.generate 完整输出**，不应宣称是 UI 首字可见时间。服务冷启动还要加模型加载，单次最初等待可能明显更长。

**建议及决策**：默认维持 macOS Dictionary 本机词典即时展示；如后续获授权，为 Reader 增加受控的**可选 Qwen 快速中文语境义项**（现有短释义基准约 0.8 秒、中位仅模型计算），复用位置级缓存；保留 Codex 作为用户显式调用的深入双语解释。不要把六字段 Qwen 输出直接接入生产或直接缓存为可靠词汇卡。若将来试验六字段 Qwen，应先在隔离代理做严格 schema/例句核验和确定性降级，并开展更大且有人工标注的真实语境质量测试。此次**没有修改 Vantilo 生产 Provider，也未改原版 magazine-reader、local-qwen-api、用户 EPUB 或提交推送 Git**。
