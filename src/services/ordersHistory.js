function getOrdersHistoryEndpoint() {
  return import.meta.env.VITE_ORDERS_HISTORY_URL ?? '/api/orders-history'
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || `Orders history request failed (${response.status}).`)
  return Array.isArray(payload.rows) ? payload.rows : []
}

export async function loadOrdersHistory(date) {
  const url = new URL(getOrdersHistoryEndpoint(), window.location.origin)
  if (date) url.searchParams.set('date', date)
  return readResponse(await fetch(url, { cache: 'no-store' }))
}

export async function saveOrdersHistory(rows, reportDate, sourceFileName = '') {
  return readResponse(await fetch(getOrdersHistoryEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, reportDate, sourceFileName }),
  }))
}
