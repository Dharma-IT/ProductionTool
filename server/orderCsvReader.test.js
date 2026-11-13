import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import { readOrderCsvWorkbook } from '../src/services/orderCsvReader.js'
import { buildOrderCsvLookup, buildStriveCsvLookup, enrichHubSpotOrders, enrichStriveOrderNumbers } from '../src/services/orderCsvEnrichment.js'

function readRows(csv) {
  const workbook = readOrderCsvWorkbook(new TextEncoder().encode(csv).buffer)
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false })
}

test('preserves UTF-8 names through Portal and Strive imports so accents do not prevent matching', () => {
  for (const bom of ['', '\uFEFF']) {
    const portal = readRows(`${bom}firstName,lastName,phone,purchase\nExample,Méndez ,5551234567,Tirzepatide 60mg`)
    assert.equal(portal[0].lastName, 'Méndez ')
    for (const lastName of ['Mendez', 'Méndez']) {
      const strive = readRows(`${bom}First Name,Last Name,Medication,Order,Order Status\nExample,${lastName},TIRZEPATIDE/GLYCINE/B12,123456,Complete Processing`)
      const enriched = enrichHubSpotOrders([{
        clientName: 'Example Mendez', number: '15551234567', treatment: '1x Tirzepatide 60mg',
      }], buildOrderCsvLookup(portal))
      const result = enrichStriveOrderNumbers(enriched.rows, buildStriveCsvLookup(strive))
      assert.equal(result.matchedCount, 1)
      assert.equal(result.rows[0].striveOrderNumber1, '123456')
    }
  }
})
