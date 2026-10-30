# Vantilo 0.1.14 词汇备份发布验收报告

日期：2026-10-31
结论：**停止发布，最终 Universal 安装包验收未通过完整门禁。**

## 1. 版本与源码

- 正式版本：`0.1.14`
- 构建源码提交：`f3928f17eb167093164cd2118dde4f095536aadf`
- 分支：`main`
- 构建前根仓库工作区干净；本报告是本次新增的验收记录，未提交。
- 未更新版本号，未提交、Push、创建 Tag 或 GitHub Release。
- 发布前最后一次 `git ls-remote` 因当前 DNS 无法解析 `github.com` 失败；不能据此确认此刻远端 Tag/Release 状态。此前构建前检查未发现 `v0.1.14` 冲突。

## 2. 安全补测与源码回归

依据本轮此前已完成并记录的隔离测试结果：

- 备份/恢复边界并发写入：PASS。真实隔离 Electron 写入入口在冻结期间拒绝新写入；一致性快照不含冻结期修改，解除冻结后合法写入可重试并保留。
- 恢复失败且回滚再次失败：PASS。恢复事务进入 `RECOVERY_REQUIRED`，保留恢复点和事务材料；重新启动没有清除未完成日志或开放普通写入。
- 容量受限 APFS 测试映像：PASS。真实文件系统返回 `ENOSPC`；备份未标记成功，原词汇数据保持完整。不可写目录测试：PASS。
- 词汇备份定向测试：38 项通过。
- 根目录完整测试：578 项通过。
- Reader 离线测试：574 项通过、7 项跳过，串行执行。
- 类型检查、应用生产构建、独立 Reader 生产构建、`git diff --check`：PASS。

以上是当前源码门禁证据，不代替最终 Universal 安装包验收。

## 3. Workspace 与 Universal 构建

- 外置卷：`/Volumes/Workspace`，卷 UUID `2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE`；验证为 APFS、已挂载且可写，构建前可用空间约 854 GiB。
- 独立构建副本：`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.14-build-20261031`
- 源码副本与提交 `f3928f17eb167093164cd2118dde4f095536aadf` 一致。
- Intel dictionary helper 由当前源码与工具链重新生成并通过原有严格完整性门禁；只按既定规则比较 Mach-O UUID。Swift 6.4、SDK 27.0、目标 `x86_64-apple-macosx12.0`、优化参数 `-O`；helper SHA-256：`dee5046bb948198de960f8375615a0b851fbb478bc8f3076206e2a46b15f9cee`。
- Universal ZIP：`/Volumes/Workspace/Development/Vantilo/out/0.1.14/Vantilo-Beta-0.1.14-universal.zip`
- 大小：485,595,902 字节。
- SHA-256：`f421c3d97a911f9a0a96379df9924605c18e95d22146d97bdb895aa5ca4b5449`；sidecar 与实算值一致。
- ZIP 完整性：PASS。构建报告：`/Volumes/Workspace/Development/Vantilo/out/0.1.14/Vantilo-Beta-0.1.14-universal.report.json`。
- 报告记录 `arm64+x86_64`、包内 EPUB 数量 0、未包含默认杂志 seed。解压后的正式 Beta Bundle ID 为 `com.vantilo.desktop.beta`，版本 `0.1.14`。检查到 16 个 Mach-O，均包含 `arm64` 与 `x86_64`；Intel 真机测试：NOT RUN。
- `codesign --verify --deep --strict`：PASS。签名为 ad-hoc，无 Team ID；未公证。`spctl --assess` 返回 Code Signing subsystem internal error，不能报告 Gatekeeper 验收通过。更正：应用图标并未缺失；此前检查错误地寻找 `vantilo.icns`，而最终包通过 `CFBundleIconFile=electron.icns` 引用 `Contents/Resources/electron.icns`。对最终解压应用、ZIP 内图标及源码 `resources/vantilo.icns` 的只读比较一致，SHA-256 均为 `ca595a0a428b5361d463b90010f11f63ac96c52671593ed6efbb49c60a44c9da`。

## 4. 最终 ZIP 安装包自动验收

测试包从上述确切 Universal ZIP 解压，位置：

`/Volumes/Workspace/Development/Vantilo/workspaces/0.1.14-build-20261031/build/runtime-tmp/package-e2e-final-20261031/Vantilo Beta.app`

使用独立外置临时目录与 `user-data` / `user-data-b`。未替换 Applications 中的应用。

### 已通过

- 从确切包启动，页面显示版本 `0.1.14`、更新通道 `Beta`。
- 在 Profile A 通过真实 Reader 界面导入合成 EPUB、保存一条合成词汇，并通过应用内词汇备份 UI 生成 JSON。
- 备份 UI 显示完整性校验通过；文件大小 1,768 字节，校验器验证通过。Finder 按钮实际定位到该测试 JSON。
- Profile B 使用独立 userData；选择同一 JSON 后，应用真实预览显示 SHA-256 已验证、预计新增 1 条、当前 0 条，缺失来源仍会保留关联。
- 退出 Profile B 后确认 Vantilo 进程已结束。未清理、覆盖或删除测试资料。

### 未通过/未完成

- 对 Profile B 的「确认合并恢复」执行了界面点击及键盘确认，界面始终没有出现恢复完成状态，无法确认词汇实际写入。恢复后的重启持久性因此未验证。标记：**BLOCKED**，不能把已有开发版 E2E 结果替代为最终 ZIP 通过。
- CUA 在 Profile A 退出后按相同 Bundle ID 解析应用句柄，曾短暂打开默认用户目录对应的 Vantilo。发现后立即停止操作并正常退出。没有查看、导出、清理或手动修改正式用户数据；但无法证明应用自动启动期间没有更新检查或其他启动任务写入默认目录。此事件使“测试严格隔离于正式 userData”的安装包证据不再完整，标记：**BLOCKED**。不得声称正式用户数据确定未发生变化。
- 完整包的跨 userData 合并、确认恢复、重启后持久化、恢复异常流程：NOT RUN/未完成。
- 应用内 Beta 更新下载与校验流程：本轮没有以 GitHub Release 验收，因为尚未创建 Release。

## 5. 发布门禁结论

源码安全补测、源码回归、外置卷、Intel helper 门禁和 Universal 构建通过；但最终 Universal 包的 UI 恢复操作未能证明完成，且一次默认 userData 应用启动使隔离性无法证明。按发布手册，安装包验收未通过前不得 Push、打 Tag 或发布。

因此本轮没有 Push、Tag、发布 Release、更新 README 下载入口或清理历史/临时构建材料。旧版本产物未覆盖。当前应先修复或以可复核方式完成最终包恢复与重启验收，并建立不会按 Bundle ID 串用默认 userData 的自动化连接方式；随后从相同已审阅源码重新完成受隔离的最终 ZIP 验收，再重新核对远端状态。
