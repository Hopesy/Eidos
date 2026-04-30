# Eidos 架构优化与分阶段改造计划（2026-04-29）

## 1. 背景与目标

当前仓库已经从早期的多入口原型收口成：

- Next.js 16 App Router 全栈应用
- Electron 桌面壳
- 本地 SQLite + 本地图片文件存储
- `/v1/*` OpenAI 风格接口兼容层
- 账号池 / 图像 API 双上游模式

代码现在**能构建、能运行、能持续交付功能**，但架构已经出现明显的增长压力：

- 前端页面承担了过多工作流与状态编排；
- 服务端的用例编排、上游适配、存储访问边界混在一起；
- 默认值、映射规则、错误语义在多处重复定义；
- Electron / Web / Next.js 的宿主边界还不够明确；
- 当前缺少能支撑持续重构的小型回归护栏。

本计划的目标不是“为了好看而重构”，而是先明确：

1. **什么是当前最适合 Eidos 的目标架构**；
2. **哪些问题必须优先解决，哪些问题可以延后**；
3. **后续改造应该按什么顺序推进，避免一边重构一边失去可运行性**。

---

## 2. 公开资料校准后的结论

本节只引用与当前仓库直接相关的官方资料，并据此约束改造方向。

### 2.1 Next.js：当前更适合继续走 BFF，而不是立刻拆独立后端

根据 Next.js 官方 `Backend for Frontend` 指南：

- Next.js **支持 BFF 模式**；
- Route Handlers 是**公开 HTTP 端点**；
- 但官方也明确说明：**Next.js backend capabilities are not a full backend replacement**，它更适合作为应用的 API layer，而不是无限膨胀成通用后端平台。

这对 Eidos 的含义很明确：

- 当前仓库是**单产品、单前端、单桌面壳、单本地持久化**；
- 它并没有多前端、多外部消费方、多租户的强诉求；
- 因此现阶段最合适的方向不是急着把后端拆成独立服务，而是：
  - **保留 Next.js 作为 BFF/API 层**；
  - **把 Route Handlers 做薄**；
  - **把领域逻辑和上游适配从路由层继续下沉到 `src/server/*`**。

同时，Next.js 官方在 Route Handlers 文档里还特别提醒：

- **在 Server Components 中应直接从数据源取数，而不是自调用 Route Handlers**；
- Route Handlers 更适合作为外部入口，而不是给服务端自己绕一层 HTTP。

这意味着后续如果我们引入更多 Server Components：

- 页面首屏数据应直接调用 server-side data layer；
- 不要把“内部函数调用”统一包装成“自己 fetch 自己的 `/api/*`”。

### 2.2 Next.js：应当更严格地划分 Server / Client 边界

Next.js 官方 `Server and Client Components` 文档明确：

- `layout` / `page` 默认是 **Server Components**；
- 只有在需要 `useState`、`useEffect`、事件处理、`window/localStorage` 等浏览器能力时才应使用 Client Components；
- 对 server-only 模块，官方建议使用 `server-only` 以避免被错误地 import 进 client bundle。

这对 Eidos 的启发是：

- 当前多个页面是大型 `"use client"` 页面，导致 UI、业务流程、缓存、错误处理、下载行为全部堆在一个组件里；
- 这类页面不需要全部回到 Server Component，但应该：
  - 把**纯展示部分**和**仅浏览器交互部分**保留在 client；
  - 把**不依赖浏览器的规则与编排**挪出页面；
  - 对 `src/server/*` 以及只应运行在服务端的模块显式加 `server-only` 边界。

### 2.3 Next.js：应更主动使用 private folders / route groups 做项目组织

Next.js 官方 `Project Structure` 文档明确推荐：

- 用 `(_group)` 组织路由而不改变 URL；
- 用 `_folder` 放置不会暴露为路由的内部实现；
- 用特性分组组织 app 目录，而不是把所有代码长期堆在大平层下。

这意味着 Eidos 后续可以明确收口为：

