# CLAUDE.md

## 打包 / 发版规则

- Windows 发版工作流是 `.github/workflows/electron-release.yml`，在 **push 任意 git tag** 时自动触发。
- 工作流发布说明读取的是仓库根目录 **`CHANFELOG.md`**，注意这里的文件名就是 `CHANFELOG.md`，不是 `CHANGELOG.md`。
- 工作流会用当前 tag 名精确匹配 `CHANFELOG.md` 里的版本标题，格式必须是：`## [vX.Y.Z] - YYYY-MM-DD`。
- 版本标题里的 tag 必须和实际 git tag **完全一致**，包括前面的 `v`。例如：推 `v0.1.4` 时，`CHANFELOG.md` 中必须存在 `## [v0.1.4] - 2026-04-27`。
- `electron-release` 已关闭 `generate_release_notes`，所以 **如果 `CHANFELOG.md` 没有对应版本段落，工作流会直接失败**。

## 发版前检查清单

1. 同步更新版本号：
   - `package.json`
   - `electron/package.json`
2. 在 `CHANFELOG.md` 中新增对应版本段落，tag 名必须精确匹配。
3. 只提交本次发版需要的代码与资源，不要把本地临时文件带进发版提交。
4. 先提交 release commit，再创建并 push tag。

## 本项目当前打包流程

- 根目录安装依赖：`pnpm install --frozen-lockfile`
- `electron/` 目录安装依赖：`npm ci`
- Windows 安装包构建命令：在 `electron/` 目录执行 `npm run dist:win`
- 发布与上传的产物目录：`electron/dist/*`

## 发版卫生规则

- 默认不要把这些内容带进发版提交，除非用户明确要求：
  - `logs/`
  - `.claude/`
  - 其他本地调试或临时文件
- 如果某个 tag 已经 push，且因为缺少 `CHANFELOG.md` 对应版本说明导致失败，**默认优先发一个新版本 tag**；不要擅自改写、删除或强推已发布 tag，除非用户明确要求。
