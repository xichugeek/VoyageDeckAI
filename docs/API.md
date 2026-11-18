# HTTP 接口

Windows 开发 API 位于 `http://127.0.0.1:8289`。通过指挥台的 `http://127.0.0.1:5177/api/*` 可走同源转发。Swagger 页面在 `/api/docs`，原始定义在 `/api/openapi.json`。设置 `VOYAGEDECK_API_DOCS=0` 可关闭两者。

游客的场景、指标、订单、事件和产物由访客沙盒维护。以下工作流接口操作的是持久化的管理员岗位草稿。

## 路由

| 方法与路径 | 访问 | 返回或动作 |
| --- | --- | --- |
| `GET /api/health` | 匿名 | `{"status":"ok","service":"voyagedeck-ai"}` |
| `GET /api/agents` | 匿名 | `{agents:[{id,name,label}]}` |
| `GET /api/admin/session` | 匿名或登录 | `{enabled,authenticated}` |
| `POST /api/admin/session` | 管理入口已启用 | 接收 `{password}`，成功设置 HttpOnly 会话 Cookie |
| `DELETE /api/admin/session` | 可清除当前会话 | 吊销当前令牌、清除 Cookie，返回会话状态 |
| `GET /api/settings/provider` | 管理员 | 返回当前配置和 `key_configured` 布尔值 |
| `PUT /api/settings/provider` | 管理员 | 更新非敏感 Provider 字段，返回隐藏密钥的配置 |
| `POST /api/admin/inferences` | 管理员 | 创建或重放一次岗位推理，返回工作流记录 |
| `GET /api/workflows?limit=25&offset=0` | 管理员 | `{workflows:[...]}`，按创建时间倒序，`limit` 1–100，`offset` 0–1000 |
| `GET /api/workflows/{workflow_id}` | 管理员 | 返回 UUID 对应的工作流 |
| `GET /api/outputs/{output_id}` | 管理员 | 返回 UUID 对应的结构化草稿 |
| `POST /api/workflows/{workflow_id}/approve` | 管理员 | 记录批准或驳回，返回更新后的工作流 |
| `GET /api/workflows/{workflow_id}/events?after=0&limit=100` | 管理员 | 按序返回 `{events:[...],after}` |
| `GET /api/events/stream?workflow_id={uuid}&after=0` | 管理员 | 带 `id`、`data` 和心跳的 `text/event-stream` |

写请求需带 `X-VoyageDeck-Request: cockpit`，JSON 载荷需带 `Content-Type: application/json`。会话 Cookie 名为 `voyagedeck_admin`，设置 `HttpOnly`、`SameSite=Strict`、`Path=/api`，默认启用 `Secure`。生产网关可进一步限制路由或可访问来源。

## Provider 参数和推理记录

| 字段 | 约束 |
| --- | --- |
| `mode` | `mock` 或 `openai_compatible` |
| `endpoint` | 可为空的 HTTPS API 基址，非空时须与服务端允许的地址一致，真实推理必填 |
| `model` | 1–120 字符的模型标识 |
| `timeout_seconds` | 2–45 的整数，默认 20 |
| `max_tokens` | 150–2400 的整数，默认 1000 |
| `key_configured` | 响应字段，表示服务端密钥是否已配置 |

推理请求示例为 `{"agent":"creator","context":"为虚构收纳包写 15 秒分镜","request_id":"98d22376-6fb9-44ab-8ebd-e0b81ee3b294"}`。岗位枚举为 `scout`、`lister`、`creator`、`ads`、`service`、`fulfillment`，上下文长度 1–2400 字符。响应包含 `id`、`task_id`、`agent`、`context`、`status`、`provider_mode`、`data_source`、`created_at`、`updated_at`、`output`、`failure`、`review`。

`status` 为 `running`、`succeeded`、`failed` 或 `interrupted`。配置、上游或格式失败可通过工作流响应的 `failed` 状态和可读原因判断，不能仅用 HTTP 200 判定草稿成功。`output` 为 `null` 或 `{id,title,summary,sections:[{heading,items:string[]}]}`。Mock 的数据来源为 `mock_simulated`，外部文本模式为 `ai_generated_draft`。仅成功记录可提交 `{"decision":"approved","note":"可继续人工审阅"}` 或 `rejected`，备注最多 480 字符，可省略。审批只写审计记录。

## 事件订阅与错误

事件为 `{seq,kind,message,created_at}`，编号从 1 开始，单工作流递增。用 JSON 历史从 `after=0` 开始读取，随后使用上次响应的 `after`，`limit` 为 1–100。SSE 使用同一序号作为 `id`，断线时优先按请求头 `Last-Event-ID` 继续。如果 SSE 无法连接，按最近已处理的序号分页或轮询 JSON 接口即可。

SSE 每约一秒检查更新及登录状态，无事件时发送心跳。单次连接最长约 30 秒，服务端提供 1200 毫秒重连建议，同时最多 4 条流。进程重启后可按旧游标恢复持久化事件。SSE 和 JSON 历史均须带有效会话 Cookie。

| 状态码 | 含义 |
| --- | --- |
| 400 | SSE 游标格式错误 |
| 401 | 登录失败或会话未认证 |
| 403 | 管理写请求缺少同源标记 |
| 404 | 目标工作流或产物不存在 |
| 409 | 请求 UUID 冲突、审核冲突或达到持久化容量 |
| 413 | 写请求超过 16 KiB |
| 422 | 字段无效、含已配置凭据或端点未批准 |
| 429 | 登录、推理频率或流连接超限，部分响应带 `Retry-After` |
| 503 | 未初始化管理口令，登录入口关闭 |

错误体使用 `{detail}`。后端时间戳使用 UTC，界面按浏览器时区显示。当前已通过本地 Mock 和 HTTPX 仿真上游契约测试。真实 Provider 需要经授权配置有效密钥和接口后再单独联调。