- `app/(workspace)/image/*`
- `app/(admin)/accounts/*`
- `app/(admin)/settings/*`
- `app/api/*` 只保留 HTTP 入口
- 页面内部组件、hook、mapper、presenter 继续用 `_components` / `_lib` / `_hooks` 私有目录组织

这类组织调整不会改变 URL，却能降低“一个页面越做越大”的惯性。

### 2.4 Electron：当前主方向正确，但 IPC 面与安全边界还可以继续收紧

Electron 官方文档强调：

- Electron 是**多进程模型**：main process 负责窗口、生命周期、原生能力；renderer 负责 Web UI；
- `contextIsolation` 是推荐默认安全设置；
- 通过 `contextBridge` 暴露 API 时，应当**一条 IPC 对应一个明确方法**，避免把原始能力整体暴露给 renderer；
- 安全清单还建议启用 **process sandboxing**，并校验 IPC sender。

对当前仓库的含义：

- `main.cjs` / `preload.cjs` / renderer API 的分层方向是对的；
- 但桌面桥接 API 仍应坚持“最小暴露面”；
- 当前 `BrowserWindow` 配置里仍有 `sandbox: false`，这说明桌面壳的安全收口还没做完；
- 后续应把“桌面能力白名单”和“浏览器 fallback”当成正式边界，而不是零散功能。

### 2.5 Node `node:sqlite`：适合当前本地优先模式，但要接受它是同步 API

Node 官方 `node:sqlite` 文档明确写明：

- `DatabaseSync` 表示单连接；
- **所有暴露的 API 都是同步执行**。

这说明：

- 对当前 Eidos 这种**本地优先 / 单用户 / 桌面壳 / 少量并发**模式，继续使用 `node:sqlite` 是合理的；
- 但同步 API 也意味着：
  - 不能把复杂解析、大批量数据重写、长事务遍地铺开；
  - 要让 repository/data layer 尽量薄、短、明确；
  - 不能让 UI 高频请求间接触发很重的同步数据库操作。

结论不是“换数据库”，而是“把同步 SQLite 用在适合它的边界上”。

---

## 3. 当前仓库的事实基线

以下是本轮计划基于当前代码得出的事实，不是抽象印象。

### 3.1 当前宿主形态

仓库当前是：

- `src/app/*`：App Router 页面与 Route Handlers
- `src/server/*`：业务逻辑、SQLite、文件存储、上游调用
- `electron/*`：桌面宿主与自动更新
- `data/*`：本地数据库与图片文件

这说明当前架构本质上是：

> **单仓库、单进程主应用 + Electron 壳 + 本地持久化的本地优先 BFF 应用**

这决定了优化方向应该优先做“边界收口”，而不是先拆服务。

### 3.2 当前几个最重的大文件

当前仓库里最值得警惕的热点文件包括：

- `src/app/image/page.tsx`：2730 行（初始基线；Phase 2 已拆到约 856 行）
- `src/server/providers/openai-client.ts`：2165 行（初始基线；Phase 3 已收窄为 30 行兼容 facade）
- `src/server/account-service.ts`：1509 行（初始基线；Phase 3 已开始拆分，当前约 229 行）
- `src/app/accounts/page.tsx`：1097 行
- `src/app/settings/page.tsx`：466 行

这说明问题已经不是局部重复，而是**关键能力集中在少数巨型文件里**。

### 3.3 当前最明显的结构问题

#### A. 页面层承担了应用层编排

以 `src/app/image/page.tsx` 为例，它现在同时承担：

- 页面展示
- 本地状态机
- 历史会话恢复
- 请求取消 / 中断
- 上下文继承
- 下载行为
- 错误语义转换
- 重试与恢复动作选择

这已经不是“页面复杂”，而是**页面正在扮演 feature application service**。

#### B. 服务端存在两个 God file

- `account-service.ts`
- `openai-client.ts`

它们现在把以下职责卷在一起：

- 用例编排
- 账号选择
- 上游协议细节
- 重试策略
- 日志记录
- 错误语义分类
- 结果持久化

