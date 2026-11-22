# Vantilo 代码审查报告与修复建议（2026-11-22）

本文档整理自对 `Vantilo` 仓库的静态检查与源码审查（当前 `npm run typecheck` 通过），可直接提供给 Codex 作为修复与重构任务输入。

---

## 1. 需要优先修复的问题

### [High] 1.1 `permissionMode` 传递与持久化链路断裂

**现象与根因：**
1. **任务提交时 `permissionMode` 被丢弃**：
   - `electron/main.cjs`（第 214 行）在 `agent:submit` handler 中调用了：
     `runtime.submit(sessionId, text, { permissionMode: permissionMode ?? 'supervised' })`
   - 但 `electron/runtime-supervisor.cjs`（第 77 行）的定义为：
     `submit(sessionId, text) { return this.request('submit', { sessionId, text }); }`
   - 第 3 个参数被忽略，导致前端 `PermissionModePicker` 选择的 `accept-edits` / `automatic` / `full-access` 在实际提交任务时静默退回 `'supervised'`。
2. **`session:permission-mode` 通道未打通**：
   - `electron/main.cjs`（第 184 行）注册了 `ipcMain.handle('session:permission-mode', ...)` 并调用 `runtime.setSessionPermissionMode(sessionId, permissionMode)`，但 `RuntimeSupervisor`（`electron/runtime-supervisor.cjs`）上不存在该方法。
   - `electron/runtime-protocol.cjs` 的 `Payloads` 中定义了 `'session:permission-mode'`，但 `Request` 的 `method` 枚举与 `Results` 中均遗漏了 `'session:permission-mode'`。
   - `electron/preload.cjs` 也未暴露对应的桥接方法（如 `setSessionPermissionMode`）。

**给 Codex 的修复指令：**
- 在 `electron/runtime-supervisor.cjs` 中将 `submit(sessionId, text, options)` 改为透传 `permissionMode`（如 `{ sessionId, text, ...(options?.permissionMode ? { permissionMode: options.permissionMode } : {}) }`），并补充 `setSessionPermissionMode(sessionId, permissionMode)` 方法。
- 在 `electron/runtime-protocol.cjs` 中将 `'session:permission-mode'` 加入 `Request.method` 枚举和 `Results` schema（如 `z.object({ permissionMode: PermissionMode }).strict()`）。
- 如需在切换权限模式时即刻持久化到会话，在 `electron/preload.cjs` 与 `src/main.tsx` 中补齐 `setSessionPermissionMode` 调用；若仅在 `submit` 时生效，则评估是否保留或完善 `session:permission-mode` IPC。
- 补充或更新 `tests/runtime.test.ts` 与 `tests/ipc-security.test.ts`，验证非 `'supervised'` 权限模式能够完整透传到 `AgentRuntime.submit`。

---

### [Medium] 1.2 Reader 固定端口 `127.0.0.1:5174` / `5175` 冲突风险

**现象与根因：**
- `electron/portable-reader-supervisor.cjs`、`electron/portable-reader-service.cjs` 与 `src/ui/magazine-reader-module.tsx` 硬编码绑定了 `127.0.0.1:5174`（API）和 `127.0.0.1:5175`（Web）。
- 虽然有单实例锁防止多开 Vantilo，但如果用户本机其他本地服务占用了 5174 或 5175 端口，Reader 模块会启动失败。

**给 Codex 的建议：**
- 评估在不破坏现有 `userData/reader-library` origin 与 CSP/Cookie 策略的前提下，是否需要提供更清晰的端口占用诊断提示（指出具体被占用的端口），或长期规划动态端口 + 主进程注入 origin。

---

### [Medium] 1.3 核心单文件职责过重与单行压缩风格

**现象与根因：**
- `src/main.tsx`（约 50 KB）将大量业务状态（30+ 个 `useState`）、IPC 监听、会话/工作区/模型/Reader 切换逻辑集中在一个 `App` 组件中。
- `electron/main.cjs`（约 38 KB）混杂窗口创建、菜单模板、会话/项目 IPC、词汇备份状态机和 Gutenberg 路由校验。
- `electron/runtime.cjs`（约 38 KB）与 `packages/reader/src/server/app.ts`（约 73 KB）同样体积较大，且多处函数与 JSX 被写成极紧凑的单行语句，影响后续维护与 `git diff` 审查。

**给 Codex 的重构建议（低风险拆分，不改行为）：**
- 从 `electron/main.cjs` 抽离独立子模块：`electron/ipc/vocabulary-backup-ipc.cjs`、`electron/ipc/gutenberg-ipc.cjs`。
- 从 `src/main.tsx` 抽离自定义 Hooks（如 `useAgentRuntime`、`useWorkspaceSessions`、`useReaderBridge`）。
- 对后续改动文件保持正常多行格式化，避免继续引入单行压缩语句。

---

### [Low] 1.4 `isPrivateHost` 放行链路本地地址 `169.254.0.0/16`

**现象与根因：**
- `electron/reader-custom-api.cjs` 中的 `isPrivateHost` 将 `169.254.0.0/16` 视为合法 HTTP 私网主机。虽然自定义 API 由用户手动配置，但 `169.254.169.254` 属于常见云元数据地址段，不适合作为常规局域网 API 目标。

**给 Codex 的修复指令：**
- 在 `electron/reader-custom-api.cjs` 的 `isPrivateHost` 中移除 `a === 169 && b === 254`（以及 IPv6 `fe80:` 如无必要也可收紧），并在 `tests/reader-custom-api.test.mjs` 补充对应单测。

---

## 2. 架构与安全亮点（重构时需保持）

- **Electron 进程与渲染器隔离**：主窗口保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，所有 IPC 均通过 `electron/ipc-security.cjs` 的 `requireTrustedSender` 校验精确 URL 与 `mainFrame`。
- **Codex 权限收敛**：`electron/codex-driver.cjs` 禁用内置高危能力与未授权 MCP，仅通过 `electron/tool-catalog.cjs` 暴露受控工具并做工具目录指纹校验。
- **数据安全与原子写入**：启动阶段使用 `O_SHLOCK`（`acquireReaderDataLockSync`）与事务守卫（`checkStartupTransactions`）；配置与会话持久化采用临时文件 + `fsync` + 原子 `rename` + `0o600` 权限，密钥使用 `safeStorage` 加密并在日志/历史中脱敏（`redactSecrets`）。

---

## 3. 当前工作区状态备忘

- `npm run typecheck`：已通过（主项目与 `@vantilo/reader` workspace 均无类型错误）。
- 当前 `git status` 包含 32 个已修改文件与 4 个未跟踪文件（主要集中在 `packages/reader` 的整期翻译与听书流式播放优化）。建议先将当前功能改动与上述修复拆分提交，并运行 `npm test` 与 `npm run test:reader:audiobook` 回归验证。
