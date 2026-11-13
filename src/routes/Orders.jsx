import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { readOrderCsvWorkbook } from '../services/orderCsvReader'
import { loadHubSpotOrders } from '../services/hubspotOrders'
import { acceptPendingMedicalForm, loadOrdersHistory, loadPendingMedicalForms, reconcilePendingMedicalForms, saveOrdersHistory } from '../services/ordersHistory'
import { formatOrderPurchaseDate } from '../services/orderDates'
import { isOrderHistoryEligible } from '../services/orderHistoryEligibility'
import { isCompletedOrder } from '../services/pendingMedicalForms'
import { formatOrderExportValue, getOrderExportHeaders } from '../services/orderExport'
import {
  buildOrderCsvLookup,
  buildStriveCsvLookup,
  enrichHubSpotOrders,
  enrichStriveOrderNumbers,
  expandHubSpotOrderItems,
  findMedicalFormOrderWarnings,
  normalizeOrderStatus,
  normalizeOrderStatuses,
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
  const value = normalizeOrderStatus(row[key])
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
  const [medicalUploadRows, setMedicalUploadRows] = useState(null)
  const [csvFileName, setCsvFileName] = useState('')
  const [csvError, setCsvError] = useState('')
  const [striveCsvLookup, setStriveCsvLookup] = useState(null)
  const [striveCsvFileName, setStriveCsvFileName] = useState('')
  const [striveCsvError, setStriveCsvError] = useState('')
  const [cellEdits, setCellEdits] = useState({})
  const [activeView, setActiveView] = useState('current')
  const [historyRows, setHistoryRows] = useState([])
  const [savedPendingRows, setSavedPendingRows] = useState([])
  const [pendingStatus, setPendingStatus] = useState('idle')
  const [historyReport, setHistoryReport] = useState(null)
  const [historyStatus, setHistoryStatus] = useState('idle')
  const [autoSaveMessage, setAutoSaveMessage] = useState('')
  const saveQueue = useRef(Promise.resolve())
  const queueSnapshotSave = useCallback((snapshot) => {
    const next = saveQueue.current.catch(() => {}).then(() => saveOrdersHistory(
      snapshot.rows, snapshot.reportDate, snapshot.sourceFileName,
      { snapshot: true, warnings: snapshot.warnings, workflowComplete: snapshot.workflowComplete },
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
  const displayedRows = useMemo(() => striveEnrichment.rows.map(normalizeOrderStatuses), [striveEnrichment.rows])
  const medicalWarnings = useMemo(
    () => csvLookup ? findMedicalFormOrderWarnings(rows, csvLookup, request.date, savedPendingRows, historyRows) : [],
    [rows, csvLookup, request.date, savedPendingRows, historyRows],
  )
  const pendingMedicalRows = savedPendingRows
  const historicalRows = historyRows.filter((row) =>
    isOrderHistoryEligible(row) && (normalizeOrderStatus(cellEdits[row.id]?.medicalForm ?? row.medicalForm) !== 'PENDING'
      || isCompletedOrder({ ...row, ...cellEdits[row.id] })))
  const visibleRows = activeView === 'history' ? historicalRows
    : activeView === 'pending' ? pendingMedicalRows : displayedRows
  const visibleHeaders = activeView === 'history'
    ? [...orderHeaders, { key: 'reportDate', label: 'Report Date' }]
    : orderHeaders
  const visibleWarnings = activeView === 'history' ? historyReport?.warnings ?? [] : medicalWarnings
  const snapshotPayload = useMemo(() => ({
    rows: displayedRows, reportDate: request.date, sourceFileName: csvFileName, warnings: medicalWarnings,
    workflowComplete: Boolean(csvLookup && striveCsvLookup),
  }), [displayedRows, request.date, csvFileName, medicalWarnings, csvLookup, striveCsvLookup])

  useEffect(() => {
    if (status !== 'ready' || !csvLookup || !striveCsvLookup) return undefined
    let active = true
    queueSnapshotSave(snapshotPayload)
      .then(() => { if (active) setAutoSaveMessage(`Automatically saved for ${snapshotPayload.reportDate}: pending medical forms to Pending, YES or Strive-matched orders to Historical data.`) })
      .catch((saveError) => { if (active) setAutoSaveMessage(`Automatic save failed: ${saveError.message}. Use Save final result to retry.`) })
    return () => { active = false }
  }, [status, csvLookup, striveCsvLookup, snapshotPayload, queueSnapshotSave])
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
    let active = true
    saveQueue.current.catch(() => {}).then(() => loadPendingMedicalForms()).then((report) => {
      if (active) { setSavedPendingRows(report.rows); setPendingStatus('ready') }
    }).catch((loadError) => {
      if (active) { setPendingStatus('error'); setSaveMessage(loadError.message) }
    })
    return () => { active = false }
  }, [activeView])

  useEffect(() => {
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
    setMedicalUploadRows(null)
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
      const workbook = readOrderCsvWorkbook(await file.arrayBuffer())
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
      setMedicalUploadRows(csvRows)
      setCsvFileName(file.name)
      setAutoSaveMessage('Medical forms imported. Upload the Strive file to automatically save both tabs.')
      const pendingReport = await reconcilePendingMedicalForms(csvRows)
      setSavedPendingRows(pendingReport.rows)
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
      const workbook = readOrderCsvWorkbook(await file.arrayBuffer())
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
      if (medicalUploadRows) {
        const pendingReport = await reconcilePendingMedicalForms(medicalUploadRows, csvRows)
        setSavedPendingRows(pendingReport.rows)
      }
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

  async function acceptPending(row) {
    setSaveStatus('saving')
    setSaveMessage('')
    try {
      const report = await acceptPendingMedicalForm(row.rowId || row.id)
      setSavedPendingRows(report.rows)
      setSaveMessage(`${row.clientName} accepted and saved to Historical data.`)
    } catch (saveError) {
      setSaveMessage(saveError.message)
    } finally {
      setSaveStatus('idle')
    }
  }

  function updateCell(rowId, key, value) {
    setCellEdits((current) => ({
      ...current,
      [rowId]: { ...current[rowId], [key]: normalizeOrderStatus(value) },
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

    const exportHeaders = getOrderExportHeaders(visibleHeaders)
    const exportRows = visibleRows.map((row) => Object.fromEntries(
      exportHeaders.map(({ key, label }) => [label, formatOrderExportValue(key, readEditableValue(row, key))]),
    ))
    const worksheet = XLSX.utils.json_to_sheet(exportRows, {
      header: exportHeaders.map(({ label }) => label),
    })
    worksheet['!cols'] = exportHeaders.map(({ label }) => ({
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
      const rowsToSave = displayedRows.map(materializeRow).filter(isOrderHistoryEligible)
      await queueSnapshotSave({ ...snapshotPayload, rows: rowsToSave })
      setSaveMessage(`${rowsToSave.length} rows saved to historical data.`)
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
    if (activeView === 'pending') return <span>{displayCell(row, header.key)}</span>
    if (row.recordType === 'pending-medical-form-import') return <span>{displayCell(row, header.key)}</span>
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
      const statuses = ['YES', 'PENDING', 'Mismatch', 'NO']
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
          <option value="YES">YES</option>
          <option value="PENDING">PENDING</option>
          {(header.key === 'medicalForm' || selectedStatus === 'Mismatch') && <option value="Mismatch">Mismatch</option>}
          <option value="NO">NO</option>
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
          <button className={activeView === 'pending' ? 'active' : ''} type="button" onClick={() => { if (activeView !== 'pending') setPendingStatus('loading'); setActiveView('pending') }}>Pending medical forms ({pendingMedicalRows.length})</button>
          <button className={activeView === 'history' ? 'active' : ''} type="button" onClick={() => { if (activeView === 'history') return; setHistoryStatus('loading'); setHistoryRows([]); setHistoryReport(null); setActiveView('history') }}>Historical data</button>
        </div>

        {activeView !== 'history' ? <form className="report-filters" aria-label="Orders date filter" onSubmit={submitDate}>
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
        <button className="filter-button orders-save-button" disabled={status !== 'ready' || !csvLookup || !striveCsvLookup || saveStatus === 'saving'} type="button" onClick={saveFinalResult}>
          {saveStatus === 'saving' ? 'Saving…' : 'Save final result'}
        </button>
        <select
          aria-label={activeView === 'pending' ? 'Export pending medical forms' : 'Export current orders'}
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
            <span className="timezone-pill">{historicalRows.length} saved rows</span>
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

        {activeView === 'pending' && (
          <p role="status">{pendingStatus === 'loading' ? 'Loading saved pending medical forms…' : pendingStatus === 'error' ? 'Could not load saved pending medical forms.' : `${savedPendingRows.length} imported pending medical forms across all dates.`}</p>
        )}

        {activeView === 'current' && status === 'ready' && csvLookup && (
          <section className="orders-reconciliation" aria-labelledby="orders-reconciliation-title">
            <div className="orders-reconciliation-heading">
              <div>
                <h2 id="orders-reconciliation-title">Medical forms missing from fetched orders</h2>
                <p>{activeView === 'history'
                  ? 'Saved warnings across all report dates, newest first.'
                  : `Comparing medical forms completed on ${request.date} (UTC) in ${csvFileName} with HubSpot orders fetched for the same date.`}</p>
              </div>
              <strong role="status">{visibleWarnings.length} to review</strong>
            </div>
            <p>Forms absent from current orders are checked against Pending and Historical data. Last Purchase Date shows the latest matching purchase on or before the form completion date (UTC). NAD+ capsules and supplements are excluded.</p>
            {visibleWarnings.length > 0 ? (
              <div className="orders-reconciliation-scroll">
                <table className="client-table">
                  <thead><tr>
                    <th scope="col">Portal patient</th><th scope="col">Phone</th>
                    <th scope="col">Medical form product</th><th scope="col">Form completed</th>
                    <th scope="col">Last Purchase Date</th><th scope="col">Status</th>
                    {activeView === 'history' && <th scope="col">Report Date</th>}
                  </tr></thead>
                  <tbody>{visibleWarnings.map((warning) => (
                    <tr key={warning.id}>
                      <td>{warning.clientName || 'Name unavailable'}</td><td>{warning.number || 'Phone unavailable'}</td>
                      <td>{warning.treatment}</td><td>{warning.completionDate || 'Not provided'}</td>
                      <td>{warning.lastPurchaseDate ? formatOrderPurchaseDate(warning.lastPurchaseDate) : 'Not found'}</td>
                      <td>{warning.reason}</td>
                      {activeView === 'history' && <td>{warning.reportDate}</td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p role="status">No missing medical-form records for {activeView === 'history' ? 'the saved report dates' : request.date}.</p>}
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
                {activeView === 'pending' && <th scope="col">Review</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  {visibleHeaders.map((header) => (
                    <td key={header.key}>{renderOrderCell(row, header)}</td>
                  ))}
                  {activeView === 'pending' && <td>
                    <span>{row.pendingFormFound ? 'Found on pending' : 'Awaiting medical form'}</span>
                    {row.pendingFormFound && <button type="button" className="filter-button"
                      disabled={saveStatus === 'saving' || row.medicalForm !== 'YES'}
                      onClick={() => acceptPending(row)}>Accept</button>}
                    {row.pendingFormFound && row.medicalForm !== 'YES' && <span>Complete address required</span>}
                  </td>}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={visibleHeaders.length + (activeView === 'pending' ? 1 : 0)}>
                    {activeView === 'history'
                      ? historyStatus === 'loading' ? 'Loading saved orders...' : historyStatus === 'error' ? 'Could not load saved orders' : 'No historical data saved'
                      : status === 'loading' ? 'Loading HubSpot orders…'
                        : activeView === 'pending' ? 'No pending medical forms for this date' : 'No paid orders found for this date'}
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
