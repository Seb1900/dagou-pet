# 正式发布与自动更新

## 发行形式

- 安装版：`Dagou-Desktop-Pet-Setup-<版本>-x64.exe`
- Portable：`Dagou-Desktop-Pet-Portable-<版本>-x64.exe`
- 校验文件：`SHA256SUMS.txt`

两个 EXE 都包含运行所需的图片、声音和图标。用户无需安装运行库或下载额外资源。

## 自动更新

安装版以同目录存在 `Uninstall.exe` 识别安装状态。启动约 8 秒后在后台执行：

1. 使用 WinHTTP 请求 `Seb1900/dagou-pet` 的 latest Release。
2. 使用 `semver` 比较当前版本和 `tag_name`。
3. 精确选择同版本 `Setup-x64.exe` 和 `SHA256SUMS.txt`。
4. 限制响应与安装包大小，下载到 `%LOCALAPPDATA%\dagou-pet\updates\v<版本>`。
5. 比对 Release 资产大小和 SHA-256。
6. 用户确认后启动 NSIS `/S /UPDATE`，当前进程退出。

Portable 不下载或替换自身，只打开官方 Release 页面。

## 构建

```powershell
.\scripts\build-native-release.ps1
.\scripts\smoke-native-release.ps1
```

构建脚本依次执行格式检查、严格 Clippy、单元测试、release 构建、NSIS 打包和 SHA-256 生成。冒烟脚本校验文件名、哈希、32 MB 预算并启动 Portable。CI 额外执行静默安装、启动和卸载。

## 发布流程

1. 更新 `Cargo.toml` 版本与 `CHANGELOG.md`。
2. 本地运行构建和冒烟脚本。
3. 创建与 Cargo 版本一致的 `vX.Y.Z` Tag。
4. GitHub Actions 构建三个发布文件并创建草稿 Release。
5. 核对标题、正文、文件名、文件大小和 SHA-256。
6. 人工测试 Windows 10/11 x64 后发布草稿。
7. 发布下一版本时，用上一公开原生安装版完成真实 A 到 B 更新。

## 覆盖安装

NSIS 使用旧 Electron 版本的卸载注册表键：

`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\bc780249-420c-5c11-acac-c3642d232a28`

安装时会读取旧目录并调用旧版静默卸载器，再写入原生程序。卸载脚本不会删除 `%APPDATA%\dagou-pet`，因此 schema v1、v2 设置可以由 schema v3 迁移。

## 当前验收

- [x] Rust 格式检查、严格 Clippy 和原生单元测试
- [x] release EXE 构建与资源嵌入
- [x] NSIS 静默安装、原生程序启动、线上版本检查和静默卸载
- [x] Portable 启动与 SHA-256 校验
- [x] 旧 Electron 注册表键、目录继承和设置保留逻辑
- [ ] 使用两个已公开原生版本完成 GitHub Release A 到 B 更新
- [ ] 在独立 Windows 10 与 Windows 11 实机执行完整人工回归

在最后两项完成前，0.4.0 应标记为测试版。
