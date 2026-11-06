import { isOrderHistoryEligible } from './orderHistoryEligibility.js'

export function isCompletedOrder(row) {
  return String(row.medicalForm ?? '').trim().toUpperCase() === 'YES'
    || ['striveOrderNumber1', 'striveOrderNumber2', 'futureOrderNumber']
      .some((key) => Boolean(String(row[key] ?? '').trim()))
}

export function isPendingMedicalOrder(row) {
  return isOrderHistoryEligible(row) && !isCompletedOrder(row)
    && String(row.medicalForm ?? '').trim().toUpperCase() === 'PENDING'
}

export function selectImportedPendingMedicalForms(rows) {
  const imported = rows.filter((row) => row.recordType === 'pending-medical-form-import'
    && row.sourceFileName === 'DHARMA ORDERS - OCT 17 2024 + - PENDING MEDICAL FORMS.csv')
  const automatic = rows.filter((row) => row.recordType === 'orders-report-snapshot' && row.workflowComplete)
    .flatMap((snapshot) => snapshot.rows.filter(isPendingMedicalOrder))
  const reviews = rows.filter((row) => row.recordType === 'pending-medical-review')
  const combined = new Map([...imported, ...automatic, ...reviews].map((row) => [row.rowId || row.id, row]))
  return [...combined.values()].filter((row) => !row.pendingAccepted)
}
