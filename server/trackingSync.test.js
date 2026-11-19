import assert from 'node:assert/strict'
import test from 'node:test'
import { scanTrackingPages, createSharedTrackingSync } from './trackingSync.js'

test('persists each batch before fetching another and stops at the date cutoff', async () => {
  const events = []
  const result = await scanTrackingPages({
    params: { limit: 100, created_at_min: '2026-10-20T00:00:00Z' },
    fetchPage: async (params) => {
      events.push(['fetch', params])
      return { payload: { orders: params.page_info
        ? [{ id: 2, created_at: '2026-10-21' }, { id: 3, created_at: '2026-10-19' }]
        : [{ id: 1, created_at: '2026-11-19' }] }, nextPageInfo: 'next' }
    },
    processPage: async (orders) => { await Promise.resolve(); events.push(['saved', orders.map((o) => o.id)]) },
  })
  assert.deepEqual(events.map(([type]) => type), ['fetch', 'saved', 'fetch', 'saved'])
  assert.deepEqual(events[2][1], { limit: 100, page_info: 'next' })
  assert.deepEqual(events[3][1], [2])
  assert.deepEqual(result, { pageCount: 2, hitPageLimit: false })
})

test('failed persistence stops the scan before fetching more pages', async () => {
  let fetched = 0
  await assert.rejects(scanTrackingPages({
    params: {},
    fetchPage: async () => { fetched++; return { payload: { orders: [] }, nextPageInfo: 'next' } },
    processPage: async () => { throw new Error('database unavailable') },
  }), /database unavailable/)
  assert.equal(fetched, 1)
})

test('concurrent refreshes share one job and permit a new job after completion or failure', async () => {
  const run = createSharedTrackingSync()
  let release
  let count = 0
  const work = () => { count++; return new Promise((resolve) => { release = resolve }) }
  const first = run(work)
  const second = run(work)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(count, 1)
  release('done')
  assert.deepEqual(await Promise.all([first, second]), ['done', 'done'])
  await assert.rejects(run(() => { throw new Error('failed') }), /failed/)
  assert.equal(await run(() => 'retry'), 'retry')
})
