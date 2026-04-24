---
created: 2026-04-23
reason: 将 ChatGpt-Image-Studio-main 参考项目的 UI 与全部功能迁移到当前 Eidos Next.js 项目，保持 Next.js + TypeScript + Tailwind v4 技术栈不变。
---

# ChatGpt Image Studio UI 全量迁移方案

## 1. 项目对比摘要

### 当前 Eidos 项目（目标）
- **框架**：Next.js 16.2.3（App Router）
- **语言**：TypeScript + Tailwind v4
- **UI库**：shadcn/ui（Radix UI 底层）+ lucide-react + sonner
- **状态**：Zustand + localforage
- **现有页面**：`/login`、`/accounts`、`/image`
- **导航**：顶部横向 TopNav（Header 样式）
- **现有 API Routes**：`/api/accounts`（GET/POST/DELETE）、`/api/accounts/refresh`、`/api/accounts/update`、`/api/version`、`/v1/images/generations`、`/v1/chat/completions`、`/v1/models`、`/v1/responses`
- **缺失后端能力**：无 `/api/accounts/import`、`/api/accounts/{id}/quota`、`/api/sync/status`、`/api/sync/run`、`/api/config`、`/api/requests`、`/v1/images/edits`、`/v1/images/upscale`

### 参考项目（源）
- **框架**：Vite + React Router（SPA），不是 Next.js
- **导航**：侧边栏（可折叠），使用 react-router-dom 的 `Link` / `useLocation`
- **新增页面**：`/settings`（配置管理）、`/requests`（调用请求）
- **新增组件**：`ImageEditModal`（Canvas 遮罩画笔编辑）、`AppImage`（普通 img 封装）
- **新增 Store**：`image-active-tasks.ts`（进行中任务追踪）、`sync-status-cache.ts`（同步状态缓存）
- **图片工作台升级**：支持生成、编辑（inpaint）、放大三种模式；多 turn 对话；侧边历史列表；Canvas 遮罩

---

## 2. 技术栈适配规则

| 参考项目写法 | Eidos 等价写法 |
|---|---|
| `import { Link } from "react-router-dom"` | `import Link from "next/link"` |
| `import { useLocation } from "react-router-dom"` | `import { usePathname } from "next/navigation"` |
| `import { useNavigate } from "react-router-dom"` | `import { useRouter } from "next/navigation"` |
| `navigate("/image", { replace: true })` | `router.replace("/image")` |
| `<img src=... />` (AppImage) | 直接 `<img />` 或保留 AppImage 封装 |
| SPA 路由（`/image.html` 兼容） | Next.js App Router 路由，无 html 后缀 |

---

## 3. 完整变更清单

### 3.1 数据模型与 Store 层

#### 3.1.1 `src/lib/api.ts` — 扩展类型与 API 函数
新增以下类型：
- `SyncStatus`、`SyncAccount`、`SyncRunResult`、`SyncStatusResponse`
- `AccountImportResponse`、`AccountQuotaResponse`
- `ConfigPayload`（含 app/server/chatgpt/accounts/storage/sync/proxy/cpa/log/paths 字段）
- `RequestLogItem`、`VersionInfo`
- `ImageMode`（`"studio" | "cpa" | "mix"`）
- `ImageResponseItem`（含 `file_id`、`gen_id`、`conversation_id` 等额外字段）
- `InpaintSourceReference`

新增以下函数：
- `importAccountFiles(files: File[])` → POST `/api/accounts/import` multipart
- `fetchAccountQuota(accountId, options)` → GET `/api/accounts/{id}/quota`
- `fetchSyncStatus()` → GET `/api/sync/status`
- `runSync(direction)` → POST `/api/sync/run`
- `fetchConfig()` → GET `/api/config`
- `fetchDefaultConfig()` → GET `/api/config/defaults`
- `updateConfig(config)` → PUT `/api/config`
- `fetchRequestLogs()` → GET `/api/requests`
- `fetchVersionInfo()` → GET `/version`
- `editImage(...)` → POST `/v1/images/edits` multipart
- `upscaleImage(...)` → POST `/v1/images/upscale` multipart
- 修改 `generateImage`：支持 `count` 参数，返回类型扩展为 `ImageResponseItem[]`

修改 `Account` 类型：新增 `fileName`、`provider`、`disabled`、`note`、`priority`、`syncStatus`、`syncOrigin`、`lastSyncedAt`、`remoteDisabled` 字段

#### 3.1.2 `src/store/image-conversations.ts` — 大幅升级
- 新增 `ImageMode` 类型（`"generate" | "edit" | "upscale"`）
- 新增 `StoredSourceImage` 类型（id/role/name/dataUrl）
- `StoredImage` 新增：`file_id`、`gen_id`、`conversation_id`、`parent_message_id`、`source_account_id`
- 新增 `ImageConversationTurn` 类型（多轮对话单个 turn）
- `ImageConversation` 新增：`mode`、`scale`、`sourceImages`、`turns`
- 新增 `normalizeConversation` 导出函数（旧数据兼容）
- 新增 `updateImageConversation` 函数
- 新增 `getImageConversation` 函数
- 重构内部缓存机制（`cachedConversations` + `writeQueue` + `loadPromise`）
- localforage instance name 改为 `chatgpt2api-studio`

