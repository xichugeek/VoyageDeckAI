import { agents, markets, money, percent, scenarios } from './model'
import type { Action, Config, Metrics, Order, Product, Run, RunEvent, Task } from './model'

const source = 'demo_simulated'

export const products: Product[] = [
  { id: 'nomad', sku: 'VD-NP01', name: 'NomadPack 旅行收纳包', englishName: 'NomadPack Travel Organizer', cost: 1800, price: 4900, status: 'pending' },
  { id: 'orbit', sku: 'VD-OC02', name: 'OrbitCase 数码收纳盒', englishName: 'OrbitCase Travel Tech Case', cost: 2900, price: 3600, status: 'pending' },
  { id: 'aero', sku: 'VD-AF03', name: 'AeroFold 折叠旅行袋', englishName: 'AeroFold Travel Tote', cost: 1650, price: 4200, status: 'pending' },
]

const defaultConfig: Config = {
  scenario: 'standard', market: 'US', preferredId: 'nomad', category: '旅行收纳', marginFloor: 0.35, budget: 6000,
}

function event(run: Run, at: string, level: RunEvent['level'], message: string, task?: Task) {
  const seq = run.events.length + 1
  run.events.push({ seq, at, level, message, agent: task?.agent, taskId: task?.id })
  const { gmv, totalCost } = metrics(run)
  const last = run.snapshots.at(-1)
  if (!last || last.gmv !== gmv || last.cost !== totalCost) {
    run.snapshots.push({ seq, gmv, cost: totalCost })
  }
}

export function createRun(config: Partial<Config> = {}, now = Date.now()): Run {
  const createdAt = new Date(now).toISOString()
  const options = { ...defaultConfig, ...config }
  if (options.scenario === 'fallback' && !config.preferredId) options.preferredId = 'orbit'
  const run: Run = {
    id: crypto.randomUUID(), mode: source, config: options, status: 'ready', createdAt, updatedAt: createdAt,
    activeIndex: 0, candidates: structuredClone(products), events: [], snapshots: [], orders: [],
    adSpend: 0, otherCosts: 0, approvals: [],
    tasks: agents.map(({ id }) => ({ id: crypto.randomUUID(), agent: id, status: 'pending', attempts: 0, progress: 0, processed: 0 })),
  }
  event(run, createdAt, 'info', '隔离演示沙盒已挂载 · USD')
  event(run, createdAt, 'info', `情景载入 · ${scenarios[options.scenario]} / ${markets[options.market]}市场`)
  event(run, createdAt, 'info', '已载入 3 个虚构商品样例')
  return run
}

export function metrics(run: Run): Metrics {
  const orders = run.orders.filter(({ status }) => status !== 'canceled')
  let gmv = 0
  let refunds = 0
  let procurement = 0
  let shipping = 0
  let fees = 0
  let attributed = 0
  for (const order of orders) {
    gmv += order.amount
    refunds += order.refund
    procurement += order.productCost
    shipping += order.shipping
    fees += order.platformFee
    if (order.attributed) attributed += order.amount - order.refund
  }
  const net = gmv - refunds
  const gross = net - procurement
  const totalCost = procurement + shipping + fees + run.adSpend + run.otherCosts
  return {
    gmv, count: orders.length, refunds, net, procurement, shipping, fees, attributed, adSpend: run.adSpend,
    roas: run.adSpend === 0 ? null : attributed / run.adSpend, gross, margin: net === 0 ? null : gross / net,
    contribution: net - totalCost, totalCost,
    working: run.status === 'running' ? run.tasks.filter(({ status }) => status === 'running').length : 0,
  }
}

function begin(run: Run, task: Task, at: string) {
  task.status = 'running'
  task.progress = 25
  task.attempts += 1
  task.startedAt ??= at
  task.endedAt = undefined
  task.failure = undefined
  task.attemptHistory ??= []
  task.attemptHistory.push({ number: task.attempts, startedAt: at })
  task.input = { data_source: source, market: markets[run.config.market], category: run.config.category, preferred: run.config.preferredId, planned_budget: money(run.config.budget), selected: run.selectedId }
  task.summary = agents.find(({ id }) => id === task.agent)?.action
  event(run, at, 'info', `${task.summary} · 第 ${task.attempts} 次执行`, task)
}

function succeed(run: Run, task: Task, at: string) {
  task.status = 'succeeded'
  task.progress = 100
  task.endedAt = at
  const attempt = task.attemptHistory?.at(-1)
  if (attempt) attempt.endedAt = at
  event(run, at, 'success', task.summary ?? '执行完成', task)
  run.activeIndex += 1
  if (run.activeIndex === run.tasks.length) {
    run.status = 'completed'
    event(run, at, 'success', '六岗位任务已完成 · 复盘就绪')
    return
  }
  const next = run.tasks[run.activeIndex]
  next.status = 'queued'
  if (run.status === 'running') begin(run, next, at)
}

