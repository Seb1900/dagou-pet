# Dagou 正式发布与自动更新计划

## 发布定位

Dagou 官方版本免费发布。本项目不建设付费、授权码、账户权益、DRM 或付费内容系统。

源码和仓库内素材继续使用 PolyForm Noncommercial License 1.0.0。未经版权方书面许可，第三方不得将项目、修改版或打包程序用于销售、付费分发及其他商业用途。

## 目标

- 提供可验证来源的 Windows 安装版和免安装版。
- 发布包包含许可证、版权声明和隐私说明。
- 使用可重复执行的 Tag 发布流程生成安装包、校验值和更新文件。
- NSIS 安装版支持安全的应用内更新。
- 免安装版只检查新版本并引导用户手动下载。
- 更新不收集按键、窗口标题、进程名或输入节奏。

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 源码许可证 | PolyForm Noncommercial 1.0.0 |
| 安装包 | NSIS x64、Portable x64 |
| 自动测试 | `npm run verify`，98 项测试 |
| 打包检查 | `npm run smoke:packaged` |
| 完整性校验 | `SHA256SUMS.txt` |
| GitHub Actions 发布流程 | 已建立，等待首次 Tag 实跑 |
| 应用内更新 | 已实现，等待两个真实版本更新验收 |
| 设置迁移和备份 | 已实现并有自动测试 |
| 设置与关于页 | 已完成紧凑三页签界面和 330×450 视觉复核 |

## 阶段 0：发布身份与许可证

- 冻结 `appId`、产品名、Publisher、可执行文件名和用户数据目录。
- 新增 `PRIVACY.md`，说明全局键盘 Hook 只在本机处理输入事件。
- 新增 `THIRD_PARTY_NOTICES.md`，登记随程序分发的 Electron、Chromium、`uiohook-napi` 和 `node-gyp-build`。
- 新增 `assets/ASSET_PROVENANCE.md`，记录每个图片、图标和声音的作者、日期、来源与文件哈希。
- 在安装程序、设置页和发布页提供 `LICENSE.md`、`NOTICE` 与隐私说明入口。
- README 和发布说明持续明确“官方免费发布，禁止未经授权转卖”。

完成标准：发布包内能找到许可证与版权声明，全部素材来源可追溯，发行身份不再随版本变化。

## 阶段 1：构建加固

- 配置 Electron fuses，关闭 `RunAsNode`、`NODE_OPTIONS` 和 CLI 调试入口，启用 ASAR 完整性验证。
- 只打包 `zh-CN`、`en-US` 和 Windows x64 所需的原生文件。
- 检查安装包、免安装版、更新清单和校验值是否完整。

完成标准：构建产物缺失或校验失败时流程中止；全新 Windows 10/11 环境可以安装、启动和卸载。

## 阶段 2：GitHub 发布流程

- 新增 `.github/workflows/release-windows.yml`。
- 仅由 `vX.Y.Z` Tag 触发正式发布。
- 校验 Tag、`package.json` 版本和发布说明一致。
- 依次执行 `npm ci`、`npm run verify`、打包、冒烟测试和哈希验证。
- 生成 NSIS、免安装版、`latest.yml`、blockmap 和 `SHA256SUMS.txt`。
- 同一版本号的文件不得覆盖上传。
- GitHub Releases 作为免费官方版本的发布源；需要改善国内下载时，可增加只读镜像或 HTTPS CDN。

完成标准：任一验证失败都不会生成正式 Release，普通分支无法发布版本。

## 阶段 3：应用内更新

- 将固定版本的 `electron-updater` 加入生产依赖。
- 更新逻辑只在主进程运行，Renderer 通过校验 sender 的受限 IPC 操作。
- 状态至少覆盖：空闲、检查中、已是新版、发现新版、下载中、已下载、已取消和失败。
- 设置页展示当前版本、新版本、更新说明、文件大小、下载进度和错误信息。
- 设置“关于”页提供更新操作；启动后延迟进行一次静默检查，无更新时不弹窗。
- NSIS 版允许确认下载并重启安装；免安装版打开官方 Release 下载页。
- 只允许访问代码中固定的 GitHub 或 HTTPS 镜像域名。
- 更新说明按纯文本展示，不直接渲染远端 HTML。

完成标准：使用两个真实版本完成 A 到 B 更新，更新后版本正确且原有设置保留。

## 阶段 4：设置迁移与异常测试

- 为 `settings.json` 增加 schema 版本和逐版本迁移函数。
- 写入前保留 `.bak`，文件损坏时恢复备份并提示用户。
- 测试离线、超时、404、下载取消、磁盘不足和文件损坏。
- 测试默认安装目录、自定义目录、多显示器、系统恢复及 Windows 10/11。
- 更新安装前停止键盘 Hook、音频和托盘资源。
- 出现问题时发布更高版本号修复，不覆盖旧版本文件。

## 建议实施文件

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/release-windows.yml` | Tag 驱动的 Windows 发布流程 |
| `src/main/update-service.ts` | 主进程更新状态机 |
| `src/shared/update-contracts.ts` | 更新状态与 IPC 类型 |
| `src/preload/index.ts` | 受限更新 API |
| `src/renderer/settings.*` | 更新与关于界面 |
| `test/update-service.test.ts` | 更新状态和错误测试 |
| `scripts/verify-release.ps1` | 哈希和产物检查 |
| `scripts/e2e-update.ps1` | 双版本更新验收 |
| `PRIVACY.md` | 隐私说明 |
| `THIRD_PARTY_NOTICES.md` | 第三方组件声明 |
| `assets/ASSET_PROVENANCE.md` | 素材来源台账 |

## 正式发布检查表

- [x] README 与发布页明确官方免费发布及禁止未经授权转卖
- [x] LICENSE、NOTICE、隐私说明和第三方声明随包分发
- [x] 素材来源台账完成
- [ ] Tag 发布流程可以重复执行并保留日志
- [ ] NSIS 双版本更新测试通过
- [x] 免安装版只引导手动下载
- [x] 设置迁移、备份和损坏恢复通过
- [ ] Windows 10/11 安装、启动、退出和卸载通过
- [ ] 离线、取消、损坏文件和磁盘不足通过