这意味着后续只要继续加模式或加上游，复杂度会继续指数式堆高。

#### C. 单一事实源不足

当前代码里已经出现多处规则重复：

- 设置默认值有前端默认、`/api/config` 默认、`/api/config/defaults` 默认；
- 放大/增强质量映射同时存在于前端和路由；
- 版本比较 / release 资产选择同时存在于 Web route 与 Electron main；
- 数据目录解析同时存在于 `config.ts` 与 `db.ts`。

只要这些规则继续分散，后续必然继续漂移。

#### D. SQLite 虽然工作正常，但仓储边界还不够稳定

当前 `node:sqlite` 已经承担真实持久化，但 repository 层还有这些问题：

- 局部实现仍倾向整对象写回；
- 结构列与 `data_json` 并存，需要更明确“谁是索引列、谁是 payload”；
- 存储模型没有显式分层为 repository / mapper / persistence model。

#### E. Electron 壳与 Web fallback 还缺少统一桌面能力层

当前桌面能力已经开始通过 preload 暴露，但还没有形成统一策略：

- 哪些能力只能桌面可用；
- 哪些能力浏览器可降级；
- 哪些能力必须走最小 IPC 白名单；
- 哪些行为应在 `main` 层托管，哪些只应在 renderer 层出现。

#### F. 缺少最小回归护栏

当前 `package.json` 里只有：

- `dev`
- `build`
- `start`
- `desktop:build`

没有正式的：

- `lint`
- `test`
- 小型规则/mapper/版本比较/错误分类单测

这会直接抬高后续重构成本。

---

## 4. 架构判断：当前最合适的目标架构是什么

### 4.1 不建议现在拆独立后端服务

当前阶段，不建议把 `src/server/*` 立即拆成独立 Express / Fastify / ASP.NET / 其他后端服务。原因很直接：

1. 当前产品主要是**单前端 + 单桌面壳**；
2. 本地 SQLite / 本地文件 / Electron 桌面能力都与单机宿主强耦合；
3. 真正的问题不是“Next.js 不够用”，而是**边界没有立起来**；
4. 现在硬拆服务只会把复杂度从单仓库内部问题升级成跨进程/跨协议问题。

### 4.2 建议的目标形态

现阶段更合适的目标形态是：

> **Next.js 继续作为 BFF/API 层 + Electron 桌面宿主 + 本地 SQLite / 文件存储 + 明确的 feature / service / repository 分层**

换句话说：

- **不拆宿主**；
- **先拆职责**。

### 4.3 目标分层

建议后续逐步收口为五层：

1. **Presentation**
   - `src/app/*`
   - `src/components/*`
   - 页面、布局、交互壳、展示组件

2. **Feature orchestration**
   - `src/features/*`
   - 每个功能自己的 hook / reducer / presenter / command handler
   - 例如 image workbench、accounts、settings、updates

3. **Application services**
   - `src/server/application/*`
   - 用例编排：生成、编辑、增强、账号刷新、恢复任务、版本检查

4. **Domain / policy / contracts**
   - `src/domain/*` 或 `src/server/domain/*`
   - 错误分类、重试动作、账号选择策略、尺寸/质量映射、版本比较、配置 schema

5. **Infrastructure**
   - `src/server/infrastructure/*`
   - SQLite repository、文件存储、OpenAI/ChatGPT 上游 adapter、Electron bridge server helpers

这个分层的关键不是目录名，而是：

- 页面不再直接扛全部流程；
- Route Handler 只做 HTTP 入站适配；
- 业务规则不散落在 UI 和路由里；
- 存储和上游协议从 application service 中继续下沉。

---

## 5. 已落地进度（截至 2026-04-30）

本轮已经从计划进入实施，当前落地结果如下：

#### Phase 0：文档和事实源基线

- 已新增本计划文档到 `plans/2026-04-29-architecture-optimization-plan.md`。
- 已新增 `plans/架构原则.md`，明确这个仓库后续的 Next.js 分层、BFF、feature hook 与共享规则约束。
- 明确当前不拆独立后端服务，继续采用 Next.js BFF + Electron + 本地 SQLite / 文件存储。
- 明确优先级：先收口规则事实源，再拆前端巨型页面，再处理服务端 God file。

