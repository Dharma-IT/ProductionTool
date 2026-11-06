import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { buildOrdersSnapshot, readOrdersSnapshot } from './ordersSnapshots.js'

test('preserves legacy dates while snapshots replace stale rows for their own date', () => {
  const snapshot = buildOrdersSnapshot([{ id: 'current' }], '2026-10-29', 'portal.csv', [])
  const report = readOrdersSnapshot([
    { id: 'legacy', reportDate: '2026-10-28' },
    { id: 'stale', reportDate: '2026-10-29' }, snapshot,
  ])
  assert.deepEqual(report.rows.map((row) => row.id), ['2026-10-29:current', 'legacy'])
  assert.deepEqual(readOrdersSnapshot([]).rows, [])
})

test('CSV imports stay visible alongside snapshots and snapshot replacements', () => {
  const imported = { id: 'csv-1', rowId: 'csv-1', reportDate: '2026-10-29', recordType: 'orders-csv-import' }
  for (const rows of [[], [{ id: 'current' }], [imported]]) {
    const snapshot = buildOrdersSnapshot(rows, '2026-10-29', 'portal.csv', [])
    const report = readOrdersSnapshot([snapshot, imported])
    assert.equal(report.rows.filter((row) => row.id === 'csv-1').length, 1)
  }
})

test('pending medical form imports never appear in historical data', () => {
  const pending = { id: 'pending', reportDate: '2026-10-01', treatment: 'Tirzepatide', recordType: 'pending-medical-form-import' }
  assert.deepEqual(readOrdersSnapshot([pending]).rows, [])
})

