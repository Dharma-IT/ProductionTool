import assert from 'node:assert/strict'
import test from 'node:test'
import { countOpenDays, parseTrackingDate, getNormalizedTrackingStatus, getOrderWarningSummary } from '../src/services/trackingAnalytics.js'
import { collectTrackingPages } from '../src/services/trackingPagination.js'

function aged(row) {
  const normalizedStatus = getNormalizedTrackingStatus(row.status)
  return { ...row, normalizedStatus, businessDaysOpen: normalizedStatus === 'delivered' ? 0 : countOpenDays(parseTrackingDate(row.date), new Date('2026-10-28T12:00:00Z')) }
}

test('counts the current business day, excludes weekends and the order date', () => {
  assert.equal(countOpenDays(parseTrackingDate('10/16/2026'), new Date('2026-10-28T12:00:00Z')), 8)
  assert.equal(countOpenDays(parseTrackingDate('10/23/2026'), new Date('2026-10-26T12:00:00Z')), 1)
  assert.equal(countOpenDays(parseTrackingDate('10/28/2026'), new Date('2026-10-28T12:00:00Z')), 0)
})

test('includes #7226 and previously excluded customers/products and deduplicates orders', () => {
  const summary = getOrderWarningSummary([
    aged({ orderNumber: '#7226', name: 'Gladis Ordonez', date: '10/16/2026', status: 'In transit' }),
    aged({ orderNumber: '#7226', name: 'Gladis Ordonez', date: '10/16/2026', status: 'In transit' }),
    aged({ orderNumber: '#7000', item: 'Detox Tea', date: '10/16/2026', status: 'In transit' }),
    aged({ orderNumber: '#7001', date: '10/16/2026', status: 'Delivered' }),
    aged({ orderNumber: '#7002', date: '10/28/2026', status: 'Failed delivery' }),
  ])
  assert.deepEqual(summary.overdueOrders.map(r => r.orderNumber), ['#7226', '#7000'])
  assert.equal(summary.warningOrders.length, 3)
  assert.equal(summary.failedOrders.length, 1)
})

test('scans past an empty filtered batch, accumulates history and deduplicates row IDs', async () => {
  const offsets = []
  const progress = []
  const pages = {
    0: { rows: [{ rowId: 'new', orderNumber: '#8741' }], hasMoreRows: true, nextRowsOffset: 1000 },
    1000: { rows: [], hasMoreRows: true, nextRowsOffset: 2000 },
    2000: { rows: [{ rowId: 'old', orderNumber: '#7226' }, { rowId: 'new', orderNumber: '#8741' }], hasMoreRows: false },
  }
  const report = await collectTrackingPages(async offset => { offsets.push(offset); return pages[offset] }, { onProgress: r => progress.push(r.rows.length) })
  assert.deepEqual(offsets, [0, 1000, 2000])
  assert.deepEqual(progress, [1, 1, 2])
  assert.equal(report.rows.find(r => r.orderNumber === '#7226').rowId, 'old')
})

test('never declares complete coverage when a later batch fails or stops advancing', async () => {
  await assert.rejects(collectTrackingPages(async offset => {
    if (offset) throw new Error('network failure')
    return { rows: [], hasMoreRows: true, nextRowsOffset: 1000 }
  }), /network failure/)
  await assert.rejects(collectTrackingPages(async () => ({ rows: [], hasMoreRows: true, nextRowsOffset: 0 })), /did not advance/)
})

test('cancellation prevents fetching more batches', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(collectTrackingPages(async () => {
    calls += 1
    controller.abort()
    return { rows: [], hasMoreRows: true, nextRowsOffset: 1000 }
  }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('risk cutoff uses calendar days: includes day 30 and excludes day 31, including failed deliveries', () => {
  const today = new Date('2026-10-28T12:00:00Z')
  const summary = getOrderWarningSummary([
    aged({ orderNumber: '#30', date: '09/28/2026', status: 'In transit' }),
    aged({ orderNumber: '#31', date: '09/27/2026', status: 'In transit' }),
    aged({ orderNumber: '#failed30', date: '09/28/2026', status: 'Failed delivery' }),
    aged({ orderNumber: '#failed31', date: '09/27/2026', status: 'Failed delivery' }),
    aged({ orderNumber: '#7226', date: '10/16/2026', status: '' }),
  ], today)
  assert.deepEqual(summary.overdueOrders.map(r => r.orderNumber), ['#30', '#failed30'])
  assert.deepEqual(summary.failedOrders.map(r => r.orderNumber), ['#failed30'])
  assert.equal(summary.warningOrders.some(r => r.orderNumber === '#31' || r.orderNumber === '#failed31'), false)
  assert.equal(summary.activeOrders.some(r => r.orderNumber === '#31'), true)
})

test('no-status orders remain in open orders but are excluded from risks and warnings', () => {
  const today = new Date('2026-10-28T12:00:00Z')
  const rows = ['', null, 'No status', '   '].map((status, i) =>
    aged({ orderNumber: `#blank${i}`, date: '10/16/2026', status }),
  )
  rows.push(aged({ orderNumber: '#tracked', date: '10/16/2026', status: 'In transit' }))
  const summary = getOrderWarningSummary(rows, today)
  assert.equal(summary.activeOrders.length, 5)
  assert.deepEqual(summary.overdueOrders.map(row => row.orderNumber), ['#tracked'])
  assert.deepEqual(summary.warningOrders.map(row => row.orderNumber), ['#tracked'])
})

test('delivered packages clear stale duplicate warnings regardless of row order', () => {
  const rows = [
    aged({ orderNumber: '#7412', date: '10/22/2026', tracking: '9400 1234', status: 'In progress' }),
    aged({ orderNumber: '#7412', date: '10/22/2026', tracking: '94001234', status: 'Delivered' }),
  ]
  // Use an older order date so the stale row would otherwise be overdue.
  rows[0].businessDaysOpen = 8
  for (const input of [rows, [...rows].reverse()]) {
    const summary = getOrderWarningSummary(input, new Date('2026-10-30T12:00:00Z'))
    assert.equal(summary.warningOrders.length, 0)
    assert.equal(summary.activeOrders.length, 0)
  }
})

test('partial deliveries and untracked items keep their own warnings', () => {
  const summary = getOrderWarningSummary([
    aged({ orderNumber: '#7201', date: '10/16/2026', tracking: 'delivered', status: 'Delivered' }),
    aged({ orderNumber: '#7201', date: '10/16/2026', tracking: 'pending', status: 'In transit' }),
    aged({ orderNumber: '#7189', date: '10/16/2026', status: 'Delivered' }),
    aged({ orderNumber: '#7189', date: '10/16/2026', status: 'In progress' }),
    aged({ orderNumber: '#7422', date: '10/16/2026', tracking: 'delivered', status: 'In transit' }),
  ], new Date('2026-10-30T12:00:00Z'))
  assert.deepEqual(summary.overdueOrders.map(row => row.orderNumber), ['#7201', '#7189', '#7422'])
})