#### Phase 1：单一事实源收口

已完成：

- `src/shared/app-config.ts`
  - 统一配置默认值 payload 与 sanitize 逻辑。
  - 接入 `/api/config`、`/api/config/defaults` 与 settings 页面。
- `src/shared/image-generation.ts`
  - 统一图片比例、生成尺寸、增强质量、增强 prompt、质量标签等映射。
  - 接入 generate / edit / upscale / recover route 与图片工作台。
- `src/server/image-error-response.ts`
  - 统一图片 API 错误到 HTTP status / JSON response 的映射。
- `electron/release-shared.cjs` 与 `src/server/release-shared.ts`
  - 统一 Electron 与 Web release/version 选择逻辑。

#### Phase 2：Image Workbench 页面拆分

`src/app/image/page.tsx` 已从约 2730 行拆到约 856 行。当前边界：

```text
src/app/image/page.tsx
  页面壳 / state 持有 / 事件接线

src/features/image-workbench/browser-actions.ts
  浏览器副作用：打开图片、下载图片

src/features/image-workbench/processing-status.ts
  处理中 UI 文案状态

src/features/image-workbench/recovery-candidates.ts
  recover/retry 候选选择

src/features/image-workbench/workspace.ts
  历史记录、运行态任务同步、会话持久化

src/features/image-workbench/composer.ts
  输入区状态、文件追加、模式切换、结果复用

src/features/image-workbench/conversation-editing.ts
  turn 编辑、撤回失败请求、取消并编辑、composer 回填

src/features/image-workbench/submission.ts
  兼容导出入口

src/features/image-workbench/submit-main.ts
  普通 generate/edit/upscale 提交

src/features/image-workbench/selection-edit-submit.ts
  选区编辑提交

src/features/image-workbench/retry-recover.ts
  失败图片重试 / recover task 恢复

src/features/image-workbench/request-lifecycle.ts
  begin/finish request、active task 生命周期、draft conversation 构造

src/features/image-workbench/turn-patches.ts
  turn 成功、失败、取消、重试中状态写回

src/features/image-workbench/submission-types.ts
  提交流程共享类型

src/features/image-workbench/utils.ts
  图片数据转换、结果合并、错误语义等通用工具
```

已执行多轮 `pnpm build`，最近一次构建通过。

#### Phase 2：大型交互组件拆分（首轮已开始）

`src/components/image-edit-modal.tsx` 已从约 710 行收窄到约 380 行，当前边界：

```text
src/components/image-edit-modal.tsx
  模态框结构、按钮/提示文案、视觉和事件绑定

src/features/image-edit/use-image-edit-modal.ts
  选区状态、笔刷与缩放、撤销/重做、遮罩生成、提交编排
```

这一步的取舍：

- 不把图片编辑拆成很多小 util 或很多小组件；
- 只立起“展示组件 + feature hook”这一层边界；
- 下一步如果继续处理 image-edit，优先抽顶部工具区或底部提交区，而不是继续细拆 hook 内部实现。

#### Phase 2：Accounts 页面拆分（已完成前两刀）

`src/app/accounts/page.tsx` 已从约 1017 行收窄到约 625 行。当前已先后完成两步：

```text
src/features/accounts/account-view-model.ts
  账号筛选/排序、统计摘要、token mask、额度与时间格式化、
  import summary、选中项修剪、sync status 归一化等纯逻辑

src/features/accounts/use-accounts-page.ts
  页面状态、初始加载、缓存回填、import / refresh / delete / update /
  sync action handlers，以及选中态和编辑态编排
```

这一步的取舍：

- 页面现在保留 JSX 结构、图标/Badge 元数据和少量交互绑定；
- 纯规则和请求/状态编排已经离开页面，后续再拆组件时不会再碰业务流程；
- 下一步如继续处理 Accounts，优先抽表格行或顶部控制区，而不是继续细碎地拆 hook。

