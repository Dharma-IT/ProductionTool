import { timingSafeEqual } from 'node:crypto'

const aircallBaseUrl = 'https://api.aircall.io/v1'

function asIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null

  const numericValue = Number(value)
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue * 1000)
    : new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function readCallerName(call) {
  const user = call?.user ?? call?.assigned_to ?? {}

  return String(
    user.name
      || [user.first_name, user.last_name].filter(Boolean).join(' ')
      || user.email
      || '',
  ).trim()
}

export function hasAircallApiConfig(env = process.env) {
  return Boolean(String(env.AIRCALL_API_ID ?? '').trim() && String(env.AIRCALL_API_TOKEN ?? '').trim())
}

export function verifyAircallWebhookToken(receivedToken, expectedToken) {
  const received = Buffer.from(String(receivedToken ?? ''))
  const expected = Buffer.from(String(expectedToken ?? ''))

  return received.length > 0
    && received.length === expected.length
    && timingSafeEqual(received, expected)
}

export function normalizeAircallCall(call) {
  const callTime = asIsoTimestamp(call?.started_at ?? call?.created_at)
  const answered = Boolean(call?.answered_at)

  return {
    callId: `aircall:${call?.id}`,
    source: 'aircall',
    callerName: readCallerName(call),
    callTime,
    callTitle: '',
    phoneNumber: normalizePhone(call?.raw_digits),
    direction: String(call?.direction ?? '').toUpperCase(),
    disposition: answered ? 'CONNECTED' : String(call?.status ?? 'OUTBOUND').toUpperCase(),
  }
}

export function buildAircallDatabaseRow(call, event = 'call.ended') {
  return {
    call_id: String(call?.id ?? ''),
    direction: String(call?.direction ?? '').toLowerCase(),
    raw_digits: String(call?.raw_digits ?? ''),
    normalized_phone: normalizePhone(call?.raw_digits),
    user_id: call?.user?.id === undefined ? null : String(call.user.id),
    user_name: readCallerName(call) || null,
    started_at: asIsoTimestamp(call?.started_at ?? call?.created_at),
    answered_at: asIsoTimestamp(call?.answered_at),
    ended_at: asIsoTimestamp(call?.ended_at),
    status: call?.status ? String(call.status) : null,
    missed_call_reason: call?.missed_call_reason ? String(call.missed_call_reason) : null,
    event_name: event,
    raw_data: call,
    received_at: new Date().toISOString(),
  }
}

export async function fetchAircallCalls({ from, to, env = process.env, fetchImpl = fetch }) {
  if (!hasAircallApiConfig(env)) return []

  const credentials = Buffer.from(`${env.AIRCALL_API_ID}:${env.AIRCALL_API_TOKEN}`).toString('base64')
  let requestUrl = new URL(`${aircallBaseUrl}/calls`)
  requestUrl.search = new URLSearchParams({
    from: String(Math.floor(Number(from) / 1000)),
    to: String(Math.ceil(Number(to) / 1000)),
    per_page: '50',
    order: 'desc',
  })
  const calls = []

  while (requestUrl) {
    const response = await fetchImpl(requestUrl, {
      headers: { Authorization: `Basic ${credentials}` },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Aircall request failed (${response.status}): ${body}`)
    }

    const payload = await response.json()
    calls.push(...(payload.calls ?? []))
    requestUrl = payload.meta?.next_page_link ? new URL(payload.meta.next_page_link) : null
  }

  return calls
}

export function mergeCallSources(hubspotCalls, aircallCalls, duplicateWindowMs = 2 * 60 * 1000) {
  const merged = [...hubspotCalls]

  aircallCalls.forEach((aircallCall) => {
    const aircallPhone = normalizePhone(aircallCall.phoneNumber).slice(-10)
    const aircallTime = new Date(aircallCall.callTime).getTime()
    const duplicate = hubspotCalls.some((hubspotCall) => {
      const hubspotPhone = normalizePhone(hubspotCall.phoneNumber).slice(-10)
      const hubspotTime = new Date(hubspotCall.callTime).getTime()

      return aircallPhone
        && aircallPhone === hubspotPhone
        && Number.isFinite(aircallTime)
        && Number.isFinite(hubspotTime)
        && Math.abs(aircallTime - hubspotTime) <= duplicateWindowMs
    })

    if (!duplicate) merged.push(aircallCall)
  })

  return merged
}
