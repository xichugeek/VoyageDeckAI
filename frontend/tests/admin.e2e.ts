import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const admin = (page: Page) => page.getByRole('dialog', { name: '管理后台' })
const commandHeaders = { 'X-VoyageDeck-Request': 'cockpit' }
const screenshots = new URL('../../artifacts/screenshots/', import.meta.url)
const testResults = new URL('../.local/admin-e2e-tests/', import.meta.url)

async function openAdmin(page: Page) {
  await page.getByRole('button', { name: '管理后台' }).click()
  await expect(admin(page)).toBeVisible()
  return admin(page)
}

async function login(page: Page) {
  const password = process.env.VOYAGEDECK_E2E_SYNTHETIC_PASSWORD
  if (!password) throw new Error('Run this test with playwright.admin.config.ts')
  const board = admin(page)
  await board.getByLabel('管理员密码').fill(password)
  await board.getByRole('button', { name: '登录', exact: true }).click()
  await expect(board.getByRole('button', { name: '退出管理' })).toBeVisible()
}

test.afterAll(async () => {
  for (const filename of ['admin.sqlite-shm', 'admin.sqlite-wal', 'admin.sqlite']) {
    await rm(new URL(filename, testResults), { force: true })
  }
})

test('管理员可登录、运行 Mock 草稿、持久化审核并退出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const session = await page.request.get('/api/admin/session')
  expect(await session.json()).toEqual({ enabled: true, authenticated: false })
  expect((await page.request.get('/api/workflows')).status()).toBe(401)
  expect((await page.request.get('/api/settings/provider')).status()).toBe(401)
  const unauthorized = await page.request.post('/api/admin/inferences', {
    headers: commandHeaders, data: { agent: 'creator', context: '虚构访客任务', request_id: randomUUID() },
  })
  expect(unauthorized.status()).toBe(401)

  const board = await openAdmin(page)
  await expect(board.getByLabel('管理员密码')).toBeVisible()
  await login(page)
  const afterLogin = await page.request.get('/api/admin/session')
  expect(await afterLogin.json()).toEqual({ enabled: true, authenticated: true })
  await expect(board.getByRole('heading', { name: '持久化任务' })).toBeVisible()

  const provider = await page.request.get('/api/settings/provider')
  expect(provider.ok()).toBe(true)
  expect(await provider.json()).toMatchObject({ mode: 'mock', key_configured: false })
  await board.getByText(/模型配置/).click()
  const mode = board.getByLabel('Provider 模式')
  const endpoint = board.getByLabel('HTTPS API 基址')
  await mode.selectOption('openai_compatible')
  await endpoint.fill('http://127.0.0.1:9/v1')
  const invalid = page.waitForResponse(response => response.url().endsWith('/api/settings/provider') && response.request().method() === 'PUT')
  await board.getByRole('button', { name: '保存模型设置' }).click()
  expect((await invalid).status()).toBe(422)
  await expect(board.getByRole('alert')).toBeVisible()

  await mode.selectOption('mock')
  await endpoint.fill('')
  await board.getByLabel('模型', { exact: true }).fill('mock-e2e')
  await board.getByRole('button', { name: '保存模型设置' }).click()
  await expect(board.getByText('模型设置已保存。', { exact: true })).toBeVisible()
  await board.getByRole('combobox', { name: '岗位', exact: true }).selectOption('creator')
  await board.getByLabel('任务上下文').fill('为虚构收纳商品草拟一条短视频。只在管理员模型沙盒处理。')
  const inferenceResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/inferences') && response.request().method() === 'POST')
  await board.getByRole('button', { name: '生成文本草稿' }).click()
  const generated = await inferenceResponse
  expect(generated.ok()).toBe(true)
  const draft = await generated.json()
  expect(draft).toMatchObject({ status: 'succeeded', data_source: 'mock_simulated', output: { title: expect.any(String) } })
  const detail = board.getByRole('region', { name: '持久化任务详情' })
  await expect(detail.getByText(/Mock 模拟草稿/)).toBeVisible()
  await detail.getByLabel('审核备注').fill('本地 Mock 验收通过')
  const reviewResponse = page.waitForResponse(response => response.url().endsWith(`/api/workflows/${draft.id}/approve`) && response.request().method() === 'POST')
  await detail.getByRole('button', { name: '批准草稿' }).click()
  expect((await reviewResponse).ok()).toBe(true)
  await expect(detail.getByText(/审批记录 · 已批准.*本地 Mock 验收通过/)).toBeVisible()

  await page.reload()
  await openAdmin(page)
  await expect(board.getByRole('button', { name: '退出管理' })).toBeVisible()
  const list = await page.request.get('/api/workflows')
  expect(await list.json()).toMatchObject({ workflows: [{ id: draft.id, status: 'succeeded', data_source: 'mock_simulated' }] })
  const stored = await page.request.get(`/api/workflows/${draft.id}`)
  expect(await stored.json()).toMatchObject({ id: draft.id, output: draft.output, review: { decision: 'approved', note: '本地 Mock 验收通过' } })
  expect(await (await page.request.get('/api/settings/provider')).json()).toMatchObject({ mode: 'mock', model: 'mock-e2e', key_configured: false })

  await board.getByRole('button', { name: '退出管理' }).click()
  await expect(board.getByLabel('管理员密码')).toBeVisible()
  expect((await page.request.get(`/api/workflows/${draft.id}`)).status()).toBe(401)
  await login(page)
  await board.getByRole('region', { name: '持久化任务', exact: true }).getByRole('button', { name: /内容官.*Mock 模拟草稿/ }).click()
  const reviewed = detail.getByText(/审批记录 · 已批准.*本地 Mock 验收通过/)
  await expect(reviewed).toBeVisible()
  await reviewed.scrollIntoViewIfNeeded()
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: fileURLToPath(new URL('admin-mock-review.png', screenshots)), animations: 'disabled' })
})
