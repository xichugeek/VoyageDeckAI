import { agents, markets, money, scenarios } from './model'
import type { Action, Config, Metrics, Order, OrderEvent, Product, Run, RunEvent, Task } from './model'
import {
  adPlan, contentDraft, inventoryFor, listingDraft, plannedSpend, products, roleInput, scoreCandidate, serviceDraft, source,
} from './demoAgents'

export { products }
export const retryLimit = 2

const defaultConfig: Config = {
  scenario: 'standard', market: 'US', preferredId: 'nomad', category: '旅行收纳', marginFloor: 0.35, budget: 6000,
}

function validateConfig(config: Partial<Config>): Config {
  const options = { ...defaultConfig, ...config }
  if (options.scenario === 'fallback' && !config.preferredId) options.preferredId = 'orbit'
  if (!Object.hasOwn(scenarios, options.scenario) || !Object.hasOwn(markets, options.market)
    || !products.some(product => product.id === options.preferredId)
    || !['旅行收纳', '随身配件'].includes(options.category)) {
    throw new RangeError('场景、市场、候选商品或类目无效')
  }
  if (!Number.isFinite(options.marginFloor) || options.marginFloor < 0 || options.marginFloor > 0.9) {
    throw new RangeError('毛利门槛应介于 0% 至 90%')
  }
  if (!Number.isSafeInteger(options.budget) || options.budget < 0 || options.budget > 100000) {
    throw new RangeError('模拟预算应介于 $0 至 $1,000，并以整数美分计量')
  }
  return options
}

function event(run: Run, at: string, level: RunEvent['level'], message: string, task?: Task, orderId?: string) {
  const seq = run.events.length + 1
  run.events.push({
    seq, at, level, message, workflowId: run.id, dataSource: source,
    agent: task?.agent, taskId: task?.id, attempt: task?.attempts || undefined, orderId,
  })
  const { gmv, totalCost } = metrics(run)
  const last = run.snapshots.at(-1)
  if (!last || last.gmv !== gmv || last.cost !== totalCost) run.snapshots.push({ seq, gmv, cost: totalCost })
  return seq
}

export function eventsSince(run: Run, afterSeq = 0): RunEvent[] {
  return run.events.filter(({ seq }) => seq > afterSeq)
}

export function createDraft(config: Partial<Config> = {}, now = Date.now()): Run {
  const createdAt = new Date(now).toISOString()
  const options = validateConfig(config)
  const run: Run = {
    id: crypto.randomUUID(), mode: source, config: options, status: 'draft', createdAt, updatedAt: createdAt,
    activeIndex: 0, candidates: structuredClone(products), events: [], snapshots: [], orders: [], inventory: inventoryFor(options),
    adSpend: 0, otherCosts: 0, approvals: [],
    tasks: agents.map(({ id }) => ({ id: crypto.randomUUID(), agent: id, status: 'pending', attempts: 0, progress: 0, processed: 0 })),
  }
  event(run, createdAt, 'info', '隔离演示沙盒已挂载 · USD')
  return run
}

export function createRun(config: Partial<Config> = {}, now = Date.now()): Run {
  return reduceRun(createDraft(config, now), { type: 'prepare' }, now)
}

export function metrics(run: Run): Metrics {
  let gmv = 0
  let count = 0
  let refunds = 0
  let procurement = 0
  let shipping = 0
  let fees = 0
  let attributed = 0
  for (const order of run.orders) {
    if (order.status !== 'canceled') {
      count += 1
      gmv += order.amount
      refunds += order.refund
      if (order.attributed) attributed += order.amount - order.refund
    }
    procurement += order.productCost
    shipping += order.shipping
    fees += order.platformFee
  }
  const net = gmv - refunds
  const gross = net - procurement
  const totalCost = procurement + shipping + fees + run.adSpend + run.otherCosts
  return {
    gmv, count, refunds, net, procurement, shipping, fees, attributed, adSpend: run.adSpend,
    roas: run.adSpend === 0 ? null : attributed / run.adSpend, gross, margin: net === 0 ? null : gross / net,
    contribution: net - totalCost, totalCost,
    working: run.status === 'running' ? run.tasks.filter(({ status }) => status === 'running').length : 0,
  }
}

