import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, AudioLines, ChevronRight, CircleCheck, Clipboard, Coins, Globe2, Layers3, Pause, Play, Plus, RotateCcw, Settings, ShoppingBag, SkipForward, Square, Timer, TrendingUp, TriangleAlert, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AdminBoard } from './AdminBoard'
import { CandidatePanel, OrderPanel, TerminalPanel, TrendPanel } from './CockpitPanels'
import { canRetry, createRun, metrics, previewRun, products, reduceRun } from './demo'
import { agents, localTime, markets, money, percent, runStatusLabel, scenarios, taskStatusLabel } from './model'
import type { Action, Config, Run, Task } from './model'
import { Dialog, Logo, PanelTitle, Radar, RoleIcon, tint } from './ui'

const sessionKey = 'voyagedeck-demo-v1'
const stepMs = 1150

function initialRun(): Run {
  try {
    const saved = sessionStorage.getItem(sessionKey)
    if (saved) {
      const run = JSON.parse(saved) as Run
      if (run.mode === 'demo_simulated' && run.tasks.length === agents.length) return run
    }
  } catch { /* The sandbox can also run in memory. */ }
  return previewRun()
}

function useClock() {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return localTime(now)
}

function Header({ run, openAdmin }: { run: Run; openAdmin: () => void }) {
  const clock = useClock()
  return <header className="topbar" id="top">
    <div className="topbar-inner">
      <a className="brand" href="#top"><Logo /><span><strong>VoyageDeck <i>AI</i></strong><small>出海星舰</small></span></a>
      <nav className="topnav" aria-label="主导航"><a href="#overview" className="nav-current"><Layers3 size={15} /> 指挥台</a><a href="#flow">执行链路</a><a href="#telemetry">运行记录</a></nav>
      <div className="topbar-info"><span className="demo-mode"><i /> 演示沙盒</span><span className="top-time"><Timer size={14} /> {clock}</span><button className="btn icon-btn admin-link" onClick={openAdmin} title="管理后台" aria-label="管理后台"><Settings size={17} /></button></div>
    </div>
    <div className="status-line"><div><span><span className="online-dot" /> 舰桥在线</span><span><Globe2 size={13} /> {markets[run.config.market]}市场 · USD</span></div><span className="mono">{run.id.slice(0, 8).toUpperCase()} <span className="status-line-divider">/</span> {run.checkpoint ? '演示检查点' : '当前会话'}</span></div>
  </header>
}

function Hero({ run, dispatch, newTask, reset, report }: { run: Run; dispatch: (action: Action) => void; newTask: () => void; reset: () => void; report: () => void }) {
  const finished = ['completed', 'failed', 'canceled'].includes(run.status)
  const ready = ['draft', 'ready'].includes(run.status)
  const active = run.status === 'running'
  const paused = run.status === 'paused'
  return <section className="hero" id="overview" aria-labelledby="hero-title" data-status={run.status}>
    <Radar />
    <div className="hero-content">
      <div className="hero-heading"><span className="hero-code"><AudioLines size={15} /> MISSION CONTROL</span><span className="run-badge" data-status={run.status}><i /> {runStatusLabel[run.status]}</span></div>
      <h1 id="hero-title">出海运营指挥台</h1>
      <p><strong>{scenarios[run.config.scenario]}</strong> <span>·</span> {run.config.category} <span>·</span> 全链路模拟</p>
      <div className="hero-actions">
        <button className="btn btn-primary" onClick={newTask}><Plus size={17} /> 新建出海任务</button>
        {ready && <button className="btn" onClick={() => dispatch({ type: 'start' })}><Play size={16} /> 启动演示</button>}
        {active && <button className="btn" onClick={() => dispatch({ type: 'pause' })}><Pause size={16} /> 暂停</button>}
        {paused && <button className="btn" onClick={() => dispatch({ type: 'resume' })}><Play size={16} /> 继续演示</button>}
        {!finished && <button className="btn icon-btn" title="单步执行" aria-label="单步执行" disabled={!paused && !ready} onClick={() => dispatch({ type: 'step' })}><SkipForward size={17} /></button>}
        <button className="btn icon-btn" title="重置沙盒" aria-label="重置沙盒" onClick={reset}><RotateCcw size={17} /></button>
        {finished && <button className="btn" onClick={report}><Clipboard size={16} /> 查看复盘</button>}
      </div>
    </div>
    <div className="hero-coordinate"><span className="mono">VOYAGE / 01</span><span>演示航区 · {run.config.market}</span></div>
  </section>
}

