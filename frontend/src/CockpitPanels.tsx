import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, Box, ChartNoAxesCombined, ChevronRight, CircleDot, Clock3, ListFilter, Radar, Terminal } from 'lucide-react'
import { agents, localTime, money, percent } from './model'
import type { AgentId, Run } from './model'
import './panels.css'

const roles = new Map(agents.map(role => [role.id, role]))

const candidateStatus = {
  pending: '待扫描', selected: '已选定', eligible: '可备选', rejected: '已淘汰',
}

const eventLevel = { info: 'INFO', success: 'OK', warn: 'WARN', error: 'ERR' }
const orderStatus = { created: '已创建', shipped: '已发货', refunded: '已退款', canceled: '已取消' }

export function CandidatePanel({ run }: { run: Run }) {
  const [inspectedId, setInspectedId] = useState<string>()
  const candidate = run.candidates.find(({ id }) => id === inspectedId)
    ?? run.candidates.find(({ status }) => status === 'selected')
    ?? run.candidates[0]
  const rejected = run.candidates.filter(({ status }) => status === 'rejected').length

  return <section className="cockpit-panel candidate-panel" aria-label="候选商品">
    <div className="cp-head">
      <h2><Radar size={15} />候选商品</h2>
      <span className="cp-head-note">{run.candidates.length} 件虚构商品{rejected > 0 && <> · <span className="cp-danger">{rejected} 件已淘汰</span></>}</span>
    </div>
    {candidate ? <>
      <div className="cp-candidate-focus">
        <div className="cp-product-mark" aria-hidden="true"><Box size={26} strokeWidth={1.25} /></div>
        <div className="cp-product-name"><strong>{candidate.name}</strong><small>{candidate.sku}</small></div>
        <span className={`cp-pill cp-candidate-${candidate.status}`}>{candidateStatus[candidate.status]}</span>
      </div>
      <dl className="cp-candidate-values">
        <div><dt>预计售价</dt><dd>{money(candidate.price)}</dd></div>
        <div><dt>采购成本</dt><dd>{money(candidate.cost)}</dd></div>
        <div><dt>商品毛利率</dt><dd className={candidate.status === 'rejected' ? 'cp-danger' : 'cp-gain'}>{percent(candidate.price > 0 ? (candidate.price - candidate.cost) / candidate.price : null)}</dd></div>
        {candidate.score !== undefined && <div><dt>综合评分</dt><dd>{candidate.score}</dd></div>}
      </dl>
      <p className="cp-candidate-reason"><ChevronRight size={13} />{candidate.reason ?? '启动演示后生成选品判断。'}</p>
      <div className="cp-candidate-choices" aria-label="查看候选商品">
        {run.candidates.map((item) => <button type="button" key={item.id} onClick={() => setInspectedId(item.id)} aria-label={`${item.sku} · ${item.name} · ${candidateStatus[item.status]}`} aria-pressed={item.id === candidate.id} className={`cp-candidate-${item.status}`}>
          <span className="cp-choice-dot" />{item.sku}
        </button>)}
      </div>
    </> : <div className="cp-empty">等待候选商品</div>}
  </section>
}