#### 3.1.3 `src/store/image-active-tasks.ts` — 全新文件
进行中图片任务的全局注册/注销/订阅，无 React 依赖，纯 Map + listener 模式

#### 3.1.4 `src/store/sync-status-cache.ts` — 全新文件
简单模块级单例缓存 `SyncStatusResponse`，供 accounts 页面跨导航复用

---

### 3.2 组件层

#### 3.2.1 `src/components/top-nav.tsx` — 重构为侧边栏导航
- 改为左侧 `<aside>` 侧边栏布局（桌面）+ 顶部 header（移动端）
- 支持折叠/展开（collapsed state）
- 导航项新增：图片工作台、账号管理、**配置管理**、**调用请求**
- 显示版本号（调用 `fetchVersionInfo`）
- 退出登录逻辑不变

#### 3.2.2 `src/components/app-image.tsx` — 全新文件
轻量封装 `<img>`，替代 Next.js Image 组件（参考项目无需 next/image 优化）

#### 3.2.3 `src/components/image-edit-modal.tsx` — 全新文件
Canvas 遮罩画笔编辑弹窗，完整移植：
- 画笔大小控制（range input）
- 选择模式开关（brush cursor 跟随）
- 撤销/重做/清空 stroke
- 导出 mask.png（透明通道白底+描边区域透明）
- 提交 prompt + mask 到上层回调

---

### 3.3 页面层

#### 3.3.1 `src/app/layout.tsx` — 调整布局
- 将 `<TopNav />` 从顶部改为与内容同行的侧边栏模式
- Layout 改为 `flex flex-row`，TopNav 在左，main 在右
- main 高度 `h-screen`，内容 `overflow-hidden`
- 移除 `min-h-screen px-4 py-3` 等原有外边距

#### 3.3.2 `src/app/login/page.tsx` — 完整替换
- 两栏布局：左侧深色品牌面板 + 右侧登录表单
- 登录后跳转 `/image`（替换现有跳转 `/accounts`）
- 风险提示 amber 卡片
- 功能特性三栏卡片展示

#### 3.3.3 `src/app/page.tsx` — 修改重定向目标
- `redirect("/image")` 替代现有的 `redirect("/accounts")`

#### 3.3.4 `src/app/image/page.tsx` — 完整重写（最复杂）
核心升级：
- **三种模式**：生成（generate）/ 编辑（edit）/ 放大（upscale）
- **侧边历史列表**：可折叠，显示多 turn 对话，支持删除/清空
- **多 turn 对话**：每次操作追加为新 turn，保留历史
- **图片结果区**：支持 Zoom 预览、复制 base64、继续编辑（触发 ImageEditModal）、继续生成、放大
- **输入区**：上传参考图/源图/遮罩，粘贴图片，模型/数量/比例选择器
- **进度追踪**：`image-active-tasks` 注册，per-image loading state
- **历史面板切换**：PanelLeftOpen/Close 按钮

#### 3.3.5 `src/app/accounts/page.tsx` — 大幅升级
新增功能：
- **导入认证文件**（JSON 文件 multipart 上传）
- **per-账号额度刷新**（`fetchAccountQuota`）
- **同步状态面板**：显示本地/远端数量、各状态分布、最近同步结果
- **运行同步**（pull/push）
- **账号同步状态列**（syncStatus badge）
- **账号优先级、备注、文件名**显示
- 编辑弹窗新增 `note` 字段
- 搜索支持 `fileName`、`note` 字段

#### 3.3.6 `src/app/settings/page.tsx` — 全新页面
配置管理：
- 获取/保存后端配置（`fetchConfig` / `updateConfig`）
- 多 section：应用配置、ChatGPT 配置、账号配置、存储配置、同步配置、代理配置、CPA 配置、日志配置、路径信息（只读）
- HintTooltip 组件（悬浮说明）
- 重置默认值按钮

#### 3.3.7 `src/app/requests/page.tsx` — 全新页面
调用请求日志：
- 表格展示 `RequestLogItem` 列表
- 字段：时间、操作、模式、方向（官方/CPA）、路由、接口、账号、模型、结果、错误
- 手动刷新按钮

---

### 3.4 后端 API Routes（新增/扩展）