function MetricsRow({ run, inspect }: { run: Run; inspect: () => void }) {
  const m = metrics(run)
  const cards = [
    { name: '模拟成交总额', code: 'GMV', value: money(m.gmv), icon: TrendingUp, color: '#53e1eb' },
    { name: '模拟订单', code: 'ORDERS', value: String(m.count).padStart(2, '0'), icon: ShoppingBag, color: '#7bb4fc' },
    { name: '模拟广告支出', code: 'AD SPEND', value: money(m.adSpend), icon: Wallet, color: '#f5c65d' },
    { name: '广告回报', code: 'ROAS', value: m.roas === null ? 'N/A' : `${m.roas.toFixed(2)}×`, icon: Activity, color: '#53e1eb' },
    { name: '模拟商品毛利', code: 'GROSS PROFIT', value: money(m.gross), icon: Coins, color: '#69ddb9' },
    { name: '执行中岗位', code: 'AGENTS', value: String(m.working).padStart(2, '0'), icon: Layers3, color: '#af9dff' },
  ]
  return <section className="metrics" aria-label="模拟经营指标">
    {cards.map(({ name, code, value, icon: Icon, color }, index) => <button className="metric" key={code} style={tint(color)} onClick={inspect} aria-label={`${name} ${value}，查看计算口径`}>
      <span className="metric-label"><Icon size={15} /> {name}</span><strong className="metric-value" key={value}>{value}{index === 5 && <small> / 06</small>}</strong><span className="metric-code">{code} <ArrowUpRight size={12} /></span>
    </button>)}
  </section>
}

function LiveFlow({ run, inspect }: { run: Run; inspect: (task: Task) => void }) {
  const done = run.tasks.filter(task => task.status === 'succeeded').length
  return <section className="flow-panel panel" id="flow" aria-label="六岗位实时流程">
    <div className="panel-header"><PanelTitle title="任务执行链路" english="LIVE FLOW" live /><span className="flow-count mono"><strong>{String(done).padStart(2, '0')}</strong> / 06 完成</span></div>
    <div className="flow-scroll"><ol className="flow-steps">
      {run.tasks.map((task, index) => {
        const agent = agents[index]
        const label = task.status === 'running' && run.status === 'paused' ? '已暂停' : taskStatusLabel[task.status]
        return <li key={task.id} data-state={task.status} style={tint(agent.color)}>
          <button className="flow-node" onClick={() => inspect(task)} aria-label={`${agent.name}详情 · ${label}`}>
            <span className="node-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="node-orbit"><RoleIcon agent={agent.id} size={22} />{task.status === 'succeeded' && <CircleCheck className="node-check" size={13} />}</span>
            <strong>{agent.name}</strong><small>{label}</small>
          </button>
          {index < agents.length - 1 && <span className="flow-link" aria-hidden="true"><i /><ChevronRight size={13} /></span>}
        </li>
      })}
    </ol></div>
  </section>
}

function AgentRoster({ run, inspect }: { run: Run; inspect: (task: Task) => void }) {
  return <aside className="roster" aria-label="六岗位运行状态">
    <div className="roster-header"><PanelTitle title="岗位矩阵" english="AGENT ROSTER" /><span className="mono">06</span></div>
    <div className="roster-list">{run.tasks.map((task, index) => {
      const agent = agents[index]
      return <button className="agent-card" data-state={task.status} key={task.id} style={tint(agent.color)} onClick={() => inspect(task)}>
        <span className="agent-line"><span className="role-icon"><RoleIcon agent={agent.id} size={18} /></span><strong>{agent.name}<small>{agent.label}</small></strong><span className="agent-status"><i /> {task.status === 'running' && run.status === 'paused' ? '已暂停' : taskStatusLabel[task.status]}</span></span>
        <span className="agent-action" title={task.summary || agent.action}>{task.summary || agent.action}</span>
        <span className="agent-footer"><span className="agent-progress"><i style={{ width: `${task.progress}%` }} /></span><span>{task.processed} {agent.unit}</span></span>
      </button>
    })}</div>
  </aside>
}

