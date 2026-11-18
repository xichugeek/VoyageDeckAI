import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const screenshots = new URL('../../artifacts/screenshots/', import.meta.url)
const viewport = { width: 1440, height: 900 }

const flow = (page: Page) => page.getByRole('region', { name: '六岗位实时流程' })
const flowNode = (page: Page, role: string, status: string) => flow(page).getByRole('button', { name: new RegExp(`^\\d{2} ${role} ${status}，查看详情$`) })
const decision = (page: Page) => page.getByRole('region', { name: '阶段决策' })
const metric = (page: Page, label: RegExp) => page.getByRole('region', { name: '模拟经营指标' }).getByRole('button', { name: label })

async function createTask(page: Page, scenario: 'standard' | 'fallback' | 'incident' = 'standard') {
  await page.getByRole('button', { name: '新建出海任务' }).click()
  const form = page.getByRole('dialog', { name: '新建出海任务' })
  await form.getByLabel('演示情景').selectOption(scenario)
  if (scenario === 'fallback') await expect(form.getByLabel('优先候选商品')).toHaveValue('orbit')
  await form.getByRole('button', { name: '创建演示任务' }).click()
  await expect(form).toHaveCount(0)
  await expect(page.getByRole('button', { name: '启动演示' })).toBeVisible()
}

async function openTask(page: Page, name: string, status: string) {
  await flowNode(page, name, status).click()
  const dialog = page.getByRole('dialog', { name: `${name} · 岗位详情` })
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeDialog(page: Page) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toHaveCount(0)
}

async function clickTwice(button: Locator) {
  await button.evaluate(element => {
    const target = element as HTMLButtonElement
    target.click()
    target.click()
  })
}

async function captureState(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: fileURLToPath(new URL(name, screenshots)), animations: 'disabled' })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(viewport)
  await page.clock.install({ time: new Date('2026-11-19T04:00:00Z') })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '出海运营指挥台' })).toBeVisible()
})

