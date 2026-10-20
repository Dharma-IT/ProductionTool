import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchAircallCalls,
  mergeCallSources,
  normalizeAircallCall,
} from './aircall.js'

test('normalizes an answered outbound call for the existing matcher', () => {
  const call = normalizeAircallCall({
    id: 42,
    direction: 'outbound',
    raw_digits: '+1 (781) 520-5625',
    started_at: 1792472400,
    answered_at: 1792472410,
    user: { id: 7, name: 'Laura Example' },
  })

  assert.deepEqual(call, {
    callId: 'aircall:42',
    source: 'aircall',
    callerName: 'Laura Example',
    callTime: '2026-10-20T05:00:00.000Z',
    callTitle: '',
    phoneNumber: '17815205625',
    direction: 'OUTBOUND',
    disposition: 'CONNECTED',
  })
})

test('keeps Aircall-only calls and removes cross-source duplicates', () => {
  const hubspot = [{
    callId: 'hubspot:1',
    phoneNumber: '17815205625',
    callTime: '2026-10-20T05:00:00.000Z',
  }]
  const duplicate = {
    callId: 'aircall:2',
    phoneNumber: '+17815205625',
    callTime: '2026-10-20T05:01:00.000Z',
  }
  const aircallOnly = {
    callId: 'aircall:3',
    phoneNumber: '+12125550199',
    callTime: '2026-10-20T05:02:00.000Z',
  }

  assert.deepEqual(mergeCallSources(hubspot, [duplicate, aircallOnly]), [hubspot[0], aircallOnly])
})

test('fetches and paginates Aircall calls using Basic authentication', async () => {
  const requestedUrls = []
  const requestedAuth = []
  const pages = [
    { calls: [{ id: 1 }], meta: { next_page_link: 'https://api.aircall.io/v1/calls?page=2' } },
    { calls: [{ id: 2 }], meta: {} },
  ]
  const fetchImpl = async (url, options) => {
    requestedUrls.push(String(url))
    requestedAuth.push(options.headers.Authorization)
    const payload = pages.shift()
    return {
      ok: true,
      async json() { return payload },
    }
  }

  const calls = await fetchAircallCalls({
    from: 1000,
    to: 5000,
    env: { AIRCALL_API_ID: 'id', AIRCALL_API_TOKEN: 'token' },
    fetchImpl,
  })

  assert.deepEqual(calls, [{ id: 1 }, { id: 2 }])
  assert.match(requestedUrls[0], /from=1/)
  assert.equal(requestedAuth[0], `Basic ${Buffer.from('id:token').toString('base64')}`)
  assert.equal(requestedAuth[1], requestedAuth[0])
})