function Milestones({ run, inspect }: { run: Run; inspect: (task: Task) => void }) {
  const reached = run.tasks.filter(task => task.startedAt)
  if (!reached.length) return null
  return <section className="milestones panel" aria-label="任务里程碑"><h2><Timer size={15} /> 任务时间轴</h2><ol>
    {reached.map(task => {
      const agent = agents.find(item => item.id === task.agent)!
      return <li key={task.id} style={tint(agent.color)}><button onClick={() => inspect(task)}><i /> <strong>{agent.name}</strong> <time dateTime={task.endedAt || task.startedAt}>{localTime((task.endedAt || task.startedAt)!)}</time></button></li>
    })}
  </ol></section>
}

function NewTaskForm({ current, submit }: { current: Config; submit: (config: Config) => void }) {
  const [scenario, setScenario] = useState(current.scenario)
  const [preferred, setPreferred] = useState(current.preferredId)
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    submit({
      scenario, preferredId: preferred, market: String(fields.get('market')) as Config['market'], category: String(fields.get('category')),
      budget: Math.round(Number(fields.get('budget')) * 100), marginFloor: Number(fields.get('margin')) / 100,
    })
  }
  return <form className="new-task-form" onSubmit={handleSubmit}>
    <p>创建新的会话任务，当前任务的记录会保留在本标签页的历史中。</p>
    <div className="form-grid"><label>演示情景<select value={scenario} onChange={event => {
      const value = event.target.value as Config['scenario']
      setScenario(value)
      setPreferred(value === 'fallback' ? products[1].id : products[0].id)
    }}>{Object.entries(scenarios).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label>目标市场<select name="market" defaultValue={current.market}>{Object.entries(markets).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label>优先候选商品<select value={preferred} onChange={event => setPreferred(event.target.value)}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>类目<select name="category" defaultValue={current.category}><option value="旅行收纳">旅行收纳</option><option value="随身配件">随身配件</option></select></label>
    <label>毛利门槛 (%)<input name="margin" type="number" min="0" max="90" step="1" defaultValue={Math.round(current.marginFloor * 100)} required /></label>
    <label>模拟广告预算 (USD)<input name="budget" type="number" min="0" max="1000" step="0.01" defaultValue={current.budget / 100} required /></label></div>
    <button className="btn btn-primary" type="submit"><ArrowRight size={16} /> 创建演示任务</button>
  </form>
}

const factLabels: Record<string, string> = {
  data_source: '数据来源', status: '状态', market: '目标市场', category: '类目', preferred: '首选候选',
  planned_budget: '模拟预算', selected: '已选商品', title: '商品标题', description: '商品描述', sku: 'SKU',
  attempt: '尝试编号', risk: '风险', price: '售价', cost: '成本', score: '评分', reason: '依据', id: '记录 ID',
  name: '名称', englishName: '英文名称', draft: '草稿', market_language: '语言', order_id: '订单',
}

function FactValue({ value }: { value: unknown }): ReactNode {
  if (Array.isArray(value)) return <ol className="fact-array">{value.map((item, index) => <li key={index}><FactValue value={item} /></li>)}</ol>
  if (value && typeof value === 'object') return <dl className="fact-grid">{Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => <div key={key}><dt>{factLabels[key] || key.replaceAll('_', ' ')}</dt><dd><FactValue value={item} /></dd></div>)}</dl>
  if (value === 'demo_simulated') return '虚构场景 · 模拟数据'
  if (value === 'draft') return '草稿'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return value == null ? '—' : String(value)
}

function Output({ data, label }: { data: Record<string, unknown>; label: string }) {
  return <section className="detail-output"><h3>{label}</h3><FactValue value={data} /></section>
}

function download(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('')
  return <><button className="btn" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setStatus('已复制') } catch { setStatus('复制失败，可选择文本复制') }
  }}><Clipboard size={16} /> {label}</button><span className="copy-status" role="status">{status}</span></>
}

