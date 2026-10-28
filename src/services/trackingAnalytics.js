export const overdueDaysThreshold = 5
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

export function getOrderWarningSummary(rows) {
  const ordersByKey = new Map()

  rows.forEach((row) => {
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

    nextOrder.failed = nextOrder.failed || row.normalizedStatus === 'failed'
    nextOrder.overdue = nextOrder.overdue
      || (row.normalizedStatus !== 'delivered' && row.businessDaysOpen > overdueDaysThreshold)
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

