# Dagou Pet

一个会响应全局键盘输入的 Windows 桌宠。用户在其他应用中打字时，桌宠会播放 `da`、`gou`、`jiao` 三种声音并做出动作，不会抢走当前窗口焦点或拦截原有按键。

## 功能

- 两种声音模式：`大 / 狗交替`、`按下大，松开狗`。
- 短按播放完整原音，长按进入连续延音，松开后平滑淡出。
- 物理键区映射五声音阶，`gou` 会继承对应 `da` 的音高与声像。
- 可自定义 `jiao` 键、音量、反应强度、延音音高和键区旋律。
- 支持 `65%–160%` 无级缩放、左右镜像、上下镜像和位置记忆。
- 鼠标悬停进入害羞状态，点击触发身体回弹和摇尾巴动画。
- 托盘提供设置、暂停监听、静音、鼠标穿透、强制置顶、复位和退出。
- 强制置顶使用 Electron `screen-saver` 层级，并在窗口重新显示、系统恢复或显示器变化后重新设置。
- 单实例运行，使用安全 Preload、受限 IPC 和内容安全策略。

## 使用

桌宠启动后常驻系统托盘：

- 左键单击托盘图标可打开设置。
- 右键单击托盘图标可使用常用控制。
- 鼠标移动到桌宠右下角可拖动调整大小。
- 鼠标移动到狗本体会进入害羞状态，左键单击会触发摇尾巴。

全局快捷键：

| 功能 | 首选快捷键 | 冲突时回退 |
| --- | --- | --- |
| 静音/恢复 | `Ctrl+Alt+M` | `Ctrl+Alt+Shift+M` |
| 鼠标穿透 | `Ctrl+Alt+D` | `Ctrl+Alt+Shift+D` |

## 开发环境

- Windows 10/11 x64
- Node.js 22.12 或更新版本
- npm

安装依赖并启动开发版：

```powershell
npm ci
npm run dev
```

运行自动测试和完整构建：

```powershell
npm run verify
```

生成 Windows 安装版和便携版：

```powershell
npm run dist:win
```

检查打包后的页面和音频初始化：

```powershell
npm run smoke:packaged
```

发布文件生成在 `release/`：

```text
Dagou-Desktop-Pet-Setup-<version>-x64.exe
Dagou-Desktop-Pet-Portable-<version>-x64.exe
SHA256SUMS.txt
```

## 工程结构

```text
assets/                 运行时图片、声音和应用图标
scripts/                打包冒烟与校验值脚本
src/main/               Electron 主进程、托盘和全局键盘监听
src/preload/            Renderer 的受限 IPC 接口
src/renderer/           桌宠、设置页、动画和音频处理
src/shared/             主进程与 Renderer 共用的契约和设置
test/                   Vitest 自动测试
```

构建输出、依赖目录和安装包不会提交到 Git。

## 隐私与安全

全局键盘 Hook 只处理按下和松开事件。主进程会将物理键转换为按压 ID、声音角色、音阶步进和声像，不会保存字符、组合键、输入历史或打字统计，也不会阻止原按键继续传递给当前应用。

托盘中的“暂停监听”会停止全局 Hook。当前发布包未做代码签名，Windows SmartScreen 或安全软件可能对未签名程序和全局键盘 Hook 给出提示。

## 许可证

Copyright 2026 Seb1900.

本项目的源码和随仓库提供的素材使用 [PolyForm Noncommercial License 1.0.0](LICENSE.md)。允许该许可证规定的非商业用途；商业使用需要另行获得授权。