function TaskDetails({ run, task }: { run: Run; task: Task }) {
  const approvals = run.approvals.filter(item => item.taskId === task.id)
  const duration = task.startedAt ? Math.max(0, (Date.parse(task.endedAt || run.updatedAt) - Date.parse(task.startedAt)) / 1000) : undefined
  return <div className="drawer-content">
    <div className="detail-meta"><span>{task.status === 'running' && run.status === 'paused' ? '已暂停' : taskStatusLabel[task.status]}</span><span>尝试 {task.attempts} 次</span><span>{duration === undefined ? '待执行' : `${duration.toFixed(1)} 秒`}</span><code>{task.id}</code></div>
    <p>{task.summary || '等待前序岗位完成。'} {task.failure}</p>
    {task.input && <Output data={task.input} label="执行输入" />}
    {task.output && <><Output data={task.output} label="模拟产物" /><CopyButton label="复制产物" text={JSON.stringify(task.output, null, 2)} /></>}
    {!!task.attemptHistory?.length && <><h3>执行尝试</h3><ul className="detail-log">{task.attemptHistory.map(attempt => <li key={attempt.number}>第 {attempt.number} 次 · <time>{localTime(attempt.startedAt)}</time> · {attempt.failure || (attempt.endedAt ? '已结束' : '尚未结束')}</li>)}</ul></>}
    <h3>岗位日志</h3><ul className="detail-log">{run.events.filter(evt => evt.taskId === task.id).map(evt => <li key={evt.seq}><time>{localTime(evt.at)}</time> {evt.message}</li>)}</ul>
    {!!approvals.length && <><h3>审批记录</h3><ul className="detail-log">{approvals.map((entry, index) => <li key={entry.id || index}><time>{localTime(entry.at)}</time> {entry.decision === 'approved' ? '批准' : '驳回'}模拟产物{entry.attempt && ` · 第 ${entry.attempt} 次尝试`}</li>)}</ul></>}
  </div>
}

function MetricDetails({ run }: { run: Run }) {
  const m = metrics(run)
  return <div className="metric-detail"><p>金额单位 USD。口径由当前任务的模拟订单及支出记录计算。</p>
    <dl>
      <dt>成交总额 · 排除取消订单</dt><dd>{money(m.gmv)}</dd>
      <dt>退款金额</dt><dd>{money(m.refunds)}</dd>
      <dt>净销售额 · 成交总额 − 退款</dt><dd>{money(m.net)}</dd>
      <dt>商品采购成本</dt><dd>{money(m.procurement)}</dd>
      <dt>商品毛利 · 净销售额 − 采购成本</dt><dd>{money(m.gross)} · {percent(m.margin)}</dd>
      <dt>物流成本 / 平台费用</dt><dd>{money(m.shipping)} / {money(m.fees)}</dd>
      <dt>广告归因净销售额 / 模拟广告支出</dt><dd>{money(m.attributed)} / {money(m.adSpend)}</dd>
      <dt>广告 ROAS · 归因净销售额 ÷ 支出</dt><dd>{m.roas === null ? 'N/A' : `${m.roas.toFixed(2)}×`}</dd>
      <dt>其他可变费用</dt><dd>{money(run.otherCosts)}</dd>
      <dt>估算贡献利润 · 净销售额 − 全部可变成本</dt><dd>{money(m.contribution)}</dd>
    </dl>
  </div>
}

