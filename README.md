# VoyageDeck AI · 出海星舰

六岗位跨境运营演示指挥台，覆盖选品、上架、内容制作、投流、客服和履约。访客沙盒使用虚构产品和模拟交易。

[打开在线演示](https://voyagedeck.demo.xichugeek.com/)

## Windows 本地启动

需要 Git、Node.js 22.13+（22.x）和 Python 3.12。在 PowerShell 中执行：

```powershell
git clone https://github.com/xichugeek/VoyageDeckAI.git
Set-Location VoyageDeckAI
py -3.12 -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
Push-Location frontend
npm.cmd ci
Pop-Location
.\scripts\dev.ps1
```

- 指挥台 <http://127.0.0.1:5177>
- 健康检查 <http://127.0.0.1:8289/api/health>
- OpenAPI <http://127.0.0.1:8289/api/docs>

在启动终端按 `Ctrl+C` 结束服务。启动日志在 `.local/backend-dev.log`。如需清理本项目的临时日志，可在服务停止后运行 `Remove-Item -LiteralPath .local/backend-dev.log -ErrorAction SilentlyContinue`。管理员历史默认保存在 `backend/data/voyagedeck.sqlite3`。

## 访客演示

首次打开会载入一个暂停在履约阶段的模拟检查点，便于查看现有事件和指标。点击「继续演示」完成这轮，或点击「新建出海任务」从选品开始。新任务可选标准成功、低毛利换品和故障恢复三个情景。

审批、订单和广告支出属于当前标签页的模拟工作流。页面刷新会恢复该会话的记录。新建任务会归档上一轮，重置只清除当前任务的进度。

## 管理员本地初始化

管理员入口默认关闭。若要在本机验证 Mock 推理与审核，请在运行开发脚本的同一 PowerShell 中设定管理员密码散列：

```powershell
Push-Location backend
$env:VOYAGEDECK_ADMIN_PASSWORD_HASH = .\.venv\Scripts\python.exe -m app.password
Pop-Location
$env:VOYAGEDECK_INSECURE_COOKIE = '1'
.\scripts\dev.ps1
```

在指挥台右上角打开管理后台，使用刚设置的密码登录。`VOYAGEDECK_INSECURE_COOKIE=1` 仅用于本机 HTTP。默认 Mock 模式无需 API Key。OpenAI-compatible 配置由服务端环境变量限定 HTTPS 基址及密钥，管理界面显示密钥配置状态，并要求逐次确认真实模型调用。

## 自动化验证

```powershell
Push-Location frontend
npx.cmd playwright install chromium
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run test:admin
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
Pop-Location
Push-Location backend
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check app tests
Pop-Location
```

## 文档

- [验收和启动演示](docs/DEMO_GUIDE.md) · [第 031 期制作脚本](docs/EPISODE_031.md)
- [架构](docs/ARCHITECTURE.md) · [API](docs/API.md) · [安全](docs/SECURITY.md)
- [容器部署与回滚](deploy/README.md) · [交付报告](docs/DELIVERY_REPORT.md) · [变更记录](docs/CHANGELOG.md)
- [许可状态](LICENSE-PENDING.md)

VoyageDeck AI is a mission-control console for a simulated six-agent cross-border commerce workflow.
