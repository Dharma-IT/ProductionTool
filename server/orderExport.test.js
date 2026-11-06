import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatOrderExportValue, getOrderExportHeaders } from '../src/services/orderExport.js'

test('exports the requested column positions for current and historical orders', () => {
  const source = readFileSync(new URL('../src/routes/Orders.jsx', import.meta.url), 'utf8')
  const headerSource = source.split('const orderHeaders = [')[1].split('\n]')[0]
  const headers = [...headerSource.matchAll(/key: '([^']+)', label: '([^']+)'/g)]
    .map(([, key, label]) => ({ key, label }))
  for (const input of [headers, [...headers, { key: 'reportDate', label: 'Report Date' }]]) {
    const keys = getOrderExportHeaders(input).map(({ key }) => key)
    assert.equal(keys[14], 'striveOrderNumber1')
    assert.equal(keys[15], 'futureOrderNumber')
    assert.deepEqual(keys.slice(17, 21), ['address', 'city', 'state', 'zipCode'])
    assert.equal(keys[25], 'seller')
    assert.ok(!keys.includes('striveOrderNumber2'))
  }
})

test('formats exported statuses and single-item treatments without changing other quantities', () => {
  assert.equal(formatOrderExportValue('medicalForm', 'Pending'), 'NO')
  assert.equal(formatOrderExportValue('medicalForm', ' yes '), 'YES')
  assert.equal(formatOrderExportValue('medicalForm', 'Mismatch'), 'MISMATCH')
  assert.equal(formatOrderExportValue('medicalForm', ''), '')
  assert.equal(formatOrderExportValue('doctorPrescribed', 'Pending'), 'PENDING')
  assert.equal(formatOrderExportValue('treatment', '1x Compounded Tirzepatide'), 'Compounded Tirzepatide')
  assert.equal(formatOrderExportValue('treatment', '2x Compounded Tirzepatide'), '2x Compounded Tirzepatide')
})
