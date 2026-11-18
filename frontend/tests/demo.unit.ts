import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canRetry, createDraft, createRun, eventsSince, metrics, previewRun, reduceRun } from '../src/demo'
import type { Action, Config, Run } from '../src/model'

const epoch = Date.parse('2026-11-19T00:00:00.000Z')

function drive(initial: Run) {
  let state = initial
  let now = Date.parse(state.updatedAt)
  function send(action: Action) {
    now += 1250
    state = reduceRun(state, action, now)
    return state
  }
  function finishStep() {
    send({ type: 'tick' })
    return send({ type: 'tick' })
  }
  function review(type: 'approve' | 'reject' = 'approve'): Action {
    const { id, attempts } = state.tasks[state.activeIndex]
    return { type, taskId: id, attempt: attempts }
  }
  return { send, review, finishStep, current: () => state }
}

function complete(config: Partial<Config> = {}) {
  const run = drive(createRun(config, epoch))
  run.send({ type: 'start' })
  for (let index = 0; index < 6; index += 1) {
    run.finishStep()
    if (run.current().status === 'awaiting_approval') run.send(run.review())
  }
  return run.current()
}

test('draft, readiness, duplicate start, paused clock, single step and resume are reducer controlled', () => {
  const draft = createDraft({}, epoch)
  assert.equal(draft.status, 'draft')
  assert.equal(reduceRun(draft, { type: 'start' }, epoch), draft)
  const driver = drive(draft)
  assert.equal(driver.send({ type: 'prepare' }).status, 'ready')
  const started = driver.send({ type: 'start' })
  assert.equal(driver.send({ type: 'start' }), started)
  assert.equal(started.tasks[0].status, 'running')
  assert.equal(started.tasks[0].attempts, 1)
  assert.equal(metrics(started).working, 1)
  const paused = driver.send({ type: 'pause' })
  assert.equal(driver.finishStep(), paused)
  assert.equal(metrics(paused).working, 0)
  const stepped = driver.send({ type: 'step' })
  assert.equal(stepped.status, 'paused')
  assert.equal(stepped.tasks[0].status, 'succeeded')
  assert.equal(stepped.tasks[1].status, 'queued')
  assert.equal(stepped.tasks[1].attempts, 0)
  const waiting = driver.send({ type: 'step' })
  assert.equal(waiting.status, 'awaiting_approval')
  assert.equal(driver.send({ type: 'resume' }), waiting)
  const afterApproval = driver.send(driver.review())
  assert.equal(afterApproval.status, 'paused')
  assert.equal(afterApproval.tasks[2].status, 'queued')
  const resumed = driver.send({ type: 'resume' })
  assert.equal(resumed.tasks[2].status, 'running')
  assert.equal(resumed.tasks[0].attempts, 1)
})

test('approval is scoped by task and attempt and repeated actions cannot charge twice', () => {
  const driver = drive(createRun({ budget: 1234 }, epoch))
  driver.send({ type: 'start' })
  driver.finishStep()
  const listingReview = driver.finishStep()
  assert.equal(listingReview.status, 'awaiting_approval')
  const listingApproval = driver.review()
  assert.equal(driver.send({ type: 'tick' }), listingReview)
  assert.equal(driver.send({ ...listingApproval, taskId: 'different-task' }), listingReview)
  assert.equal(driver.send({ ...listingApproval, attempt: 2 }), listingReview)
  const afterListing = driver.send(listingApproval)
  assert.equal(afterListing.tasks[1].output?.status, 'draft')
  assert.equal(driver.send(listingApproval), afterListing)
  assert.equal(afterListing.orders.length, 0)
  driver.finishStep()
  const adsReview = driver.finishStep()
  assert.equal(adsReview.status, 'awaiting_approval')
  assert.equal(adsReview.adSpend, 0)
  assert.equal(driver.send(listingApproval), adsReview)
  const adsApproval = driver.review()
  const charged = driver.send(adsApproval)
  assert.equal(charged.adSpend, 1234)
  assert.equal(charged.orders.length, 2)
  assert.equal(driver.send(adsApproval), charged)
  assert.equal(driver.send({ ...adsApproval, type: 'reject' }), charged)
  assert.deepEqual(charged.approvals.map(item => [item.decision, item.attempt, item.actor]), [
    ['approved', 1, 'sandbox_visitor'], ['approved', 1, 'sandbox_visitor'],
  ])
  assert.equal(charged.approvals[1].outputId, charged.tasks[3].outputId)
})

