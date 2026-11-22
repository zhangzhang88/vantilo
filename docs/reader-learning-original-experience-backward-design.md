# 精选英语学习：从原版完整体验倒推备课系统

> 状态：设计与实现约束；**不是已完成改造或验收报告**。2026-11-07 按原版组件和当前 Basic Practice 源码核对。禁止用 UI 壳或合成假字段冒充完整课程。

## 0. 唯一目标

用户要的是**原版两阶段的完整学习体验**，而不只是布局接近：

1. 原版阶段选择、词汇选择/调整、全屏视觉、设置、快捷键、进度和继续/重练。
2. 第一阶段：重点单词的原文挖空、语境中文词义、原句中文译文、可信音标、单词与原句朗读、答错纠正、提示和完成页。
3. 第二阶段：挑选 1–3 个关键原句；按教学意义安排 Anchor / Bridge / Target（每句多步）；每步有自然中文回忆提示、句意与简短语法说明；原版全屏逐词输入、词位锁定、答案提示、朗读与听力模式、完成/续练。
4. 打开练习不能因一个无效 AI 输出永久阻断日常词汇/原句输入；但不能把没有中文教学解释、没有递进结构的“原句默写”标作“完整原版”。
5. 版本与来源身份稳定，不改动已有 AI 教材、15 词草稿、用户进度和音频缓存；不得自动切换用户设置的模型。

当前相关源码：
- UI：`packages/reader/src/frontend/vocabulary-preparation-game.tsx`、`assembly-typing-game.tsx`、`learning-stage-completion.tsx`、`learning-game-settings.tsx`
- 正式教材契约与严格校验：`packages/reader/src/shared/learning-material.ts`
- 原版编写/审核：`packages/reader/src/server/services/learning-material-service.ts`
- 新基础题目：`packages/reader/src/shared/basic-learning.ts`
- 当前“仅套 UI”适配器：`packages/reader/src/frontend/basic-game-adapter.ts`
- 语音：`packages/reader/src/frontend/use-lesson-speech.ts`，`packages/reader/src/server/services/learning-audio-service.ts`，`packages/reader/src/server/app.ts`
- 译文/字典：`packages/reader/src/frontend/sentence-translation-state.ts`，`dictionary-meaning.ts`，`lesson-learning.tsx`
- 进度：`packages/reader/src/frontend/basic-learning.tsx` 和 `learning-state.ts`

## 1. 从画面倒推“每项数据从哪里来”

| 原版画面/行为 | 必需数据 | 唯一可信来源 / 处理者 | 能否无模型生成 |
|---|---|---|---|
| 精选文章标题、英文正文、原书身份 | `bookId/lessonId/sourceFingerprint/english` | 当前 Reader 已保存精选文章 | 能 |
| 重点单词的选择与顺序 | `wordId/sentenceId/start/end/sourceText`、掌握词过滤 | 程序对原文分词；可读旧草稿 **仅复用精确匹配位置**；候选可按词频/内容性排序并让用户调整 | 能；“是否有教学价值”还需验证 |
| 挖空、正确答案、同词出现位置 | `answerText/answerTokens/occurrence` | **只能从当前英文原文编译**；绝不让模型决定答案或位置 | 能 |
| 词义卡 | `meaningZh`（当前词形在此句中的具体含义） | 可信上下文字典、已核验旧教材或单项 AI 语境释义；绑定到词位 | **通常不能**完全无模型/字典保证 |
| 整句中文 | `sentenceMeaningZh` | 对应来源/句子指纹的 Reader 已存译文，缺失时调用用户当前选择的翻译引擎；校对否定、条件和修饰关系 | 需要可信已有译文或模型/人工 |
| IPA | `pronunciation`（匹配原文变形） | 优先可信词典 exact-form；不确定时显示“音标未确认”，不得编造或套用原形 IPA | 不保证 |
| 单词和原句读音 | `audio`、`clipKey`、`voice` | Qwen3-TTS，由**准确英文原文**合成；键为 provider/model/voice/text/format 哈希 | 需要 TTS，但不需要 Codex |
| 重点句的挑选 | `focusSentenceIds` | 有限且可验证的原句 ID；可使用规则排序或 AI 提议，再做来源校验 | 可生成候选，但教学价值需核查 |
| 递进 Anchor / Bridge / Target | 每步源文 `start/end/english`、`kind`、`dependsOn`、`pieces` | 程序编译合法词位/引用；AI/语法规则只提议**语义部件及顺序**；最后一步必须等于原句 | 不能对任意句子保证“既有教学意义又无 AI” |
| 逐步中文回忆提示 | `meaningZh` | 对选定英文步骤单独生成并验证；**不得直接暴露本步英文答案** | 需要可信译注、模型或人工 |
| 分步语法与难度分析 | `explanationZh/assembly.analysisZh` | 由可信教学内容模型/人工生成，检查中文、指代、否定与语法准确性 | 不能对任意句无模型保证 |
| 词块顺序、打字词位 | `tiles/correctOrder/bankOrder/typingTokens` | **程序依据已批准的原文词块跨度计算**；不由模型输出 ID、坐标或乱序 | 能 |
| 进度、复习、设置、计时 | `materialId/materialVersion/wordId/stepId` + user actions | 原版游戏状态机和用户本机存储；不因教学注释或音频变化重置 | 能 |

