const analyticsExportUrl = 'https://api.aircall.io/v1/analytics/report/export'

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }

  const headers = (rows.shift() ?? []).map((header) => header.trim().toLowerCase())
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

function readUtcTimestamp(row) {
  const value = row['datetime (utc)'] || row['call start time']
  if (!value) return null

  const normalized = String(value).trim().replace(' ', 'T')
  const date = new Date(/[z+-]\d\d(?::?\d\d)?$/i.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeAnalyticsCsv(text) {
  return parseCsv(text)
    .map((row) => ({
      callId: `aircall:${row['call id (internal)'] || row['call id']}`,
      source: 'aircall-analytics',
      callerName: String(row.user ?? '').trim(),
      callTime: readUtcTimestamp(row),
      callTitle: '',
      phoneNumber: normalizePhone(row.to || row['customer number']),
      direction: String(row.direction || row['call type'] || '').toUpperCase(),
      disposition: String(row.answered ?? '').toLowerCase() === 'yes' ? 'CONNECTED' : 'DONE',
    }))
    .filter((call) => call.callId !== 'aircall:' && call.callTime && call.phoneNumber)
}

export async function fetchAircallAnalyticsCalls({
  fromDate,
  toDate,
  accessToken = process.env.AIRCALL_ANALYTICS_ACCESS_TOKEN,
  fetchImpl = fetch,
  pollIntervalMs = 10000,
  timeoutMs = 3 * 60 * 1000,
}) {
  if (!String(accessToken ?? '').trim()) return []

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
  const createResponse = await fetchImpl(analyticsExportUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: {
        reportName: 'CALLS_HISTORY',
        filter: {
          timezone: 'America/New_York',
          dateFilter: { absoluteRange: { fromDate, toDate } },
        },
      },
    }),
  })

  if (!createResponse.ok) {
    throw new Error(`Aircall Analytics export failed (${createResponse.status}): ${await createResponse.text()}`)
  }

  const created = await createResponse.json()
  const exportId = created.exportID ?? created.exportId ?? created.id
  if (!exportId) throw new Error('Aircall Analytics did not return an export ID')

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await fetchImpl(`${analyticsExportUrl}/${exportId}`, { headers })
    if (!response.ok) {
      throw new Error(`Aircall Analytics polling failed (${response.status}): ${await response.text()}`)
    }

    const report = await response.json()
    const status = String(report.status ?? '').toUpperCase()
    if (status === 'FAILED') throw new Error(report.errorMessage ?? 'Aircall Analytics export failed')
    if (status === 'COMPLETED') {
      const downloadUrl = report.downloadUrl ?? report.download_url
      if (!downloadUrl) throw new Error('Aircall Analytics export did not include a download URL')
      const download = await fetchImpl(downloadUrl)
      if (!download.ok) throw new Error(`Aircall Analytics download failed (${download.status})`)
      return normalizeAnalyticsCsv(await download.text())
    }

    await delay(pollIntervalMs)
  }

  throw new Error('Aircall Analytics export timed out')
}
