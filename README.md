# Eidos 图片工作台

本项目现已收敛为 **Next.js 16 全栈应用**：

- UI：App Router + React 19
- 组件：标准 shadcn/ui 组件基线
- 主题：已按 `tweakcn` 的 **Supabase** 风格变量整理，后续换主题只需要继续替换 CSS variables
- 服务端：Next.js Route Handlers 承载账号管理、额度刷新与 OpenAI 兼容图片接口
- 存储：结构化数据写入本地 SQLite `data/eidos.db`；图片文件写入 `data/images/`，上传源图/遮罩写入 `data/uploads/`
- 运行时：纯 Node.js / Next.js，不再包含 Python 入口、依赖或服务层

---

## 功能

- 兼容 OpenAI `POST /v1/images/generations`
- 兼容 OpenAI `POST /v1/chat/completions` 的图片请求
- 兼容 OpenAI `POST /v1/responses` 的图片生成工具调用
- Web 账号池管理
- Access Token / Session JSON / CPA JSON 导入
- 自动刷新账号邮箱、套餐、额度、恢复时间
- 轮询可用账号进行图片生成
- 失效 Token 自动剔除

### 接口暴露层 vs 上游实际链路

本项目**对下游统一暴露 OpenAI 风格 `/v1/*` 接口**，但**向上游实际调用的链路并不只有一种**。

#### 对下游统一暴露的接口

- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /v1/images/upscale`
- `POST /v1/chat/completions`
- `POST /v1/responses`

#### 向上游实际调用的两条主链

1. **账号池模式**

   向上游走的是 **ChatGPT Web 会话链**。本质上，`chatgpt.com` 网页本身是一个前端应用：用户在网页里点击发送时，浏览器会带着当前账号的登录态、设备信息和校验 token 请求 ChatGPT 的 Web 后端。账号池模式不打开浏览器、不模拟鼠标点击，而是在服务端使用账号池里已经保存的 `access_token` 和浏览器指纹信息，把 Eidos 自己作为一个非浏览器客户端，直接构造 ChatGPT Web 前端会发出的请求。

   因此，这条链不是“免登录”或“绕过登录”。它依赖账号池里已有的有效 ChatGPT 登录凭证：

   - `Authorization: Bearer <access_token>` 用于代表具体 ChatGPT 账号
   - `oai-device-id`、`oai-session-id`、`user-agent`、`sec-ch-ua*` 用于补齐 Web 客户端上下文
   - `openai-sentinel-chat-requirements-token` / `openai-sentinel-proof-token` 用于满足 ChatGPT Web 后端的请求校验

   生图时，Eidos 会把本地 `/v1/images/*` 请求翻译成一条 ChatGPT conversation 消息。ChatGPT 后端在该会话中执行图片生成工具，返回 SSE 流、会话状态和图片资源指针；Eidos 再解析 `conversation_id`、`parent_message_id`、图片文件 ID，轮询会话结果，下载图片，并包装成 OpenAI 风格响应返回给下游。

   当前账号池模式会用到的 ChatGPT Web 上游接口包括：

   - `GET /`：初始化 ChatGPT Web 会话，捕获前端构建信息和 Cookie
   - `POST /backend-api/sentinel/chat-requirements`：获取发送会话消息前需要的校验 token / proof 要求
   - `POST /backend-api/conversation`：发送会话消息，触发对话式生图
   - `GET /backend-api/conversation/{conversation_id}`：轮询会话 mapping，查找图片生成工具输出
   - `GET /backend-api/conversation/{conversation_id}/attachment/{file_id}/download`：获取会话附件图片下载地址
   - `GET /backend-api/files/{file_id}/download`：获取普通文件下载地址
   - `POST /backend-api/files`：注册编辑/增强图片时上传的源图或遮罩
   - `POST /backend-api/files/{file_id}/uploaded` / `POST /backend-api/files/process_upload_stream`：完成上传文件处理
   - `GET /backend-api/me`：刷新账号身份信息
   - `POST /backend-api/conversation/init`：刷新账号模型、套餐和 `image_gen` 额度信息

   这条链**不是官方公开 `/v1` API**，而是账号池模式下的会话式上游实现。

2. **图像 API 服务模式**

   向上游走的是**官方公开 Images API**，例如：

   - `POST /v1/images/generations`
   - `POST /v1/images/edits`

   这条链是当前项目里最接近“标准官方图像 API”的实现路径。

#### `/v1/responses` 当前状态

- 项目**已经对下实现了** `POST /v1/responses`
- 但**图片工作台当前主入口并不是走 `/v1/responses`**
- 图片工作台当前主要调用的是：
  - `POST /v1/images/generations`
  - `POST /v1/images/edits`
  - `POST /v1/images/upscale`

因此，可以把当前项目理解为：

- **对下**：统一暴露 OpenAI 风格 `/v1/*`
- **对上**：
  - 账号池模式 -> ChatGPT 会话链
  - API 服务模式 -> 官方 `/v1/images/*`
- **`/v1/responses` 已实现，但不是图片工作台当前主链路**

#### Responses API SSE 流式保活

当图像 API 服务模式选择 `responses` 风格时，上游请求使用 **SSE（Server-Sent Events）流式传输**而非一次性 JSON 响应。

**解决的问题**：大多数中转站架在 Cloudflare 后面，而图像模型推理需要 30~120 秒。Cloudflare 网关在连接空闲 100 秒后会切断连接返回 524 错误。传统的一次性请求在整个推理期间没有数据流动，极易触发此超时。

**工作原理**：

1. 请求时带 `stream: true`，上游不再等推理完成才返回，而是边推理边发送事件
2. 模型推理期间持续收到心跳事件（`response.in_progress`、`image_generation_call.generating` 等），保持 TCP 连接活跃
3. Cloudflare 看到连接上有持续数据流过，不会判定空闲超时

**降级保护**：

- 如果最终结果（`response.output_item.done`）未能送达，会使用推理过程中收到的 `partial_image_b64`（部分图片数据）作为兜底结果
- 如果上游不支持流式响应（返回的不是 `text/event-stream`），自动退回 JSON 解析，不影响兼容性
- 流式模式超时从 120 秒提升到 300 秒（因为流式连接有持续流量，不会被网关掐断）

### 图片工作台比例 / 分辨率档位说明

图片工作台在“生成”模式下把 **比例** 和 **分辨率档位** 拆开了：

- 比例：
  - `Auto`
  - `1:1 方图`
  - `3:2 横图`
  - `2:3 竖图`
  - `16:9 横屏`
  - `9:16 竖屏`
- 分辨率档位：
  - `Auto`
  - `1K`
  - `2K`
  - `4K`

底层不是直接把 `1K / 2K / 4K` 发给上游，而是按 **比例 + 档位** 计算真实分辨率，并同时映射质量参数：

- `Auto` -> `size=auto`，`quality=auto`
- `1K` -> `quality=low`
- `2K` -> `quality=medium`
- `4K` -> `quality=high`

当前项目内置映射如下：

| 比例 | 1K | 2K | 4K |
| --- | --- | --- | --- |
| `1:1` | `1024x1024` | `2048x2048` | `2880x2880` |
| `3:2` | `1536x1024` | `3072x2048` | `3520x2336` |
| `2:3` | `1024x1536` | `2048x3072` | `2336x3520` |
| `16:9` | `1920x1088` | `2560x1440` | `3840x2160` |
| `9:16` | `1088x1920` | `1440x2560` | `2160x3840` |

补充说明：

- 上表分辨率都按“宽高最好能被 `16` 整除”的规则收口，避免使用 `1080x1920` 这类不整除尺寸
- 4K 档会继续经过安全上限规整：最大边长不超过 `3840px`、宽高比不超过 `3:1`、总像素不超过 `8294400`
- `background` 参数当前**未在图片工作台暴露，也不主动设置**
- 如果当前请求走标准 Images API 服务路径，会直接传计算后的 `size` / `quality`
- 如果当前请求走标准 Responses API 服务路径，并且在设置页选择了推理强度，会把该值作为 `reasoning.effort` 传给上游主模型；默认档位不主动发送 `reasoning`
- 如果当前请求走本地 ChatGPT 会话链路，则会把最终分辨率 / 画质要求补进 prompt，保证两条链路都能吃到这个设置

### 图片结果增强动作说明

图片工作台不再把“增强”作为顶部一级模式。增强能力保留在图片结果卡片下方的快捷动作中，对外仍然走 `POST /v1/images/upscale`，产品语义收口成：

- **单张源图高清增强**
- 优先提升清晰度、边缘细节、材质纹理与整体成片质感
- **不再暴露旧的 `2x / 4x / 6x / 8x` 倍率文案**

增强动作当前只暴露一个质量档位选择：

- `Auto`
- `1K`
- `2K`
- `4K`

对应关系如下：

- `Auto` -> `quality=auto`
- `1K` -> `quality=low`
- `2K` -> `quality=medium`
- `4K` -> `quality=high`

实现上：

- 如果走标准 Images API 服务路径，会把增强任务收口到单图编辑链并透传 `quality`
- 如果走本地 ChatGPT 会话链路，会把增强强度和“保持原图构图/风格一致”的要求补进 prompt

官方文档：

- Image generation guide: https://platform.openai.com/docs/guides/image-generation
- Images API reference: https://platform.openai.com/docs/api-reference/images/generate

---

## 目录

```text
.
├─ data/                  # SQLite 数据库、图片文件、上传源图、迁移备份
├─ public/                 # 静态资源
├─ src/
│  ├─ app/                # 页面 + Route Handlers
│  ├─ components/         # shadcn/ui + 页面布局
│  └─ server/             # 服务端业务 / SQLite 存储 / 文件存储 / 上游调用
├─ package.json
├─ next.config.ts
└─ tsconfig.json
```

---

## 本地开发

### 1. 安装依赖

```powershell
pnpm install
```

### 2. 启动开发环境

默认启动：

```powershell
pnpm dev
```

指定 `3001` 端口启动：

```powershell
$env:PORT='3001'
pnpm dev
```

Windows `cmd` 也可以使用：

```bat
set PORT=3001 && pnpm dev
```

可选环境变量：

```powershell
$env:REFRESH_ACCOUNT_INTERVAL_MINUTE='5'
```

- `REFRESH_ACCOUNT_INTERVAL_MINUTE`：限制账号后台刷新轮询间隔，默认 `5`
- `PORT`：开发服务监听端口，未设置时 Next.js 默认使用 `3000`

默认访问：

- Web UI: `http://127.0.0.1:3000`
- 若以上文方式指定端口，则访问：`http://127.0.0.1:3001`
- API 示例:
  - `GET /api/accounts`
  - `POST /api/accounts/refresh`
  - `POST /v1/images/generations`
  - `POST /v1/images/edits`
  - `POST /v1/images/upscale`
  - `GET /api/config`
  - `GET /api/requests`

---

## 构建

```powershell
pnpm build
pnpm start
```

---

## 主题说明

当前 UI 已经切到 **shadcn + CSS Variables** 模式：

- 全局令牌在 `src/app/globals.css`
- 主题切换由 `next-themes` 承载
- 组件样式以 `bg-background / bg-card / text-foreground / border-border / text-muted-foreground` 等语义 token 为主

后续如果你要继续换主题，优先只替换：

- `globals.css` 的变量
- 必要时再微调页面级布局

而不是重新改组件实现。

---

## 说明

本项目仅供学习与研究交流。请遵循 OpenAI 的使用条款及当地法律法规，不得用于非法用途。

