import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { loadHubSpotOrders } from '../services/hubspotOrders'
import {
  buildOrderCsvLookup,
  enrichHubSpotOrders,
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

function todayIsoDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function displayCell(row, key) {
  const value = row[key]
  if (!value) return ''
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

  const enrichment = useMemo(
    () => csvLookup ? enrichHubSpotOrders(rows, csvLookup) : { rows, matchedCount: 0 },
    [csvLookup, rows],
  )
  const displayedRows = enrichment.rows

  useEffect(() => {
    let active = true

    loadHubSpotOrders(request.date)
      .then((report) => {
        if (!active) return
        setRows(report.rows ?? [])
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

  return (
    <section className="route-view" aria-label="Orders dashboard">
      <div className="report-toolbar">
        <div>
          <h1 id="orders-title">Orders</h1>
          <p>Order details and production workflow.</p>
        </div>
      </div>

      <form className="report-filters" aria-label="Orders date filter" onSubmit={submitDate}>
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
        {status === 'ready' && <span className="timezone-pill">{rows.length} orders</span>}
        <label className="filter-button orders-upload-button">
          Upload customer CSV
          <input accept=".csv,text/csv" onChange={uploadCsv} type="file" />
        </label>
        {csvFileName && (
          <span className="orders-upload-status" title={csvFileName}>
            {csvFileName} · {enrichment.matchedCount}/{rows.length} matched
          </span>
        )}
      </form>

      {error && <div className="report-alert" role="alert">{error}</div>}
      {csvError && <div className="report-alert" role="alert">{csvError}</div>}

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
              {displayedRows.map((row) => (
                <tr key={row.id}>
                  {orderHeaders.map((header) => (
                    <td key={header.key}>{displayCell(row, header.key)}</td>
                  ))}
                </tr>
              ))}
              {displayedRows.length === 0 && (
                <tr>
                  <td colSpan={orderHeaders.length}>
                    {status === 'loading' ? 'Loading HubSpot orders…' : 'No paid orders found for this date'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default Orders
