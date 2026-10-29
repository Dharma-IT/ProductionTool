// HubSpot paid-date properties represent calendar dates encoded at UTC midnight.
export function formatOrderPurchaseDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC',
    }).format(date)
}
