import assert from 'node:assert/strict'
import test from 'node:test'
import { isOrderHistoryEligible } from '../src/services/orderHistoryEligibility.js'
import { buildOrdersSnapshot, readOrdersSnapshot } from './ordersSnapshots.js'

test('excludes supplement variants while preserving medication orders', () => {
  for (const treatment of [
    '1x Subscription Berberine', '3x Berberine + & Weight Balance',
    '5x Subscription GLP-1 Support', '3x GLP-1 Support', 'Subscription GLP1 Support',
    '3x Beauty Boost', '1x Subscription Beauty Boost',
    'Personalized Nutrition Consultation', '1x Nutrition Consultation',
    '2x Subscription Personalized Nutrition Consultation',
    '1x Subscription - Multivitamin', 'Multi Vitamin',
    '3x Subscription - Apple Cider Vinegar', 'Apple Cider Vinegar',
    'Subscription Apple Scider Vinegar',
  ]) assert.equal(isOrderHistoryEligible({ treatment }), false, treatment)
  for (const treatment of ['1x Compounded Tirzepatide 60mg', '1x Subscription NAD+',
    '1x Subscription Zepbound', '1x Personalized Tirzepatide 52mg', '']) {
    assert.equal(isOrderHistoryEligible({ treatment }), true, treatment)
  }
})

test('history saves and historical reads exclude supplements without changing fetched rows', () => {
  const rows = [
    { id: 'medication', treatment: '1x Compounded Tirzepatide 52mg' },
    { id: 'supplement', treatment: '5x Subscription GLP-1 Support' },
  ]
  const snapshot = buildOrdersSnapshot(rows, '2026-11-04', '', [])
  assert.equal(rows.length, 2)
  assert.deepEqual(snapshot.rows.map((row) => row.treatment), [rows[0].treatment])
  const oldSnapshot = { ...snapshot, rows }
  const imported = { id: 'import', treatment: 'Beauty Boost', recordType: 'orders-csv-import' }
  assert.deepEqual(readOrdersSnapshot([oldSnapshot, imported]).rows.map((row) => row.id), ['medication'])
})
