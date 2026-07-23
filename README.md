# 大狗桌宠

![大狗桌宠预览](assets/dagou/sprites/idle.png)

[下载最新版](https://github.com/Seb1900/dagou-pet/releases/latest) · [反馈问题](https://my.feishu.cn/share/base/form/shrcnGOLHXa8CDRLcwwbDGRI9cf) · 当前版本 `0.3.1`

一个会响应全局键盘输入的 Windows 桌宠。用户在其他应用中打字时，桌宠会播放 `da`、`gou`、`jiao` 三种键盘声音并做出动作；点击桌宠会播放独立的 `ei` 互动音效。应用不会抢走当前窗口焦点或拦截原有按键。

官方版本免费发布。未经版权方书面许可，不得将本项目、修改版或打包程序用于销售、付费分发及其他商业用途，具体条款以 [PolyForm Noncommercial License 1.0.0](LICENSE.md) 为准。

## 下载与系统要求

官方安装包只会出现在 [Seb1900/dagou-pet Releases](https://github.com/Seb1900/dagou-pet/releases)。请核对文件名和 `SHA256SUMS.txt`，不要从收费下载站或来源不明的网盘获取程序。

- Windows 10/11 x64
- 安装版：写入所选安装目录，创建开始菜单和可选桌面快捷方式，支持应用内检查、下载和重启安装。
- 免安装版：直接运行，不写入安装信息；更新时会打开官方发布页，由用户手动替换文件。

| 文件 | 适合场景 |
| --- | --- |
| `Dagou-Desktop-Pet-Setup-<版本>-x64.exe` | 日常长期使用，需要开始菜单和应用内更新 |
| `Dagou-Desktop-Pet-Portable-<版本>-x64.exe` | 临时使用、不便安装或需要自行管理文件 |

## 功能

- 狗叫旋律开关：开启后会在原有节奏上加入循环的音高起伏，关闭后原调即时响应。
- 两种声音模式：`大 / 狗`、`大狗`。
- 狗叫旋律开启或关闭时都支持长按延音；松键后会从循环接回原始录音尾音。
- `gou` 继承对应 `da` 的键区与声像表达，可调节旋律速度、音量和反应强度。
- 支持 `65%–500%` 无级缩放、左右镜像、上下镜像和位置记忆。
- 鼠标悬停进入害羞状态，点击播放 `ei` 并触发身体回弹和摇尾巴；左键拖动可移动桌宠。
- 右键桌宠直接打开紧凑设置面板，托盘保留暂停、鼠标穿透、置顶、复位和退出。
- 强制置顶使用 Electron `screen-saver` 层级，并在窗口显示、系统恢复或显示器变化后重新设置。
- 设置文件支持格式迁移、本地备份和损坏恢复。

## 使用

启动后，桌宠常驻系统托盘：

- 右键桌宠打开设置。
- 左键单击托盘图标打开设置，右键托盘图标使用常用运行控制。
- 鼠标移动到狗的缩放角后拖动可调整大小；镜像后缩放角会随狗切换方向。
- 鼠标移动到狗本体会进入害羞状态；左键单击触发互动，按住拖动可移动。

全局快捷键：

| 功能 | 首选快捷键 | 冲突时回退 |
| --- | --- | --- |
| 鼠标穿透 | `Ctrl+Alt+D` | `Ctrl+Alt+Shift+D` |

## 已知限制

- 当前只支持 Windows 10/11 x64。
- 全局键盘 Hook 可能被安全软件拦截，远程桌面、部分游戏和高权限窗口中的输入也可能无法捕获。
- 免安装版不自动替换自身，需要从官方发布页手动下载新版。
- 应用内更新已具备完整基础流程，仍需用后续真实版本完成首次跨版本升级验收。

## 常见问题

### 杀毒软件提示键盘监听

桌宠使用全局键盘按下和松开事件驱动声音。事件只在本机转换为声音角色和动作参数，不保存字符、窗口标题或输入历史。可以在托盘菜单中暂停监听。详细说明见 [PRIVACY.md](PRIVACY.md)。

### 桌宠点不到或无法拖动

检查托盘中的“鼠标穿透”是否开启。快捷键 `Ctrl+Alt+D` 可切换鼠标穿透。

### 如何确认下载的是官方版本

查看下载页面仓库名是否为 `Seb1900/dagou-pet`，并核对 Release 附带的 SHA-256。官方版本不会收费。版本变化统一记录在 [CHANGELOG.md](CHANGELOG.md)。

## 开发

需要 Windows 10/11 x64、Node.js 22.12 或更新版本和 npm。

```powershell
npm ci
npm run dev
```

运行自动测试和完整构建：

```powershell
npm run verify
```

生成 Windows 安装版、免安装版和校验值：

```powershell
npm run dist:win
npm run smoke:packaged
```

发布文件生成在 `release/`。构建输出、依赖目录和安装包不会提交到 Git。

```text
assets/                 运行时图片、声音和应用图标
scripts/                打包冒烟与校验值脚本
src/main/               Electron 主进程、托盘和全局键盘监听
src/preload/            Renderer 的受限 IPC 接口
src/renderer/           桌宠、设置页、动画和音频处理
src/shared/             主进程与 Renderer 共用的契约和设置
test/                   Vitest 自动测试
```

贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，正式发布和更新步骤见 [docs/release-and-update-plan.md](docs/release-and-update-plan.md)。

## 隐私、许可与致谢

- 开发者与项目维护者：Seb1900
- 美术、声音和图标：Seb1900，详见 [素材来源台账](assets/ASSET_PROVENANCE.md)
- 项目许可：[PolyForm Noncommercial License 1.0.0](LICENSE.md)
- 隐私说明：[PRIVACY.md](PRIVACY.md)
- 第三方许可：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- 安全报告：[SECURITY.md](SECURITY.md)
- 支持渠道：[SUPPORT.md](SUPPORT.md)

Copyright 2026 Seb1900.