test('标准成功：六岗位审批、两笔履约、指标与下载复盘可互相核对', async ({ page }) => {
  const apiWrites: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') apiWrites.push(request.url())
  })
  await createTask(page)
  await expect(metric(page, /模拟成交总额 \$0\.00/)).toBeVisible()
  await expect(metric(page, /广告回报 N\/A/)).toBeVisible()

  await clickTwice(page.getByRole('button', { name: '启动演示' }))
  await expect(flowNode(page, '选品官', '执行中')).toBeVisible()
  await page.clock.runFor(1200)
  await captureState(page, 'state-scout-running.png')
  await page.clock.runFor(3900)

  const candidates = page.getByRole('region', { name: '候选商品' })
  await candidates.getByRole('button', { name: /OrbitCase.*已淘汰/ }).click()
  await expect(candidates.getByText(/低于.*门槛/)).toBeVisible()
  await expect(candidates.getByText('19.4%', { exact: true })).toBeVisible()
  const terminal = page.getByRole('region', { name: '实时终端' })
  await terminal.getByLabel('按日志级别筛选').selectOption('warn')
  await terminal.getByLabel('按岗位筛选日志').selectOption('scout')
  await terminal.getByLabel('按任务筛选日志').selectOption({ index: 1 })
  await expect(terminal.getByText(/OrbitCase.*淘汰/)).toBeVisible()
  await terminal.getByRole('button', { name: '跟随最新' }).click()
  await expect(terminal.getByRole('button', { name: '跟随最新' })).toHaveAttribute('aria-pressed', 'false')
  await terminal.getByLabel('按日志级别筛选').selectOption('all')
  await terminal.getByLabel('按岗位筛选日志').selectOption('all')
  await terminal.getByLabel('按任务筛选日志').selectOption('all')
  await expect(terminal.getByText('指挥任务启动 · 六岗位串行执行', { exact: true })).toHaveCount(1)

  await expect(decision(page).getByText('待审 · 模拟上架草稿', { exact: true })).toBeVisible()
  const listing = await openTask(page, '上架官', '待审批')
  await expect(listing.getByText(/Compact Packing for Weekend Trips/)).toBeVisible()
  await expect(listing.getByRole('button', { name: '复制产物' })).toBeVisible()
  await closeDialog(page)
  await page.clock.runFor(6000)
  await expect(flowNode(page, '内容官', '待命')).toBeVisible()
  await decision(page).getByRole('button', { name: '批准模拟草稿' }).click()
  await expect(flowNode(page, '内容官', '执行中')).toBeVisible()
  await page.clock.runFor(5000)

  const creative = await openTask(page, '内容官', '已完成')
  await expect(creative.getByText(/Pack fast\. Move light\./).first()).toBeVisible()
  await closeDialog(page)
  await expect(decision(page).getByText('待审 · 模拟广告预算', { exact: true })).toBeVisible()
  await expect(metric(page, /模拟广告支出 \$0\.00/)).toBeVisible()
  await clickTwice(decision(page).getByRole('button', { name: '批准模拟预算' }))
  await expect(flowNode(page, '客服官', '执行中')).toBeVisible()
  await expect(metric(page, /模拟订单 02/)).toBeVisible()
  await expect(metric(page, /模拟广告支出 \$26\.80/)).toBeVisible()
  await page.clock.runFor(5000)

  const support = await openTask(page, '客服官', '已完成')
  await expect(support.getByText(/待审核回复|待审核回覆/).first()).toBeVisible()
  await closeDialog(page)
  await expect(flowNode(page, '履约官', '已完成')).toBeVisible()
  const orders = page.getByRole('region', { name: '模拟订单', exact: true })
  await expect(orders.getByText('已发货', { exact: true })).toHaveCount(2)
  await orders.locator('summary').first().click()
  await expect(orders.locator('details[open]').getByText(/模拟发货/)).toBeVisible()
  await expect(metric(page, /模拟成交总额 \$98\.00/)).toBeVisible()
  await expect(metric(page, /广告回报 1\.83×/)).toBeVisible()
  await expect(metric(page, /模拟商品毛利 \$62\.00/)).toBeVisible()

  await page.getByRole('button', { name: '查看复盘', exact: true }).click()
  const report = page.getByRole('dialog', { name: '任务复盘' })
  await expect(report.getByText('$19.72', { exact: true })).toBeVisible()
  await expect(report.getByRole('button', { name: '复制复盘' })).toBeVisible()
  const downloadEvent = page.waitForEvent('download')
  await report.getByRole('button', { name: '下载复盘' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^voyagedeck-[a-f\d]{8}\.txt$/)
  const contents = await readFile(await download.path(), 'utf8')
  expect(contents).toContain('估算贡献利润 $19.72')
  expect(contents).toContain('风险与异常')
  expect(contents.split('\n').filter(line => line.endsWith(' · 批准'))).toHaveLength(2)
  for (const name of ['选品官', '上架官', '内容官', '投流官', '客服官', '履约官']) {
    expect(contents).toContain(`${name} · 已完成`)
  }
  expect(apiWrites).toEqual([])
})

