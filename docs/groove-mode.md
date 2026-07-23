# 节奏乐谱模式设计

## 目标

节奏模式把任意键盘输入整理成稳定、有区分又保持和谐的狗叫演奏。按键动作立即反馈，声音吸附到节拍；即时模式继续保留，用于追求最低听觉延迟的场景。

## 设计约束

- 输入吸附到八分音符网格，BPM 由设置控制。首个输入只使用很短的安全延迟，连续输入按顺序进入有限的未来拍点。
- 队列过载时只替换仍有调度余量的声音，不改动已经临近起音的声音。
- 和声采用 C 大调 `I-V-vi-IV` 循环。强拍与 `jiao` 吸附到当前和弦音，弱拍保留更明显的键区音高差异。
- 键盘横向映射为八个音高区域。`da`、`gou`、`jiao` 分别以自身录音音高为锚点，保留接近原声的档位，避免统一校音破坏狗叫辨识度。
- 主声部始终最突出，和声使用较低增益和协和音程，避免同源异速叠加盖住辅音与元音。
- 节奏模式和即时模式都支持长按循环；松键后接回原始录音尾段。量化起音前松键也不会吞掉尾音。
- 点击使用的 `ei` 是独立 one-shot，不参与键盘音阶、和弦或量化。

具体 BPM 默认值、调度余量、队列长度、音高锚点和增益属于实现参数，源码与测试才是唯一事实来源，不在本文重复固化。

## 处理链路

```text
全局键盘事件
    ↓
主进程分类键区、角色与声像
    ↓
Renderer 立即驱动动作
    ↓
GroovePlayer 决定拍点、样本、音高、和声与声音组生命周期
    ↓
SoundController 将计划发送给 AudioWorklet
    ↓
AudioWorklet 按绝对音频帧起音、循环并衔接尾音
```

因此，Renderer 不只是计算拍点；音乐映射和声音组管理也在 Renderer 中完成。AudioWorklet 负责样本级的准确起音与持续播放，避免普通计时器造成节奏抖动。

实现入口：

- [`src/renderer/groove-player.ts`](../src/renderer/groove-player.ts)：量化、和弦、键区映射和队列策略。
- [`src/renderer/sound-controller.ts`](../src/renderer/sound-controller.ts)：声音组调度和释放。
- [`src/renderer/sustain-processor.js`](../src/renderer/sustain-processor.js)：绝对帧起音、循环与尾音。
- [`test/groove-player.test.ts`](../test/groove-player.test.ts)：稳定节拍、和声约束和乐句状态测试。

## 参考依据

- [Mikutap](https://aidn.jp/mikutap/) 展示了固定时间网格与预先校音声库如何让任意输入保持律动。
- [Dagou-Tap-New](https://github.com/MarkCup-Official/Dagou-Tap-New) 提供了队列和循环和弦的行为参考；本项目不复制其代码或素材。
- Desain 与 Honing 对音乐时间量化的研究支持把连续输入映射到离散拍点。
- Wessel 与 Wright 对交互音乐延迟的研究支持把首次输入延迟保持在很短的可控范围。
- Tymoczko、Huron 的和弦与声部进行研究支持共同音和紧凑转位。
- Plomp 与 Levelt 的协和度研究支持限制同时声部数量并保持明确音程。

文献：

- P. Desain, H. Honing, “The Quantization of Musical Time,” *Computer Music Journal* 13(3), 1989. [DOI](https://doi.org/10.2307/3679558)
- D. Wessel, M. Wright, “Problems and Prospects for Intimate Musical Control of Computers,” *Computer Music Journal* 26(3), 2002. [DOI](https://doi.org/10.1162/014892602320582945)
- D. Tymoczko, “The Geometry of Musical Chords,” *Science* 313, 2006. [DOI](https://doi.org/10.1126/science.1126287)
- D. Huron, “Tone and Voice: A Derivation of the Rules of Voice-Leading from Perceptual Principles,” *Music Perception* 19(1), 2001. [DOI](https://doi.org/10.1525/mp.2001.19.1.1)
- R. Plomp, W. J. M. Levelt, “Tonal Consonance and Critical Bandwidth,” *JASA* 38(4), 1965. [DOI](https://doi.org/10.1121/1.1909741)