function Report({ run }: { run: Run }) {
  const m = metrics(run)
  const report = [
    `VoyageDeck AI 演示复盘 · ${run.id}`, `模拟数据 · ${scenarios[run.config.scenario]} · ${markets[run.config.market]} · ${runStatusLabel[run.status]}`,
    `GMV ${money(m.gmv)} − 退款 ${money(m.refunds)} = 净销售额 ${money(m.net)}`,
    `净销售额 ${money(m.net)} − 采购 ${money(m.procurement)} − 物流 ${money(m.shipping)} − 平台 ${money(m.fees)} − 广告 ${money(m.adSpend)} − 其他 ${money(run.otherCosts)} = 估算贡献利润 ${money(m.contribution)}`,
    `ROAS = ${money(m.attributed)} 归因净销售额 / ${money(m.adSpend)} 广告支出 = ${m.roas === null ? 'N/A' : m.roas.toFixed(2)}`,
    ...run.tasks.map((task, index) => {
      const timing = task.startedAt && task.endedAt ? `${((Date.parse(task.endedAt) - Date.parse(task.startedAt)) / 1000).toFixed(1)} 秒` : '未结束'
      return `\n${agents[index].name} · ${taskStatusLabel[task.status]} · ${timing} · 尝试 ${task.attempts} 次\n${task.failure || task.summary || ''}\n输入 ${JSON.stringify(task.input ?? {})}\n输出 ${JSON.stringify(task.output ?? {})}`
    }),
    '\n人工审批', ...run.approvals.map(entry => `${entry.at} · ${entry.taskId} · ${entry.decision === 'approved' ? '批准' : '驳回'}`),
    '\n风险与异常', ...run.events.filter(evt => evt.level === 'warn' || evt.level === 'error').map(evt => `${evt.at} · ${evt.message}`),
  ].join('\n')
  return <><MetricDetails run={run} /><div className="dialog-actions"><CopyButton label="复制复盘" text={report} /><button className="btn" onClick={() => download(report, `voyagedeck-${run.id.slice(0, 8)}.txt`)}><ArrowDownToLine size={16} /> 下载复盘</button></div><pre className="report-text">{report}</pre></>
}

type View = 'new' | 'reset' | 'cancel' | 'metrics' | 'report' | 'admin' | 'history' | null

