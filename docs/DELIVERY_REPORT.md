# VoyageDeck AI 交付验收

## 里程碑记录

| 里程碑 | 主要变更 | 已执行验证 |
| --- | --- | --- |
| M0 `efc8582` | `.gitignore`、前后端骨架和 `scripts/dev.ps1` | Windows 启动，前端、健康检查和 OpenAPI 返回 200，2 项 pytest，Vite 构建 |
| M1 `44ac305` | 指挥台、岗位、趋势、筛选和详情 | `npm run build` 及 3 项浏览器视口测试，1440×900、1920×1080、390×844 |
| M2 `14f933d` | 业务引擎、三个可重放场景和审计 | `npm run test:unit` 9 项，`playwright test tests/workflow.spec.ts` 4 项，构建通过 |
| M3 `7990fe3` | Mock、OpenAI-compatible、认证、SQLite、SSE | `python -m pytest` 31 项，`npm run test:admin` 1 项，构建通过 |
| M4 `2519cd2` | 焦点、无障碍、响应式、性能与安全复扫 | 前端 typecheck、lint、build、unit 9 项、`npm run test:e2e` 12 项、管理端 1 项、有界面 Chromium 冒烟。后端 Ruff、pytest 31 项、pip check、compileall |
| M5 | 架构、API、部署与回滚、演示脚本、验收文件 | Docker Desktop 独立构建及健康运行，32 项 pytest、Ruff 通过。公网上线以本报告末尾的实测记录为准 |

[截图目录](../artifacts/screenshots/)包含三种尺寸、桌面与手机全页、正在选品、重试耗尽和模拟管理员审核的实际 Chromium 截图。管理端图使用合成数据。

## 业务复算

- 标准场景两笔各 49.00 美元订单，GMV 98.00 美元。采购 36.00、物流 9.60、平台费用 5.88、广告支出 26.80，估算贡献利润 19.72 美元。归因净销售额 49.00，ROAS 1.83×。
- 换品场景淘汰 OrbitCase，备选 AeroFold 入选。第二笔订单因模拟库存不足退款 42.00 美元。GMV 84.00、净销售额 42.00 美元。
- 故障场景两次人工重试，第三次尝试失败并转人工处理。订单与广告支出均为零。

## 资源与扫描

- Windows Node 22.22.2、Python 3.12.10。生产前端构建在本机 Chromium 的五次冷加载中，FCP 176–216 ms，中位 192 ms，初始传输约 101 KB，页面资源均为同源。
- Windows Uvicorn 在本机的 30 次健康检查中，中位耗时 1.96 ms、p95 3.26 ms。实际完成六个 Mock 文本岗位，含合成登录和同进程 HTTP 客户端的工作集峰值约 91 MiB。这些是本机样本。
- `npm audit --omit=dev` 无发现。完整 `npm audit` 报告开发依赖图中的 10 个节点，均来自同一个已撤回的 Picomatch 公告。 [GitHub 安全公告](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
- `pip-audit` 核对 24 个 Python 运行和测试锁定包，无已知漏洞发现。`gitleaks git --redact` 与工作文件扫描无密钥发现。原始参考文件、私有设置、临时数据库和日志通过 Git 忽略规则隔离。

## 边界

- OpenAI-compatible 已通过仿真 HTTP 协议测试。真实 Provider 接口仍待使用有效账户和允许的基址联调。
- 访客演示历史保存在当前浏览器标签页。管理员工作流保存在服务器 SQLite。Public Demo 默认关闭管理员功能。
- 可用许可和视频工件分别以许可状态页和实际制作记录为准。

## 部署实测记录

计划入口为 `https://voyagedeck.demo.xichugeek.com`。权威 DNS、Cloudflare 和 Google 解析一致。独立 Compose 服务的容器端口为 8080。开发工作区运行端口为 5177 和 8289，单机容器验证绑定到 `127.0.0.1:18288`。

本地 Docker Desktop 实测 health、HTML、JS、CSS、Logo、SPA 回退和 Swagger 均返回 200，未知 API 返回 JSON 404，匿名管理员记录返回 401。容器以内置非 root 用户启动，根文件系统只读，配置 256 MiB、1 CPU 和 64 PIDs 上限。Docker stats 在测试中显示约 42 MiB 内存。生产 Compose 覆盖配置只通过 `xg_edge` 发布服务别名。验收后的公网上线证据另行记录。
