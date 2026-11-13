import * as XLSX from 'xlsx'

export function readOrderCsvWorkbook(bytes) {
  // Portal and Strive exports use UTF-8, including patient names with accents.
  return XLSX.read(bytes, { type: 'array', codepage: 65001 })
}
