# 第三方许可声明

大狗桌宠包含或依赖以下第三方软件。各组件仍由其原作者持有版权，并按各自许可证提供。

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Electron、Chromium、Node.js | 桌面运行环境 | MIT、BSD 及各上游组件许可证 |
| electron-updater 及 builder-util-runtime | GitHub Release 更新 | MIT |
| uiohook-napi、libuiohook | Windows 全局按键事件 | MIT |
| node-gyp-build | 原生模块加载 | MIT |
| fs-extra、jsonfile、universalify | 更新文件处理 | MIT |
| js-yaml、argparse | 更新清单解析 | MIT、Python-2.0 |
| debug、ms | 运行日志支持 | MIT |
| sax | XML 解析 | BlueOak-1.0.0 |
| graceful-fs、semver | 文件系统兼容和版本比较 | ISC |
| lazy-val、lodash.escaperegexp、lodash.isequal、tiny-typed-emitter | 更新工具内部支持 | MIT |

生产依赖的准确版本记录在 `package-lock.json`。Electron 发布目录中的 `LICENSE` 和 `LICENSES.chromium.html` 包含 Electron、Chromium 及其上游组件的详细声明；各 npm 包中的 `LICENSE` 文件包含对应许可证全文。

项目自身的使用条款见 [LICENSE.md](LICENSE.md)。项目素材的作者记录见 [assets/ASSET_PROVENANCE.md](assets/ASSET_PROVENANCE.md)。

如发现遗漏或归属错误，请通过[官方仓库 Issues](https://github.com/Seb1900/dagou-pet/issues)提出更正。
