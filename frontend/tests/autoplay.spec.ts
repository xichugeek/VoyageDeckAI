import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { previewRun } from '../src/demo'

const metrics = (page: Page) => page.getByRole('region', { name: '模拟经营指标' })
const gmv = (page: Page, amount: string) => metrics(page).getByRole('button', { name: `模拟成交总额 ${amount} GMV，查看计算口径`, exact: true })
const orders = (page: Page) => page.getByRole('region', { name: '模拟订单', exact: true })
const trend = (page: Page) => page.getByRole('region', { name: '模拟业绩趋势' })
const log = (page: Page) => page.getByRole('list', { name: '工作流事件历史' })

async function openWithFrozenClock(page: Page, url = '/') {
  const start = new Date('2026-11-19T04:00:00Z')
  await page.clock.install({ time: start })
  await page.clock.pauseAt(new Date(start.getTime() + 1000))
  await page.goto(url)
  await expect(page.getByRole('heading', { name: '出海运营指挥台' })).toBeVisible()
}

async function advanceUntil(page: Page, target: Locator, maxMilliseconds: number) {
  for (let elapsed = 0; elapsed < maxMilliseconds && !await target.isVisible(); elapsed += 200) {
    await page.clock.runFor(200)
  }
  await expect(target).toBeVisible()
}

test('默认升级旧暂停检查点，逐笔生成订单，暂停后按同一进度继续并自动换轮', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(checkpoint => {
    sessionStorage.setItem('voyagedeck-demo-v1', JSON.stringify(checkpoint))
  }, previewRun())
  const writes: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url())
  })
  await openWithFrozenClock(page)

  await expect(gmv(page, '$0.00')).toBeVisible()
  await expect(orders(page).locator('summary')).toHaveCount(0)
  const initialEvents = await log(page).getByRole('listitem').count()
  await advanceUntil(page, gmv(page, '$49.00'), 12_000)
  await expect(orders(page).locator('summary')).toHaveCount(1)
  await expect(trend(page).getByRole('img', { name: /模拟 GMV \$49\.00/ })).toBeVisible()
  await expect(metrics(page).getByRole('button', { name: /模拟广告支出 \$26\.80/ })).toBeVisible()
  expect(await log(page).getByRole('listitem').count()).toBeGreaterThan(initialEvents)

  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const frozenEvents = await log(page).getByRole('listitem').allTextContents()
  await page.clock.runFor(15_000)
  await expect(gmv(page, '$49.00')).toBeVisible()
  await expect(orders(page).locator('summary')).toHaveCount(1)
  expect(await log(page).getByRole('listitem').allTextContents()).toEqual(frozenEvents)

  await page.getByRole('button', { name: '继续演示', exact: true }).click()
  await advanceUntil(page, gmv(page, '$98.00'), 8_000)
  await expect(orders(page).locator('summary')).toHaveCount(2)
  await expect(trend(page).getByRole('img', { name: /模拟 GMV \$98\.00/ })).toBeVisible()
  await advanceUntil(page, page.getByRole('button', { name: '查看复盘', exact: true }), 15_000)
  await expect(orders(page).getByText('已发货', { exact: true })).toHaveCount(2)
  await advanceUntil(page, page.locator('.hero').getByText('低毛利换品', { exact: true }), 20_000)
  await expect(gmv(page, '$0.00')).toBeVisible()
  expect(writes).toEqual([])
})

for (const [width, height] of [[1366, 768], [1440, 810], [1440, 900], [1704, 922], [1920, 1080]]) {
  test(`桌面 ${width} × ${height} 同屏显示链路、看板和轮播操作`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await openWithFrozenClock(page, '/#telemetry')
    await advanceUntil(page, gmv(page, '$98.00'), 15_000)
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    const panels = [
      page.getByRole('heading', { name: '出海运营指挥台' }),
      metrics(page),
      page.getByRole('region', { name: '六岗位实时流程' }),
      page.getByRole('region', { name: '候选商品' }),
      page.getByRole('region', { name: '实时终端' }),
      trend(page),
      orders(page),
      page.getByRole('region', { name: '任务里程碑' }),
      page.getByRole('button', { name: '任务历史' }),
      page.locator('.agent-card').last(),
    ]
    await expect(page.locator('.agent-card')).toHaveCount(6)
    for (const panel of panels) await expect(panel).toBeInViewport({ ratio: 0.99 })
    const summariesFit = await page.locator('.agent-action').evaluateAll(elements =>
      elements.every(element => element.clientHeight > 0 && element.scrollHeight <= element.clientHeight + 1),
    )
    expect(summariesFit).toBe(true)
    const pageOverflow = await page.evaluate(() => {
      const root = document.documentElement
      return root.scrollWidth > root.clientWidth + 1 || root.scrollHeight > root.clientHeight + 1
    })
    expect(pageOverflow).toBe(false)
  })
}

test('手机自动演示保持可操作且页面无横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openWithFrozenClock(page)
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeInViewport()
  await advanceUntil(page, gmv(page, '$49.00'), 12_000)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(orders(page).locator('summary')).toHaveCount(1)
  await expect(trend(page)).toBeVisible()
})