test('standard scenario scores, links role contracts, ships both orders and reconciles every KPI', () => {
  const run = complete()
  assert.equal(run.status, 'completed')
  assert.equal(run.selectedId, 'nomad')
  const orbit = run.candidates.find(item => item.id === 'orbit')
  assert.equal(orbit?.status, 'rejected')
  assert.match(orbit?.reason ?? '', /毛利率 19.4% 低于 35.0%/)
  assert.ok(orbit?.factors)
  const { margin, demand, competition, complianceRisk, supplyReliability } = orbit.factors
  const weighted = demand * 0.30 + margin * 35 + (100 - competition) * 0.15
    + (100 - complianceRisk) * 0.10 + supplyReliability * 0.10
  assert.equal(orbit.score, Math.round(weighted))
  assert.deepEqual(run.tasks.map(item => item.status), Array(6).fill('succeeded'))
  assert.ok(run.tasks.every(item => item.startedAt && item.endedAt && item.attemptHistory?.[0].endedAt))
  assert.ok(run.tasks.every(item => item.input?.data_source === run.mode && item.output?.task_id === item.id))
  assert.equal(run.tasks[2].input?.已审核上架草稿ID, run.tasks[1].outputId)
  assert.equal((run.tasks[1].output?.五点描述 as string[]).length, 5)
  assert.equal((run.tasks[2].output?.分镜 as unknown[]).length, 3)
  assert.equal((run.tasks[4].output?.草稿 as unknown[]).length, 3)
  assert.deepEqual(run.orders.map(item => item.status), ['shipped', 'shipped'])
  assert.deepEqual(run.inventory?.['VD-NP01'], { available: 6, reserved: 0, shipped: 2 })
  const m = metrics(run)
  assert.deepEqual(m, {
    gmv: 9800, count: 2, refunds: 0, net: 9800, procurement: 3600, shipping: 960, fees: 588,
    adSpend: 2680, attributed: 4900, roas: 4900 / 2680, gross: 6200, margin: 6200 / 9800,
    contribution: 1972, totalCost: 7828, working: 0,
  })
})

test('fallback ranks an alternate, refunds stock shortage and links event IDs to its order', () => {
  const run = complete({ scenario: 'fallback' })
  assert.equal(run.status, 'completed')
  assert.equal(run.config.preferredId, 'orbit')
  assert.equal(run.selectedId, 'aero')
  assert.equal(run.candidates.find(item => item.id === 'aero')?.reason, '首选商品淘汰 · 切换最高分备选')
  assert.deepEqual(run.orders.map(item => item.status), ['shipped', 'refunded'])
  const refunded = run.orders[1]
  assert.deepEqual(refunded.events.map(item => item.kind), ['created', 'stock_shortage', 'refunded'])
  for (const order of run.orders) {
    for (const entry of order.events) {
      const event = run.events.find(({ seq }) => seq === entry.seq)
      assert.equal(event?.orderId, order.id)
      assert.equal(event?.workflowId, run.id)
    }
  }
  assert.deepEqual(run.inventory?.['VD-AF03'], { available: 0, reserved: 0, shipped: 1 })
  assert.deepEqual(metrics(run), {
    gmv: 8400, count: 2, refunds: 4200, net: 4200, procurement: 1650, shipping: 480, fees: 252,
    adSpend: 2680, attributed: 4200, roas: 4200 / 2680, gross: 2550, margin: 2550 / 4200,
    contribution: -862, totalCost: 5062, working: 0,
  })
})

test('insufficient margin or high compliance risk are surfaced independently', () => {
  const eu = drive(createRun({ market: 'EU', marginFloor: 0 }, epoch))
  eu.send({ type: 'start' })
  const riskChecked = eu.finishStep()
  assert.match(riskChecked.candidates.find(item => item.id === 'orbit')?.reason ?? '', /合规风险分 62 高于上限 60/)
  const strict = drive(createRun({ marginFloor: 0.9 }, epoch))
  strict.send({ type: 'start' })
  const failed = strict.finishStep()
  assert.equal(failed.status, 'failed')
  assert.equal(canRetry(failed), false)
  assert.ok(failed.tasks.slice(1).every(item => item.status === 'skipped'))
})