function queue(run: Run, task: Task, at: string) {
  task.status = 'queued'
  const agent = agents.find(({ id }) => id === task.agent)
  event(run, at, 'info', `${agent?.name}已排队`, task)
}

function begin(run: Run, task: Task, at: string) {
  if (task.status !== 'queued') queue(run, task, at)
  task.status = 'running'
  task.progress = 25
  task.attempts += 1
  task.startedAt ??= at
  task.endedAt = undefined
  task.failure = undefined
  task.attemptHistory ??= []
  task.attemptHistory.push({ number: task.attempts, startedAt: at })
  task.input = { data_source: source, workflow_id: run.id, task_id: task.id, attempt: task.attempts, ...roleInput(run, task.agent) }
  task.summary = agents.find(({ id }) => id === task.agent)?.action
  event(run, at, 'info', `${task.summary} · 第 ${task.attempts} 次执行`, task)
}

function endAttempt(task: Task, at: string, failure?: string) {
  const attempt = task.attemptHistory?.at(-1)
  if (attempt && !attempt.endedAt) Object.assign(attempt, { endedAt: at, failure })
}

function output(run: Run, task: Task, fields: Record<string, unknown>) {
  task.outputId = crypto.randomUUID()
  task.output = { ...fields, data_source: source, output_id: task.outputId, workflow_id: run.id, task_id: task.id, attempt: task.attempts }
}

function succeed(run: Run, task: Task, at: string) {
  task.status = 'succeeded'
  task.progress = 100
  task.endedAt = at
  endAttempt(task, at)
  event(run, at, 'success', task.summary ?? '执行完成', task)
  run.activeIndex += 1
  if (run.activeIndex === run.tasks.length) {
    run.status = 'completed'
    event(run, at, 'success', '六岗位任务已完成 · 复盘就绪')
    return
  }
  const next = run.tasks[run.activeIndex]
  queue(run, next, at)
  if (run.status === 'running') begin(run, next, at)
}

function scout(run: Run, task: Task, at: string) {
  const candidates = run.candidates.map(product => scoreCandidate(product, run.config))
  for (const product of candidates) {
    if (product.status === 'rejected') event(run, at, 'warn', `${product.name} 淘汰 · ${product.reason}`, task)
  }
  const eligible = candidates.filter(({ status }) => status === 'eligible')
  const selected = eligible.find(({ id }) => id === run.config.preferredId)
    ?? eligible.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.sku.localeCompare(b.sku))[0]
  if (selected) {
    selected.status = 'selected'
    selected.reason = selected.id === run.config.preferredId ? '通过毛利与风险门槛 · 命中首选商品' : '首选商品淘汰 · 切换最高分备选'
  }
  run.candidates = candidates
  run.selectedId = selected?.id
  task.processed = candidates.length
  output(run, task, { 候选评分: candidates, 推荐商品: selected?.name ?? '无合格商品' })
  task.summary = selected ? `锁定 ${selected.name} · 评估 ${candidates.length} 件候选` : '无合格候选'
}

function orderEvent(run: Run, task: Task, order: Order, at: string, kind: OrderEvent['kind'], message: string, level: RunEvent['level']) {
  const seq = event(run, at, level, `${order.id} ${message}`, task, order.id)
  order.events.push({ at, message, kind, seq })
}

function createOrders(run: Run, product: Product, task: Task, at: string) {
  run.adSpend = plannedSpend(run.config)
  event(run, at, 'info', `记录模拟广告支出 ${money(run.adSpend)}`, task)
  for (const index of [1, 2]) {
    const order: Order = {
      id: `SIM-${run.id.slice(0, 8).toUpperCase()}-0${index}`, sku: product.sku, status: 'created',
      amount: product.price, refund: 0, productCost: product.cost, shipping: 0, platformFee: Math.round(product.price * 0.06),
      attributed: index === 1 && run.adSpend > 0, units: 1, events: [], dataSource: source,
    }
    run.orders.push(order)
    orderEvent(run, task, order, at, 'created', `创建模拟订单 · ${money(order.amount)}`, 'success')
  }
}

