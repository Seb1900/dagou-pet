# 更新日志

## [未发布]

暂无。

## [0.4.0] - 2026-07-23

### 新增

- 使用 Rust、Win32、Direct2D 和 WASAPI 完成原生重构。
- 48 kHz 浮点音频线程、36 复音、声像、压缩、限制器、平滑延音和快速淡出。
- 原生三页设置面板、schema v3、旧设置迁移、备份和损坏恢复。
- WinHTTP GitHub Release 检查、语义版本比较、安装包下载和 SHA-256 校验。
- NSIS 安装版、单文件 Portable、统一发布脚本和原生 GitHub Actions。
- 为未来麦克风变声保留 `AudioInput`、`AudioSource`、`AudioProcessor`、`AudioOutput` 接口。

### 调整

- 所有 PNG、WAV 和应用图标嵌入单个 EXE。
- 窗口、托盘和安装程序统一使用含 16 至 256 像素帧的 `app-icon.ico`。
- 狗叫旋律迁移为有界节拍队列、12 步轮廓、录音基准校音和轻量和声。
- 安装版覆盖旧 Electron 安装记录并保留 `%APPDATA%\dagou-pet\settings.json`。
- Portable 更新改为打开官方 Release，安装版支持应用内覆盖更新。
- 删除 Electron、Node.js、Vite、uiohook、Koffi 及其构建文件。

### 修复

- `F13-F24` 和媒体键不会触发隐藏狗叫。
- 暂停狗叫、系统休眠和漏发松键时会结束持续音。
- `大狗` 模式后续 `gou` 播完后不会再次进入无限循环。
- 默认按键摘要分别显示 `Delete` 和 `Num Delete`。

## [0.3.1] - 2026-07-23

- 普通输入只接受设置页支持的按键。

## [0.3.0] - 2026-07-23

- 增加狗叫旋律、声音与交互调整。

## [0.2.0] - 2026-07-23

- 增加设置页、更新入口、缩放、镜像、置顶、鼠标穿透和发布文档。

[未发布]: https://github.com/Seb1900/dagou-pet/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Seb1900/dagou-pet/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/Seb1900/dagou-pet/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Seb1900/dagou-pet/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Seb1900/dagou-pet/releases/tag/v0.2.0
