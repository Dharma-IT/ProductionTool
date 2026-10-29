export function buildOrdersSnapshot(rows, reportDate, sourceFileName, warnings) {
  const rowId = `${reportDate}:report-snapshot`
  return {
    id: rowId,
    rowId,
    recordType: 'orders-report-snapshot',
    reportDate,
    sourceFileName,
    savedAt: new Date().toISOString(),
    rows: rows.map((row, index) => {
      const id = row.rowId || `${reportDate}:${row.id || `row-${index}`}`
      return { ...row, id, rowId: id, reportDate, sourceFileName }
    }),
    warnings,
  }
}

export function readOrdersSnapshot(records) {
  const snapshots = records.filter((row) => row.recordType === 'orders-report-snapshot')
  const savedDates = new Set(snapshots.map((row) => row.reportDate))
  return {
    rows: [
      ...snapshots.flatMap((snapshot) => snapshot.rows),
      ...records.filter((row) => row.recordType !== 'orders-report-snapshot' && !savedDates.has(row.reportDate)),
    ].sort((left, right) => String(right.reportDate || '').localeCompare(String(left.reportDate || ''))),
    warnings: snapshots.flatMap((snapshot) => snapshot.warnings.map((warning) => ({
      ...warning, id: `${snapshot.reportDate}:${warning.id}`, reportDate: snapshot.reportDate,
    }))).sort((left, right) => right.reportDate.localeCompare(left.reportDate)),
    reportCount: snapshots.length,
    snapshot: snapshots.length === 1 ? snapshots[0] : null,
  }
}