export function TerminalPanel({ run }: { run: Run }) {
  const [level, setLevel] = useState('all')
  const [agent, setAgent] = useState('all')
  const [task, setTask] = useState('all')
  const [follow, setFollow] = useState(true)
  const scroller = useRef<HTMLOListElement>(null)
  const availableTasks = new Map<string, AgentId | undefined>()
  for (const event of run.events) {
    if (event.taskId) availableTasks.set(event.taskId, event.agent)
  }
  const selectedTask = availableTasks.has(task) ? task : 'all'
  const visibleEvents = run.events.filter(event => (level === 'all' || event.level === level)
    && (agent === 'all' || (event.agent ?? 'system') === agent)
    && (selectedTask === 'all' || event.taskId === selectedTask))
  const lastSeq = visibleEvents.at(-1)?.seq

  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [follow, lastSeq, level, agent, selectedTask])

  return <section className="cockpit-panel terminal-panel" aria-label="实时终端">
    <div className="cp-head">
      <h2><Terminal size={15} />实时终端 <code>ops.log</code></h2>
      <span className="cp-head-note">{visibleEvents.length < run.events.length ? `${visibleEvents.length} / ` : ''}{run.events.length} 条</span>
    </div>
    <div className="cp-terminal-tools">
      <ListFilter size={13} aria-hidden="true" />
      <select aria-label="按日志级别筛选" value={level} onChange={event => setLevel(event.target.value)}>
        <option value="all">全部级别</option>
        {Object.entries(eventLevel).map(([key, text]) => <option value={key} key={key}>{text}</option>)}
      </select>
      <select aria-label="按岗位筛选日志" value={agent} onChange={event => setAgent(event.target.value)}>
        <option value="all">全部岗位</option><option value="system">系统</option>
        {agents.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}
      </select>
      <select aria-label="按任务筛选日志" value={selectedTask} onChange={event => setTask(event.target.value)}>
        <option value="all">全部任务</option>
        {[...availableTasks].map(([id, role]) => <option key={id} value={id}>{role ? roles.get(role)?.name : '任务'} · {id.slice(0, 6)}</option>)}
      </select>
      <button type="button" className="cp-follow" aria-pressed={follow} onClick={() => setFollow(value => !value)}><CircleDot size={12} />跟随最新</button>
    </div>
    <ol className="cp-terminal-log" ref={scroller} aria-label="工作流事件历史" tabIndex={0}>
      {visibleEvents.map(event => <li key={event.seq} className={`cp-event cp-event-${event.level}`}>
        <time dateTime={event.at}>{localTime(event.at)}</time>
        <span className="cp-event-level">{eventLevel[event.level]}</span>
        <span className="cp-event-role" style={{ color: event.agent && roles.get(event.agent)?.color }}>{event.agent ? roles.get(event.agent)?.name : '系统'}</span>
        <span className="cp-event-message">{event.message}</span>
        <code className="cp-event-id" title={event.taskId ? `任务 ${event.taskId} · 事件 #${event.seq}` : `事件 #${event.seq}`}>{event.taskId ? event.taskId.slice(0, 6) : `#${String(event.seq).padStart(3, '0')}`}</code>
      </li>)}
      {visibleEvents.length === 0 && <li className="cp-terminal-empty">{run.events.length ? '没有符合筛选条件的事件' : '等待工作流事件'}</li>}
    </ol>
  </section>
}

const chart = { width: 600, height: 146, left: 48, right: 18, top: 14, bottom: 28 }