**关键事实**：当前 `basic-game-adapter.ts` 把 `meaningZh`、`sentenceMeaningZh`、`translationZh`、`analysisZh` 等填成空字符串；第二阶段每句只构造一个无依赖的 `Target`。同时 `use-lesson-speech.ts` 直接排除 `basic-source`；`app.ts` 的学习语音接口又只读取已完成 AI 教材。故现在的“原版 UI”并不是原版完整学习体验。

## 2. 生成流程必须倒过来设计

### A. 先定不变的 ExerciseCore（纯程序、即时可用）

输入是当前 `BookLesson.english` 和来源身份。一次性编译、校验：
- 分句、分词、位置、标点、单词缺口、答案、默认选词和源文哈希；
- 稳定 IDs：按原文锚点派生，不能依赖 AI 第几次请求或中文解释；
- 两阶段各自可保存原始练习进度，词汇失败不影响全文输入；
- 保持既有基础练习可作为**明确标注的普通练习**，但不能伪装为完整 Anchor/Bridge/Target 精讲。

### B. 从原文锚点收集已有资源（不重复生成）

按 `sourceFingerprint + sentenceId + surfacePosition + targetLanguage + translatorIdentity` 查找：
- 已审核的词义/旧教材；
- Reader 已有句子翻译缓存（身份不一致时严禁借用）；
- 词典 exact-form 音标；
- 既有音频按 `voice + exactText` 缓存；
- 原有的合法重点句计划（需要完整校验，**不可**把拒绝过的草稿直接发布）。

只复用可追溯并经过该字段所需校验的结果；不要把“有中文文字”当成语义准确的证明。

### C. 只生成缺失的最小教学信息，不再让模型写整个课程 JSON

1. **词汇注释**：输入 `[{wordId, exactSurface, sourceSentence}]`；模型仅返回 `[{wordId,meaningZh}]` 和需要的句子译文。程序验证 ID、词形、词位，检测不能接受的英文字样；可单词级重试。不能以整份“教学价值”主观审核否决所有原文挖空。
2. **重点句决策**：1–3 个 sourceSentenceId，默认以内容核心和适当复杂度为准；没有可信决策则用户可从原句手动选择。整篇 11 句不可默认被冒充为“原版 10 步渐进课程”。
3. **语义拆句**：模型仅提供“选用哪些原文跨度、教学顺序及最小中文含义”，例如 `[{kind, spans, meaningZh, explanationZh, analysisZh}]`。由程序从英文原文切出字符串，并计算所有词块 ID、引用、位置、乱序和标点；禁止模型重复维护 `dependsOn/tiles/correctOrder/bankOrder/typingTokens`。
4. **强结构检查**：真实可复用的完整英语部件；目标最后一步=原句；引用唯一/不重叠；保留否定、条件、语义范围；不把未经讲解的长从句当简单 Anchor。来源不合法直接拒绝该候选，不修改原文。
5. **独立教学审核**：只审核已通过结构检查的**中文意义和教学拆解**。返回精确失败项 ID；局部修订，不重新生成已有正确词汇和句子。重复失败应保留候选与明确诊断，不把整页卡死。
6. **音频**：对当前词和当前步骤优先级最高，后台按需触发 Qwen3-TTS、缓存复用；“无音频”不能延迟练习，但明确显示音频不可用，而不是按钮静默失效。

### D. 两种独立完成状态，不再相互冒充

- `ExerciseCoreReady`：原文答案及游戏输入已经验证。可以使用普通单词填空、原句默写。
- `TeachingPlanReady`：词义、整句中文、重点句与递进计划均有足够合格数据。**只有这时才能宣称“完整原版精讲体验”**；词义、音标、音频各自有可见状态。
- `AudioReady`：可以播放目标音色和本步音频；与教学审核独立。