#### Phase 3：OpenAI Provider 适配层拆分（主体已完成）

`src/server/providers/openai-client.ts` 已从约 2165 行拆到 30 行，当前不再承载上游协议实现，而是作为兼容 facade 保留既有导出入口，避免一次性扩散修改调用方。

当前已拆出的边界：

```text
src/server/providers/openai-client.ts
  对外兼容入口 / 旧导入路径 re-export

src/server/providers/openai-image-errors.ts
  图片生成错误类型、失败分类、retryAction、HTTP status meta、上游错误归一化

src/server/providers/openai-api-service-adapter.ts
  OpenAI-compatible Images API 与 Responses API 适配、文件上传、结果解析

src/server/providers/chatgpt-file-upload-adapter.ts
  ChatGPT Web conversation 文件注册、上传、finalize 与图片尺寸探测

src/server/providers/chatgpt-result-adapter.ts
  ChatGPT Web SSE 结果收集、图片 ID 轮询、下载 URL 获取、base64 下载与 recover

src/server/providers/chatgpt-session-adapter.ts
  ChatGPT Web CookieSession、fingerprint、bootstrap、chat-requirements、账号远端信息探测

src/server/providers/chatgpt-conversation-adapter.ts
  ChatGPT Web 图片生成/带附件生成/recover 用例编排、conversation message 构造与提交
```

这一步的取舍：

- 先按**上游协议阶段**拆，而不是先引入复杂抽象框架；
- 旧调用方继续从 `@/server/providers/openai-client` 导入，降低变更面；
- 当前暂不动 `account-service.ts` 的账号池/调度逻辑，避免两个 God file 同时大幅改写；
- 下一步应转向 `account-service.ts`，把账号选择、API service 切换、图片生成/编辑/恢复用例继续拆出。

已执行 `pnpm build`，构建通过。

#### Phase 3：Account Service 拆分（首轮已开始）

`src/server/account-service.ts` 已开始从账号池 God file 拆出低风险边界，当前从初始约 1509 行收窄到约 229 行。

当前已拆出的边界：

```text
src/server/account-selection-service.ts
  账号池候选过滤、quota 优先、round-robin 轮转、远端刷新后确认可用 token

src/server/account-admin-service.ts
  账号 normalize/public 映射、列表、导入、删除、更新、图片结果计数

src/server/image-api-service-config.ts
  图像 API 服务开关、baseUrl、apiKey、apiStyle、responsesModel 配置解析

src/server/image-api-task-runner.ts
  图像 API 服务 generate/edit/upscale 执行编排、重试策略、请求日志、图片持久化

src/server/account-pool-image-runner.ts
  账号池 Web 通道 generate/edit/upscale 执行编排、token 切换、失败重试、请求日志、图片持久化

src/server/account-remote-refresh-service.ts
  账号类型识别、JWT payload 解析、远端 quota/plan 刷新、批量刷新错误归集

src/server/image-recovery-service.ts
  recover 任务恢复、原账号校验、恢复结果持久化、恢复日志记录
```

这一步的取舍：

- 账号选择仍由 `account-service.ts` 对外暴露 `getAvailableAccessToken`，避免改动调用方；
- round-robin 状态被封装在 selector 内部，删除账号后通过 `reset(accountCount)` 维持索引有效；
- 图像 API 服务配置从账号服务中抽离，但仍由 `account-service.ts` re-export 旧入口，保证 `/v1/images/*` 路由无需同步改动；
- 图像 API 服务的 generate/edit/upscale 执行编排已从账号池主文件移出；
- 账号池 Web 通道 generate/edit/upscale 执行编排已通过依赖注入移出；
- 账号远端刷新 / plan 识别链已移出，但 `account-service.ts` 继续保留 facade 入口；
- recover 用例已移出，但 `account-service.ts` 继续保留 facade 入口；
- 账号管理 CRUD 已移出，但 `account-service.ts` 继续保留 facade 入口；
- 账号类型归一化已抽到 `src/server/account-type-policy.ts`，账号管理与远端刷新共用同一事实源；
- `account-admin-service.ts` 已增加 store 依赖注入入口，默认仍接真实 SQLite store，测试可传入内存 store；
- 下一步 `account-service.ts` 已基本收敛为组合 facade，应转向更多测试护栏或前端 Accounts 页面拆分。

