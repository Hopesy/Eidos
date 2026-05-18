# CHANFELOG

## [v0.1.13] - 2026-05-18

### Fixed
- 修复账号池生成的图片在 Responses apiStyle 下编辑时 `gen_id` 会被当成 `previous_response_id` 发往上游导致请求失败的问题。
- 修复 `/v1/chat/completions` 图片返回的 data URL MIME 永远是 `image/png`，不随 `output_format` 变化的问题。
- 修复 v1 通道直连 OpenAI 时 `gpt-image-1` / `gpt-image-2` 因为附带 `response_format` 字段被判为非法参数的问题。
- 修复 `/v1/responses` 和 `/v1/chat/completions` 客户端断开后上游请求继续运行，以及重试策略把上游错误文本里的 "400ms" 等数字误判为不可重试状态码的问题。

### Changed
- 重写 `/v1/responses` 端点：支持解析 `input_image`（data URL）、`image_generation` 工具配置（size/quality/output_format）和 `previous_response_id`；遇到 `file_id` 或远程 URL 时返回 400 而非静默丢弃。
- `/v1/images/edits` 与 `/v1/images/upscale` 改为强制 `multipart/form-data`，非该类型直接 415；新增上传张数（≤4）和单张大小（≤32MB）限制，edits 的 `quality` 走 schema 校验。
- v1 三条 images 路由的 dispatch 统一到 `account-service.editImage` / `upscaleImage` 包装函数；upscale 在 API service 通道也开始透传 `sourceReference`。
- 图像 API 单次任务总耗时上限 180s，到点放弃后续重试。
- "高画质" 档位的尺寸映射调整为符合 4K UHD 像素预算（1:1→2880x2880、3:2→3520x2336、2:3→2336x3520），同步收紧 `ImageGenerationSize` 类型与 size schema。
- Responses 通道输出 `id` 改用 `crypto.randomUUID()`；并发部分失败原因聚合到 warn 日志；`parallel_tool_calls` 改为回显请求值，不再硬编码 false。

### Improved
- 路由与 adapter 不再把 prompt 全文写入日志，仅记 `promptLength`；上游错误回显的 body 预览从 400 字节收紧到 200 字节。
- `/v1/images/generations` 的 `n` 参数现支持字符串数字。

## [v0.1.12] - 2026-05-10

### Changed
- 图片工作台将增强能力从顶部一级模式降级为结果卡片的快捷动作，保留 `/v1/images/upscale`、历史记录、请求日志与重试恢复兼容。
- 图片预览放大镜默认倍率调整为 2x，并在预览窗口右上角新增保存按钮与 `S` 快捷保存。
- 图片工作台的生成/编辑模式切换控件按两项入口收窄，并统一编辑相关图标。

### Fixed
- 修复账号刷新网络异常时状态列展示长文案的问题，改为独立显示“网络异常”。
- 修复图片生成重试、上游处理中提示、示例卡片默认质量和 ChatGPT 下载认证相关体验问题。

## [v0.1.11] - 2026-05-02

### Added
- 新增 Next.js App Router 架构文档，明确 Server Component 页面壳、Client Component 交互层、Route Handler 校验与 feature/server 边界。
- 图片编辑模式新增手绘遮罩入口，支持在已上传源图上直接添加遮罩。

### Changed
- 真实业务页面迁移到 `(app)` 路由组，并改为 Server Component 首屏取数 + Client Component 交互的结构。
- 账号、图片、请求、设置页面拆分为页面壳与客户端组件，补齐 `loading`、`error`、`not-found` 边界文件。
- 图片下载文件名改为 `提示词-模型ID-分辨率` 格式。

### Fixed
- 修复批量图片失败后，重试其中一张会锁住其他失败图片重试按钮的问题。
- 修复生成完成后分辨率选择被重置的问题。
- 修复图片文件列表从 SQLite 返回非普通对象导致 RSC 序列化失败的问题。
- 为多张失败图片并发重试增加同会话更新队列，避免结果互相覆盖。

## [v0.1.10] - 2026-04-28

### Fixed
- 修复旧版 Eidos 正在运行时，新安装包覆盖升级仍可能因为旧版卸载器返回失败而停留在旧版本的问题。

### Changed
- Windows Release 只上传带平台后缀的安装包资产，安装包命名改为 `Eidos-Setup-<version>-win-x64.exe`。
- Release 不再上传 `builder-debug.yml` 与 `.blockmap` 这类构建调试/差分更新辅助文件。
- 新安装器在旧版卸载器失败时会接管清理旧安装目录与旧卸载注册表项，再继续安装新版。

## [v0.1.9] - 2026-04-28

### Fixed
- 修复桌面版访问账号/配置等 SQLite 接口时，Next.js 打包产物把 `node:sqlite` 静态 `require` 改写成 `Unsupported external type Url for commonjs reference` 占位错误的问题。
- 修复从桌面端启动更新安装包时旧版 Eidos 仍占用安装目录，导致旧版本卸载/覆盖安装失败的问题。

### Changed
- SQLite 内置模块改为运行时通过 `process.getBuiltinModule` / 原生 `require` 动态加载，避开 Next/Turbopack 对 `node:sqlite` 的错误外部化。
- 安装包启动后桌面端会自动退出；安装器/卸载器会先关闭残留的 `Eidos.exe` 进程，再执行覆盖安装或卸载。

## [v0.1.8] - 2026-04-28

### Fixed
- 修复 `v0.1.7` 安装版仍可能因 Next.js 运行时相对模块解析失败而导致桌面内置服务退出码 1 的问题。

### Changed
- 桌面包保留 Next standalone 的顶层运行时入口副本，同时继续注入 pnpm store `NODE_PATH`，优先保证安装版启动稳定。

## [v0.1.7] - 2026-04-28

### Fixed
- 将桌面端安装包、EXE 与浏览器 favicon 切换为项目主图标（三条横线图标），替换误用的默认三角形图标。

## [v0.1.6] - 2026-04-28

### Fixed
- 修复桌面内置服务在打包后找不到 pnpm standalone 依赖导致启动失败的问题。
- 修复启动阶段服务进程提前退出时错误先显示超时、再显示退出码的问题。
- 修复服务日志目录创建与写入的竞态，避免日志不可用影响桌面启动。

### Changed
- 精简桌面打包产物，移除 standalone 中由 pnpm store 支撑的重复顶层依赖副本与本地助手/临时目录。
- 统一 Windows EXE、NSIS 安装器、卸载器与安装器页眉图标到项目图标。

## [v0.1.5] - 2026-04-28

### Added
- 增加图片请求恢复任务存储、恢复接口与请求记录增强字段，支持展示尝试次数、最终态、API 风格与状态码。
- 新增浏览器模式下的 Release 查询接口，以及应用启动时本地凭据状态静默刷新。

### Changed
- 图像 API 通道改为显式启用后只走 API，并统一文生图、编辑、放大的重试与错误分类逻辑。
- 请求记录页改为按最新时间倒序显示，账号页 CPA 未配置提示改成点击同步时再 toast 提示。
- 图片工作台收口“引用上张”逻辑：默认开启，仅在上一轮为一次多图生成时自动关闭。

### Fixed
- 修复 legacy `data/accounts.json` 会把已删除账号重新回灌 SQLite 的问题。
- 修复 API 编辑/放大链路、审核拒绝分类、图片落盘/取图日志与启动刷新空账号 warning。
- 修复版本检查弹窗在浏览器模式下无法读取最新 Release 信息的问题。

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
