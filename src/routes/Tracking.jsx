import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { loadAllShopifyTracking } from '../services/shopifyTracking'
import { countOpenDays, getNormalizedTrackingStatus, getOrderWarningSummary, getTrackingOrderKey, overdueDaysThreshold, parseTrackingDate } from '../services/trackingAnalytics'

const trackingHeaders = [
  'Order Number',
  'Supliful Order',
  'Item',
  'Name',
  'Phone',
  'Date',
  'Date shipped',
  'Tracking',
  'Delivery Date',
  'Status',
]
const trackingRowsPageSize = 100
const trackingAutoRefreshMs = 5 * 60 * 1000

const trackingExportFields = [
  ['Order Number', 'orderNumber'],
  ['Supliful Order', 'suplifulOrder'],
  ['Item', 'item'],
  ['Name', 'name'],
  ['Phone', 'phone'],
  ['Date', 'date'],
  ['Date shipped', 'dateShipped'],
  ['Tracking', 'tracking'],
  ['Delivery Date', 'deliveryDate'],
  ['Status', 'status'],
]

function displayCell(value) {
  return value || '-'
}

function renderTrackingNumbers(value, uspsUrl) {
  const trackingNumbers = String(value ?? '')
    .split(',')
    .map((trackingNumber) => trackingNumber.trim())
    .filter(Boolean)

  if (trackingNumbers.length === 0) return '-'

  return trackingNumbers.map((trackingNumber) => (
    <a
      className="tracking-number-link"
      href={uspsUrl || `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`}
      key={trackingNumber}
      rel="noreferrer"
      target="_blank"
    >
      {trackingNumber}
    </a>
  ))
}

function getTrackingStatusClass(value) {
  const normalizedStatus = String(value ?? '').toLowerCase()

  if (normalizedStatus.includes('failed')) return 'failed'
  if (normalizedStatus.includes('delivered')) return 'delivered'
  if (normalizedStatus.includes('transit')) return 'transit'
  if (normalizedStatus.includes('progress')) return 'progress'

  return 'blank'
}

function getStatusSourceLabel(value) {
  if (value === 'usps') return 'Updated from USPS tracking'
  if (value === 'shopify') return 'Updated from Shopify fulfillment status'
  if (value === 'manual') return 'Manually marked delivered'

  return 'Updated from Google Sheet'
}

function getTrackingSourceLabel(value) {
  if (value === 'supabase') return 'Supabase'
  if (value === 'shopify') return 'Live Shopify'

  return 'Sample'
}

