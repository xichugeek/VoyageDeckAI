export const agents = [
  { id: 'scout', name: '选品官', label: 'Scout', color: '#f5c65d', action: '评估候选与毛利', unit: '件候选' },
  { id: 'lister', name: '上架官', label: 'Lister', color: '#ae9bff', action: '生成结构化商品草稿', unit: '份草稿' },
  { id: 'creator', name: '内容官', label: 'Creator', color: '#f28bbd', action: '编写分镜与社媒文案', unit: '套创意' },
  { id: 'ads', name: '投流官', label: 'Ads', color: '#52deeb', action: '核算预算与广告归因', unit: '份计划' },
  { id: 'service', name: '客服官', label: 'Service', color: '#7ab2ff', action: '分流咨询并草拟回复', unit: '条咨询' },
  { id: 'fulfillment', name: '履约官', label: 'Fulfillment', color: '#66dfb6', action: '核验订单与库存', unit: '笔订单' },
] as const

export type AgentId = typeof agents[number]['id']
export type Scenario = 'standard' | 'fallback' | 'incident'
export const scenarios: Record<Scenario, string> = { standard: '标准成功', fallback: '低毛利换品', incident: '故障恢复' }
export const markets = { US: '美国', EU: '欧洲', UK: '英国' } as const
export type Market = keyof typeof markets
export type RunStatus = 'draft' | 'ready' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'failed' | 'canceled'
export type TaskStatus = 'pending' | 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'skipped' | 'canceled'
export const runStatusLabel: Record<RunStatus, string> = {
  draft: '草稿', ready: '待启动', running: '运行中', paused: '已暂停', awaiting_approval: '待人工审批', completed: '已完成', failed: '任务失败', canceled: '已取消',
}
export const taskStatusLabel: Record<TaskStatus, string> = {
  pending: '待命', queued: '已排队', running: '执行中', awaiting_approval: '待审批', succeeded: '已完成', failed: '失败', skipped: '已跳过', canceled: '已取消',
}
export interface Config {
  scenario: Scenario
  market: Market
  preferredId: string
  category: string
  marginFloor: number
  budget: number
}
export interface Product {
  id: string
  sku: string
  name: string
  englishName: string
  cost: number
  price: number
  score?: number
  factors?: { demand: number; margin: number; competition: number; complianceRisk: number; supplyReliability: number }
  status: 'pending' | 'selected' | 'eligible' | 'rejected'
  reason?: string
}
export interface RunEvent {
  seq: number
  at: string
  agent?: AgentId
  level: 'info' | 'success' | 'warn' | 'error'
  message: string
  taskId?: string
  workflowId?: string
  dataSource?: 'demo_simulated'
  attempt?: number
  orderId?: string
}
export interface OrderEvent {
  at: string
  message: string
  kind?: 'created' | 'reserved' | 'shipped' | 'stock_shortage' | 'refunded'
  seq?: number
}
export interface Order {
  id: string
  sku: string
  status: 'created' | 'shipped' | 'refunded' | 'canceled'
  amount: number
  refund: number
  productCost: number
  shipping: number
  platformFee: number
  attributed: boolean
  events: OrderEvent[]
  dataSource?: 'demo_simulated'
  units?: number
}
export interface Stock {
  available: number
  reserved: number
  shipped: number
}
export interface Approval {
  taskId: string
  decision: 'approved' | 'rejected'
  at: string
  id?: string
  attempt?: number
  outputId?: string
  actor?: 'sandbox_visitor' | 'sandbox_autoplay'
}
export interface Task {
  id: string
  agent: AgentId
  status: TaskStatus
  progress: number
  attempts: number
  processed: number
  summary?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  outputId?: string
  startedAt?: string
  endedAt?: string
  failure?: string
  attemptHistory?: { number: number; startedAt: string; endedAt?: string; failure?: string }[]
}
export interface Run {
  id: string
  mode: 'demo_simulated'
  config: Config
  status: RunStatus
  createdAt: string
  updatedAt: string
  activeIndex: number
  tasks: Task[]
  candidates: Product[]
  selectedId?: string
  events: RunEvent[]
  snapshots: { seq: number; gmv: number; cost: number }[]
  orders: Order[]
  approvals: Approval[]
  inventory?: Record<string, Stock>
  adSpend: number
  otherCosts: number
  failure?: string
  checkpoint?: boolean
  singleStep?: boolean
  autoplay?: { paused: boolean }
}
export interface Metrics {
  gmv: number
  count: number
  refunds: number
  net: number
  procurement: number
  shipping: number
  fees: number
  adSpend: number
  attributed: number
  roas: number | null
  gross: number
  margin: number | null
  contribution: number
  totalCost: number
  working: number
}
export type Action = { type: 'prepare' | 'start' | 'pause' | 'resume' | 'step' | 'tick' | 'cancel' | 'retry' }
  | { type: 'approve' | 'reject' | 'autoApprove'; taskId: string; attempt: number }

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const money = (cents: number) => dollars.format(cents / 100)
export const percent = (value: number | null) => value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`
export const localTime = (value: string) => new Date(value).toLocaleTimeString('en-GB', { hour12: false })