function scout(run: Run, task: Task, at: string) {
  const scores = [94, 56, 87]
  const candidates = run.candidates.map((product, index): Product => {
    const margin = (product.price - product.cost) / product.price
    if (margin < run.config.marginFloor) {
      const reason = `毛利率 ${percent(margin)} 低于 ${percent(run.config.marginFloor)} 门槛`
      event(run, at, 'warn', `${product.name} 淘汰 · ${reason}`, task)
      return { ...product, status: 'rejected', score: scores[index], reason }
    }
    return { ...product, status: 'eligible', score: scores[index], reason: '通过毛利门槛 · 保留为备选' }
  })
  const selected = candidates.find(({ id, status }) => id === run.config.preferredId && status === 'eligible')
    ?? candidates.filter(({ status }) => status === 'eligible').sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  if (selected) {
    selected.status = 'selected'
    selected.reason = selected.id === run.config.preferredId ? '通过毛利门槛 · 命中首选商品' : '首选商品淘汰 · 切换最高分备选'
  }
  run.candidates = candidates
  run.selectedId = selected?.id
  task.processed = candidates.length
  task.output = { data_source: source, 候选评分: candidates, 推荐商品: selected?.name ?? '无合格商品' }
  task.summary = selected ? `锁定 ${selected.name} · 评估 ${candidates.length} 件候选` : '无合格候选'
}

function createOrders(run: Run, product: Product, task: Task, at: string) {
  run.adSpend = Math.min(run.config.budget, 2680)
  event(run, at, 'info', `记录模拟广告支出 ${money(run.adSpend)}`, task)
  for (const index of [1, 2]) {
    const order: Order = {
      id: `SIM-${run.id.slice(0, 4).toUpperCase()}-0${index}`, sku: product.sku, status: 'created', amount: product.price,
      refund: 0, productCost: product.cost, shipping: 0, platformFee: Math.round(product.price * 0.06),
      attributed: index === 1 && run.adSpend > 0, events: [{ at, message: '已创建模拟订单' }],
    }
    run.orders.push(order)
    event(run, at, 'success', `${order.id} 创建模拟订单 · ${money(order.amount)}`, task)
  }
}

function fail(run: Run, task: Task, at: string, reason: string) {
  task.status = 'failed'
  task.failure = reason
  task.endedAt = at
  const attempt = task.attemptHistory?.at(-1)
  if (attempt) Object.assign(attempt, { endedAt: at, failure: reason })
  run.status = 'failed'
  run.failure = reason
  event(run, at, 'error', reason, task)
}

function finish(run: Run, task: Task, at: string) {
  const product = run.candidates.find(({ id }) => id === run.selectedId)
  const name = product?.englishName ?? 'Travel Organizer'
  switch (task.agent) {
    case 'scout':
      scout(run, task, at)
      if (!run.selectedId) {
        fail(run, task, at, '三件候选均未通过毛利门槛')
        return
      }
      break
    case 'lister':
      task.output = { data_source: source, status: 'draft', title: `${name} | Compact Packing for Weekend Trips`, sku: product?.sku, description: 'Lightweight travel storage for a more organized carry-on.' }
      task.summary = '商品草稿就绪 · 等待审核'
      task.processed = 1
      break
    case 'creator':
      if (run.config.scenario === 'incident') {
        fail(run, task, at, '内容生成模拟超时 · 已保存故障快照')
        return
      }
      task.output = { data_source: source, 标题: 'Pack fast. Move light.', 分镜: ['0–3 秒：开箱展示', '4–9 秒：整理行李前后对比', '10–15 秒：细节特写与卖点'], 社媒帖文: 'A tidy bag starts with the right organizer.' }
      task.summary = '已归档 15 秒短视频脚本与社媒文案'
      task.processed = 1
      break
    case 'ads':
      task.output = { data_source: source, status: '模拟投放计划', 预算上限: money(run.config.budget), 计划消耗: money(Math.min(run.config.budget, 2680)), 渠道: '模拟短视频 / 模拟搜索', 目标回报: '1.80×' }
      task.summary = '模拟投放计划就绪 · 等待批准预算'
      task.processed = 1
      break
    case 'service':
      task.output = { data_source: source, 状态: '待审核回覆', 草稿: ['Dimensions are listed in the draft product description.', 'This is a simulated order, so no delivery date has been issued.', 'I’ll flag this return request for manual review.'] }
      task.summary = '三条英语咨询已分流 · 1 条需人工处理'
      task.processed = 3
      break
    case 'fulfillment':
      for (const order of run.orders) {
        order.status = 'shipped'
        order.shipping = 480
        order.events.push({ at, message: '库存校验通过 · 模拟发货' })
        event(run, at, 'success', `${order.id} 库存校验通过 · 模拟发货`, task)
      }
      task.output = { data_source: source, 模拟订单: run.orders }
      task.summary = `已校验库存与地址 · ${run.orders.length} 笔模拟发货`
      task.processed = run.orders.length
      break
  }
  if (task.agent === 'lister' || task.agent === 'ads') {
    task.status = 'awaiting_approval'
    task.progress = 85
    run.status = 'awaiting_approval'
    event(run, at, 'warn', task.summary ?? '等待人工审批', task)
    return
  }
  succeed(run, task, at)
}

