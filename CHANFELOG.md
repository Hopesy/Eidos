# CHANFELOG

## [v0.1.3] - 2026-04-27

### Fixed
- 为 `electron-release` workflow 增加 `contents: write` 权限，允许自动创建 GitHub Release 并上传安装包资产。
- 新增基于 tag 从 `CHANFELOG.md` 提取对应版本更新内容并写入 Release Body 的流程。
- 禁用 `generate_release_notes`，避免与自定义版本说明冲突。

## [v0.1.2] - 2026-04-26

### Changed
- 同步主应用与 Electron 壳层版本到 `0.1.2`，重新发版以使用修复后的 CI 打包流程。
- 保持 Windows 安装包命名与应用版本一致。

## [v0.1.1] - 2026-04-26

### Added
- 增加桌面端自动更新能力，支持检查 GitHub Release 并下载安装包。
- 新增更新弹窗与桌面端版本检查入口。

### Changed
- 图像工作台支持生成、编辑、放大三种模式的统一历史记录与结果持久化。
- 图像结果、对话记录和账号数据迁移到 SQLite / 本地文件存储。

### Fixed
- 移除登录/登出与鉴权门槛，改为直接使用本地工作流。
- 修复放大功能未正确上传源图、错误把提示词当结果回显的问题。
- 修复构建 tracing warning、图像多图重试与失败回填逻辑。