export function App() {
  const [run, setRun] = useState(initialRun)
  const [view, setView] = useState<View>(null)
  const [inspected, setInspected] = useState<string | null>(null)
  const [historical, setHistorical] = useState<Run | null>(null)
  const [history, setHistory] = useState<Run[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(`${sessionKey}-history`) ?? '[]') as Run[] } catch { return [] }
  })
  useEffect(() => {
    try { sessionStorage.setItem(sessionKey, JSON.stringify(run)) } catch { /* Keep using the live state. */ }
  }, [run])
  useEffect(() => {
    if (run.status !== 'running') return
    const timer = window.setInterval(() => setRun(current => reduceRun(current, { type: 'tick' })), stepMs)
    return () => window.clearInterval(timer)
  }, [run.status])

  const dispatch = (action: Action) => setRun(current => reduceRun(current, action))
  const close = () => { setView(null); setInspected(null); setHistorical(null) }
  const inspect = (task: Task) => setInspected(task.id)
  const selectedTask = run.tasks.find(task => task.id === inspected)
  const approval = run.status === 'awaiting_approval' ? run.tasks[run.activeIndex] : undefined
  const activeTask = run.tasks[run.activeIndex]
  const summary = run.failure || activeTask?.summary || '候选库已载入，等待任务启动。'
  const terminal = ['completed', 'failed', 'canceled'].includes(run.status)

  function replace(config: Config, preserve: boolean) {
    if (preserve) {
      const archived = run.status === 'running' ? reduceRun(run, { type: 'pause' }) : run
      const next = [archived, ...history].slice(0, 12)
      setHistory(next)
      try { sessionStorage.setItem(`${sessionKey}-history`, JSON.stringify(next)) } catch { /* Keep the in-memory archive. */ }
    }
    setRun(createRun(config))
    close()
  }

  const titles: Record<Exclude<View, null>, string> = { new: '新建出海任务', reset: '重置当前演示任务', cancel: '取消当前任务', metrics: '模拟指标计算口径', report: '任务复盘', admin: '管理后台', history: '本会话任务历史' }
  let modalContent: ReactNode
  if (view === 'new') modalContent = <NewTaskForm current={run.config} submit={config => replace(config, true)} />
  if (view === 'reset') modalContent = <><p>清除当前任务的进度、模拟订单、指标和审批记录。场景、市场和已有任务历史会保留。</p><div className="dialog-actions"><button className="btn" onClick={close}>返回</button><button className="btn btn-primary" onClick={() => replace(run.config, false)}>确认重置</button></div></>
  if (view === 'cancel') modalContent = <><p>停止该任务的剩余步骤，保留现有模拟数据和审计记录。</p><div className="dialog-actions"><button className="btn" onClick={close}>返回</button><button className="btn btn-danger" onClick={() => { dispatch({ type: 'cancel' }); close() }}>确认取消</button></div></>
  if (view === 'metrics') modalContent = <MetricDetails run={run} />
  if (view === 'report') modalContent = <Report run={historical || run} />
  if (view === 'admin') modalContent = <AdminBoard />
  if (view === 'history') modalContent = history.length ? <ul className="history-list">{history.map(item => <li key={item.id}><button className="btn" onClick={() => { setHistorical(item); setView('report') }}>{scenarios[item.config.scenario]} · {runStatusLabel[item.status]} · {item.id.slice(0, 8)} <ArrowUpRight size={14} /></button></li>)}</ul> : <p>新建第二个任务后，可在此回看上一轮模拟记录。</p>

  return <>
    <a className="skip-link" href="#overview">跳转到指挥台</a>
    <Header run={run} openAdmin={() => setView('admin')} />
    <main className="console-layout">
      <Hero run={run} dispatch={dispatch} newTask={() => setView('new')} reset={() => setView('reset')} report={() => setView('report')} />
      <MetricsRow run={run} inspect={() => setView('metrics')} />
      <div className="cockpit-grid">
        <div className="main-deck">
          <LiveFlow run={run} inspect={inspect} />
          <section className="decision-strip" data-status={run.status} aria-label="阶段决策" aria-live="polite">
            <span className="decision-icon">{approval || run.status === 'failed' ? <TriangleAlert size={17} /> : <Activity size={17} />}</span>
            <div><strong>{approval ? (approval.agent === 'ads' ? '待审 · 模拟广告预算' : '待审 · 模拟上架草稿') : '阶段动态'}</strong><span>{summary}</span></div>
            <div className="decision-actions">
              {approval && <><button className="btn" onClick={() => inspect(approval)}>查看产物</button><button className="btn btn-danger" onClick={() => dispatch({ type: 'reject', taskId: approval.id, attempt: approval.attempts })}>驳回</button><button className="btn btn-primary" onClick={() => dispatch({ type: 'approve', taskId: approval.id, attempt: approval.attempts })}>{approval.agent === 'ads' ? '批准模拟预算' : '批准模拟草稿'}</button></>}
              {canRetry(run) && <button className="btn btn-primary" onClick={() => dispatch({ type: 'retry' })}><RotateCcw size={15} /> 重试模拟岗位</button>}
              {run.status === 'failed' && <button className="btn" onClick={() => setView('report')}>查看失败复盘 <ArrowRight size={14} /></button>}
              {!terminal && !approval && activeTask && <button className="btn subtle-btn" onClick={() => inspect(activeTask)}>岗位详情 <ArrowRight size={14} /></button>}
            </div>
          </section>
          <div className="panel-pair" id="telemetry" key={run.id}><CandidatePanel run={run} /><TerminalPanel run={run} /></div>
          <div className="panel-pair analytics-pair"><TrendPanel run={run} /><OrderPanel run={run} /></div>
          <Milestones run={run} inspect={inspect} />
        </div>
        <AgentRoster run={run} inspect={inspect} />
      </div>
      <footer className="console-footer"><span><span className="online-dot" /> 模拟数据 · USD <span className="foot-mid">/</span> 当前浏览器会话</span><div><button className="btn" onClick={() => setView('history')}>任务历史</button>{(!terminal || canRetry(run)) && <button className="btn" onClick={() => setView('cancel')}><Square size={13} /> 取消任务</button>}<button className="btn" onClick={() => setView('report')}>运行记录</button></div></footer>
    </main>
    {selectedTask && <Dialog title={`${agents.find(agent => agent.id === selectedTask.agent)?.name} · 岗位详情`} close={close} wide><TaskDetails run={run} task={selectedTask} /></Dialog>}
    {view && <Dialog title={titles[view]} close={close} wide={view === 'report' || view === 'admin'}>{modalContent}</Dialog>}
  </>
}
