import { normalizeOrderStatus } from './orderCsvEnrichment.js'

export function getOrderExportHeaders(headers) {
  return headers.filter(({ key }) => key !== 'striveOrderNumber2')
}

export function formatOrderExportValue(key, value) {
  if (key === 'medicalForm') {
    const status = String(value ?? '').trim().toUpperCase()
    return status === 'PENDING' ? 'NO' : status
  }
  if (key === 'treatment') return String(value ?? '').replace(/^\s*1\s*x\s+/i, '')
  return normalizeOrderStatus(value)
}
