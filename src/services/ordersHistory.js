function getOrdersHistoryEndpoint() {
  if (import.meta.env.VITE_ORDERS_HISTORY_URL) return import.meta.env.VITE_ORDERS_HISTORY_URL
  const configuredEndpoint = import.meta.env.VITE_HUBSPOT_CALL_REPORT_URL
  if (!configuredEndpoint) return '/api/orders-history'
  const endpoint = new URL(configuredEndpoint, window.location.origin)
  endpoint.pathname = '/api/orders-history'
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint.toString()
}

async function readResponse(response) {
  const payload = await response.json().catch(() => {
    throw new Error('Orders history API did not return JSON. Check the configured API address.')
  })
  if (!response.ok) throw new Error(payload.message || `Orders history request failed (${response.status}).`)
  if (!Array.isArray(payload.rows)) throw new Error('Orders history API returned an invalid response.')
  return payload
}

export async function loadOrdersHistory(date) {
  const url = new URL(getOrdersHistoryEndpoint(), window.location.origin)
  if (date) url.searchParams.set('date', date)
  return readResponse(await fetch(url, { cache: 'no-store' }))
}

export async function saveOrdersHistory(rows, reportDate, sourceFileName = '', options = {}) {
  const result = await readResponse(await fetch(getOrdersHistoryEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, reportDate, sourceFileName, ...options }),
  }))
  return result.rows
}
