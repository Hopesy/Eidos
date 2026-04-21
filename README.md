# chatgpt2api Next.js 全栈版

本项目现已收敛为 **Next.js 16 全栈应用**：

- UI：App Router + React 19
- 组件：标准 shadcn/ui 组件基线
- 主题：已按 `tweakcn` 的 **Supabase** 风格变量整理，后续换主题只需要继续替换 CSS variables
- 服务端：Next.js Route Handlers 承载登录、账号管理、额度刷新与 OpenAI 兼容图片接口
- 存储：本地 `data/accounts.json`
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

---

## 目录

```text
.
├─ data/
├─ public/                 # 静态资源
├─ src/
│  ├─ app/                # 页面 + Route Handlers
│  ├─ components/         # shadcn/ui + 页面布局
│  └─ server/             # 服务端业务 / 存储 / 上游调用
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

```powershell
pnpm dev
```

可选环境变量：

```powershell
$env:CHATGPT2API_AUTH_KEY='your-auth-key'
$env:REFRESH_ACCOUNT_INTERVAL_MINUTE='5'
```

- `CHATGPT2API_AUTH_KEY`：设置后启用接口鉴权；不设置则本地默认免鉴权
- `REFRESH_ACCOUNT_INTERVAL_MINUTE`：限制账号后台刷新轮询间隔，默认 `5`

默认访问：

- Web UI: `http://127.0.0.1:3000`
- API 示例:
  - `POST /auth/login`
  - `GET /api/accounts`
  - `POST /api/accounts/refresh`
  - `POST /v1/images/generations`

---

## 构建

```powershell
pnpm build
pnpm start
```

---

## 鉴权

所有管理接口与 OpenAI 兼容接口都需要：

```http
Authorization: Bearer <auth-key>
```

仅当你设置了 `CHATGPT2API_AUTH_KEY` 环境变量时才需要携带这个请求头。

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
