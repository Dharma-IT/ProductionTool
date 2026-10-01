import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { loadHubSpotOrders } from '../services/hubspotOrders'
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

const ordersAccessPin = '1111'

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
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [pinDigits, setPinDigits] = useState(['', '', '', ''])
  const [pinError, setPinError] = useState('')
  const pinInputRefs = useRef([])
  const [selectedDate, setSelectedDate] = useState(todayIsoDate)
  const [request, setRequest] = useState({ date: todayIsoDate(), sequence: 0 })
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [csvLookup, setCsvLookup] = useState(null)
  const [csvFileName, setCsvFileName] = useState('')
  const [csvError, setCsvError] = useState('')
  const [cellEdits, setCellEdits] = useState({})

  const enrichment = useMemo(
    () => csvLookup ? enrichHubSpotOrders(rows, csvLookup) : { rows, matchedCount: 0 },
    [csvLookup, rows],
  )
  const displayedRows = enrichment.rows
  const treatmentColorLookup = useMemo(() => {
    const lookup = new Map()
    displayedRows.forEach((row) => {
      const treatment = String(cellEdits[row.id]?.treatment ?? row.treatment ?? '')
        .replace(/^\d+x\s+/i, '')
        .trim()
      if (treatment && !lookup.has(treatment)) {
        lookup.set(treatment, treatmentColors[lookup.size % treatmentColors.length])
      }
    })
    return lookup
  }, [cellEdits, displayedRows])

  useEffect(() => {
    if (!isUnlocked) return undefined

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
  }, [isUnlocked, request])

  function checkPin(nextDigits) {
    if (nextDigits.some((digit) => !digit)) return

    if (nextDigits.join('') === ordersAccessPin) {
      setPinError('')
      setStatus('loading')
      setIsUnlocked(true)
      return
    }

    setPinError('Incorrect access code')
    setPinDigits(['', '', '', ''])
    window.setTimeout(() => pinInputRefs.current[0]?.focus(), 0)
  }

  function updatePinDigit(index, value) {
    const digits = value.replace(/\D/g, '')
    const nextDigits = [...pinDigits]

    if (digits.length > 1) {
      digits.slice(0, 4).split('').forEach((digit, digitIndex) => {
        nextDigits[digitIndex] = digit
      })
      setPinDigits(nextDigits)
      checkPin(nextDigits)
      return
    }

    nextDigits[index] = digits.slice(-1)
    setPinDigits(nextDigits)
    setPinError('')
    if (digits && index < 3) pinInputRefs.current[index + 1]?.focus()
    checkPin(nextDigits)
  }

  function handlePinKeyDown(index, event) {
    if (event.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus()
    }
  }

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
      />
    )
  }

  return (
    <section className={`route-view orders-route${isUnlocked ? '' : ' locked'}`} aria-label="Orders dashboard">
      <div className="orders-dashboard-content" aria-hidden={!isUnlocked} inert={!isUnlocked}>
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
                    <td key={header.key}>{renderOrderCell(row, header)}</td>
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
      </div>

      {!isUnlocked && (
        <div className="orders-lock-screen" role="dialog" aria-modal="true" aria-labelledby="orders-lock-title">
          <div className="orders-lock-card">
            <span className="orders-warning-orbit orbit-one" aria-hidden="true" />
            <span className="orders-warning-orbit orbit-two" aria-hidden="true" />
            <div className="orders-warning-icon" aria-hidden="true">!</div>
            <span className="orders-lock-kicker">Restricted preview</span>
            <h2 id="orders-lock-title">Under Construction</h2>
            <div className="orders-pin-inputs" aria-label="Four digit access code">
              {pinDigits.map((digit, index) => (
                <input
                  aria-label={`Access code digit ${index + 1}`}
                  autoComplete="off"
                  autoFocus={index === 0}
                  inputMode="numeric"
                  key={index}
                  maxLength="4"
                  ref={(element) => { pinInputRefs.current[index] = element }}
                  type="password"
                  value={digit}
                  onChange={(event) => updatePinDigit(index, event.target.value)}
                  onKeyDown={(event) => handlePinKeyDown(index, event)}
                />
              ))}
            </div>
            <div className={`orders-pin-feedback${pinError ? ' error' : ''}`} aria-live="polite">
              {pinError || 'Four-digit team access code required'}
            </div>
            <a className="orders-lock-back" href="/home">← Back to dashboard</a>
          </div>
        </div>
      )}
    </section>
  )
}

export default Orders