function fulfill(run: Run, task: Task, at: string) {
  run.inventory ??= inventoryFor(run.config)
  for (const order of run.orders) {
    if (order.status !== 'created') continue
    const stock = run.inventory[order.sku]
    const units = order.units ?? 1
    if (stock.available < units) {
      orderEvent(run, task, order, at, 'stock_shortage', '库存不足 · 模拟拦截，转入退款', 'warn')
      order.status = 'refunded'
      order.refund = order.amount
      order.productCost = 0
      order.platformFee = 0
      orderEvent(run, task, order, at, 'refunded', `已模拟全额退款 ${money(order.refund)}`, 'warn')
      continue
    }
    stock.available -= units
    stock.reserved += units
    orderEvent(run, task, order, at, 'reserved', `占用 ${units} 件模拟库存`, 'info')
    order.status = 'shipped'
    order.shipping = 480
    stock.reserved -= units
    stock.shipped += units
    orderEvent(run, task, order, at, 'shipped', '库存校验通过 · 模拟发货', 'success')
  }
  const shipped = run.orders.filter(order => order.status === 'shipped').length
  const refunded = run.orders.filter(order => order.status === 'refunded').length
  output(run, task, { 模拟订单: run.orders, SKU库存: run.inventory, 模拟发货笔数: shipped, 模拟退款笔数: refunded })
  task.summary = `已核验 ${run.orders.length} 笔订单 · ${shipped} 笔模拟发货 / ${refunded} 笔模拟退款`
  task.processed = run.orders.length
}

function skipDownstream(run: Run, at: string) {
  for (const task of run.tasks.slice(run.activeIndex + 1)) {
    task.status = 'skipped'
    task.endedAt = at
    event(run, at, 'info', '前序任务已终止 · 此步骤跳过', task)
  }
}

function fail(run: Run, task: Task, at: string, reason: string) {
  task.status = 'failed'
  task.failure = reason
  task.endedAt = at
  endAttempt(task, at, reason)
  run.status = 'failed'
  run.failure = reason
  event(run, at, 'error', reason, task)
  if (!canRetry(run)) skipDownstream(run, at)
}

function finish(run: Run, task: Task, at: string) {
  const product = run.candidates.find(({ id }) => id === run.selectedId)
  if (task.agent !== 'scout' && !product) {
    fail(run, task, at, '缺少已批准的候选商品')
    return
  }
  switch (task.agent) {
    case 'scout':
      scout(run, task, at)
      if (!run.selectedId) {
        fail(run, task, at, '三件候选均未通过毛利或风险门槛')
        return
      }
      break
    case 'lister':
      if (product) output(run, task, listingDraft(product, run.config))
      task.summary = '商品草稿就绪 · 等待审核'
      task.processed = 1
      break
    case 'creator':
      if (run.config.scenario === 'incident') {
        const resolution = task.attempts > retryLimit ? '已达重试上限 · 转人工处理' : `可人工重试（剩余 ${retryLimit + 1 - task.attempts} 次）`
        fail(run, task, at, `内容生成模拟超时 · ${resolution}`)
        return
      }
      if (product) output(run, task, contentDraft(product))
      task.summary = '已归档 15 秒短视频脚本与社媒文案'
      task.processed = 1
      break
    case 'ads':
      output(run, task, adPlan(run.config))
      task.summary = '模拟投放计划就绪 · 等待批准预算'
      task.processed = 1
      break
    case 'service':
      if (product) output(run, task, serviceDraft(run, product))
      task.summary = '三条英语咨询已分流 · 1 条需人工处理'
      task.processed = 3
      break
    case 'fulfillment':
      fulfill(run, task, at)
      break
  }
  if (task.agent === 'lister' || task.agent === 'ads') {
    task.status = 'awaiting_approval'
    task.progress = 85
    run.status = 'awaiting_approval'
    endAttempt(task, at)
    event(run, at, 'warn', task.summary ?? '等待人工审批', task)
    return
  }
  succeed(run, task, at)
}

