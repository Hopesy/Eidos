# Eidos 架构说明

本文档是 Eidos 当前架构的项目级说明。它同步自 `plans/架构原则.md`，用于说明当前代码如何按 Next.js App Router、BFF、Electron、本地 SQLite / 文件存储进行分层。

## 1. 当前结论

Eidos 当前已经收敛为：

```text
Next.js 16 App Router
  + Server Components 首屏取数
  + Client Components 承接交互
  + Route Handlers 提供 HTTP / OpenAI-compatible API
  + Server Actions 处理页面内简单 mutation
  + Electron 桌面宿主
  + 本地 SQLite / 文件存储
```

当前不拆独立后端服务。Next.js 继续作为 Web UI + BFF/API layer，SQLite 和本地文件仍是运行态数据的 source of truth。

## 2. 核心原则

### 2.1 Server First

- 能在服务端完成的事情优先放到服务端。
- 首屏取数、配置解析、文件列表、请求日志、账号状态、图片历史等运行态数据，由 Server Component 直接调用 `server/**` service / repository。
- 服务端内部不为了复用逻辑去 `fetch` 自己的 `/api/**`。

### 2.2 BFF 架构

- Next.js 继续承担 Web UI + API/BFF。
- `src/app/api/**/route.ts` 是公开 HTTP 入口，不承载核心业务规则。
- OpenAI-compatible `/v1/**`、multipart 文件上传、长任务和外部系统调用继续保留 Route Handler。

### 2.3 Presentation / Feature / Server 分层

```text
src/app       路由、layout、页面壳、loading/error/not-found、页面私有展示组件
src/features  页面级状态编排、交互流程、view-model、feature hook
src/server    服务端用例、repository、SQLite、文件存储、上游适配、CPA 同步
src/shared    纯规则、默认值、映射、schema、contracts
src/components 跨页面复用 UI 或独立展示组件
src/lib/api   前端 API client 与共享 contract 类型
```

### 2.4 单一事实源

- 默认配置、枚举、图片参数映射、错误语义、release/version 解析等规则只保留一份事实源。
- 禁止同一规则在 page、route、server、desktop 中分别重写。
- RSC 可直接读取的服务端数据，不再额外维护客户端 in-memory source of truth。

## 3. App Router 结构

业务页面位于 `src/app/(app)` route group。

```text
src/app/
  layout.tsx                  # 根布局：全局 providers / toaster / html body
  error.tsx
  loading.tsx
  not-found.tsx

  (app)/
    layout.tsx                # 应用壳：导航、启动刷新、页面背景
    error.tsx
    loading.tsx
    not-found.tsx

    accounts/
      page.tsx                # Server Component
      accounts-client.tsx     # Client Component
      _components/

    image/
      page.tsx                # Server Component
      image-client.tsx        # Client Component
      _components/

    requests/
      page.tsx                # Server Component
      requests-client.tsx     # Client Component

    settings/
      page.tsx                # Server Component
      settings-client.tsx     # Client Component
      actions.ts              # Server Actions
```

### 页面标准

`page.tsx` 只负责：

1. 在服务端直接调用 `server/**` service / repository 读取首屏数据；
2. 设置必要的 `dynamic = "force-dynamic"`，避免本地 SQLite / 文件 / 运行态数据被 build-time 静态化；
3. 把初始数据传给同目录 `*-client.tsx`。

`*-client.tsx` 负责：

1. 调用 feature hook；
2. 渲染 JSX；
3. 绑定事件和局部展示状态。

当前真实业务页均已按该模式落地：

```text
/accounts -> src/app/(app)/accounts/page.tsx + accounts-client.tsx
/image    -> src/app/(app)/image/page.tsx + image-client.tsx
/requests -> src/app/(app)/requests/page.tsx + requests-client.tsx
/settings -> src/app/(app)/settings/page.tsx + settings-client.tsx
```

## 4. 首屏数据来源

### `/accounts`

Server Component 直接读取：

- `listAccounts()`
- `getSyncStatus()`

客户端组件只负责导入、删除、刷新、编辑、CPA 同步和筛选选择等交互。

### `/image`

Server Component 直接读取：

- `listImageConversationRecords()`
- `listImageFiles()`
- `listRecoverableImageUpstreamTasks(30)`
- `listAccounts()` 聚合可用额度

