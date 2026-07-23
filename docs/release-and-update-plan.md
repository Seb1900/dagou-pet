# 正式发布与自动更新

本文只记录当前可执行的发布流程和仍需完成的验收，不把规划中的能力描述成现成功能。

## 发布原则

- 官方版本通过 [Seb1900/dagou-pet Releases](https://github.com/Seb1900/dagou-pet/releases) 免费发布。
- 源码和仓库内素材使用 PolyForm Noncommercial License 1.0.0；未经版权方书面许可，不得销售或付费分发。
- Windows 安装版是普通用户的主要发行形式；免安装版由用户手动下载和替换。
- 更新流程不收集按键、窗口标题、进程名或输入历史。

## 当前实现

| 模块 | 当前状态 |
| --- | --- |
| 版本 | `0.2.0` 源码与本地发行包已完成验证，等待创建同版本 Tag 和草稿 Release |
| Windows 构建 | `electron-builder` 生成 NSIS x64 安装版和 Portable x64 免安装版 |
| 构建加固 | 已启用 Electron fuses、ASAR 完整性校验并限制打包语言和原生文件 |
| 随包声明 | 打包 `LICENSE.md`、`NOTICE.md`、`PRIVACY.md`、第三方声明和素材台账 |
| 本地验证 | `npm run verify` 执行自动测试和完整构建；`npm run smoke:packaged` 检查打包程序 |
| 产物校验 | `scripts/write-checksums.cjs` 要求安装版、blockmap、免安装版和 `latest.yml` 全部存在，再生成 `SHA256SUMS.txt` |
| 自动发布 | `vX.Y.Z` Tag 触发 Windows 工作流，验证版本、测试、审计、构建并创建草稿 Release |
| 安装版更新 | 启动后延迟静默检查；设置页支持检查、下载和重启安装，并显示版本、进度和错误状态 |
| 免安装版更新 | 不原地覆盖，只打开官方 Releases 页面 |
| 设置兼容 | 已有 schema 迁移、备份和损坏恢复逻辑 |

当前更新界面没有展示更新说明、文件大小或下载速度，也没有取消下载入口。代码具备基本更新状态机，但尚未经过两个真实发布版本的端到端验证。

## 发布流程

1. 更新 `package.json` 版本，并把 `CHANGELOG.md` 的“未发布”内容整理为同版本标题和发布日期。
2. 在干净工作树执行 `npm ci`、`npm run verify`、`npm audit --omit=dev --audit-level=high`、`npm run dist:win` 和 `npm run smoke:packaged`。
3. 确认以下文件全部存在，且 `SHA256SUMS.txt` 覆盖前四项：

```text
Dagou-Desktop-Pet-Setup-<版本>-x64.exe
Dagou-Desktop-Pet-Setup-<版本>-x64.exe.blockmap
Dagou-Desktop-Pet-Portable-<版本>-x64.exe
latest.yml
SHA256SUMS.txt
```

4. 提交版本变更，创建与 `package.json` 完全一致的 `vX.Y.Z` Tag 并推送。
5. 等待 `.github/workflows/release-windows.yml` 完成。工作流只创建草稿 Release，不会直接公开。
6. 在草稿中补充本版本变化，核对附件和 SHA-256，完成 Windows 人工验收后再发布。
7. 发布下一版本时，用已安装的上一正式版本完成应用内检查、下载、重启安装和设置保留验证。

工作流会拒绝 Tag 与包版本不一致、Changelog 缺少版本标题、测试失败、生产依赖高危审计失败或发布产物缺失的构建。

## 发布前未完成

以下项目完成前，不应把自动更新描述为已通过生产验证：

- [ ] 首次 `vX.Y.Z` Tag 全流程实跑，并确认草稿 Release 的附件、权限和日志正确。
- [ ] 使用两个真实版本完成 NSIS A 到 B 更新，确认版本、用户设置和窗口状态保留。
- [ ] 在干净的 Windows 10 和 Windows 11 x64 环境验证安装、自定义目录、启动、退出、覆盖安装和卸载。
- [ ] 验证离线、超时、GitHub 不可达、磁盘不足、下载损坏和安装失败后的提示与重试。
- [ ] 配置 Windows 代码签名和可信时间戳，冻结正式 Publisher 身份。
- [ ] 为启动检查发现的新版本提供托盘提示或设置入口状态，避免用户必须主动打开“关于”页才能获知更新。
- [ ] 明确是否补充更新说明、文件大小、速度和取消下载；当前 UI 不具备这些能力。
- [ ] 验证设置文件损坏恢复时用户能够获知恢复结果。

稳定版/测试版通道、分批发布、回滚、匿名统计和崩溃上报不属于当前发布链路，后续引入时需要单独设计隐私、兼容和运维策略。

## 回滚原则

- 已公开的版本和附件不覆盖、不改写；修复时提高版本号重新发布。
- 发现严重问题时先将对应 Release 标记为预发布或撤下公开入口，再发布修复版本。
- Portable 用户始终手动替换文件；NSIS 用户只有在真实双版本验收通过后才主推应用内更新。
