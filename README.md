# 大狗桌宠

![大狗桌宠预览](assets/dagou/sprites/idle.png)

[下载最新版](https://github.com/Seb1900/dagou-pet/releases/latest) · [反馈问题](https://my.feishu.cn/share/base/form/shrcnGOLHXa8CDRLcwwbDGRI9cf) · 当前开发版本 `0.4.0`

大狗桌宠是一个会响应全局键盘输入的 Windows 桌宠。程序使用 Rust、Win32、Direct2D 和 WASAPI 实现，图片与声音全部嵌入 EXE，运行时无需联网下载组件。

官方版本免费发布。未经版权方书面许可，不得将本项目、修改版或打包程序用于销售、付费分发及其他商业用途，具体条款见 [PolyForm Noncommercial License 1.0.0](LICENSE.md)。

## 下载

官方安装包只在 [Seb1900/dagou-pet Releases](https://github.com/Seb1900/dagou-pet/releases) 发布。请核对文件名和 `SHA256SUMS.txt`。

| 文件 | 说明 |
| --- | --- |
| `Dagou-Desktop-Pet-Setup-<版本>-x64.exe` | 安装版，支持开始菜单、桌面快捷方式和应用内更新 |
| `Dagou-Desktop-Pet-Portable-<版本>-x64.exe` | 单文件免安装版，更新时手动替换 |

系统要求：Windows 10/11 x64。

安装版可覆盖旧 Electron 版本，原设置文件会迁移为 schema v3 并保留在 `%APPDATA%\dagou-pet\settings.json`。Portable 不写入安装信息。

## 功能

- 声音模式：`大 / 狗` 交替播放，或按下 `大`、松开 `狗`。
- 狗叫旋律：开启后按节拍组织输入，并加入校音、轻量和声和循环旋律；关闭后即时原调响应。
- 快速点按会播完原始音，长按进入无缝延音，松开后快速淡出；`大狗` 模式会完整接续 `gou`。
- `gou` 沿用对应 `da` 的音高和声像。
- `jiao` 使用平滑红色叠层，进入与退出均有过渡，退出更慢。
- 可调音量、旋律速度、反应强度、无级缩放、左右镜像和上下镜像。
- 鼠标悬停进入害羞状态，点击播放 `ei` 并触发身体回弹和摇尾巴。
- 缩放、镜像、身体动画和尾巴共用同一坐标变换，不会在窗口边缘裁切。
- 强制置顶会在窗口显示、系统恢复和显示器变化后重新设置。
- 低级键盘 Hook 只接受设置页支持的键；系统漏发松键时会检查物理按键状态并结束持续音。

## 使用

- 右键桌宠：直接打开设置面板。
- 左键拖动狗本体：移动桌宠。
- 拖动狗右下角缩放区域：无级调整大小。
- 左键单击狗本体：进入害羞状态并摇尾巴。
- 左键托盘图标：打开设置面板。
- 右键托盘图标：打开、暂停狗叫、回到右下角或退出。
- `Ctrl+Alt+D`：切换鼠标穿透。

设置页分为“声音”“桌宠”“关于”三页。关于页显示版本、开发者“冰冰赚大钱”、更新状态、反馈入口、项目地址和隐私说明。

## 更新

安装版启动约 8 秒后会通过 WinHTTP 请求官方 GitHub Release：

1. 比较语义版本。
2. 下载对应 x64 安装包和 `SHA256SUMS.txt`。
3. 校验安装包大小和 SHA-256。
4. 经用户确认后退出程序并启动静默覆盖安装。

Portable 只会打开官方发布页，不会原地覆盖自身。更新请求不包含按键内容。

## 已知限制

- 目前只支持 Windows 10/11 x64。
- 当前安装包没有 Authenticode 签名，Windows SmartScreen 可能显示“未知发布者”。
- 全局键盘 Hook 可能被安全软件、远程桌面、部分游戏或高权限窗口限制。
- 0.4.0 的安装、卸载、Portable 和线上版本检查已完成本地验收；从一个已公开原生版本升级到下一个公开版本仍需在发布 0.4.1 时完成真实 A 到 B 验收。

## 开发

需要以下工具：

- Rust stable，目标 `x86_64-pc-windows-gnu`
- WinLibs POSIX MSVCRT 或兼容的 MinGW-w64 工具链
- NSIS 3

检查源码：

```powershell
$env:CARGO_TARGET_DIR="$env:LOCALAPPDATA\DagouPetBuild"
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

生成安装版、Portable 和 SHA-256：

```powershell
.\scripts\build-native-release.ps1
.\scripts\smoke-native-release.ps1
```

发布产物位于 `release/`，不会提交到 Git。

```text
assets/                 嵌入程序的图片、声音和统一 ICO
native/src/             窗口、渲染、音频、输入、设置与更新
native/windows/         NSIS 安装脚本
scripts/                构建与发行冒烟脚本
.github/workflows/      Windows 自动构建和草稿 Release
```

## 项目信息

- 展示开发者：冰冰赚大钱
- GitHub 发布主体：Seb1900
- 项目许可：[PolyForm Noncommercial License 1.0.0](LICENSE.md)
- 隐私说明：[PRIVACY.md](PRIVACY.md)
- 第三方许可：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- 素材台账：[assets/ASSET_PROVENANCE.md](assets/ASSET_PROVENANCE.md)
- 安全报告：[SECURITY.md](SECURITY.md)

Copyright 2026 Seb1900.
