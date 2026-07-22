# 参与贡献

感谢关注大狗桌宠。提交代码前请先搜索现有 Issue；涉及交互、声音策略或较大结构调整时，建议先开 Issue 说明目标和验收方式。

## 开发流程

1. 在 Windows 10/11 x64 和 Node.js 22.12 或更新版本安装依赖：`npm ci`。
2. 从独立分支完成范围明确的修改。
3. 为行为变化添加或更新测试。
4. 运行 `npm run verify`。
5. 在 Pull Request 中说明用户可见变化、测试结果和相关 Issue。

请勿提交 `node_modules/`、`dist/`、`dist-electron/`、`release/`、个人设置或密钥。

## 提交要求

- 保留现有 TypeScript 严格检查、安全 Preload 和受限 IPC 边界。
- 用户可见变化写入 `CHANGELOG.md` 的“未发布”部分。
- 新增生产依赖时说明用途、体积、安全风险和许可证，并更新 `THIRD_PARTY_NOTICES.md`。
- 新增图片、声音或图标时提供作者、来源、授权和文件哈希，并更新素材台账。
- 不接受带有广告、追踪、付费解锁、授权码或收集输入内容的改动。

## 许可证

向本仓库提交内容即表示你有权提交，并同意该贡献按项目的 [PolyForm Noncommercial License 1.0.0](LICENSE.md) 提供。商业授权由版权方另行决定，Pull Request 不构成商业授权。

项目名、图标和官方发布身份的使用说明见 [TRADEMARKS.md](TRADEMARKS.md)。