test('低毛利换品：默认备选接棒并体现模拟退款', async ({ page }) => {
  await createTask(page, 'fallback')
  await page.getByRole('button', { name: '启动演示' }).click()
  await expect(flowNode(page, '选品官', '执行中')).toBeVisible()
  await page.clock.runFor(5000)

  const candidates = page.getByRole('region', { name: '候选商品' })
  await expect(candidates.getByRole('button', { name: /OrbitCase.*已淘汰/ })).toBeVisible()
  await expect(candidates.getByRole('button', { name: /AeroFold.*已选定/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(candidates.getByText(/首选商品淘汰.*切换/)).toBeVisible()
  await decision(page).getByRole('button', { name: '批准模拟草稿' }).click()
  await expect(flowNode(page, '内容官', '执行中')).toBeVisible()
  await page.clock.runFor(5000)
  await decision(page).getByRole('button', { name: '批准模拟预算' }).click()
  await expect(flowNode(page, '客服官', '执行中')).toBeVisible()
  await page.clock.runFor(5000)

  const orders = page.getByRole('region', { name: '模拟订单', exact: true })
  await expect(orders.getByText('已发货', { exact: true })).toHaveCount(1)
  await expect(orders.getByText('已退款', { exact: true })).toHaveCount(1)
  const gmv = metric(page, /模拟成交总额 \$84\.00/)
  await gmv.click()
  const figures = page.getByRole('dialog', { name: '模拟指标计算口径' })
  await expect(figures.getByText('净销售额 · 成交总额 − 退款', { exact: true })).toBeVisible()
  await expect(figures.getByText('$42.00', { exact: true })).toHaveCount(2)
})

test('故障恢复：暂停冻结链路，恢复后模拟超时仅可重试两次', async ({ page }) => {
  await createTask(page, 'incident')
  await page.getByRole('button', { name: '启动演示' }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(flowNode(page, '选品官', '已暂停')).toBeVisible()
  const log = page.getByRole('list', { name: '工作流事件历史' })
  const eventsWhenPaused = await log.getByRole('listitem').count()
  await page.clock.runFor(15_000)
  await expect(log.getByRole('listitem')).toHaveCount(eventsWhenPaused)
  await expect(flowNode(page, '上架官', '待命')).toBeVisible()
  await page.getByRole('button', { name: '继续演示' }).click()
  await expect(flowNode(page, '选品官', '执行中')).toBeVisible()
  await page.clock.runFor(5000)
  await decision(page).getByRole('button', { name: '批准模拟草稿' }).click()
  await expect(flowNode(page, '内容官', '执行中')).toBeVisible()
  await page.clock.runFor(2500)
  await expect(flowNode(page, '内容官', '失败')).toBeVisible()
  await expect(decision(page).getByText(/模拟超时/)).toBeVisible()
  for (const expectedAttempts of [2, 3]) {
    await decision(page).getByRole('button', { name: '重试模拟岗位' }).click()
    await expect(flowNode(page, '内容官', '执行中')).toBeVisible()
    await page.clock.runFor(2500)
    const creator = await openTask(page, '内容官', '失败')
    await expect(creator.getByText(`尝试 ${expectedAttempts} 次`, { exact: true })).toBeVisible()
    await closeDialog(page)
  }
  await expect(decision(page).getByRole('button', { name: '重试模拟岗位' })).toHaveCount(0)
  await expect(decision(page).getByRole('button', { name: /查看失败复盘/ })).toBeVisible()
  await expect(metric(page, /模拟成交总额 \$0\.00/)).toBeVisible()
  await captureState(page, 'state-creator-failed.png')
})

test('驳回、取消、重置和刷新均保持会话隔离', async ({ page, browser }) => {
  await createTask(page)
  await page.getByRole('button', { name: '单步执行' }).click()
  await expect(flowNode(page, '选品官', '已完成')).toBeVisible()
  await page.getByRole('button', { name: '单步执行' }).click()
  await expect(decision(page).getByText('待审 · 模拟上架草稿', { exact: true })).toBeVisible()
  await page.reload()
  await expect(decision(page).getByText('待审 · 模拟上架草稿', { exact: true })).toBeVisible()
  await decision(page).getByRole('button', { name: '驳回', exact: true }).click()
  const listing = await openTask(page, '上架官', '失败')
  await expect(listing.getByText('驳回模拟产物', { exact: false })).toBeVisible()
  await closeDialog(page)

  const visitor = await browser.newContext()
  try {
    const privatePage = await visitor.newPage()
    await privatePage.goto(new URL('/', page.url()).href)
    await expect(metric(privatePage, /模拟成交总额 \$98\.00/)).toBeVisible()
    await createTask(page)
    await page.getByRole('button', { name: '取消任务', exact: true }).click()
    await page.getByRole('dialog', { name: '取消当前任务' }).getByRole('button', { name: '确认取消' }).click()
    await expect(page.locator('.run-badge')).toHaveText('已取消')
    await page.getByRole('button', { name: '重置沙盒' }).click()
    await page.getByRole('dialog', { name: '重置当前演示任务' }).getByRole('button', { name: '确认重置' }).click()
    await expect(page.getByRole('button', { name: '启动演示' })).toBeVisible()
    await expect(metric(page, /模拟成交总额 \$0\.00/)).toBeVisible()
    await page.getByRole('button', { name: '任务历史' }).click()
    const history = page.getByRole('dialog', { name: '本会话任务历史' })
    await history.getByRole('button', { name: /标准成功 · 任务失败/ }).click()
    await expect(page.getByRole('dialog', { name: '任务复盘' }).getByText(/人工驳回/)).toBeVisible()
    await expect(metric(privatePage, /模拟成交总额 \$98\.00/)).toBeVisible()
    await expect(privatePage.getByRole('button', { name: '继续演示' })).toBeVisible()
  } finally {
    await visitor.close()
  }
})