const terminal = new Set<Run['status']>(['completed', 'failed', 'canceled'])

export function reduceRun(run: Run, action: Action, now = Date.now()): Run {
  const current = run.tasks[run.activeIndex]
  switch (action.type) {
    case 'start': if (run.status !== 'ready') return run; break
    case 'pause': if (run.status !== 'running') return run; break
    case 'resume': if (run.status !== 'paused') return run; break
    case 'step': if (run.status !== 'paused' && run.status !== 'ready') return run; break
    case 'tick': if (run.status !== 'running') return run; break
    case 'cancel': if (terminal.has(run.status)) return run; break
    case 'retry': if (run.status !== 'failed' || current?.agent !== 'creator' || current.attempts >= 3) return run; break
    case 'approve':
    case 'reject':
      if (run.status !== 'awaiting_approval' || current?.id !== action.taskId) return run
      break
  }
  const next = structuredClone(run)
  const at = new Date(now).toISOString()
  const task = next.tasks[next.activeIndex]
  next.updatedAt = at
  switch (action.type) {
    case 'start':
      next.status = 'running'
      event(next, at, 'info', '指挥任务启动 · 六岗位串行执行')
      begin(next, task, at)
      break
    case 'pause':
      next.status = 'paused'
      event(next, at, 'info', '人工暂停 · 已保留岗位进度')
      break
    case 'resume':
      next.checkpoint = false
      next.status = 'running'
      event(next, at, 'info', '恢复任务 · 从中断位置继续')
      if (task.status === 'queued') begin(next, task, at)
      break
    case 'step':
      next.checkpoint = false
      next.status = 'paused'
      if (task.status !== 'running') begin(next, task, at)
      finish(next, task, at)
      break
    case 'tick':
      if (task.progress === 25) task.progress = 60
      else finish(next, task, at)
      break
    case 'cancel':
      next.status = 'canceled'
      for (const item of next.tasks) {
        if (item.status !== 'succeeded') {
          item.status = item === task && item.startedAt ? 'canceled' : 'skipped'
          if (item.startedAt) item.endedAt = at
        }
      }
      event(next, at, 'warn', '任务已取消 · 已完成产物保留')
      break
    case 'retry':
      next.status = 'running'
      next.failure = undefined
      event(next, at, 'warn', '登记模拟重试', task)
      begin(next, task, at)
      break
    case 'approve': {
      next.approvals.push({ taskId: task.id, decision: 'approved', at })
      event(next, at, 'success', '人工批准 · 模拟审批已留痕', task)
      const product = next.candidates.find(({ id }) => id === next.selectedId)
      if (task.agent === 'ads' && product) createOrders(next, product, task, at)
      next.status = 'running'
      task.summary = task.agent === 'ads' ? '已批准模拟预算 · 两笔模拟订单' : '已批准商品草稿 · 模拟审核'
      succeed(next, task, at)
      break
    }
    case 'reject':
      next.approvals.push({ taskId: task.id, decision: 'rejected', at })
      fail(next, task, at, '人工驳回 · 任务已停止，审批记录已保留')
      break
  }
  return next
}

export function previewRun(): Run {
  const now = Date.now()
  let run = createRun({}, now - 36000)
  let elapsed = 1000
  const dispatch = (action: Action) => {
    run = reduceRun(run, action, now - 36000 + elapsed)
    elapsed += 2200
  }
  dispatch({ type: 'start' })
  for (let index = 0; index < 5; index += 1) {
    dispatch({ type: 'tick' })
    dispatch({ type: 'tick' })
    if (run.status === 'awaiting_approval') {
      dispatch({ type: 'approve', taskId: run.tasks[run.activeIndex].id })
    }
  }
  dispatch({ type: 'tick' })
  dispatch({ type: 'pause' })
  return { ...run, checkpoint: true }
}