客户端组件继续负责图片生成、编辑、放大、上传、恢复任务、active task、预览和历史会话交互。

### `/requests`

Server Component 直接读取：

- `getRequestLogs()`

客户端组件负责筛选、排序和显式刷新。

### `/settings`

Server Component 直接读取：

- `getSavedConfig()`
- `getDefaultConfigPayload()`
- `sanitizeConfigPayload()`

配置保存使用 Server Action，HTTP API 仍保留为外部 / fallback 入口。

## 5. Route Handlers

Route Handler 只做 HTTP 入站适配：

- 参数读取；
- 运行时校验；
- 调用 server service / repository；
- HTTP 响应转换。

不在 Route Handler 中写复杂业务规则、重试策略、持久化细节或重复的共享规则。

### JSON body 校验

JSON body 必须经过运行时校验：

```ts
const body = await parseJsonBody(request, schema);
```

禁止继续在 route handler 中写：

```ts
const body = (await request.json()) as SomeType;
```

统一入口是：

```text
src/server/request-validation.ts
```

## 6. Server Actions

页面内简单 mutation 优先考虑 Server Action。

当前已落地：

```text
src/app/(app)/settings/actions.ts
```

配置保存走：

```ts
saveSettingsConfigAction(config)
```

但不强行把所有写操作迁移到 Server Action：

- 图片生成 / 编辑 / 放大继续走 Route Handler，因为涉及 OpenAI-compatible API、文件上传、长任务和外部协议语义；
- 账号导入继续走 Route Handler，因为是 multipart 文件上传入口；
- `/api/**` 和 `/v1/**` 不因为页面内 Server Action 而删除。

## 7. 持久化和缓存

SQLite 和本地文件是 source of truth。

```text
src/server/repositories/*
```

是持久化入口。新读写逻辑优先落到 repository，而不是写回 route handler 或业务 service。

当前主要持久化对象：

- accounts
- config
- request logs
- image files
- image conversations
- image upstream tasks
- sync runs

客户端 store 只保留这几类：

1. 纯 UI 状态，例如图片工作台当前选中会话 / 草稿状态；
2. 浏览器运行中任务状态，例如 active image task；
3. RSC 首屏数据的客户端后续编辑缓存，例如 image conversations。

已经删除的服务端数据缓存：

```text
src/store/accounts-view-cache.ts
src/store/sync-status-cache.ts
```

账号列表和同步状态不再维护第二套客户端 in-memory source of truth。

## 8. 服务端边界

`src/server` 承载真正的服务端能力：

- account admin / refresh / selection / pool runner
- image request / recovery / file persistence / upstream task
- OpenAI / ChatGPT provider adapters
- CPA sync client / runner / status
- SQLite repository
- release / version / desktop support logic

facade 可以保留，但不能重新增长成 God file。Route Handler 和页面层都不直接承载服务端业务细节。

## 9. Next.js 约定式边界

必须保留：

```text
src/app/error.tsx
src/app/loading.tsx
src/app/not-found.tsx
src/app/(app)/error.tsx
src/app/(app)/loading.tsx
src/app/(app)/not-found.tsx
```

这些文件用于错误边界、加载兜底和 404 兜底，不再只依赖 toast 或默认页。

当前不需要 `middleware.ts`。只有出现鉴权、跨路由 header、rewrite/redirect、locale 等横切需求时才新增 middleware；不为了“最佳实践清单完整”添加无意义 noop middleware。

## 10. 不做的事情

- 不为了目录好看做大搬家。
- 不为了“设计模式完整”硬造抽象层。
- 不把所有文件拆成极细颗粒。
- 不把 Next.js 项目硬拆成独立后端服务，除非产品边界真的改变。
- 不为了“有 middleware / 有 action / 有 facade”添加无业务意义的空层。

## 11. 后续演进标准

后续只有出现明确业务变化或下面这些信号时才继续重构：

- 页面同时管理请求、状态、规则、格式化和复杂 UI；
- route handler 出现明显业务编排；
- 同一规则在多个地方重复定义；
- server 文件重新混入上游协议、持久化和业务策略；
- 图片工作台状态机继续增长到难以维护。

默认演进方式：

1. 先抽 view-model 或 feature hook；
2. 再按状态机职责拆 feature module；
3. 最后才考虑继续拆组件或目录。

当前主干架构已经完成，后续不再为了行数或形式主义继续大拆。