教学增强、音频更新必须单独版本化，不能改变 `ExerciseCore` 的进度身份。旧 AI 模式及旧基础进度先保持原样，迁移只有逐字段等价证明后才能执行。

## 3. 固定文章回归样例

《小问题为什么重要》，91 词，当前英文是“AI 简易英文改写，非原著引文”。

- 第一阶段使用来源精确匹配的 15 个目标词；原版界面里每个词应该有正确的语境中文词义和可用时的整句译文、IPA、语音；缺少这些注释时要有明确状态，不能用“根据上下文回忆”冒充中文释义。
- 第二阶段恢复 **1–3 个重点句 × 多个 Anchor/Bridge/Target 步骤**，而不是默认 11 个 Target。
- 指定回归句 `s:0:65`：`A good answer can help us answer a bigger question.`。一种可教学的结构候选（仍须审核）：
  - Anchor `a bigger question`：一个更大的问题
  - Anchor `A good answer`：一个好的回答
  - Bridge `answer a bigger question`：回答一个更大的问题
  - Target 完整原句：一个好的回答能帮助我们回答更大的问题
  - 程序验证英语跨度、词块边界、真实引用和完整标点；不能把中文译文当英文答案，也不能凭空加词。

## 4. 实施顺序（禁止继续 UI 套壳）

1. **冻结原版界面作为金样**：复用原组件/样式/键盘功能，标明目前丢失的中文、IPA、阶段数与朗读。增加屏幕 DOM 和视觉回归，验收对象是外部学习者而不是自动测试通过率。
2. 定义 `ExerciseCore`、`TeachingEnrichment`、`AudioManifest` 的独立 schema / 版本与可用状态。不要借用带有虚假 `generator.review` 或 `kind:target` 的 `LearningMaterial` 伪装完整教材。
3. 原文/答案编译保持现有可靠实现，加入严格身份和不变性校验；来源信息变化时不复用旧教学资料。
4. 实装“词义/句子译文”最小补全流程，优先复用现有正确缓存，不暗中更换模型。第一阶段恢复原版词义/句义区域，未验证值不显示为事实。
5. 实装“重点句/语义跨度→确定性编译”流程，保留严格的教学审查与可诊断的局部重试，恢复每句多步渐进玩法。
6. 为两种课程材料提供正式、带鉴权的按需 Qwen3-TTS 入口；复用现有哈希音频、Aiden/Ryan 和缓存；可试听、可重试、不可静默失效。
7. 兼容保存/退出/重启/备份，加入用户真实原文的隐藏 Electron 全流程及真人视觉验收。新版本构建前不得自动操作或重置真实草稿。

## 5. 发布/验收门禁

**自动化：**
- 同一原文中每个目标单词都能准确填回来源词位；拼写纠错、跳词、重练、快捷键仍按原版。
- 完整体验中每个实际显示的中文提示都有对应 source-span 的合格来源；不得是空白、伪注释、无关通用提示。
- 重点句为 1–3 个；每句有有意义的 Anchor、Bridge 和完整 Target，源码不变、依赖合法、逐词拼写与标点正确。
- 真实 Qwen WAV 播放、缓存命中、失败可恢复；不得让音频错误挡住练习。
- 原有基础进度、AI 精讲进度、词汇草稿、用户教材数据前后哈希不变；版本/来源校验后恢复。
- 固定文章《小问题为什么重要》隐藏 Electron E2E：两个阶段、错误输入、提示、中文线索、听力、退出恢复；测试中记录真实 AI 与真实 TTS 和模拟结果的明确边界。
- Reader 离线、TypeScript、构建，且不覆盖用户运行中的服务。

**真人体验（不可用自动化替代）：**
- 让用户对比“以前”的分步逻辑：词义/句义、中文提示、Anchor→Bridge→Target 的学习价值，键盘手感、朗读与设置。
- 原有学习体验尚未在真实开发版比较验证之前，不声称“全部恢复”。

## 6. 核心取舍与风险

不允许同时承诺“完全不用 AI/词典/人工”与“任意英文都拥有准确中文词义、译文、音标及高质量 Anchor/Bridge/Target 递进拆解”：这两项目标在一般情形下不兼容。可以保证无需模型的**基本输入**立即可用；要实现原版**完整教学内容**，必须有已验证的缓存、字典、模型或人工策划。可先在精选文章生成时预备并持久化完整课程，用户点练习时直接读取；仍需监测内容生成失败率，不能把一次 AI 审核通过当成教学有效的客观证据。
