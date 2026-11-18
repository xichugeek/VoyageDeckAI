import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const screenshots = new URL('../../artifacts/screenshots/', import.meta.url)

for (const [width, height] of [[1440, 900], [1920, 1080], [390, 844]]) {
  test(`command console at ${width} × ${height}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '出海运营指挥台' })).toBeVisible()
    await expect(page.locator('.flow-node')).toHaveCount(6)
    await expect(page.locator('.agent-card')).toHaveCount(6)
    await expect(page.getByRole('button', { name: /模拟成交总额 \$98\.00/ })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    mkdirSync(screenshots, { recursive: true })
    await page.screenshot({ path: fileURLToPath(new URL(`console-${width}x${height}.png`, screenshots)), animations: 'disabled' })
    if (width !== 1920) {
      const wholePage = width === 390 ? 'console-mobile-full.png' : 'console-desktop-full.png'
      await page.screenshot({ path: fileURLToPath(new URL(wholePage, screenshots)), fullPage: true, animations: 'disabled' })
    }
    await page.getByRole('button', { name: /01 选品官 .*查看详情/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('执行输入', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '继续演示' }).click()
    await expect(page.getByRole('button', { name: '查看复盘' })).toBeVisible()
    expect(errors).toEqual([])
  })
}
