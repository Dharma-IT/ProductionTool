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
    aged({ orderNumber: '#7226', name: 'Gladis Ordonez', date: '10/16/2026', status: '' }),
    aged({ orderNumber: '#7226', name: 'Gladis Ordonez', date: '10/16/2026', status: '' }),
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
