export const overdueDaysThreshold = 5
export const maxRiskAgeDays = 30
const deliveryRiskExcludedOrders = new Set([
  '7424', '7201', '7189', '7422', '7421', '7412', '7296', '7285',
])
const trackingBusinessTimeZone = 'America/New_York'
const trackingBusinessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: trackingBusinessTimeZone,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})


export function parseTrackingDate(value) {
  if (!value) return null

  const parts = String(value).trim().split('/').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null

  const [month, day, year] = parts
  const date = new Date(Date.UTC(year, month - 1, day, 12))

  return Number.isNaN(date.getTime()) ? null : date
}

function getTrackingBusinessToday(now = new Date()) {
  const parts = trackingBusinessDateFormatter.formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))

  return new Date(Date.UTC(values.year, values.month - 1, values.day, 12))
}

// Compare date-only UTC values so DST and time of day cannot shift the cutoff.
export function countCalendarDays(startDate, endDate = getTrackingBusinessToday()) {
  if (!startDate) return null
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  return Math.floor((end - start) / 86400000)
}

export function countOpenDays(startDate, endDate = getTrackingBusinessToday()) {
  if (!startDate) return 0

  const cursor = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate() + 1,
    0,
  ))
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  let businessDays = 0

  while (cursor.getTime() <= end) {
    const dayOfWeek = cursor.getUTCDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) businessDays += 1
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return businessDays
}

export function getNormalizedTrackingStatus(value) {
  const status = String(value ?? '').toLowerCase()

  if (status.includes('failed')) return 'failed'
  if (status.includes('delivered')) return 'delivered'
  if (status.includes('transit')) return 'transit'
  if (status.includes('progress')) return 'progress'

  return 'unknown'
}

export function getTrackingOrderKey(row) {
  return String(row.orderNumber || row.rowId || '').trim()
}

export function isDeliveryRiskExcluded(row) {
  // Explicitly excluded at the user's request; this does not assert delivery.
  return deliveryRiskExcludedOrders.has(String(row.orderNumber ?? '').trim().replace(/^#/, ''))
}

// Delivery evidence applies to a package, not every package in the order.
export function reconcileDeliveredShipments(rows) {
  const trackingKeys = (row) => String(row.tracking ?? '').split(',')
    .map((value) => value.replace(/\s/g, '').toUpperCase()).filter(Boolean)
    .map((value) => `${getTrackingOrderKey(row)}|${value}`)
  const delivered = new Map()
  rows.forEach((row) => {
    if (getNormalizedTrackingStatus(row.status) === 'delivered') {
      trackingKeys(row).forEach((key) => delivered.set(key, row))
    }
  })
  return rows.map((row) => {
    const keys = trackingKeys(row)
    if (!keys.length || !keys.every((key) => delivered.has(key))) return row
    const evidence = delivered.get(keys[0])
    return {
      ...row,
      status: 'Delivered',
      normalizedStatus: 'delivered',
      statusSource: evidence.statusSource,
      deliveryDate: row.deliveryDate || evidence.deliveryDate,
      businessDaysOpen: 0,
    }
  })
}

export function getOrderWarningSummary(rows, today = getTrackingBusinessToday()) {
  const ordersByKey = new Map()

  reconcileDeliveredShipments(rows).forEach((row) => {
    const orderKey = getTrackingOrderKey(row)
    if (!orderKey) return

    const existingOrder = ordersByKey.get(orderKey)
    const nextOrder = existingOrder ?? {
      ...row,
      failed: false,
      overdue: false,
      active: false,
      businessDaysOpen: 0,
      status: '',
    }

    const withinRiskWindow = !isDeliveryRiskExcluded(row)
      && countCalendarDays(parseTrackingDate(row.date), today) <= maxRiskAgeDays
    nextOrder.failed = nextOrder.failed || (withinRiskWindow && row.normalizedStatus === 'failed')
    nextOrder.overdue = nextOrder.overdue
      || (withinRiskWindow && row.normalizedStatus !== 'unknown' && row.normalizedStatus !== 'delivered' && row.businessDaysOpen > overdueDaysThreshold)
    nextOrder.active = nextOrder.active
      || (row.normalizedStatus !== 'delivered' && row.normalizedStatus !== 'failed')

    const shouldUseRowDetails = row.normalizedStatus === 'failed'
      || row.businessDaysOpen > nextOrder.businessDaysOpen

    if (shouldUseRowDetails) {
      nextOrder.status = row.status
      nextOrder.statusSource = row.statusSource
      nextOrder.businessDaysOpen = row.businessDaysOpen
      nextOrder.name = row.name
    }

    ordersByKey.set(orderKey, nextOrder)
  })

  const orders = [...ordersByKey.values()]
  const warningOrders = orders
    .filter((order) => order.failed || order.overdue)
    .map((order) => ({
      ...order,
      status: order.failed ? (order.status || 'Failed delivery') : order.status,
    }))
    .sort((left, right) =>
      right.businessDaysOpen - left.businessDaysOpen
      || left.orderNumber.localeCompare(right.orderNumber),
    )

  return {
    activeOrders: orders.filter((order) => order.active),
    failedOrders: orders.filter((order) => order.failed),
    overdueOrders: orders.filter((order) => order.overdue),
    warningOrders,
  }
}

