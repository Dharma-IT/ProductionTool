import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { loadHubSpotOrders } from '../services/hubspotOrders'
import { loadOrdersHistory, saveOrdersHistory } from '../services/ordersHistory'
import { formatOrderPurchaseDate } from '../services/orderDates'
import {
  buildOrderCsvLookup,
  buildStriveCsvLookup,
  enrichHubSpotOrders,
  enrichStriveOrderNumbers,
  expandHubSpotOrderItems,
  findMedicalFormOrderWarnings,
  validateOrderCsvHeaders,
  validateStriveCsvHeaders,
} from '../services/orderCsvEnrichment'

const orderHeaders = [
  { key: 'number', label: 'Number' },
  { key: 'clientName', label: 'Client Name' },
  { key: 'language', label: 'Language' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'notes', label: 'Notes' },
  { key: 'interval', label: 'Interval' },
  { key: 'purchaseDate', label: 'Purchase Date' },
  { key: 'medicalForm', label: 'Medical Form' },
  { key: 'doctorPrescribed', label: 'Doctor Prescribed' },
  { key: 'prescribedPharmacy', label: 'Prescribed Pharmacy' },
  { key: 'shopifyOrderNumber', label: 'Shopify Order Number' },
  { key: 'perfectOrderNumber1', label: 'Perfect Order Number 1' },
  { key: 'perfectOrderNumber2', label: 'Perfect Order Number 2' },
  { key: 'absoluteOrderNumber', label: 'Absolute Order Number' },
  { key: 'striveOrderNumber1', label: 'Strive Order #' },
  { key: 'striveOrderNumber2', label: 'On Hold Order #' },
  { key: 'futureOrderNumber', label: 'Future Order #' },
  { key: 'shopifyDate', label: 'Shopify Date' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zipCode', label: 'Zip Code' },
  { key: 'addressConfirmed', label: 'Address Confirmed' },
  { key: 'trackingNumber', label: 'Tracking Number - Except Medication' },
  { key: 'csContactDay', label: 'CS Contact Day' },
  { key: 'proposedSecondOrder', label: 'Proposed to Order Second' },
  { key: 'seller', label: 'Seller' },
]

const treatmentColors = [
  '#ead7f5', '#dce8f7', '#ffe8ad', '#ffd3ce', '#dcece3',
  '#e3e5e8', '#d9ecff', '#f8dbec', '#e5e0ff', '#dff0c9',
]

function todayIsoDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function displayCell(row, key) {
  const value = row[key]
  if (!value) return ''
  if (key === 'language' && /^es(?:[-_]|$)/i.test(String(value).trim())) return 'Spanish'
  if (key !== 'purchaseDate') return value

  return formatOrderPurchaseDate(value)
}

function Orders() {
  const [selectedDate, setSelectedDate] = useState(todayIsoDate)
  const [request, setRequest] = useState({ date: todayIsoDate(), sequence: 0 })
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [csvLookup, setCsvLookup] = useState(null)
  const [csvFileName, setCsvFileName] = useState('')
  const [csvError, setCsvError] = useState('')
  const [striveCsvLookup, setStriveCsvLookup] = useState(null)
  const [striveCsvFileName, setStriveCsvFileName] = useState('')
  const [striveCsvError, setStriveCsvError] = useState('')
  const [cellEdits, setCellEdits] = useState({})
  const [activeView, setActiveView] = useState('current')
  const [historyRows, setHistoryRows] = useState([])
  const [historyReport, setHistoryReport] = useState(null)
  const [historyStatus, setHistoryStatus] = useState('idle')
  const [autoSaveMessage, setAutoSaveMessage] = useState('')
  const saveQueue = useRef(Promise.resolve())
  const queueSnapshotSave = useCallback((snapshot) => {
    const next = saveQueue.current.catch(() => {}).then(() => saveOrdersHistory(
      snapshot.rows, snapshot.reportDate, snapshot.sourceFileName,
      { snapshot: true, warnings: snapshot.warnings },
    ))
    saveQueue.current = next
    return next
  }, [])
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')

  const enrichment = useMemo(
    () => csvLookup ? enrichHubSpotOrders(rows, csvLookup) : { rows, matchedCount: 0 },
    [csvLookup, rows],
  )
  const striveEnrichment = useMemo(
    () => striveCsvLookup
      ? enrichStriveOrderNumbers(enrichment.rows, striveCsvLookup)
      : { rows: enrichment.rows, matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0 },
    [enrichment, striveCsvLookup],
  )
  const displayedRows = striveEnrichment.rows
  const medicalWarnings = useMemo(
    () => csvLookup ? findMedicalFormOrderWarnings(rows, csvLookup) : [],
    [rows, csvLookup],
  )
  const visibleRows = activeView === 'history' ? historyRows : displayedRows
  const visibleHeaders = activeView === 'history'
    ? [...orderHeaders, { key: 'reportDate', label: 'Report Date' }]
    : orderHeaders
  const visibleWarnings = activeView === 'history' ? historyReport?.warnings ?? [] : medicalWarnings
  const snapshotPayload = useMemo(() => ({
    rows: displayedRows, reportDate: request.date, sourceFileName: csvFileName, warnings: medicalWarnings,
  }), [displayedRows, request.date, csvFileName, medicalWarnings])

  useEffect(() => {
    if (status !== 'ready' || !csvLookup) return undefined
    let active = true
    queueSnapshotSave(snapshotPayload)
      .then(() => { if (active) setAutoSaveMessage(`Automatically saved for ${snapshotPayload.reportDate}.`) })
      .catch((saveError) => { if (active) setAutoSaveMessage(`Automatic save failed: ${saveError.message}. Use Save final result to retry.`) })
    return () => { active = false }
  }, [status, csvLookup, snapshotPayload, queueSnapshotSave])
  const treatmentColorLookup = useMemo(() => {
    const lookup = new Map()
    visibleRows.forEach((row) => {
      const treatment = String(cellEdits[row.id]?.treatment ?? row.treatment ?? '')
        .replace(/^\d+x\s+/i, '')
        .trim()
      if (treatment && !lookup.has(treatment)) {
        lookup.set(treatment, treatmentColors[lookup.size % treatmentColors.length])
      }
    })
    return lookup
  }, [cellEdits, visibleRows])

  useEffect(() => {
    if (activeView !== 'history') return undefined
    let active = true
    saveQueue.current.catch(() => {}).then(() => loadOrdersHistory())
      .then((report) => {
        if (!active) return
        setHistoryRows(report.rows)
        setHistoryReport(report)
        setHistoryStatus('ready')
      })
      .catch((loadError) => {
        if (!active) return
        setHistoryStatus('error')
        setSaveMessage(loadError.message)
      })
    return () => { active = false }
  }, [activeView])

  useEffect(() => {
    let active = true

    loadHubSpotOrders(request.date)
      .then((report) => {
        if (!active) return
        setRows(expandHubSpotOrderItems(report.rows ?? []))
        setStatus('ready')
      })
      .catch((loadError) => {
        if (!active) return
        setRows([])
        setError(loadError.message)
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [request])

  function submitDate(event) {
    event.preventDefault()
    setStatus('loading')
    setError('')
    setCsvLookup(null)
    setAutoSaveMessage('')
    setCsvFileName('')
    setCsvError('')
    setStriveCsvLookup(null)
    setStriveCsvFileName('')
    setStriveCsvError('')
    setRequest((current) => ({ date: selectedDate, sequence: current.sequence + 1 }))
  }

  async function uploadCsv(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setCsvError('')
    setStriveCsvLookup(null)
    setStriveCsvFileName('')
    setStriveCsvError('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!worksheet) throw new Error('The CSV does not contain a readable worksheet.')

      const csvRows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false })
      if (!csvRows.length) throw new Error('The CSV does not contain any customer rows.')

      const headers = Object.keys(csvRows[0]).map((header) => header.trim())
      const missingHeaders = validateOrderCsvHeaders(headers)
      if (missingHeaders.length) {
        throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`)
      }

      setCsvLookup(buildOrderCsvLookup(csvRows))
      setCsvFileName(file.name)
      setAutoSaveMessage('Saving uploaded report automatically...')
    } catch (uploadError) {
      setCsvError(uploadError instanceof Error ? uploadError.message : 'Unable to read this CSV file.')
    } finally {
      event.target.value = ''
    }
  }

  async function uploadStriveCsv(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setStriveCsvError('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!worksheet) throw new Error('The Strive CSV does not contain a readable worksheet.')

      const csvRows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false })
      if (!csvRows.length) throw new Error('The Strive CSV does not contain any order rows.')

      const headers = Object.keys(csvRows[0]).map((header) => header.trim())
      const missingHeaders = validateStriveCsvHeaders(headers)
      if (missingHeaders.length) {
        throw new Error(`Missing required Strive columns: ${missingHeaders.join(', ')}`)
      }

      setStriveCsvLookup(buildStriveCsvLookup(csvRows))
      setStriveCsvFileName(file.name)
    } catch (uploadError) {
      setStriveCsvError(uploadError instanceof Error ? uploadError.message : 'Unable to read this Strive CSV file.')
    } finally {
      event.target.value = ''
    }
  }

  function readEditableValue(row, key) {
    return Object.hasOwn(cellEdits[row.id] ?? {}, key)
      ? cellEdits[row.id][key]
      : displayCell(row, key)
  }

  function updateCell(rowId, key, value) {
    setCellEdits((current) => ({
      ...current,
      [rowId]: { ...current[rowId], [key]: value },
    }))
  }

  function materializeRow(row) {
    return Object.fromEntries([
      ['id', row.id],
      ['rowId', row.rowId],
      ['reportDate', row.reportDate],
      ['sourceFileName', row.sourceFileName],
      ['importedAt', row.importedAt],
      ...orderHeaders.map(({ key }) => [
        key,
        Object.hasOwn(cellEdits[row.id] ?? {}, key) ? cellEdits[row.id][key] : displayCell(row, key),
      ]),
    ])
  }

  function exportVisibleRows(format) {
    if (visibleRows.length === 0) return

    const exportRows = visibleRows.map((row) => Object.fromEntries(
      visibleHeaders.map(({ key, label }) => [label, readEditableValue(row, key)]),
    ))
    const worksheet = XLSX.utils.json_to_sheet(exportRows, {
      header: visibleHeaders.map(({ label }) => label),
    })
    worksheet['!cols'] = visibleHeaders.map(({ label }) => ({
      wch: Math.min(50, Math.max(label.length + 2, 14)),
    }))

    const reportDate = activeView === 'history' ? 'all-dates' : request.date
    const filename = `orders-${activeView}-${reportDate}`

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(worksheet)
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = `${filename}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      return
    }

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders')
    XLSX.writeFile(workbook, `${filename}.xlsx`)
  }

  async function saveFinalResult() {
    setSaveStatus('saving')
    setSaveMessage('')
    try {
      await queueSnapshotSave({ ...snapshotPayload, rows: displayedRows.map(materializeRow) })
      setSaveMessage(`${displayedRows.length} rows saved to historical data.`)
    } catch (saveError) {
      setSaveMessage(saveError.message || 'Could not save orders history.')
    } finally {
      setSaveStatus('idle')
    }
  }

  async function saveHistoryRow(row) {
    if (!cellEdits[row.id]) return
    setSaveStatus('saving')
    setSaveMessage('')
    try {
      const savedRows = await saveOrdersHistory([materializeRow(row)], row.reportDate, row.sourceFileName)
      setHistoryRows((current) => current.map((existing) =>
        savedRows.find((saved) => saved.id === existing.id) ?? existing))
      setCellEdits((current) => {
        const next = { ...current }
        delete next[row.id]
        return next
      })
      setSaveMessage('History change saved.')
    } catch (saveError) {
      setSaveMessage(saveError.message || 'Could not update orders history.')
    } finally {
      setSaveStatus('idle')
    }
  }

  function renderOrderCell(row, header) {
    const editableValue = readEditableValue(row, header.key)
    if (header.key === 'reportDate') return <span>{row.reportDate}</span>

    if (header.key === 'treatment') {
      const treatmentName = String(editableValue).replace(/^\d+x\s+/i, '').trim()
      return (
        <input
          aria-label={`Treatment for ${row.clientName}`}
          className="orders-treatment-pill"
          style={{ '--treatment-color': treatmentColorLookup.get(treatmentName) }}
          title={editableValue}
          type="text"
          value={editableValue}
          onChange={(event) => updateCell(row.id, header.key, event.target.value)}
          onBlur={() => activeView === 'history' && saveHistoryRow(row)}
        />
      )
    }

    if (header.key === 'medicalForm' || header.key === 'doctorPrescribed') {
      const savedStatus = String(editableValue ?? '').trim()
      const statuses = ['Yes', 'Pending', 'Mismatch', 'No']
      const selectedStatus = statuses.find((value) => value.toLowerCase() === savedStatus.toLowerCase()) ?? savedStatus
      return (
        <select
          aria-label={`${header.label} for ${row.clientName}`}
          className={`orders-status-select ${selectedStatus.toLowerCase()}`}
          value={selectedStatus}
          onChange={(event) => updateCell(row.id, header.key, event.target.value)}
          onBlur={() => activeView === 'history' && saveHistoryRow(row)}
        >
          <option value="">{header.key === 'medicalForm' ? '' : 'Select'}</option>
          <option value="Yes">Yes</option>
          <option value="Pending">Pending</option>
          {(header.key === 'medicalForm' || selectedStatus === 'Mismatch') && <option value="Mismatch">Mismatch</option>}
          <option value="No">No</option>
          {selectedStatus && !statuses.includes(selectedStatus) && <option value={selectedStatus}>{selectedStatus}</option>}
        </select>
      )
    }

    return (
      <input
        aria-label={`${header.label} for ${row.clientName}`}
        className="orders-cell-input"
        type="text"
        value={editableValue}
        onChange={(event) => updateCell(row.id, header.key, event.target.value)}
        onBlur={() => activeView === 'history' && saveHistoryRow(row)}
      />
    )
  }

  return (
    <section className="route-view orders-route" aria-label="Orders dashboard">
      <div className="orders-dashboard-content">
        <div className="report-toolbar">
        <div>
          <h1 id="orders-title">Orders</h1>
          <p>Order details and production workflow.</p>
        </div>
        </div>

        <div className="orders-view-tabs" aria-label="Orders views">
          <button className={activeView === 'current' ? 'active' : ''} type="button" onClick={() => setActiveView('current')}>Current orders</button>
          <button className={activeView === 'history' ? 'active' : ''} type="button" onClick={() => { if (activeView === 'history') return; setHistoryStatus('loading'); setHistoryRows([]); setHistoryReport(null); setActiveView('history') }}>Historical data</button>
        </div>

        {activeView === 'current' ? <form className="report-filters" aria-label="Orders date filter" onSubmit={submitDate}>
        <span className="filter-label">Paid Date (All Pipelines)</span>
        <input
          aria-label="Paid date"
          className="date-filter-input"
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
        />
        <button className="filter-button" disabled={!selectedDate || status === 'loading'} type="submit">
          {status === 'loading' ? 'Loading…' : 'Load orders'}
        </button>
        {status === 'ready' && <span className="timezone-pill">{rows.length} product rows</span>}
        <label className="filter-button orders-upload-button">
          Upload customer CSV
          <input accept=".csv,text/csv" onChange={uploadCsv} type="file" />
        </label>
        {csvFileName && (
          <span className="orders-upload-status" title={csvFileName}>
            {csvFileName} · {enrichment.matchedCount}/{rows.length} matched
          </span>
        )}
        <label className={`filter-button orders-upload-button ${status !== 'ready' || !csvLookup ? 'disabled' : ''}`}>
          Upload Strive CSV
          <input
            accept=".csv,text/csv"
            disabled={status !== 'ready' || !csvLookup}
            onChange={uploadStriveCsv}
            type="file"
          />
        </label>
        {striveCsvFileName && (
          <span className="orders-upload-status" title={striveCsvFileName}>
            {striveCsvFileName} · {striveEnrichment.matchedCount}/{displayedRows.length} matched · {striveEnrichment.unmatchedCount} unmatched · {striveEnrichment.ambiguousCount} medication mismatch
          </span>
        )}
        <button className="filter-button orders-save-button" disabled={status !== 'ready' || !csvLookup || saveStatus === 'saving'} type="button" onClick={saveFinalResult}>
          {saveStatus === 'saving' ? 'Saving…' : 'Save final result'}
        </button>
        <select
          aria-label="Export current orders"
          className="orders-export-select"
          defaultValue=""
          disabled={visibleRows.length === 0}
          onChange={(event) => {
            exportVisibleRows(event.target.value)
            event.target.value = ''
          }}
        >
          <option disabled value="">Export…</option>
          <option value="csv">CSV</option>
          <option value="xlsx">Excel (.xlsx)</option>
        </select>
        </form> : (
          <div className="report-filters" aria-label="Orders history">
            <span className="filter-label">All saved orders · Newest report date first</span>
            <span className="timezone-pill">{historyRows.length} saved rows</span>
            {saveStatus === 'saving' && <span className="orders-upload-status">Saving change…</span>}
            <select
              aria-label="Export historical orders"
              className="orders-export-select"
              defaultValue=""
              disabled={visibleRows.length === 0}
              onChange={(event) => {
                exportVisibleRows(event.target.value)
                event.target.value = ''
              }}
            >
              <option disabled value="">Export…</option>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (.xlsx)</option>
            </select>
          </div>
        )}

        {error && <div className="report-alert" role="alert">{error}</div>}
        {csvError && <div className="report-alert" role="alert">{csvError}</div>}
        {striveCsvError && <div className="report-alert" role="alert">{striveCsvError}</div>}
        {saveMessage && <div className="orders-save-message" role="status">{saveMessage}</div>}
        {activeView === 'current' && autoSaveMessage && <div className="orders-save-message" role="status">{autoSaveMessage}</div>}

        {((activeView === 'current' && status === 'ready' && csvLookup) || (activeView === 'history' && historyReport?.reportCount > 0)) && (
          <section className="orders-reconciliation" aria-labelledby="orders-reconciliation-title">
            <div className="orders-reconciliation-heading">
              <div>
                <h2 id="orders-reconciliation-title">Medical forms missing from fetched orders</h2>
                <p>{activeView === 'history'
                  ? 'Saved warnings across all report dates, newest first.'
                  : `Comparing all medical records in ${csvFileName} with HubSpot orders fetched for ${request.date}.`}</p>
              </div>
              <strong role="status">{visibleWarnings.length} to review</strong>
            </div>
            <p>A warning means the patient or medication/dose was not found in its report date's fetched items. The transaction may be on another date. NAD+ capsules and supplements are excluded.</p>
            {visibleWarnings.length > 0 ? (
              <div className="orders-reconciliation-scroll">
                <table className="client-table">
                  <thead><tr>
                    <th scope="col">Portal patient</th><th scope="col">Phone</th>
                    <th scope="col">Medical form product</th><th scope="col">Form completed</th>
                    <th scope="col">Warning</th>
                    {activeView === 'history' && <th scope="col">Report Date</th>}
                  </tr></thead>
                  <tbody>{visibleWarnings.map((warning) => (
                    <tr key={warning.id}>
                      <td>{warning.clientName || 'Name unavailable'}</td><td>{warning.number || 'Phone unavailable'}</td>
                      <td>{warning.treatment}</td><td>{warning.completionDate || 'Not provided'}</td>
                      <td>{warning.reason}</td>
                      {activeView === 'history' && <td>{warning.reportDate}</td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p role="status">All medical-form records have matching fetched items.</p>}
          </section>
        )}

        <div className={`table-panel orders-panel ${activeView === 'history' ? 'orders-history-panel' : ''}`}>
          <div className="table-shell">
          <table className="client-table orders-table">
            <thead>
              <tr>
                {visibleHeaders.map((header) => (
                  <th key={header.key} scope="col">{header.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  {visibleHeaders.map((header) => (
                    <td key={header.key}>{renderOrderCell(row, header)}</td>
                  ))}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={visibleHeaders.length}>
                    {activeView === 'history'
                      ? historyStatus === 'loading' ? 'Loading saved orders...' : historyStatus === 'error' ? 'Could not load saved orders' : 'No historical data saved'
                      : status === 'loading' ? 'Loading HubSpot orders…' : 'No paid orders found for this date'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

    </section>
  )
}

export default Orders
