# macOS 通用测试包

Vantilo 使用一个 Universal macOS 测试包，同时包含 Apple Silicon（arm64）和 Intel（x64）运行代码。系统会自动选择本机架构。两种架构均可使用配置的云端或局域网 OpenAI 兼容 API。

Intel 设备使用自定义云端或局域网 API；网络、API 服务与模型是否可用取决于用户配置和服务商。

## 本机构建前提

`npm run build:mac:universal` 需要 Apple Silicon macOS、Vantilo npm workspace 依赖、网络访问，以及 Xcode Command Line Tools。Reader 源码与 ARM Codex 运行时从仓库内 `packages/reader/` 解析；脚本会复用已校验的 Electron/Codex 输入，并在仓库忽略的 `build/` 目录中交叉编译 Intel 系统词典辅助程序。原始外部 Magazine Reader checkout 不再是构建输入。项目所有者已确认 Reader 自有源码版权；第三方依赖、外部贡献、媒体和在线服务仍须分别审查。源码本身未添加或选择 Vantilo 开源许可证。

`npm run build:mac:beta` 是底层双架构候选构建脚本：它将 arm64/x64 候选 ZIP、sidecar 与报告写入 `VANTILO_BETA_ROOT` 指定的新目录（应在外置工作副本的 `build/` 下），且拒绝覆盖已存在的目录。它不是最终 Universal 发行包入口。`npm run build:mac:universal` 再生成 Universal ZIP、sidecar 和报告到版本化输出目录；可通过绝对路径 `VANTILO_UNIVERSAL_OUTPUT_ROOT` 指向一个新建、经核验的外置输出命名空间，避免触碰既有 ZIP。Universal 发行不生成或上传 DMG。

构建时需要设置两个绝对路径：

- `VANTILO_BETA_ROOT`：仅直接运行底层双架构候选构建脚本时使用，必须是仓库忽略的 `build/` 子目录或 `/private/tmp` 下尚不存在的目录。
- `VANTILO_BETA_INPUTS`：仅直接运行底层候选构建脚本时使用，含 Electron 双架构归档、Intel Codex 和 Intel 系统词典辅助程序。通用包入口会在仓库 `build/universal-inputs/` 中自动准备这些输入。

源码中的 Universal 候选流程默认不复制任何 seed；主进程仅在 packaged Reader 资源确有 seed manifest 时才启用 seed 初始化。若旧的 `build/reader/seed` 存在，Reader build 会失败并要求人工检查，不会自动删除或纳入包。构建会拒绝包含 EPUB 条目的最终 ZIP，并在报告中记录 `defaultMagazineSeedIncluded: false` 与 `bundledEpubCount: 0`。必须验证无 seed 首次启动和用户导入合成 fixture 的流程。四种默认杂志的既有权利声明未独立核验，因此不随包分发；不得复制个人书库或模型权重。项目所有者已单独确认 `assembly-typing-game.tsx` 中 Worm 项目的布局/键盘生命周期代码属于其版权并授权公开发布；该确认不涵盖任何第三方依赖或外部媒体素材。

## 验收与发布边界

- 通用候选包应同时检查 arm64 与 x86_64 切片、签名完整性和安装包校验值，并分别在两种芯片的真实设备上验收安装和主要功能。
- Intel 的 Codex 与系统词典原生程序、模型选择、段落翻译、点词、取消和异常恢复必须在 Intel 设备实测；两种架构均需验证已配置的 API 服务。
- Reader 的会话认证、合成 EPUB 流程和隔离的助手通道需验证；真实账号或真实模型测试须单独说明，不能从模拟测试推断。
- 候选包使用 ad-hoc 签名，未经过 Developer ID 签名和 Apple 公证。测试者可能需要根据 macOS 提示确认打开。Universal 公共交付只包括 ZIP、SHA-256 sidecar 和构建报告，不生成、不上传 DMG。
- 软件更新当前只检查 GitHub 的稳定 Release 并打开发布页面，不自动安装；预发布版不触发稳定版更新提示。
- 检查源码和安装包中的第三方许可、隐私数据与构建内容，建立可回滚 Git 基线之后，才适合准备公开 Release。

不要把本地候选包描述为已经公开发布；不要将用户个人 EPUB、模型权重或登录资料加入源码提交。
