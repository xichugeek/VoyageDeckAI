import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const accessibilityTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function expectNoAccessibilityViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(accessibilityTags).analyze()
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([])
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  )
}

test('桌面键盘支持跳转主区、导航锚点和可见焦点', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?mode=manual')

  const skip = page.getByRole('link', { name: '跳转到指挥台' })
  await page.keyboard.press('Tab')
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#overview$/)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '新建出海任务' })).toBeFocused()

  const navigation = page.getByRole('navigation', { name: '主导航' })
  for (const [label, fragment] of [['执行链路', 'flow'], ['运行记录', 'telemetry']]) {
    await navigation.getByRole('link', { name: label }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`#${fragment}$`))
    await expect.poll(() => page.locator(`#${fragment}`).evaluate(target => {
      const top = target.getBoundingClientRect().top
      const bridgeBottom = document.querySelector('.topbar')!.getBoundingClientRect().bottom
      return top >= Math.max(0, bridgeBottom) - 2 && top < window.innerHeight - 48
    })).toBe(true)
  }

  await expectNoHorizontalOverflow(page)
  await expectNoAccessibilityViolations(page)
})

test('手机键盘可开关表单、恢复焦点并访问第六个流程节点', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?mode=manual')
  await expectNoHorizontalOverflow(page)

  const launch = page.getByRole('button', { name: '新建出海任务' })
  await launch.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '新建出海任务' })
  await expect(dialog.getByRole('button', { name: '关闭' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('combobox', { name: '演示情景' })).toBeFocused()
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expectNoAccessibilityViolations(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(launch).toBeFocused()

  const flow = page.getByRole('region', { name: '六岗位实时流程' })
  await flow.getByRole('button', { name: /客服官.*查看详情/ }).focus()
  await page.keyboard.press('Tab')
  const last = flow.getByRole('button', { name: /履约官.*查看详情/ })
  await expect(last).toBeFocused()
  await expect(last).toBeInViewport({ ratio: 0.9 })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '履约官 · 岗位详情' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(last).toBeFocused()
  await expectNoHorizontalOverflow(page)
})

test('降低动态效果时保留运行状态反馈', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?mode=manual')
  await page.getByRole('button', { name: '重置沙盒' }).click()
  await page.getByRole('button', { name: '确认重置' }).click()
  await page.getByRole('button', { name: '启动演示' }).click()
  await expect(page.getByRole('button', { name: /选品官 执行中，查看详情/ })).toBeVisible()

  const styles = await page.locator('.run-badge i').evaluate(signal => {
    const style = getComputedStyle(signal)
    return {
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
      animation: style.animationName,
    }
  })
  expect(styles.reduced).toBe(true)
  expect(styles.scroll).toBe('auto')
  expect(styles.animation).toBe('none')
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
})

test('320px 与平板版无页面横向溢出', async ({ page }) => {
  await page.goto('/?mode=manual')
  for (const viewport of [{ width: 320, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport)
    await expectNoHorizontalOverflow(page)
    await expect(page.getByRole('button', { name: '新建出海任务' })).toBeVisible()
    await expect(page.getByRole('button', { name: '继续演示' })).toBeVisible()
  }
})

test('采集资源与首屏时间，确认指挥台资源来自本机', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '出海运营指挥台' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('first-contentful-paint').length)).toBe(1)
  const data = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    return {
      documentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      firstContentfulPaintMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0].startTime),
      loadedResources: resources.length,
      transferredBytes: navigation.transferSize + resources.reduce((total, item) => total + item.transferSize, 0),
      externalResources: resources.map(item => new URL(item.name)).filter(url => /^https?:$/.test(url.protocol) && url.origin !== location.origin).map(url => url.origin),
    }
  })
  await testInfo.attach('本地首屏采样（开发服务器）', { body: JSON.stringify(data, null, 2), contentType: 'application/json' })
  expect(data.documentLoadedMs).toBeGreaterThan(0)
  expect(data.firstContentfulPaintMs).toBeGreaterThan(0)
  expect(data.externalResources).toEqual([])
})
