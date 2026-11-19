import { markets, money, percent } from './model'
import type { AgentId, Config, Product, Run, Stock } from './model'

export const source = 'demo_simulated'
const riskLimit = 60

export const products: Product[] = [
  { id: 'nomad', sku: 'VD-NP01', name: 'NomadPack 旅行收纳包', englishName: 'NomadPack Travel Organizer', cost: 1800, price: 4900, status: 'pending' },
  { id: 'orbit', sku: 'VD-OC02', name: 'OrbitCase 数码收纳盒', englishName: 'OrbitCase Travel Tech Case', cost: 2900, price: 3600, status: 'pending' },
  { id: 'aero', sku: 'VD-AF03', name: 'AeroFold 折叠旅行袋', englishName: 'AeroFold Travel Tote', cost: 1650, price: 4200, status: 'pending' },
]

const profiles: Record<string, {
  demand: number
  competition: number
  complianceRisk: number
  supplyReliability: number
  mobileDemand: number
  fallbackDemand: number
  sellingPoints: string[]
  dimensions: string
}> = {
  nomad: {
    demand: 91, competition: 34, complianceRisk: 12, supplyReliability: 94, mobileDemand: 2, fallbackDemand: -18,
    sellingPoints: ['Expandable packing compartments', 'See-through divider for quick checks', 'Lightweight fabric', 'Low-profile carry handle', 'Folds flat between trips'],
    dimensions: '30 × 21 × 9 cm',
  },
  orbit: {
    demand: 74, competition: 56, complianceRisk: 48, supplyReliability: 79, mobileDemand: 9, fallbackDemand: 0,
    sellingPoints: ['Divided cable storage', 'Padded accessory panel', 'Wide opening', 'Compact shape', 'Zip closure'],
    dimensions: '23 × 14 × 5 cm',
  },
  aero: {
    demand: 83, competition: 29, complianceRisk: 15, supplyReliability: 90, mobileDemand: 3, fallbackDemand: 14,
    sellingPoints: ['Packs into its own pouch', 'Water-resistant outer fabric', 'Wide carry straps', 'Easy-access outer pocket', 'Compact storage footprint'],
    dimensions: '37 × 28 × 13 cm',
  },
}

export function scoreCandidate(product: Product, config: Config): Product {
  const profile = profiles[product.id]
  const marketRisk = config.market === 'EU' ? 14 : config.market === 'UK' ? 4 : 0
  const scenarioDemand = config.scenario === 'fallback' ? profile.fallbackDemand : 0
  const categoryDemand = config.category === '随身配件' ? profile.mobileDemand : 0
  const demand = Math.min(100, profile.demand + categoryDemand + scenarioDemand)
  const margin = (product.price - product.cost) / product.price
  const competition = profile.competition
  const complianceRisk = Math.min(100, profile.complianceRisk + marketRisk)
  const supplyReliability = profile.supplyReliability
  const factors = { demand, margin, competition, complianceRisk, supplyReliability }
  const score = Math.round(demand * 0.30 + margin * 35 + (100 - competition) * 0.15
    + (100 - complianceRisk) * 0.10 + supplyReliability * 0.10)
  const risks = [
    margin < config.marginFloor && `毛利率 ${percent(margin)} 低于 ${percent(config.marginFloor)} 门槛`,
    complianceRisk > riskLimit && `模拟合规风险分 ${complianceRisk} 高于上限 ${riskLimit}`,
  ].filter(Boolean)
  const accepted = risks.length === 0
  return {
    ...product, score, factors, status: accepted ? 'eligible' : 'rejected',
    reason: accepted ? '通过毛利与风险门槛 · 保留为备选' : risks.join(' · '),
  }
}

export function inventoryFor(config: Config, quantity = config.scenario === 'fallback' ? 1 : 8): Record<string, Stock> {
  return Object.fromEntries(products.map(product => [
    product.sku, { available: quantity, reserved: 0, shipped: 0 },
  ]))
}

const reviews = [
  { id: 'SIM-CS-01', question: 'What are the dimensions?', category: '商品规格', risk: '低', reason: '可引用虚构样品资料' },
  { id: 'SIM-CS-02', question: 'When will my order arrive?', category: '订单物流', risk: '低', reason: '模拟订单无真实线路或 ETA' },
  { id: 'SIM-CS-03', question: 'Can I return a damaged item?', category: '售后破损', risk: '高 · 人工复核', reason: '核实退款条件前，客服草稿不能承诺退款' },
]

const channels = ['模拟短视频', '模拟搜索']
export const targetRoas = 1.8
const plannedConversion = 0.024
const marketLanguage = { US: 'en-US', EU: 'en (EU demo)', UK: 'en-GB' }
const safetyNotice = '虚构商品草稿。上线前应独立核对目标市场法规、运输约束和素材授权。'
const supportRules = '只提供隔离沙盒中的回复草稿。破损、退款或地址变更交由人工复核。'

