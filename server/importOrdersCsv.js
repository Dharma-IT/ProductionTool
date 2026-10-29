import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import XLSX from 'xlsx'

// Dry run by default. --apply inserts missing source rows without overwriting edits.
const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
const startDate = args.find((arg) => arg.startsWith('--from='))?.slice(7) || '2026-10-01'
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  throw new Error('Usage: node server/importOrdersCsv.js <file.csv> [--from=2026-10-01] [--apply]')
}
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const fields = {
  NUMBER: 'number', 'CLIENT NAME': 'clientName', LANGUAGE: 'language', TREATMENT: 'treatment',
  NOTES: 'notes', Observation: 'interval', 'PURCHASE DATE': 'purchaseDate',
  'MEDICAL FORM': 'medicalForm', 'DOCTOR PRESCRIBED?': 'doctorPrescribed',
  'PRESCRIBED PHARMACY': 'prescribedPharmacy', 'SHOPIFY ORDER NUMBER': 'shopifyOrderNumber',
  'PERFECT ORDER NUMBER 1': 'perfectOrderNumber1', 'PERFECT ORDER NUMBER 2': 'perfectOrderNumber2',
  'ABSOLUT ORDER NUMBER': 'absoluteOrderNumber', 'STRIVE ORDER NUMBER 1': 'striveOrderNumber1',
  'STRIVE ORDER NUMBER 2': 'striveOrderNumber2', 'SHOPIFY DATE': 'shopifyDate', ADDRESS: 'address',
  CITY: 'city', STATE: 'state', 'ZIP CODE': 'zipCode', 'ADDRESS CONFIRMED': 'addressConfirmed',
  'TRACKING NUMBER - EXCEPT MEDICATION': 'trackingNumber', 'CS CONTACT DAY': 'csContactDay',
  'DATE SUPPOSED TO ORDER SECOND VIAL CS': 'proposedSecondOrder', SELLER: 'seller',
}
const workbook = XLSX.readFile(file, { raw: true })
const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false })
for (const header of Object.keys(fields)) {
  if (!Object.hasOwn(sourceRows[0] || {}, header)) throw new Error(`Missing column: ${header}`)
}
const occurrences = new Map()
const byDate = {}
const invalidRows = []
const databaseRows = []
for (const [index, source] of sourceRows.entries()) {
  const match = String(source['PURCHASE DATE']).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const date = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : ''
  if (!date || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    invalidRows.push(index + 2)
    continue
  }
  if (date < startDate) continue
  const row = Object.fromEntries(Object.entries(fields).map(([header, key]) => [key, source[header]]))
  const hash = createHash('sha256').update(JSON.stringify(row)).digest('hex')
  const occurrence = (occurrences.get(hash) || 0) + 1
  occurrences.set(hash, occurrence)
  const id = `orders-csv:${hash}:${occurrence}`
  databaseRows.push({ row_id: id, report_date: date, client_name: row.clientName,
    treatment: row.treatment, medical_form: row.medicalForm, source_file_name: basename(file),
    raw_data: { ...row, id, rowId: id, reportDate: date, sourceFileName: basename(file),
      sourceRow: index + 2, sourceData: source, recordType: 'orders-csv-import' } })
  byDate[date] = (byDate[date] || 0) + 1
}
console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', startDate,
  sourceRows: sourceRows.length, eligibleRows: databaseRows.length, invalidRows, byDate }, null, 2))
if (invalidRows.length) throw new Error('Invalid purchase dates require review before import.')
if (!args.includes('--apply')) process.exit(0)

const url = process.env.SUPABASE_REST_URL?.replace(/\/$/, '')
const key = process.env.SUPABASE_ANON_KEY
const table = process.env.SUPABASE_ORDERS_HISTORY_TABLE || 'orders_history'
if (!url || !key) throw new Error('Missing Supabase configuration.')
async function request(query, options = {}) {
  const response = await fetch(`${url}/${table}?${query}`, {
    ...options, headers: { apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) throw new Error(`Orders database request failed (${response.status}).`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}
// Snapshots take precedence in the history UI. Stop instead of inserting hidden rows.
const snapshots = await request(`select=row_id&report_date=gte.${startDate}&raw_data->>recordType=eq.orders-report-snapshot`)
if (snapshots.length) throw new Error('Existing report snapshots need reconciliation before importing this date range.')
let verified = 0
for (let offset = 0; offset < databaseRows.length; offset += 100) {
  const batch = databaseRows.slice(offset, offset + 100)
  await request('on_conflict=row_id', { method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(batch) })
  const params = new URLSearchParams({ select: 'row_id,report_date,raw_data',
    row_id: `in.(${batch.map((row) => row.row_id).join(',')})` })
  const saved = await request(params)
  for (const row of batch) {
    const found = saved.find((item) => item.row_id === row.row_id)
    if (!found || found.report_date !== row.report_date
      || JSON.stringify(found.raw_data.sourceData) !== JSON.stringify(row.raw_data.sourceData)) {
      // JSONB can reorder object keys; compare source fields independently.
      if (!found || found.report_date !== row.report_date || Object.keys(row.raw_data.sourceData)
        .some((field) => found.raw_data.sourceData?.[field] !== row.raw_data.sourceData[field])) {
        throw new Error(`Verification failed for source row ${row.raw_data.sourceRow}.`)
      }
    }
    verified++
  }
}
console.log(JSON.stringify({ verifiedRows: verified, table, status: 'complete' }))
