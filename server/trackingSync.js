// Await persistence before requesting the next page so only one page is retained.
export async function scanTrackingPages({ fetchPage, processPage, params, maxPages = Infinity }) {
  let pageInfo = ''
  let pageCount = 0
  do {
    const { payload, nextPageInfo } = await fetchPage(pageInfo
      ? { limit: params.limit, page_info: pageInfo }
      : params)
    const orders = payload.orders
    if (!Array.isArray(orders)) throw new Error('Invalid Shopify orders response')
    const cutoff = Date.parse(params.created_at_min)
    const boundary = orders.findIndex((order) => Date.parse(order.created_at) < cutoff)
    await processPage(boundary < 0 ? orders : orders.slice(0, boundary))
    pageInfo = boundary < 0 ? (nextPageInfo ?? '') : ''
    pageCount += 1
  } while (pageInfo && pageCount < maxPages)
  return { pageCount, hitPageLimit: Boolean(pageInfo) }
}

// The service has one Shopify store. Request pagination must not start extra syncs.
export function createSharedTrackingSync() {
  let active
  return (work) => {
    if (!active) {
      active = Promise.resolve().then(work).finally(() => { active = undefined })
    }
    return active
  }
}
