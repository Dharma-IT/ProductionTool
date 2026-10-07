import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { loadHubSpotOrders } from '../services/hubspotOrders'
import { loadOrdersHistory, saveOrdersHistory } from '../services/ordersHistory'
import {
  buildOrderCsvLookup,
  enrichHubSpotOrders,
  expandHubSpotOrderItems,
  validateOrderCsvHeaders,
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
  { key: 'striveOrderNumber1', label: 'Strive Order Number 1' },
  { key: 'striveOrderNumber2', label: 'Strive Order Number 2' },
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

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).format(date)
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
  const [cellEdits, setCellEdits] = useState({})
  const [activeView, setActiveView] = useState('current')
  const [historyDate, setHistoryDate] = useState(todayIsoDate)
  const [historyRows, setHistoryRows] = useState([])
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')

  const enrichment = useMemo(
    () => csvLookup ? enrichHubSpotOrders(rows, csvLookup) : { rows, matchedCount: 0 },
    [csvLookup, rows],
  )
  const displayedRows = enrichment.rows
  const visibleRows = activeView === 'history' ? historyRows : displayedRows
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
    loadOrdersHistory(historyDate)
      .then((loadedRows) => { if (active) setHistoryRows(loadedRows) })
      .catch((loadError) => { if (active) setSaveMessage(loadError.message) })
    return () => { active = false }
  }, [activeView, historyDate])

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
    setRequest((current) => ({ date: selectedDate, sequence: current.sequence + 1 }))
  }

  async function uploadCsv(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setCsvError('')

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
    } catch (uploadError) {
      setCsvError(uploadError instanceof Error ? uploadError.message : 'Unable to read this CSV file.')
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

  async function saveFinalResult() {
    setSaveStatus('saving')
    setSaveMessage('')
    try {
      await saveOrdersHistory(displayedRows.map(materializeRow), request.date, csvFileName)
      setHistoryDate(request.date)
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
      const savedRows = await saveOrdersHistory([materializeRow(row)], row.reportDate || historyDate, row.sourceFileName)
      setHistoryRows(savedRows)
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
      return (
        <select
          aria-label={`${header.label} for ${row.clientName}`}
          className={`orders-status-select ${String(editableValue).toLowerCase()}`}
          value={editableValue}
          onChange={(event) => updateCell(row.id, header.key, event.target.value)}
          onBlur={() => activeView === 'history' && saveHistoryRow(row)}
        >
          <option value="">{header.key === 'medicalForm' ? '' : 'Select'}</option>
          <option value="Yes">Yes</option>
          <option value="Pending">Pending</option>
          <option value="No">No</option>
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
          <button className={activeView === 'history' ? 'active' : ''} type="button" onClick={() => setActiveView('history')}>Historical data</button>
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
        <button className="filter-button orders-save-button" disabled={!csvLookup || displayedRows.length === 0 || saveStatus === 'saving'} type="button" onClick={saveFinalResult}>
          {saveStatus === 'saving' ? 'Saving…' : 'Save final result'}
        </button>
        </form> : (
          <div className="report-filters" aria-label="Orders history date filter">
            <span className="filter-label">Saved report date</span>
            <input aria-label="Saved report date" className="date-filter-input" type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
            <span className="timezone-pill">{historyRows.length} saved rows</span>
            {saveStatus === 'saving' && <span className="orders-upload-status">Saving change…</span>}
          </div>
        )}

        {error && <div className="report-alert" role="alert">{error}</div>}
        {csvError && <div className="report-alert" role="alert">{csvError}</div>}
        {saveMessage && <div className="orders-save-message" role="status">{saveMessage}</div>}

        <div className="table-panel orders-panel">
          <div className="table-shell">
          <table className="client-table orders-table">
            <thead>
              <tr>
                {orderHeaders.map((header) => (
                  <th key={header.key} scope="col">{header.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  {orderHeaders.map((header) => (
                    <td key={header.key}>{renderOrderCell(row, header)}</td>
                  ))}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={orderHeaders.length}>
                    {activeView === 'history'
                      ? 'No historical data saved for this date'
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
