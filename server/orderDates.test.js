import assert from 'node:assert/strict'
import test from 'node:test'
import { formatOrderPurchaseDate } from '../src/services/orderDates.js'

test('preserves HubSpot purchase dates across viewer timezones for display and export', () => {
  const previousTimezone = process.env.TZ
  try {
    for (const timezone of ['America/Los_Angeles', 'America/New_York', 'Asia/Manila']) {
      process.env.TZ = timezone
      assert.equal(formatOrderPurchaseDate('2026-10-27T00:00:00Z'), '10/27/2026')
      assert.equal(formatOrderPurchaseDate('2026-10-26'), '10/26/2026')
    }
    assert.equal(formatOrderPurchaseDate(''), '')
    assert.equal(formatOrderPurchaseDate('invalid'), 'invalid')
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})
