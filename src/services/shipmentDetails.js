export function isShipmentDelivered(shipment) {
  return Boolean(shipment.deliveredAt)
    || String(shipment.status ?? '').trim().toUpperCase() === 'DELIVERED'
}

export function isShipmentLate(shipment, now = new Date()) {
  if (isShipmentDelivered(shipment)) return false
  if (shipment.status === 'DELAYED' || /arriving late|delayed/i.test(shipment.latestMessage ?? '')) return true
  if (!shipment.estimatedDeliveryAt) return false
  // An estimate remains valid through its calendar day in the shipment's timezone.
  const timezone = shipment.timeZone || 'America/New_York'
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dateKey = (date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  const estimate = new Date(shipment.estimatedDeliveryAt)
  return Number.isFinite(estimate.getTime()) && dateKey(now) > dateKey(estimate)
}

export function formatShipmentDate(value, timeZone = 'America/New_York') {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}