export function TrendPanel({ run }: { run: Run }) {
  const gradientId = useId()
  const sample = run.snapshots
  const active = sample.at(-1)
  const firstSeq = sample[0]?.seq ?? 0
  const seqRange = Math.max(1, (active?.seq ?? firstSeq) - firstSeq)
  const highest = Math.max(0, ...sample.flatMap(point => [point.gmv, point.cost]))
  const scale = Math.max(100, Math.ceil(highest / 5000) * 5000)
  const baseline = chart.height - chart.bottom
  const x = (seq: number) => chart.left + (seq - firstSeq) / seqRange * (chart.width - chart.left - chart.right)
  const y = (cents: number) => baseline - cents / scale * (baseline - chart.top)
  const pointsFor = (field: 'gmv' | 'cost') => sample.map((point, index) => {
    const left = x(point.seq)
    return index === 0 ? `${left},${y(point[field])}` : `${left},${y(sample[index - 1][field])} ${left},${y(point[field])}`
  }).join(' ')
  const gmvPoints = pointsFor('gmv')
  const marks = highest ? [scale, scale / 2, 0] : [0]

  return <section className="cockpit-panel trend-panel" aria-label="模拟业绩趋势">
    <div className="cp-head">
      <h2><ChartNoAxesCombined size={15} />业绩趋势</h2>
      <span className="cp-head-note">USD · 模拟数据</span>
    </div>
    <div className="cp-chart-legend"><span><i />GMV <strong>{money(active?.gmv ?? 0)}</strong></span><span><i />累计成本 <strong>{money(active?.cost ?? 0)}</strong></span></div>
    <div className="cp-chart-wrap">
      <svg className="cp-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`按事件绘制的模拟 GMV ${money(active?.gmv ?? 0)}，累计成本 ${money(active?.cost ?? 0)}`}>
        <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#49dfea" stopOpacity=".25" /><stop offset="1" stopColor="#49dfea" stopOpacity=".015" /></linearGradient></defs>
        {[.25, .5, .75, 1].map(part => {
          const marker = chart.left + (chart.width - chart.left - chart.right) * part
          return <line key={part} x1={marker} x2={marker} y1={chart.top} y2={baseline} className="cp-chart-grid" />
        })}
        {marks.map(mark => <g key={mark}>
          <line x1={chart.left} x2={chart.width - chart.right} y1={y(mark)} y2={y(mark)} className="cp-chart-grid" />
          <text x={chart.left - 8} y={y(mark) + 4} textAnchor="end">{mark / 100}</text>
        </g>)}
        {active && <>
          <polygon points={`${chart.left},${baseline} ${gmvPoints} ${x(active.seq)},${baseline}`} fill={`url(#${gradientId})`} />
          <polyline points={pointsFor('cost')} className="cp-chart-cost" />
          <polyline points={gmvPoints} className="cp-chart-gmv" />
          <circle cx={x(active.seq)} cy={y(active.gmv)} r="4" className="cp-chart-point" />
        </>}
        <text x={chart.left} y={chart.height - 7}>#{String(firstSeq).padStart(3, '0')}</text>
        <text x={chart.width - chart.right} y={chart.height - 7} textAnchor="end">{active && active.seq !== firstSeq ? `#${String(active.seq).padStart(3, '0')}` : '事件序号'}</text>
      </svg>
      {!highest && <div className="cp-chart-empty">{sample.length ? '等待首笔模拟交易' : '启动任务后记录业绩'}</div>}
    </div>
  </section>
}

export function OrderPanel({ run }: { run: Run }) {
  return <section className="cockpit-panel order-panel" aria-label="模拟订单">
    <div className="cp-head">
      <h2><Box size={15} />模拟订单</h2>
      <span className="cp-head-note">{run.orders.length} 笔</span>
    </div>
    {run.orders.length === 0 ? <div className="cp-empty cp-order-empty"><Box size={24} strokeWidth={1.25} /><span>等待模拟订单生成</span></div> : <div className="cp-orders">
      {run.orders.map(order => <details key={order.id}>
        <summary>
          <span className="cp-order-ref"><code>{order.id}</code><small>{order.sku}</small></span>
          <span className={`cp-pill cp-order-${order.status}`}>{orderStatus[order.status]}</span>
          <strong>{money(order.amount)}</strong><ChevronRight size={13} />
        </summary>
        <dl className="cp-order-facts">
          <div><dt>退款</dt><dd>{money(order.refund)}</dd></div>
          <div><dt>商品成本</dt><dd>{money(order.productCost)}</dd></div>
          <div><dt>物流成本</dt><dd>{money(order.shipping)}</dd></div>
          <div><dt>平台费用</dt><dd>{money(order.platformFee)}</dd></div>
          <div><dt>模拟广告归因</dt><dd>{order.attributed ? '是' : '否'}</dd></div>
        </dl>
        <ol className="cp-order-events">{order.events.map((event, index) => <li key={`${event.at}-${index}`}><Clock3 size={12} /><time dateTime={event.at}>{localTime(event.at)}</time>{event.message}</li>)}</ol>
      </details>)}
      <p className="cp-order-source"><ArrowUpRight size={12} />展开订单查看金额依据和履约事件</p>
    </div>}
  </section>
}
