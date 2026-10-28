// Completion is only reported after the final batch succeeds.
export async function collectTrackingPages(loadPage, { signal, onProgress } = {}) {
  const rows = new Map()
  let offset = 0
  while (true) {
    signal?.throwIfAborted()
    const page = await loadPage(offset)
    signal?.throwIfAborted()
    for (const row of page.rows) rows.set(row.rowId, row)
    const report = { ...page, rows: [...rows.values()] }
    onProgress?.(report)
    if (!page.hasMoreRows) return report
    const nextOffset = page.nextRowsOffset
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
      throw new Error('Tracking scan did not advance; full coverage could not be verified')
    }
    offset = nextOffset
  }
}
