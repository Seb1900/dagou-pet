# 节奏乐谱模式设计

## 目标

节奏乐谱模式让任意键盘输入同时满足三件事：按键动作立即有视觉反馈、声音稳定落在节拍上、不同按键产生的音高在同一时刻保持和谐。原有即时反馈模式完整保留，供需要最低听觉延迟时切换。

## 参考与取舍

- [Mikutap](https://aidn.jp/mikutap/) 使用固定时间网格和预先校音的声库，使随意输入仍有稳定律动。大狗采用相同原则，但节奏乐谱只使用项目自带的三个键盘声音；点击用 `ei` 不参与音阶、和弦或量化。
- [Dagou-Tap-New](https://github.com/MarkCup-Official/Dagou-Tap-New) 展示了 128 BPM 队列与 `I-V-vi-IV` 伴奏的方向。本实现仅做行为层对照，不复制其代码或素材。
- Desain 与 Honing 的音乐时间量化研究支持把连续输入映射到离散拍点；Wessel 与 Wright 对交互音乐延迟的研究支持将首次输入保持在很短的安全延迟内。
- Tymoczko 的和弦几何与 Huron 的声部进行原则支持使用共同音和紧凑转位，减少和弦切换时的跳跃。
- Plomp 与 Levelt 对协和度和临界频带的研究支持限制同时声部数量，并让不同声部保持明确音程。

文献：

- P. Desain, H. Honing, “The Quantization of Musical Time,” *Computer Music Journal* 13(3), 1989. [DOI](https://doi.org/10.2307/3679558)
- D. Wessel, M. Wright, “Problems and Prospects for Intimate Musical Control of Computers,” *Computer Music Journal* 26(3), 2002. [DOI](https://doi.org/10.1162/014892602320582945)
- D. Tymoczko, “The Geometry of Musical Chords,” *Science* 313, 2006. [DOI](https://doi.org/10.1126/science.1126287)
- D. Huron, “Tone and Voice: A Derivation of the Rules of Voice-Leading from Perceptual Principles,” *Music Perception* 19(1), 2001. [DOI](https://doi.org/10.1525/mp.2001.19.1.1)
- R. Plomp, W. J. M. Levelt, “Tonal Consonance and Critical Bandwidth,” *JASA* 38(4), 1965. [DOI](https://doi.org/10.1121/1.1909741)

## 当前规则

- 默认 128 BPM、4/4 拍、八分音符网格，每格约 234.38 ms，接近参考项目与 Mikutap 的触发密度。
- 停止输入 3 秒后重启乐句；首个声音只延后 12 ms，连续输入使用 24 ms 调度余量吸附到下一格。
- 输入依次排入最多 2 个未来格；超载时只替换仍在安全调度余量之外的声音。
- 每 8 格切换一次和弦，循环为 C 大调的 `I-V-vi-IV`，即 C-G-Am-F。
- 键盘横向分成 8 档。弱拍保留固定音阶音，强拍与 `jiao` 吸附到当前和弦音。
- 主声部占绝对主体；一个或两个和声声部的总增益低于主声部的 30%，避免同源异速叠加淹没 `da / gou` 的辅音和元音。
- 节奏模式和即时模式都支持长按延音。松键后循环会无静音地接回原始录音尾段；在量化起音前松键也仍会播放完整起音与尾音。
- Renderer 只计算拍点，AudioWorklet 使用绝对音频帧启动声音，避免普通计时器带来的节奏抖动。

## 音高映射

不再把三个样本统一校准到 A4。每段录音使用自己的 YIN 音高锚点，并在最接近原声的音区提供 8 个固定音：

| 样本 | 实测锚点 | 8 档目标音 |
| --- | --- | --- |
| `da` | MIDI 70.90，约 B4 | F4、G4、A4、B4、C5、D5、E5、F5 |
| `gou` | MIDI 62.84，约 D♯4 | A3、B3、C4、D4、E4、F4、G4、A4 |
| `jiao` | MIDI 71.08，约 B4 | F4、G4、A4、B4、C5、D5、E5、F5 |

每个键盘样本都保留一个接近原声的档位和完整一组八档音高，主声移调控制在约 `±7` 个半音内。最终版 `gou` 录音本身更低，因此目标音区整体下移一组，同时保留旧版的键位梯度和一整八度区分；和声保持低增益，避免同源异速叠加盖住原始狗叫。`ei` 始终按原音高单次播放。