export function roleInput(run: Run, role: AgentId): Record<string, unknown> {
  const product = run.candidates.find(({ id }) => id === run.selectedId)
  const profile = product ? profiles[product.id] : undefined
  const prior = (id: AgentId) => run.tasks.find(task => task.agent === id)?.outputId
  const locale = marketLanguage[run.config.market]
  switch (role) {
    case 'scout': return {
      目标市场: markets[run.config.market], 类目: run.config.category, 模拟广告预算: money(run.config.budget),
      最低毛利率: percent(run.config.marginFloor), 合规风险上限: riskLimit, 优先商品: run.config.preferredId,
      候选商品: run.candidates.map(({ id, sku, name, cost, price }) => ({ id, sku, name, 采购成本: money(cost), 定价: money(price) })),
      评分权重: { 需求: 30, 毛利: 35, 低竞争度: 15, 低合规风险: 10, 供应可靠性: 10 },
    }
    case 'lister': return {
      通过筛选的商品: product?.name, 候选决策ID: prior('scout'), 目标市场: markets[run.config.market],
      目标语言: locale, 卖点: profile?.sellingPoints, 合规核查提示: safetyNotice,
    }
    case 'creator': return {
      已审核上架草稿ID: prior('lister'), 目标语言: locale, 卖点: profile?.sellingPoints,
      渠道: channels, 用户画像: '携随身行李出行、希望快速整理物品的短途旅客',
    }
    case 'ads': return {
      创意脚本ID: prior('creator'), 模拟预算上限: money(run.config.budget), 渠道: channels,
      预计转化率: percent(plannedConversion), 单件采购成本: money(product?.cost ?? 0), 目标ROAS: targetRoas,
    }
    case 'service': return {
      模拟订单: run.orders.map(({ id, sku, status }) => ({ id, sku, status })),
      咨询: reviews.map(({ id, question }, index) => ({ id, question, order_id: run.orders[index % 2]?.id })),
      售后规则: supportRules, 目标语言: locale,
    }
    case 'fulfillment': return {
      模拟订单: run.orders.map(({ id, sku, status, units }) => ({ id, sku, status, units })),
      SKU库存: structuredClone(run.inventory ?? inventoryFor(run.config)), 模拟客服草稿ID: prior('service'),
      履约规则: '按订单顺序占用库存，每单 1 件。库存充足则模拟发货，库存不足则记录拦截并模拟全额退款。',
      售后状态: '客服 SIM-CS-03 的破损咨询待人工审核',
    }
  }
}

export function listingDraft(product: Product, config: Config) {
  return {
    status: 'draft', title: `${product.englishName} | Compact Packing for Weekend Trips`,
    五点描述: profiles[product.id].sellingPoints,
    SEO关键词: [product.englishName.toLowerCase(), 'weekend packing', 'carry-on storage', 'travel packing accessories'],
    SKU草稿: product.sku, 定价建议: money(product.price), 目标语言: marketLanguage[config.market], 合规提示: safetyNotice,
  }
}

export function contentDraft(product: Product) {
  return {
    status: 'draft', 标题: 'Pack fast. Move light.',
    分镜: [
      { 时间: '00:00–00:03', 画面: '从拥挤的行李箱切换到产品特写', 旁白: 'Still digging through your carry-on?' },
      { 时间: '00:03–00:09', 画面: '俯拍物品逐个归位，展示隔层', 旁白: profiles[product.id].sellingPoints[0] },
      { 时间: '00:09–00:15', 画面: '展示收纳后的实际空间、产品名和行动提示', 旁白: 'Pack fast. Move light.' },
    ],
    社媒帖文: `A tidy bag starts with the right organizer. Meet the ${product.englishName}. What's in your weekend bag?`,
    创意简报: '使用自摄俯拍与侧光，首屏呈现整理前后对比。仅使用演示 SKU 与原创素材。',
  }
}

export function plannedSpend(config: Config) {
  return Math.min(config.budget, 2680)
}

export function adPlan(config: Config) {
  const spend = plannedSpend(config)
  const video = Math.round(spend * 0.65)
  return {
    status: '模拟投放计划', 预算上限: money(config.budget), 计划消耗: money(spend), 计划消耗分: spend,
    渠道分配: [{ 渠道: channels[0], 预算分: video }, { 渠道: channels[1], 预算分: spend - video }],
    预计转化率: percent(plannedConversion), 目标回报: `${targetRoas.toFixed(2)}×`,
    风险: '转化率与目标 ROAS 是演示假设。实际模拟归因以订单与退款记录计算。',
  }
}

export function serviceDraft(run: Run, product: Product) {
  const drafts = [
    `Hi! The sample dimensions are ${profiles[product.id].dimensions}. Please check the available space in your bag.`,
    'Hi! This sample order belongs to the demo sandbox. There is no carrier estimate to share.',
    'I can flag the damage report for a manual return review. Please wait for the policy check before expecting a refund.',
  ]
  return {
    状态: '待审核回复',
    草稿: reviews.map((review, index) => ({
      咨询ID: review.id, 模拟订单ID: run.orders[index % 2]?.id, 英语咨询: review.question,
      分类: review.category, 风险: review.risk, 判断依据: review.reason, 英语回复草稿: drafts[index],
    })),
  }
}
