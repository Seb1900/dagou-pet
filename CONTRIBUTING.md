# 参与贡献

提交代码前请先搜索现有 Issue。涉及声音策略、交互或更新机制的改动，请说明目标和可验证的验收方式。

## 开发流程

1. 安装 Rust stable GNU、MinGW-w64 和 NSIS 3。
2. 在独立分支完成范围明确的修改。
3. 为行为变化添加 Rust 测试。
4. 运行 `cargo fmt --all --check`、`cargo clippy --all-targets -- -D warnings` 和 `cargo test`。
5. 运行 `scripts/build-native-release.ps1` 验证正式构建。
6. 在 Pull Request 中说明用户可见变化、测试结果和相关 Issue。

请勿提交 `target/`、`release/`、个人设置、更新缓存或密钥。

## 提交要求

- 保持 Win32 窗口、Direct2D 渲染、WASAPI 音频线程和设置存储的边界。
- 不在实时音频回调中进行文件、网络或阻塞操作。
- 用户可见变化写入 `CHANGELOG.md`。
- 新增依赖时说明用途、包体影响、安全风险和许可证，并更新 `THIRD_PARTY_NOTICES.md`。
- 新增素材时更新 `assets/ASSET_PROVENANCE.md`。
- 不接受广告、追踪、付费解锁、授权码或收集输入内容的改动。

## 许可证

提交内容即表示贡献者有权提交，并同意贡献按 [PolyForm Noncommercial License 1.0.0](LICENSE.md) 提供。Pull Request 不构成商业授权。