test('saves and reloads complete dated reports, warnings, replacements, and history edits', async () => {
  const records = new Map()
  let failWrites = false
  const storage = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (request.method === 'POST') {
      if (failWrites) { response.writeHead(503); response.end('Storage unavailable'); return }
      let body = ''
      for await (const chunk of request) body += chunk
      for (const record of JSON.parse(body)) records.set(record.row_id, record)
      response.writeHead(204)
      response.end()
      return
    }
    const date = url.searchParams.get('report_date')?.replace(/^eq\./, '')
    const rows = [...records.values()].filter((row) => !date || row.report_date === date)
    const offset = Number(url.searchParams.get('offset') || 0)
    const limit = Number(url.searchParams.get('limit') || 1000)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(rows.slice(offset, offset + limit)))
  })
  storage.listen(0, '127.0.0.1')
  await once(storage, 'listening')
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const apiPort = portProbe.address().port
  await new Promise((resolve) => portProbe.close(resolve))
  const api = spawn(process.execPath, ['server/hubspotCallReportApi.js'], {
    env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1',
      SUPABASE_REST_URL: `http://127.0.0.1:${storage.address().port}`,
      SUPABASE_ANON_KEY: 'local-test-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const apiUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('API startup timed out')), 10000)
      api.once('error', (error) => { clearTimeout(timeout); reject(error) })
      api.stdout.on('data', (chunk) => {
        const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/)
        if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`) }
      })
    })
    const save = (payload) => fetch(`${apiUrl}/api/orders-history`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const load = async (date) => (await fetch(`${apiUrl}/api/orders-history?date=${date}`)).json()
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `item-${index}`, clientName: `Portal patient ${index}`, treatment: 'Subscription Zepbound',
    }))
    const warnings = [{ id: 'missing', clientName: 'Missing patient', reason: 'Patient not found' }]
    let response = await save({ rows, warnings, snapshot: true, reportDate: '2026-10-29', sourceFileName: 'portal.csv' })
    assert.equal(response.status, 200)
    let report = await load('2026-10-29')
    assert.equal(report.rows.length, 1001)
    assert.deepEqual(report.warnings, warnings.map((warning) => ({ ...warning, id: `2026-10-29:${warning.id}`, reportDate: '2026-10-29' })))
    assert.equal(report.snapshot.sourceFileName, 'portal.csv')
    assert.equal(report.rows[0].clientName, 'Portal patient 0')
    assert.equal((await load('2026-10-28')).rows.length, 0)

    response = await save({ rows: [{ ...report.rows[0], notes: 'Reviewed' }], reportDate: '2026-10-29' })
    assert.equal(response.status, 200)
    report = await load('2026-10-29')
    assert.equal(report.rows[0].notes, 'Reviewed')
    assert.equal(report.rows.length, 1001)
    assert.deepEqual(report.warnings, warnings.map((warning) => ({ ...warning, id: `2026-10-29:${warning.id}`, reportDate: '2026-10-29' })))

    await save({ rows: [], warnings, snapshot: true, reportDate: '2026-10-28', sourceFileName: 'empty-day.csv' })
    report = await load('2026-10-28')
    assert.deepEqual(report.rows, [])
    assert.deepEqual(report.warnings, warnings.map((warning) => ({ ...warning, id: `2026-10-28:${warning.id}`, reportDate: '2026-10-28' })))
    assert.ok(report.snapshot)

    await save({ rows: rows.slice(0, 1), warnings: [], snapshot: true, reportDate: '2026-10-29', sourceFileName: 'replacement.csv' })
    report = await load('2026-10-29')
    assert.equal(report.rows.length, 1)
    assert.deepEqual(report.warnings, [])
    assert.equal(report.snapshot.sourceFileName, 'replacement.csv')
    assert.equal(records.size, 2)
    const allReports = await load('')
    assert.equal(allReports.rows.length, 1)
    assert.equal(allReports.rows[0].reportDate, '2026-10-29')
    assert.equal(allReports.warnings[0].reportDate, '2026-10-28')
    assert.equal(allReports.reportCount, 2)

    const workflowRows = [
      { id: 'pending-new', clientName: 'Test Patient', number: '15551234567', treatment: 'Tirzepatide 52mg', medicalForm: 'PENDING' },
      { id: 'ready-new', treatment: 'Semaglutide', medicalForm: 'YES' },
      { id: 'matched-new', treatment: 'Sermorelin', medicalForm: 'PENDING', striveOrderNumber1: '123' },
      { id: 'excluded-new', treatment: 'Subscription GLP-1 Support', medicalForm: 'PENDING' },
    ]
    response = await save({ rows: workflowRows, snapshot: true, workflowComplete: true, reportDate: '2026-11-06' })
    assert.equal(response.status, 200)
    report = await load('2026-11-06')
    assert.deepEqual(report.rows.map((row) => row.id), ['2026-11-06:ready-new', '2026-11-06:matched-new'])
    let pending = await (await fetch(`${apiUrl}/api/orders-history?view=pending`)).json()
    assert.deepEqual(pending.rows.map((row) => row.id), ['2026-11-06:pending-new'])
    response = await save({ action: 'accept-pending', rowId: '2026-11-06:pending-new' })
    assert.equal(response.status, 409)
    response = await save({ action: 'reconcile-pending', medicalRows: [{
      firstName: 'Test', lastName: 'Patient', phone: '15551234567', purchase: 'Tirzepatide 52mg',
      street: '10 Main Street', city: 'Newark', state: 'NJ', zip: '07105',
      purchaseSurveyCompletionDate: '2026-11-07T12:00:00Z',
    }] })
    assert.equal(response.status, 200)
    pending = await response.json()
    assert.equal(pending.rows.length, 1)
    assert.equal(pending.rows[0].medicalForm, 'YES')
    assert.equal(pending.rows[0].address, '10 Main Street')
    assert.equal((await load('2026-11-06')).rows.length, 2)
    response = await save({ action: 'accept-pending', rowId: '2026-11-06:pending-new' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).rows.length, 0)
    assert.equal((await load('2026-11-06')).rows.length, 3)
    response = await save({ action: 'accept-pending', rowId: '2026-11-06:pending-new' })
    assert.equal(response.status, 409)
    await save({ rows: workflowRows.map((row) => row.id === 'pending-new' ? { ...row, medicalForm: 'YES' } : row),
      snapshot: true, workflowComplete: true, reportDate: '2026-11-06' })
    pending = await (await fetch(`${apiUrl}/api/orders-history?view=pending`)).json()
    assert.equal(pending.rows.length, 0)
    assert.equal((await load('2026-11-06')).rows.length, 3)

    failWrites = true
    response = await save({ rows: [], warnings: [], snapshot: true, reportDate: '2026-10-29' })
    assert.equal(response.status, 500)
    assert.match((await response.json()).message, /503/)
    assert.equal((await load('2026-10-29')).rows.length, 1)
  } finally {
    api.kill()
    await once(api, 'exit')
    await new Promise((resolve) => storage.close(resolve))
  }
})