test('Creator incident times out, allows exactly two manual retries and records each attempt', () => {
  const driver = drive(createRun({ scenario: 'incident' }, epoch))
  driver.send({ type: 'start' })
  driver.finishStep()
  driver.finishStep()
  driver.send(driver.review())
  for (const attempt of [1, 2, 3]) {
    const failed = driver.finishStep()
    assert.equal(failed.status, 'failed')
    assert.equal(canRetry(failed), attempt < 3)
    assert.equal(failed.tasks[2].attempts, attempt)
    assert.match(failed.tasks[2].failure ?? '', /内容生成模拟超时/)
    assert.equal(failed.tasks[2].output, undefined)
    assert.equal(failed.orders.length, 0)
    if (attempt < 3) {
      assert.equal(failed.tasks[3].status, 'pending')
      const retried = driver.send({ type: 'retry' })
      assert.equal(retried.status, 'running')
      assert.equal(driver.send({ type: 'retry' }), retried)
    }
  }
  const failed = driver.current()
  assert.match(failed.failure ?? '', /已达重试上限/)
  assert.equal(driver.send({ type: 'retry' }), failed)
  assert.ok(failed.tasks.slice(3).every(task => task.status === 'skipped'))
  assert.ok(failed.tasks[2].attemptHistory?.every(item => item.failure && item.endedAt))
})

test('rejecting or canceling the pending draft preserves audit and blocks future spending', () => {
  for (const action of ['reject', 'cancel'] as const) {
    const driver = drive(createRun({}, epoch))
    driver.send({ type: 'start' })
    driver.finishStep()
    const pending = driver.finishStep()
    const copy = structuredClone(pending)
    const wrongApproval = driver.review()
    const stopped = driver.send(action === 'reject' ? driver.review('reject') : { type: 'cancel' })
    assert.equal(stopped.status, action === 'reject' ? 'failed' : 'canceled')
    assert.equal(stopped.tasks[0].status, 'succeeded')
    assert.equal(stopped.tasks[1].output?.status, 'draft')
    assert.equal(stopped.approvals.length, action === 'reject' ? 1 : 0)
    assert.equal(driver.send(wrongApproval), stopped)
    assert.equal(driver.finishStep(), stopped)
    assert.equal(stopped.adSpend, 0)
    assert.deepEqual(pending, copy)
  }
})

test('zero budgets, canceled orders and fully refunded sales use deterministic edge formulas', () => {
  assert.throws(() => createRun({ budget: -1 }), RangeError)
  assert.throws(() => createRun({ budget: 1.2 }), RangeError)
  assert.throws(() => createRun({ marginFloor: Number.NaN }), RangeError)
  const official = complete({ budget: 0 })
  assert.equal(metrics(official).roas, null)
  assert.equal(metrics(official).attributed, 0)
  const edge = structuredClone(official)
  edge.orders[0].status = 'refunded'
  edge.orders[0].refund = edge.orders[0].amount
  edge.orders[1].status = 'canceled'
  const m = metrics(edge)
  assert.equal(m.gmv, 4900)
  assert.equal(m.count, 1)
  assert.equal(m.net, 0)
  assert.equal(m.margin, null)
  assert.equal(m.contribution, -m.totalCost)
})

test('journal cursor resumes after serialization and a fresh run has isolated facts', () => {
  const preview = previewRun()
  const cursor = preview.events.at(-1)?.seq ?? 0
  const restored = JSON.parse(JSON.stringify(preview)) as Run
  const next = drive(restored)
  next.send({ type: 'resume' })
  const completed = next.send({ type: 'tick' })
  assert.equal(completed.status, 'completed')
  const delta = eventsSince(completed, cursor)
  assert.ok(delta.length > 0)
  assert.equal(delta[0].seq, cursor + 1)
  assert.deepEqual([...restored.events, ...delta], completed.events)
  assert.ok(completed.events.every((event, index) => event.seq === index + 1 && event.dataSource === 'demo_simulated'))
  assert.equal(completed.snapshots.at(-1)?.cost, metrics(completed).totalCost)
  const reset = createRun()
  assert.notEqual(reset.id, completed.id)
  assert.equal(reset.orders.length, 0)
  assert.equal(reset.approvals.length, 0)
  assert.equal(metrics(reset).roas, null)
  assert.equal(restored.orders[0].status, 'created')
})
