import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import XLSX from 'xlsx'

const file = process.argv[2]
if (!file) throw new Error('Provide the pending medical forms CSV path.')
const apply = process.argv.includes('--apply')
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
}
const workbook = XLSX.readFile(file, { raw: true })
const [headers, ...sourceRows] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
  header: 1, defval: '', raw: false, blankrows: false,
})
for (const [index, expected] of ['PHONE NUMBER', 'CLIENT NAME', 'LANGUAGE', 'TREATMENT', 'DATE', 'SELLER'].entries()) {
  if (headers[index]?.trim() !== expected) throw new Error(`Unexpected column ${index + 1}.`)
}
const occurrences = new Map()
const records = sourceRows.map((source, index) => {
  const [number, clientName, language, treatment, purchaseDate, seller] = source
  const match = String(purchaseDate).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const date = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : ''
  if (!date || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Invalid date at row ${index + 2}.`)
  const row = { number, clientName, language, treatment, purchaseDate, seller, medicalForm: 'PENDING' }
  const hash = createHash('sha256').update(JSON.stringify(row)).digest('hex')
  const occurrence = (occurrences.get(hash) || 0) + 1
  occurrences.set(hash, occurrence)
  const id = `pending-medical-csv:${hash}:${occurrence}`
  return { row_id: id, report_date: date, client_name: clientName, treatment, medical_form: 'PENDING',
    source_file_name: basename(file), raw_data: { ...row, id, rowId: id, reportDate: date,
      recordType: 'pending-medical-form-import', sourceFileName: basename(file), sourceRow: index + 2,
      sourceHeaders: headers, sourceData: source } }
})
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', rows: records.length,
  earliest: records.map((row) => row.report_date).sort()[0], latest: records.map((row) => row.report_date).sort().at(-1) }))
if (!apply) process.exit(0)
const url = process.env.SUPABASE_REST_URL.replace(/\/$/, '')
const key = process.env.SUPABASE_ANON_KEY
const table = process.env.SUPABASE_ORDERS_HISTORY_TABLE || 'orders_history'
async function request(query, options = {}) {
  const response = await fetch(`${url}/${table}?${query}`, { ...options, headers: {
    apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers,
  } })
  if (!response.ok) throw new Error(`Pending import request failed (${response.status}).`)
  const body = await response.text()
  return body ? JSON.parse(body) : null
}
for (let offset = 0; offset < records.length; offset += 100) {
  const batch = records.slice(offset, offset + 100)
  await request('on_conflict=row_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(batch) })
  const saved = await request(new URLSearchParams({ select: 'row_id,raw_data', row_id: `in.(${batch.map((row) => row.row_id).join(',')})` }))
  for (const row of batch) {
    const found = saved.find((item) => item.row_id === row.row_id)
    if (!found || JSON.stringify(found.raw_data.sourceData) !== JSON.stringify(row.raw_data.sourceData)
      || found.raw_data.recordType !== 'pending-medical-form-import') throw new Error(`Verification failed at row ${row.raw_data.sourceRow}.`)
  }
}
console.log(JSON.stringify({ status: 'complete', verifiedRows: records.length, table }))