function Tracking() {
  const [report, setReport] = useState({ source: 'supabase', rows: [] })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const [exportFormat, setExportFormat] = useState('xlsx')
  const [search, setSearch] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [refreshRequest, setRefreshRequest] = useState({ live: false, version: 0 })
  const activeReport = report
  const activeStatus = status
  const activeError = error

  useEffect(() => {
    const controller = new AbortController()
    let running = false
    async function load(live = false) {
      if (running) return
      running = true
      setStatus('loading')
      setComplete(false)
      setError('')
      try {
        const data = await loadAllShopifyTracking({
          forceRefresh: live,
          signal: controller.signal,
          onProgress: (partial) => {
            if (!controller.signal.aborted) setReport(partial)
          },
        })
        if (!controller.signal.aborted) {
          setReport(data)
          setComplete(true)
          setStatus('ready')
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError.message)
          setStatus('error')
        }
      } finally {
        running = false
      }
    }
    load(refreshRequest.live)
    const interval = window.setInterval(() => load(), trackingAutoRefreshMs)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [refreshRequest])

  function refreshTracking() {
    setRefreshRequest((current) => ({ live: true, version: current.version + 1 }))
  }

  function refreshTrackingFromCache() {
    setRefreshRequest((current) => ({ live: false, version: current.version + 1 }))
  }

  const matchingRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return report.rows.filter((row) => !query || trackingExportFields.some(([, field]) =>
      String(row[field] ?? '').toLowerCase().includes(query),
    ))
  }, [report.rows, search])
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / trackingRowsPageSize))
  const currentPage = Math.min(pageIndex, pageCount - 1)
  const visibleRows = matchingRows.slice(currentPage * trackingRowsPageSize, (currentPage + 1) * trackingRowsPageSize)

  const analytics = useMemo(() => {
    const statusGroups = {
      delivered: { label: 'Delivered', count: 0, className: 'delivered' },
      failed: { label: 'Failed', count: 0, className: 'failed' },
      transit: { label: 'In transit', count: 0, className: 'transit' },
      progress: { label: 'In progress', count: 0, className: 'progress' },
      unknown: { label: 'No status', count: 0, className: 'unknown' },
    }
    const rowsWithAge = activeReport.rows.map((row) => {
      const normalizedStatus = getNormalizedTrackingStatus(row.status)
      const ageStartDate = parseTrackingDate(row.date)
      const daysOpen = normalizedStatus === 'delivered'
        ? 0
        : countOpenDays(ageStartDate)

      statusGroups[normalizedStatus].count += 1

      return {
        ...row,
        normalizedStatus,
        businessDaysOpen: daysOpen,
      }
    })
    const warningSummary = getOrderWarningSummary(rowsWithAge)
    const maxStatusCount = Math.max(...Object.values(statusGroups).map((group) => group.count), 1)

    return {
      statusGroups: Object.values(statusGroups),
      maxStatusCount,
      ...warningSummary,
    }
  }, [activeReport.rows])

  function exportDeliveryRisks() {
    if (analytics.overdueOrders.length === 0) return

    const exportRows = analytics.overdueOrders.map((row) => Object.fromEntries(
      trackingExportFields.map(([header, field]) => [header, row[field] ?? '']),
    ))
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: trackingHeaders })
    const dateStamp = new Date().toISOString().slice(0, 10)

    if (exportFormat === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(worksheet)
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = `delivery-risks-${dateStamp}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      return
    }

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Delivery Risks')
    XLSX.writeFile(workbook, `delivery-risks-${dateStamp}.xlsx`)
  }

  return (
    <section className="route-view" aria-label="Tracking dashboard">
      <div className="report-toolbar">
        <div>
          <h1>Tracking</h1>
          <p>Shopify order shipping details.</p>
        </div>
      </div>

      <div className="report-filters" aria-label="Tracking actions">
        <span className="filter-label">{getTrackingSourceLabel(activeReport.source)}</span>
        <span className="timezone-pill">{activeReport.uspsTrackingEnabled ? 'USPS live enabled' : 'USPS links only'}</span>
        <button
          className="filter-button"
          disabled={activeStatus === 'loading'}
          type="button"
          onClick={refreshTrackingFromCache}
        >
          Refresh
        </button>
        <button
          className="filter-button"
          disabled={activeStatus === 'loading'}
          type="button"
          onClick={refreshTracking}
        >
          Refresh Live
        </button>
        <div className="tracking-export-actions">
          <label htmlFor="tracking-export-format">Export delivery risks as</label>
          <select
            id="tracking-export-format"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value)}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV (.csv)</option>
          </select>
          <button
            className="filter-button"
            disabled={!complete || analytics.overdueOrders.length === 0}
            type="button"
            onClick={exportDeliveryRisks}
          >
            Export ({analytics.overdueOrders.length})
          </button>
        </div>
      </div>

      <div className="tracking-history-controls" role="status">
        {complete
          ? `All ${report.rows.length} records checked. Risk totals cover every page.`
          : `${status === 'error' ? 'Scan incomplete' : 'Checking all records'} - ${report.rows.length} records available. Risk totals and search results are partial until the scan completes.`}
      </div>

      {activeError && <div className="report-alert">{activeError}</div>}
      {report.rows.length > 0 && (
        <section className="tracking-analytics" aria-label="Tracking analytics">
          <div className="tracking-analytics-hero">
            <div>
              <span>Delivery Risk</span>
              <strong>{complete ? analytics.overdueOrders.length : `${analytics.overdueOrders.length} so far`}</strong>
              <small>
                Open orders over
                {' '}
                {overdueDaysThreshold}
                {' '}
                business days
              </small>
            </div>
            <div className="tracking-risk-graphic" aria-hidden="true">
              <div className="tracking-risk-pulse">
                <span />
                <span />
                <strong>!</strong>
              </div>
              <div className="tracking-risk-stripes" />
            </div>
            <div className="tracking-risk-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, analytics.overdueOrders.length * 8)}%` }} />
            </div>
          </div>

          <div className="tracking-analytics-grid">
            <article className="tracking-chart-card">
              <div className="tracking-card-heading">
                <h2>Status Overview</h2>
                <span>{activeReport.rows.length} rows</span>
              </div>
              <div className="tracking-status-chart">
                {analytics.statusGroups.map((group) => (
                  <div className="tracking-chart-row" key={group.className}>
                    <div>
                      <span>{group.label}</span>
                      <strong>{group.count}</strong>
                    </div>
                    <div className={`tracking-chart-bar ${group.className}`}>
                      <span style={{ width: `${(group.count / analytics.maxStatusCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="tracking-warning-card">
              <div className="tracking-card-heading">
                <h2>Warnings</h2>
                <span>{analytics.warningOrders.length} orders</span>
              </div>
              <div className="tracking-warning-summary">
                <span>
                  <strong>{analytics.failedOrders.length}</strong>
                  Failed delivery
                </span>
                <span>
                  <strong>{analytics.activeOrders.length}</strong>
                  Open orders
                </span>
                <span>
                  <strong>{complete ? analytics.overdueOrders.length : `${analytics.overdueOrders.length} so far`}</strong>
                  Overdue
                </span>
              </div>
              <div className="tracking-warning-list">
                {analytics.warningOrders.length === 0 && (
                  <div className="tracking-warning-empty">{complete ? 'No overdue or failed deliveries found across all records.' : 'Checking remaining records for overdue or failed deliveries...'}</div>
                )}
                {analytics.warningOrders.map((row) => (
                  <div className="tracking-warning-item" key={`${getTrackingOrderKey(row)}-warning`}>
                    <div>
                      <strong>{row.orderNumber}</strong>
                      <span>{row.name || 'No name'}</span>
                    </div>
                    <div>
                      <span className={`tracking-status ${getTrackingStatusClass(row.status)}`}>
                        {row.status || 'No status'}
                      </span>
                      <small>
                        {row.businessDaysOpen}
                        {' '}
                        business days
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      )}

      <div className="table-panel tracking-panel">
        <div className="tracking-history-controls">
          <label className="tracking-search" htmlFor="tracking-search">
            Search all orders
            <input id="tracking-search" type="search" value={search}
              placeholder="Order number, customer, tracking, item, status..."
              onChange={(event) => { setSearch(event.target.value); setPageIndex(0) }} />
          </label>
          <div>
            <span>{matchingRows.length} matching records - Page {currentPage + 1} of {pageCount}</span>
            <button className="filter-button" disabled={currentPage === 0} type="button"
              onClick={() => setPageIndex(currentPage - 1)}>Previous</button>
            <button className="filter-button" disabled={currentPage + 1 >= pageCount} type="button"
              onClick={() => setPageIndex(currentPage + 1)}>Next</button>
          </div>
        </div>
        <div className="table-shell">
          <table className="client-table tracking-table">
            <thead>
              <tr className="tracking-title-row">
                <th colSpan={trackingHeaders.length} scope="colgroup">
                  Shopify Tracking Dashboard
                </th>
              </tr>
              <tr>
                {trackingHeaders.map((header) => (
                  <th scope="col" key={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeStatus === 'loading' && report.rows.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={trackingHeaders.length}>Loading Shopify orders...</td>
                </tr>
              )}
              {visibleRows.length === 0 && activeStatus !== 'loading' && (
                <tr className="empty-row">
                  <td colSpan={trackingHeaders.length}>{complete ? 'No matching orders found' : 'No matching orders loaded yet; scan incomplete'}</td>
                </tr>
              )}
              {visibleRows.map((row) => (
                <tr key={row.rowId}>
                  <td className="tracking-order-cell">{displayCell(row.orderNumber)}</td>
                  <td>{displayCell(row.suplifulOrder)}</td>
                  <td title={row.item}>{displayCell(row.item)}</td>
                  <td>{displayCell(row.name)}</td>
                  <td>{displayCell(row.phone)}</td>
                  <td>{displayCell(row.date)}</td>
                  <td>{displayCell(row.dateShipped)}</td>
                  <td title={row.tracking}>{renderTrackingNumbers(row.tracking, row.uspsUrl)}</td>
                  <td>{displayCell(row.deliveryDate)}</td>
                  <td>
                    {row.status ? (
                      <span
                        className={`tracking-status ${getTrackingStatusClass(row.status)}`}
                        title={getStatusSourceLabel(row.statusSource)}
                      >
                        {row.status}
                      </span>
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default Tracking
