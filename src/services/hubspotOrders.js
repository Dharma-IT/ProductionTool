function getOrdersEndpoint() {
  const configuredEndpoint = import.meta.env.VITE_HUBSPOT_ORDERS_URL
    ?? import.meta.env.VITE_HUBSPOT_CALL_REPORT_URL

  if (!configuredEndpoint) return '/api/hubspot/orders'

  const endpoint = new URL(configuredEndpoint, window.location.origin)
  endpoint.pathname = '/api/hubspot/orders'
  endpoint.search = ''
  return endpoint.toString()
}

export async function loadHubSpotOrders(date) {
  const requestUrl = new URL(getOrdersEndpoint(), window.location.origin)
  requestUrl.searchParams.set('date', date)

  const response = await fetch(requestUrl, { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.message || `Unable to load HubSpot orders (${response.status}).`)
  }

  return payload
}
