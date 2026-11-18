import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import { readTikTokOrderId } from '../src/services/shopifyOrderTags.js'

test('reads the TikTok order tag without losing digits or matching unrelated IDs', () => {
  const id = '577665793151439606'
  assert.equal(readTikTokOrderId(`Buyer:Marie, Shipped by TikTok, TikTokOrderID:${id}`), id)
  assert.equal(readTikTokOrderId([`TikTokOrderID=${id}`]), id)
  assert.equal(readTikTokOrderId(`TikTok Order ID: ${id}`), id)
  for (const tags of [undefined, null, '', 'OtherOrderID:123, Shipped by TikTok', 'TikTokOrderID:invalid']) {
    assert.equal(readTikTokOrderId(tags), '')
  }
})

test('TikTok IDs survive Excel export as exact text', () => {
  const id = readTikTokOrderId('TikTokOrderID:577665793151439606')
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 'TikTok Order ID': id }]), 'Risks')
  const restored = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
  assert.equal(restored.Sheets.Risks.A2.t, 's')
  assert.equal(restored.Sheets.Risks.A2.v, '577665793151439606')
})