#### Phase 6：重构护栏继续补强

在首轮规则测试之后，已继续补账号管理服务测试：

```text
tests/account-admin-service.test.ts
  覆盖账号 public 映射、token 列表、限流 token 列表、导入去重、删除计数、
  updateAccount 字段归一化、markImageResult 成功/失败计数与 quota/status 语义。

tests/ts-resolve-loader.mjs
tests/register-ts-resolve-loader.mjs
  为 Node.js 内置 node:test 增加项目别名 `@/*` 与扩展名解析能力，
  后续测试可以直接导入使用 `@/` 的源码模块。

tests/account-selection-service.test.ts
  覆盖账号池优先使用本地已有 quota 批次、正 quota 批次耗尽后回退到 zero-quota 批次、
  round-robin 轮转与 reset、候选全部失效时的稳定报错。

tests/account-remote-refresh-service.test.ts
  覆盖远端 payload 到本地账号字段的归一化、JWT plan type 识别、
  401 刷新降级、批量刷新去重、`last_refreshed_at` 打点与错误归集。

tests/account-view-model.test.ts
  覆盖 accounts 页面筛选/排序、统计、选中 token、状态归一化、
  import summary、时间格式化与 sync status 归一化。
```

已验证：

- `pnpm test`：30 个测试全部通过。
- `pnpm build`：Next.js 生产构建通过。

---

## 6. 分阶段改造计划

### Phase 0：只做文档和事实源收口

目标：先把“后续所有改动都要服从的规则”写清楚。

包含：

1. 产出本计划文档；
2. 为关键共享规则建立单一事实源清单；
3. 补一份后续目录演进草图；
4. 明确哪些改动属于“允许先做”、哪些改动必须等 Phase 1 后再做。

交付物：

- 本计划文档
- 一份实施任务清单（后续可再拆）

### Phase 1：先收口“单一事实源”（已完成首轮）

目标：先解决最容易漂移的规则。

优先收口以下内容：

1. **配置默认值**
   - 前端默认值、`/api/config` 默认值、`/api/config/defaults` 默认值统一到一个 schema/source

2. **图片尺寸与质量映射**
   - 生成比例 -> 分辨率映射
   - 增强质量 -> prompt / API 参数映射

3. **版本比较与 release 资产选择**
   - Electron / Web 共用一份实现

4. **统一错误 -> HTTP status 映射**
   - 路由层不再重复复制 `resolveImageErrorStatus(...)`

建议产物：

- `src/shared/contracts/*`
- `src/shared/policies/*`
- `src/server/domain/*`

这一步成本低、收益最高，而且不会大面积冲击现有行为。

### Phase 2：拆前端巨型页面（Image Workbench 已完成主体拆分）

目标：把 `image/page.tsx`、`accounts/page.tsx` 从“大而全页面”拆成 feature 结构。

建议顺序：

1. **Image Workbench**
   - 已落地 `src/features/image-workbench/*` 模块化拆分。
   - 页面仍保留 state 持有与事件接线，后续如有必要可再收口成 hook / reducer。
   - 当前优先不继续机械拆分，下一步应转向 Accounts 页面或服务端 God file。

2. **Accounts**
   - 列表筛选/排序
   - 选择与批量动作
   - 刷新与同步状态
   - 编辑弹窗状态

3. **Settings**
   - config schema 驱动表单
   - section presenter
   - 统一 dirty / save / reset 行为

原则：

- 页面保留路由层、布局层职责；
- 复杂状态进入 feature hooks/reducer；
- 纯规则函数移到 domain/shared；
- 展示组件不直接知道远端协议细节。

### Phase 3：拆服务端 God file

目标：让 `account-service.ts` 和 `openai-client.ts` 退回到合理边界。

建议拆法：

#### 从 `account-service.ts` 拆出

- `account-admin-service`（已完成首轮）
- `account-selection-service`（已完成首轮）
- `image-generation-service` / `image-edit-service` / `image-upscale-service`（账号池 Web 通道已完成首轮，落在 `account-pool-image-runner.ts`）
- `account-remote-refresh-service`（已完成首轮）
- `image-recovery-service`（已完成首轮）
- `image-api-service-switch`（已完成配置与 API task runner 拆分）

#### 从 `openai-client.ts` 拆出

- `chatgpt-session-bootstrap-adapter`（已完成，落在 `chatgpt-session-adapter.ts`）
- `chatgpt-file-upload-adapter`（已完成首轮）
- `chatgpt-conversation-adapter`（已完成）
- `chatgpt-result-download-adapter`（已完成首轮）
- `upstream-error-classifier`（已完成首轮，落在 `openai-image-errors.ts`）
- `proof-token-provider`（仍复用现有 `openai-proof.ts`，由 session/conversation adapter 调用）
- `openai-api-service-adapter`（已完成首轮）

原则：

- 先按**用例职责**拆；
- 再按**上游协议阶段**拆；
- 不要一开始就过度抽象成通用框架。

### Phase 4：收紧持久化层

目标：让 SQLite 与文件存储成为稳定基础设施，而不是混在业务层里的实现细节。

建议动作：

1. 为每张核心表建立清晰 repository：
   - `accounts-repository`
   - `image-conversations-repository`
   - `image-files-repository`
   - `request-logs-repository`
   - `sync-runs-repository`
   - `image-upstream-tasks-repository`

2. 明确 persistence model：
   - 哪些列用于索引和筛选
   - 哪些字段属于 payload JSON
   - 哪些字段属于派生值，不能手写漂移

3. 限制整表重写和大事务

4. 为高频路径补最小读写基准验证

这一步不是为了“数据库优雅”，而是为了让同步 SQLite 的使用成本保持可控。

### Phase 5：收口 Electron 宿主边界

目标：把桌面能力做成正式边界，而不是零散桥接。

建议动作：

1. 统一 renderer 访问桌面能力的入口：
   - `desktop-updater`
   - `desktop-shell`
   - 后续可能的 `desktop-dialog`、`desktop-paths`

2. 把 IPC 约束成白名单 API

3. 审查并逐步推进：
   - `sandbox: false` 是否可以消除
   - sender 校验是否覆盖全部 IPC
   - 是否存在不必要的原生能力暴露

4. 明确浏览器 fallback 策略：
   - 浏览器模式能做什么
   - 不能做什么
   - UI 如何表达“桌面专属能力”

### Phase 6：补重构护栏

目标：让后续架构收口不再完全靠人工小心。

已完成首轮轻量测试接入：

- `package.json`
  - 新增 `pnpm test`
  - 使用 Node.js 内置 `node:test` + `--experimental-strip-types`，不额外引入测试框架依赖。
  - 新增测试 loader，用于解析源码里的 `@/*` 路径别名与扩展名省略导入。
- `tests/image-generation.test.ts`
  - 覆盖图片比例 / 质量到尺寸映射、尺寸回推比例、upscale 质量兼容与 prompt 构造。
- `tests/openai-image-errors.test.ts`
  - 覆盖上游错误归一化、input/account blocked 分类、HTTP status 到 retryAction 语义映射。
- `tests/release-shared.test.ts`
  - 覆盖版本比较、installer asset 选择、latest release payload 解析。
- `tests/account-admin-service.test.ts`
  - 覆盖账号 normalize / public mapping、导入去重、删除、更新与图片结果计数语义。
- `tests/account-selection-service.test.ts`
  - 覆盖账号选择批次优先级、轮转与候选耗尽语义。
- `tests/account-remote-refresh-service.test.ts`
  - 覆盖远端刷新 payload mapping、401 降级、批量刷新去重与时间戳语义。
- `tests/account-view-model.test.ts`
  - 覆盖 accounts 页首轮抽离出的纯派生逻辑。

后续继续补这些小测试：

1. 配置默认值一致性
2. 关键 repository 的最小读写测试
3. 图片会话 / 上游任务恢复链的最小行为测试
4. Accounts 页面后续 action / reducer 抽离后的行为测试

同时补脚本：

- `pnpm lint`
- `pnpm test`（首轮已完成）
- 必要时加一个轻量 `pnpm check`

---

## 7. 推荐目录演进草图

下面不是必须一步到位照搬，而是后续收口的目标草图。

```text
src/
  app/
    (workspace)/
      image/
        page.tsx
        _components/
        _hooks/
        _presenters/
    (admin)/
      accounts/
      settings/
      requests/
    api/
      ... route.ts            # 只保留 HTTP 入口

  components/
    ui/
    layout/
    shared/

  features/
    image-workbench/
    accounts/
    settings/
    updater/

  shared/
    contracts/
    policies/
    utils/

  server/
    application/
    domain/
    infrastructure/
      db/
      files/
      openai/
      electron/
```

原则只有两个：

1. **UI 结构按 feature 聚合**；
2. **服务端按 application / domain / infrastructure 聚合**。

---

## 8. 明确不做什么

为了避免架构改造失控，本轮计划明确不建议做以下事情：

1. **不先拆独立后端服务**
2. **不先迁移数据库**
3. **不先引入复杂状态管理框架来“掩盖页面过大问题”**
4. **不为了目录好看大规模移动所有文件**
5. **不在没有回归护栏前重写整条图片链路**

先立边界、再抽模块、最后再考虑更大规模的宿主拆分。

---

## 9. 推荐实施顺序

当前推荐顺序已根据本轮落地进度更新：

1. **Phase 1 首轮已完成**：配置默认值、图片参数映射、release/version、图片错误响应已经收口到共享模块。
2. **Phase 2 Image Workbench 主体已完成**：`image/page.tsx` 已从巨型页面拆成 feature modules，并保持外部行为不变。
3. **Phase 3 OpenAI Provider 主体已完成**：`openai-client.ts` 已收窄为 30 行兼容 facade，ChatGPT session/conversation/upload/result 与 API service adapter 已拆出。
4. **下一优先级：继续拆服务端 God file**：
   - `account-service.ts` 已基本收敛为 facade，后续只做小幅清理；
   - 只在确有收益时再继续移动 `openai-proof.ts` 这类底层细节。
5. **Phase 6 最小护栏继续推进**：已接入 `pnpm test`，覆盖 image-generation、release-shared、openai image error mapping、account-admin-service、account-selection-service、account-remote-refresh-service。
6. **下一优先级：继续 Accounts 页面组件拆分或转向 repository 护栏**：`src/app/accounts/page.tsx` 的纯逻辑和状态编排已移出，剩余主要是 UI 结构体量。
7. **最后推进 SQLite repository 与 Electron IPC 安全边界精修**。

原则：已经拆稳的 Image Workbench 不继续为了行数而拆；下一步要把主要收益转到服务端边界和测试护栏。

---

## 10. 参考资料（官方）

1. Next.js Backend for Frontend  
   https://nextjs.org/docs/app/guides/backend-for-frontend

2. Next.js Route Handlers  
   https://nextjs.org/docs/app/getting-started/route-handlers-and-middleware

3. Next.js Server and Client Components  
   https://nextjs.org/docs/app/getting-started/server-and-client-components

4. Next.js Project Structure  
   https://nextjs.org/docs/app/getting-started/project-structure

5. Electron Process Model  
   https://www.electronjs.org/docs/latest/tutorial/process-model

6. Electron Context Isolation  
   https://www.electronjs.org/docs/latest/tutorial/context-isolation

7. Electron Security  
   https://www.electronjs.org/docs/latest/tutorial/security

8. Node.js `node:sqlite`  
   https://nodejs.org/api/sqlite.html


