# VoyageDeck AI · 出海星舰

六岗位跨境运营演示指挥台，覆盖选品、上架、内容制作、投流、客服和履约。访客沙盒使用虚构产品和模拟交易。

## Windows 本地启动

需要 Node.js 22 和 Python 3.12。在仓库根目录使用 PowerShell：

```powershell
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

在启动终端按 `Ctrl+C` 结束服务。

## 访客演示

首次打开会载入一个暂停在履约阶段的模拟检查点，便于查看现有事件和指标。点击「继续演示」完成这轮，或点击「新建出海任务」从选品开始。新任务可选标准成功、低毛利换品和故障恢复三个情景。

审批、订单和广告支出属于当前标签页的模拟工作流。页面刷新会恢复该会话的记录。新建任务会归档上一轮，重置只清除当前任务的进度。

```powershell
Push-Location frontend
npx.cmd playwright install chromium
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run build
Pop-Location
Push-Location backend
.\.venv\Scripts\python.exe -m pytest
Pop-Location
```

```mermaid
flowchart LR
  V[浏览器访客] --> C[React 指挥台]
  C --> S[会话内演示引擎]
  C --> A[FastAPI 管理接口]
  A --> D[(SQLite)]
  A --> P[模型 Provider]
```

VoyageDeck AI is a mission-control console for a simulated six-agent cross-border commerce workflow.