#### 需要新增的 Route 文件：
1. **`src/app/api/accounts/import/route.ts`** — POST multipart JSON 文件导入账号
2. **`src/app/api/accounts/[id]/quota/route.ts`** — GET 刷新单账号图片额度
3. **`src/app/api/sync/status/route.ts`** — GET 同步状态（初期可返回 `configured: false` 占位）
4. **`src/app/api/sync/run/route.ts`** — POST 执行同步（初期可返回未配置错误）
5. **`src/app/api/config/route.ts`** — GET/PUT 配置读写（初期可返回当前 RuntimeConfig）
6. **`src/app/api/config/defaults/route.ts`** — GET 默认配置
7. **`src/app/api/requests/route.ts`** — GET 最近请求日志
8. **`src/app/v1/images/edits/route.ts`** — POST 编辑图片（inpaint）
9. **`src/app/v1/images/upscale/route.ts`** — POST 放大图片
10. **`src/app/api/version/route.ts`** — 已存在，确认返回格式符合 `VersionInfo`

#### 现有 Route 修改：
- **`src/app/v1/images/generations/route.ts`**：支持 `n > 1`、返回扩展字段（`file_id`、`gen_id` 等）、支持 `response_format: b64_json`

---

### 3.5 样式调整

#### `src/app/globals.css`
- 新增 `.hide-scrollbar` 工具类（已存在，确认保留）
- 整体主题色系沿用 stone 色板，无需大改

---

## 4. 后端能力差距分析与策略

| 参考项目 API | 当前 Eidos 状态 | 迁移策略 |
|---|---|---|
| `/api/accounts/import` | 缺失 | 新增 Route，复用现有 addAccounts + refreshAccounts 逻辑，支持文件解析 |
| `/api/accounts/{id}/quota` | 缺失 | 新增 Route，调用 ChatGPT limits_progress 接口，更新账号数据 |
| `/api/sync/status` | 缺失 | 新增 Route，初期返回 `{ configured: false, local: N, remote: 0, ... }` |
| `/api/sync/run` | 缺失 | 新增 Route，初期返回"同步未配置"错误，UI 正常显示 |
| `/api/config` GET/PUT | 缺失 | 新增 Route，读写 RuntimeConfig 到文件/环境变量 |
| `/api/requests` | 缺失 | 新增 Route，内存环形日志记录最近 N 条图片请求 |
| `/v1/images/edits` | 缺失 | 新增 Route，调用 ChatGPT images/edits 接口，支持 FormData |
| `/v1/images/upscale` | 缺失 | 新增 Route，调用 ChatGPT gizmo 放大接口 |
| `/version` | 已存在 | 确认返回格式（`{ version, commit?, buildTime? }`）|

---

## 5. 执行顺序（推荐）

```
阶段一：数据基础（Store & API 类型）
  1. src/lib/api.ts 扩展类型与 API 函数
  2. src/store/image-conversations.ts 升级
  3. src/store/image-active-tasks.ts 新增
  4. src/store/sync-status-cache.ts 新增

阶段二：布局与导航
  5. src/components/top-nav.tsx 重构为侧边栏
  6. src/app/layout.tsx 调整为侧边栏 flex 布局
  7. src/app/page.tsx 改重定向到 /image

阶段三：新增通用组件
  8. src/components/app-image.tsx 新增
  9. src/components/image-edit-modal.tsx 新增

阶段四：页面重写
  10. src/app/login/page.tsx 替换为两栏布局
  11. src/app/image/page.tsx 完整重写
  12. src/app/accounts/page.tsx 大幅升级
  13. src/app/settings/page.tsx 新增
  14. src/app/requests/page.tsx 新增

阶段五：后端 API Routes
  15. src/app/api/accounts/import/route.ts
  16. src/app/api/accounts/[id]/quota/route.ts
  17. src/app/api/sync/status/route.ts
  18. src/app/api/sync/run/route.ts
  19. src/app/api/config/route.ts
  20. src/app/api/config/defaults/route.ts
  21. src/app/api/requests/route.ts
  22. src/app/v1/images/edits/route.ts
  23. src/app/v1/images/upscale/route.ts
  24. 验证 src/app/api/version/route.ts 返回格式
  25. 修改 src/app/v1/images/generations/route.ts 支持多张
```

---

## 6. 关键决策与约束

1. **不引入新依赖**：`react-medium-image-zoom` 已在 package.json，直接使用；`react-router-dom` 不引入，全部用 Next.js 导航
2. **图片存储方式**：继续用 `b64_json` base64 存 localforage，不切换为 URL
3. **主题**：保留现有深色/浅色主题切换能力（ThemeProvider 不变）
4. **侧边栏宽度**：折叠 92px，展开 228px，与参考项目一致
5. **同步/配置功能**：前端 UI 完整移植，后端 API 仅做骨架实现（occupied stub），不实现实际远端同步逻辑（Go 后端才有此能力）
6. **请求日志**：在 Next.js server 侧用内存环形队列记录最近 200 条，跨请求共享
7. **Canvas 遮罩编辑**：完整实现（纯前端，无后端依赖）