const terminal = new Set<Run['status']>(['completed', 'failed', 'canceled'])

export function canRetry(run: Run): boolean {
  const task = run.tasks[run.activeIndex]
  return run.status === 'failed' && run.config.scenario === 'incident'
    && task?.agent === 'creator' && task.attempts < retryLimit + 1
}

function accepts(run: Run, action: Action): boolean {
  const task = run.tasks[run.activeIndex]
  switch (action.type) {
    case 'prepare': return run.status === 'draft'
    case 'start': return run.status === 'ready'
    case 'pause': return run.status === 'running'
    case 'resume': return run.status === 'paused'
    case 'step': return run.status === 'paused' || run.status === 'ready'
    case 'tick': return run.status === 'running'
    case 'cancel': return !terminal.has(run.status) || canRetry(run)
    case 'retry': return canRetry(run)
    case 'approve':
    case 'reject':
      return run.status === 'awaiting_approval' && task?.status === 'awaiting_approval'
        && task.id === action.taskId && task.attempts === action.attempt
  }
}

export function reduceRun(run: Run, action: Action, now = Date.now()): Run {
  if (!accepts(run, action)) return run
  const next = structuredClone(run)
  const at = new Date(Math.max(now, Date.parse(run.updatedAt))).toISOString()
  const task = next.tasks[next.activeIndex]
  next.updatedAt = at
  switch (action.type) {
    case 'prepare':
      next.status = 'ready'
      event(next, at, 'info', `情景载入 · ${scenarios[next.config.scenario]} / ${markets[next.config.market]}市场`)
      event(next, at, 'info', '已载入 3 个虚构商品样例 · 待启动')
      break
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
      next.singleStep = false
      next.status = 'running'
      event(next, at, 'info', '恢复任务 · 从中断位置继续')
      if (task.status === 'queued') begin(next, task, at)
      break
    case 'step':
      next.checkpoint = false
      next.singleStep = true
      next.status = 'paused'
      event(next, at, 'info', '手动单步执行 · 停在当前步骤后', task)
      if (task.status !== 'running') begin(next, task, at)
      finish(next, task, at)
      break
    case 'tick':
      if (task.progress === 25) task.progress = 60
      else finish(next, task, at)
      break
    case 'cancel':
      next.status = 'canceled'
      if (task.startedAt && task.status !== 'failed') {
        task.status = 'canceled'
        task.endedAt = at
        endAttempt(task, at, '人工取消')
      } else if (!task.startedAt) {
        task.status = 'skipped'
        task.endedAt = at
      }
      skipDownstream(next, at)
      event(next, at, 'warn', '任务已取消 · 已完成产物保留', task)
      break
    case 'retry':
      next.singleStep = false
      next.status = 'running'
      next.failure = undefined
      event(next, at, 'warn', `登记模拟重试 ${task.attempts}/${retryLimit}`, task)
      begin(next, task, at)
      break
    case 'approve':
    case 'reject': {
      const decision = action.type === 'approve' ? 'approved' : 'rejected'
      next.approvals.push({
        id: crypto.randomUUID(), taskId: task.id, decision, at, attempt: action.attempt, actor: 'sandbox_visitor', outputId: task.outputId,
      })
      if (decision === 'rejected') {
        fail(next, task, at, '人工驳回 · 任务已停止，审批记录已保留')
        break
      }
      event(next, at, 'success', '人工批准 · 模拟审批已留痕', task)
      const product = next.candidates.find(({ id }) => id === next.selectedId)
      if (task.agent === 'ads' && product) createOrders(next, product, task, at)
      next.status = next.singleStep ? 'paused' : 'running'
      task.summary = task.agent === 'ads' ? '已批准模拟预算 · 两笔模拟订单' : '已批准商品草稿 · 模拟审核'
      succeed(next, task, at)
      break
    }
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
      const task = run.tasks[run.activeIndex]
      dispatch({ type: 'approve', taskId: task.id, attempt: task.attempts })
    }
  }
  dispatch({ type: 'tick' })
  dispatch({ type: 'pause' })
  return { ...run, checkpoint: true }
}
