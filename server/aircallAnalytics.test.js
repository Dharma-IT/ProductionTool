import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnalyticsCsv } from './aircallAnalytics.js'

test('normalizes reporting-only Aircall call history rows', () => {
  const csv = [
    'datetime (utc),direction,to,answered,user,call id (internal)',
    '2026-10-19 13:59:25,outbound,17815205625,Yes,Laura Alejandra Sanchez Pinto,4254735001',
  ].join('\n')

  assert.deepEqual(normalizeAnalyticsCsv(csv), [{
    callId: 'aircall:4254735001',
    source: 'aircall-analytics',
    callerName: 'Laura Alejandra Sanchez Pinto',
    callTime: '2026-10-19T13:59:25.000Z',
    callTitle: '',
    phoneNumber: '17815205625',
    direction: 'OUTBOUND',
    disposition: 'CONNECTED',
  }])
})

test('parses quoted commas in Analytics CSV fields', () => {
  const csv = [
    'datetime (utc),direction,customer number,answered,user,call id',
    '2026-10-19 14:11:50,outbound,"+1 240 516 4992",Yes,"Gonzalez, Belizabett",CAFFEE1',
  ].join('\n')

  const [call] = normalizeAnalyticsCsv(csv)
  assert.equal(call.callerName, 'Gonzalez, Belizabett')
  assert.equal(call.phoneNumber, '12405164992')
})
