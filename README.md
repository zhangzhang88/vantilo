# Vantilo

Vantilo 是一款面向 macOS 的阅读与 AI 助手应用。它把电子书、杂志阅读、翻译、词汇学习和 Codex 工作台放在一个界面中，帮助你阅读英文内容，并使用自定义 API 或 ChatGPT 辅助理解。

> **项目状态：0.1.13 Beta 预发布。** Universal ZIP 与 SHA-256 校验文件见 [GitHub Release](https://github.com/zhangzhang88/vantilo/releases/tag/v0.1.13)。该版本包含本地 macOS Dictionary Services 点词释义和有道英式/美式发音接入；有道 `dictvoice` 接口用于公开分发桌面应用的授权尚未取得书面确认，本项目不声称已获授权。项目所有者已确认拥有 Magazine Reader 与集成 Reader 源码的版权；这不自动涵盖第三方代码、依赖、媒体、杂志或在线服务。

## 功能介绍

- **发现好书并阅读**：用中文搜索精选目录、按题材筛选，查看中文介绍与阅读难度；从 Project Gutenberg 获取 EPUB 后加入现有书架。在线书籍详情可根据 Gutenberg 原著开头按需生成中文介绍；模型独立下拉列表与阅读翻译一致，列出当前阅读设置中选中的自定义 API 服务及 Codex 实时可用模型。记住所选模型，按模型分别缓存，支持手动重新生成；不修改19本精选书的人工文案。
- **阅读电子书和杂志**：导入 EPUB，在书架中打开文章、章节和目录；支持阅读进度、收藏、笔记等阅读工具。
- **段落与全文翻译**：在阅读器中选择已保存的自定义 OpenAI 兼容 API 或 Codex / ChatGPT。译文按所选引擎和模型分别保存；所选服务不可用时，应用不会悄悄切换到其他模型。
- **自定义模型服务**：保存多个 MiniMax、DeepSeek 或局域网 OpenAI 兼容 API 服务，在阅读设置中切换使用；API 密钥由 macOS 安全存储管理。
- **逐句阅读和点词释义**：逐句查看译文，点击英文单词查看系统词典和由当前阅读模型生成的语境释义；支持设置点击单词时自动发音。
- **中文目录**：可手动选择目录翻译模型并生成目录；导入书籍或检查新刊不会自动翻译整本内容。
- **听书**：在支持的阅读页面播放中文朗读，使用 Ciallo TTS 的“晓辰多语言”音色。朗读文本会发送至该第三方服务，连续播放会预生成后续音频；服务可用性取决于网络和第三方服务状态。阅读中的英文单词发音是独立功能。
- **Codex 工作台**：登录 ChatGPT 后，可以在独立工作台与 Codex 对话、选择可用模型，并在应用的权限边界内处理所选工作区内容。

## 当前版本：0.1.13 macOS Universal Beta

Universal ZIP 面向 Apple Silicon `arm64` 与 Intel `x86_64`。本次构建包内 Mach-O 架构已逐项检查；Intel 实机安装和功能测试**未运行**。候选包不包含内置本地 Qwen 模型；阅读功能使用用户配置的云端或局域网 API。签名为 ad-hoc，尚未 Developer ID 签名或 Apple 公证。

### 下载

从 [v0.1.13 GitHub Release](https://github.com/zhangzhang88/vantilo/releases/tag/v0.1.13) 下载 Universal ZIP；[下载 Universal ZIP](https://github.com/zhangzhang88/vantilo/releases/download/v0.1.13/Vantilo-Beta-0.1.13-universal.zip)；[下载 SHA-256 校验文件](https://github.com/zhangzhang88/vantilo/releases/download/v0.1.13/Vantilo-Beta-0.1.13-universal.zip.sha256)。发布只包含 ZIP 与 sidecar，不生成或上传 DMG。本地构建报告保存在独立的 Vantilo 外置发布工作区。

## 安装说明与已知限制

候选应用使用 ad-hoc 签名，没有 Apple Developer ID Team ID，也没有 Apple 公证票据。macOS 可能通过 Gatekeeper 阻止首次启动；用户可在 Finder 中 Control-click → Open，并根据系统提示在“系统设置 → 隐私与安全性”中处理。受管理设备的安全策略仍可能阻止启动。不要通过关闭 Gatekeeper 或其他系统安全保护来规避限制。

Intel 实机安装测试尚未完成。项目所有者已确认 Reader 源码版权归属，并确认 `assembly-typing-game.tsx` 中 Worm 项目的布局/键盘生命周期代码为其自有版权且授权 Vantilo 公开发布；该确认不涵盖第三方依赖或其他媒体素材，仍须分别审查。

打开已获准使用的测试候选后，可以从设置进入阅读设置，添加并测试自定义 API 服务。局域网 API 需要服务端监听可从本机访问的地址，并允许相应网络连接。使用 Codex / ChatGPT 时，在应用中登录 ChatGPT，并在阅读页面选择可用模型。在线服务需要网络、可用账号和相应服务权限。正式发行前还需完成干净安装、升级与数据保留测试。

## 杂志与更新

应用运行期间可按状态检查杂志新刊，正常情况下约每三小时检查一次；关闭应用后不会在系统后台持续运行。网络不可用、上游来源变化或访问限制都可能影响检查结果。**0.1.13 Universal ZIP 不包含 EPUB 文件**；用户可在应用中导入自己有权使用的电子书和期刊。

应用内的**软件更新检查**与杂志新刊检查是两件事。Beta 版检查 Beta 预发布，发现新版本后可在应用中下载并校验文件；用户需要退出应用，手动解压并替换旧版。校验值用于检查文件完整性，不是独立的数字签名。历史版本的更新器可能仍只检查稳定版，可通过上方链接下载。

项目所有者曾表示拥有或已取得四种默认杂志随应用分发及获取新刊的权利，但未提供书面依据，也未经独立核验。该声明不构成已确认的再分发授权。发布准备仍需核对第三方资源使用范围。用户导入的个人电子书和期刊不应被提交到公开仓库。

## 隐私与数据

- 导入的书籍、阅读记录、外观设置、API 服务配置和对话记录保存在本机应用数据目录。数据管理可备份阅读进度、笔记、词汇、阅读偏好和部分翻译缓存；备份不包含 EPUB、API 服务与密钥、中文目录缓存、ChatGPT 登录或 Agent 会话。
- 选择自定义 API 或 Codex / ChatGPT 时，阅读内容会发送到所选服务端点。使用前请核对服务地址、隐私与账号权限。
- 中文听书使用 Ciallo TTS 时，朗读文本会发送到 `tts.ztr8.uk`；请根据内容敏感程度决定是否使用。
- 英文点词发音会将所选单词发送至 `dict.youdao.com/dictvoice`。自动发音默认开启，可在阅读设置关闭；英式/美式手动发音按钮也会请求该服务。有道接口用于公开分发桌面应用的授权尚未获得书面确认，属于本 Beta 的已知第三方服务风险；未声称已获授权。请勿发送敏感内容。
- Codex 工作台使用应用独立的登录目录。阅读任务和工作台使用独立执行通道，不共用项目会话；权限、工作区边界及用户批准仍然适用。
- 本地阅读服务绑定回环地址并使用会话验证；这并不等于可以忽略系统安全设置或向不可信程序开放本机数据。

## 开发与测试

项目使用 Electron、React 和 TypeScript。以下命令面向开发者，不能替代安装应用：

```bash
npm install
npm run typecheck
npm test
npm run build
```

Reader 源码位于 `packages/reader/`，由 npm workspace 管理；构建不再依赖仓库外的 Magazine Reader checkout。原项目保持只读。来源、owner 的版权确认、排除的数据及仍待审查的独立第三方内容见 [`packages/reader/SOURCE_PROVENANCE.md`](packages/reader/SOURCE_PROVENANCE.md)。项目所有者尚未选择 Vantilo 的源码许可证，本项目不会擅自添加或指定开源许可。

Reader 使用固定的 `127.0.0.1:5174/5175` 服务 origin 和 Vantilo 现有 `userData/reader-library`，不迁移或重置本机阅读数据。构建不打包个人 EPUB、阅读历史、数据库、密钥、缓存或 `node_modules`；用户可继续在应用中导入书籍。真实 Codex 推理、真实账号操作和模型下载不属于默认测试流程。

`npm run desktop:dev` 会先构建内置 Reader 再启动应用。Universal macOS 打包需要 Apple Silicon、网络访问和 Xcode Command Line Tools。发行构建应使用经验证的外置工作副本与缓存；共享缓存不得擅自移动或清理。构建目录、版本化输出和预检步骤见 [Universal 构建操作手册](docs/release/macos-universal-build.md)。

未来 Agent 构建前必须阅读根目录 `AGENTS.md` 与 [Universal 构建操作手册](docs/release/macos-universal-build.md)，先运行外置卷身份验证脚本并检查可用空间，优先复用已验证输入；将 `build/`、临时文件及缓存放在外置工作副本，避免大型构建产物写入内置 SSD。未来 Universal 交付只发布 ZIP 与 SHA-256 sidecar，不生成或验收 DMG。

```bash
npm run desktop:dev
npm run test:reader:host
npm run test:reader:auth
```

本地双架构候选包的构建前提和限制见 [Mac 测试包说明](docs/mac-beta-candidates.md)。阅读器集成边界见 [Reader 集成说明](docs/magazine-reader-integration.md)。

## 当前限制与发布计划

公开发布前仍需完成以下工作：

1. 在 Apple Silicon 与 Intel 真实设备上完成同一通用包的安装、登录、阅读、翻译及更新验收。
2. 在两种设备上验收自定义云端与局域网 API 的点词、翻译、超时及异常恢复。
3. 候选包默认不携带杂志 EPUB；核对在线新刊来源、所有第三方组件及依赖 notices，并解决打字游戏中标注的外部代码来源。
4. 审查发布源码和新增文件，排除私人内容、凭据和模型权重，建立可回滚的 Git 发布基线。
5. 在公开发布页面明确说明系统要求、两个架构的区别、临时签名状态、已知限制和更新方法。

## 第三方组件与许可

项目使用 Electron、React Spectrum、Codex 等第三方组件，相关声明保存在 [`licenses/`](licenses/)。0.1.13 从干净发行提交构建；随包完整第三方 notices 与 Electron/Chromium/Codex 许可文件已核验。Apple Silicon 本地千问使用的模型与 MLX 组件有各自的许可证和来源要求；本候选不包含模型权重。杂志和电子书的版权不因应用开源而自动转移。

项目所有者已确认 Reader 自有源码版权；这不等于为 Vantilo 选择了开源许可证，也不授予任何第三方组件、贡献、媒体、杂志内容或在线服务的额外权利。发布前须检查最终包内实际包含的组件与 notices；不得仅凭本 README 推定第三方内容可自由再分发。
