# chatgpt2api Next.js 全栈版

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

   向上游走的是 **ChatGPT 会话链**，也就是项目内部维护的 `chatgpt.com/backend-api/*` 路径，例如：

   - `backend-api/conversation`
   - `backend-api/conversation/init`
   - 文件下载相关 `backend-api/files/*` / `backend-api/conversation/*/attachment/*/download`

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

### 图片工作台比例 / 画质说明

图片工作台在“生成”模式下支持比例与画质选择，当前 UI 与 OpenAI Images API 参数的对应关系如下：

- 比例实际对应官方支持的图片尺寸：
  - `1024x1024`
  - `1536x1024`
  - `1024x1536`
  - `auto`
- 画质实际对应：
  - `auto`
  - `low`
  - `medium`
  - `high`

因此当前界面的文案映射为：

- `自动比例` -> `auto`
- `1:1 方图` -> `1024x1024`
- `3:2 横图` -> `1536x1024`
- `2:3 竖图` -> `1024x1536`
- `自动画质` -> `auto`
- `2K(中)` -> `medium`
- `4K(高)` -> `high`

说明：

- `2K(中)` / `4K(高)` 是当前前端给用户的易懂文案，底层并不是直接把 `2k` / `4k` 发给 OpenAI，而是映射到官方支持的 `medium` / `high`
- 如果当前请求走标准 Images API 服务路径，会直接传 `size` / `quality`
- 如果当前请求走本地 ChatGPT 会话链路，则会把比例 / 画质要求补进 prompt，保证两条链路都能吃到这个设置

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

