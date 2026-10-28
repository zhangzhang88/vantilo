# macOS 通用测试包

Vantilo 使用一个 Universal macOS 测试包，同时包含 Apple Silicon（arm64）和 Intel（x64）运行代码。系统会自动选择本机架构。云端和局域网 OpenAI 兼容 API 两边通用；MLX 本地 Qwen 仅在 Apple Silicon 上启用。

Intel 设备使用自定义云端或局域网 API；网络、API 服务与模型是否可用取决于用户配置和服务商。

## 本机构建前提

`npm run build:mac:universal` 需要 Apple Silicon macOS、可用的本地 Magazine Reader 源码和依赖、网络访问，以及 Xcode Command Line Tools。脚本会下载与项目 Electron 版本匹配的官方 x64 Electron 和与 Reader ARM 版一致版本的 Codex x64 包，并在仓库忽略的 `build/` 目录中交叉编译 Intel 系统词典辅助程序。它**不是**从公开仓库即可独立重现的发行流水线；Reader 源码和部分依赖仍来自本机路径。源码、上游依赖的许可证、来源与版本必须在正式发布前核对。

构建成功后，单一安装包和 SHA-256 文件位于 `out/`。构建拒绝覆盖同名已有产物；候选架构包和通用包的中间文件保留在忽略的 `build/` 目录，供复查。

构建时需要设置两个绝对路径：

- `VANTILO_BETA_ROOT`：仅直接运行底层双架构候选构建脚本时使用，必须是仓库忽略的 `build/` 子目录或 `/private/tmp` 下尚不存在的目录。
- `VANTILO_BETA_INPUTS`：仅直接运行底层候选构建脚本时使用，含 Electron 双架构归档、Intel Codex 和 Intel 系统词典辅助程序。通用包入口会在仓库 `build/universal-inputs/` 中自动准备这些输入。

构建过程只允许从专用清单复制四种默认杂志的候选文件，不复制个人书库或模型权重。应用所有者已确认本人拥有或已取得四种杂志随应用分发和获取新刊的权利；这项确认未附书面材料，也未独立核验。候选清单必须记录准确的确认来源，不能把它描述为已核验书面授权。

## 验收与发布边界

- 通用候选包应同时检查 arm64 与 x86_64 切片、签名完整性和安装包校验值，并分别在两种芯片的真实设备上验收安装和主要功能。
- Intel 的 Codex 与系统词典原生程序、模型选择、段落翻译、点词、取消和异常恢复必须在 Intel 设备实测；Apple Silicon 上还需确认 MLX Qwen 可用。
- Reader 的会话认证、合成 EPUB 流程和隔离的助手通道需验证；真实账号或真实模型测试须单独说明，不能从模拟测试推断。
- 候选包使用 ad-hoc 签名，未经过 Developer ID 签名和 Apple 公证。测试者可能需要根据 macOS 提示确认打开。
- 软件更新当前只检查 GitHub 的稳定 Release 并打开发布页面，不自动安装；预发布版不触发稳定版更新提示。
- 检查源码和安装包中的第三方许可、隐私数据与构建内容，建立可回滚 Git 基线之后，才适合准备公开 Release。

不要把本地候选包描述为已经公开发布；不要将用户个人 EPUB、模型权重或登录资料加入源码提交。
