import { isOrderHistoryEligible } from '../src/services/orderHistoryEligibility.js'
import { isCompletedOrder, selectImportedPendingMedicalForms } from '../src/services/pendingMedicalForms.js'

export function buildOrdersSnapshot(rows, reportDate, sourceFileName, warnings, workflowComplete = false) {
  const rowId = `${reportDate}:report-snapshot`
  return {
    id: rowId,
    rowId,
    recordType: 'orders-report-snapshot',
    reportDate,
    sourceFileName,
    savedAt: new Date().toISOString(),
    workflowComplete,
    rows: rows.filter(isOrderHistoryEligible).map((row, index) => {
      const id = row.rowId || `${reportDate}:${row.id || `row-${index}`}`
      return { ...row, id, rowId: id, reportDate, sourceFileName }
    }),
    warnings,
  }
}

export function readOrdersSnapshot(records) {
  const snapshots = records.filter((row) => row.recordType === 'orders-report-snapshot')
  const savedDates = new Set(snapshots.map((row) => row.reportDate))
  const importedRows = records.filter((row) => row.recordType === 'orders-csv-import')
  const importedIds = new Set(importedRows.map((row) => row.rowId || row.id))
  const reviews = records.filter((row) => row.recordType === 'pending-medical-review')
  const reviewIds = new Set(reviews.map((row) => row.rowId || row.id))
  return {
    rows: [
      ...snapshots.flatMap((snapshot) => snapshot.rows.filter((row) => !snapshot.workflowComplete || isCompletedOrder(row)))
        .filter((row) => !importedIds.has(row.rowId || row.id) && !reviewIds.has(row.rowId || row.id)),
      ...importedRows,
      ...reviews.filter((row) => row.pendingAccepted),
      ...records.filter((row) => row.recordType !== 'orders-report-snapshot'
        && row.recordType !== 'orders-csv-import' && row.recordType !== 'pending-medical-review' && !savedDates.has(row.reportDate)),
    ].filter((row) => row.recordType !== 'pending-medical-form-import' && isOrderHistoryEligible(row))
      .sort((left, right) => String(right.reportDate || '').localeCompare(String(left.reportDate || ''))),
    warnings: snapshots.flatMap((snapshot) => snapshot.warnings.map((warning) => ({
      ...warning, id: `${snapshot.reportDate}:${warning.id}`, reportDate: snapshot.reportDate,
    }))).sort((left, right) => right.reportDate.localeCompare(left.reportDate)),
    reportCount: snapshots.length,
    pendingRows: selectImportedPendingMedicalForms(records),
    snapshot: snapshots.length === 1 ? snapshots[0] : null,
  }
}
