import test from 'node:test'
import assert from 'node:assert/strict'
import { isShipmentLate, formatShipmentDate } from '../src/services/shipmentDetails.js'
import { enrichShopifyShipments } from './shopifyShipmentDetails.js'
import { getOrderWarningSummary } from '../src/services/trackingAnalytics.js'

test('late uses the business calendar date and clears on delivery', () => {
  const shipment = { estimatedDeliveryAt: '2026-11-03T01:50:00Z' }
  assert.equal(isShipmentLate(shipment, new Date('2026-11-03T02:00:00Z')), false)
  assert.equal(isShipmentLate(shipment, new Date('2026-11-03T05:00:00Z')), true)
  assert.equal(isShipmentLate({ ...shipment, status: 'DELIVERED' }), false)
  assert.equal(isShipmentLate({ latestMessage: 'In Transit, Arriving Late' }), true)
  assert.equal(isShipmentLate({ estimatedDeliveryAt: '' }), false)
  assert.equal(isShipmentLate({ estimatedDeliveryAt: 'invalid' }), false)
  assert.equal(formatShipmentDate('invalid'), 'Not available')
})

test('enrichment batches and associates details with each fulfillment', async () => {
  const orders = [{ fulfillments: Array.from({ length: 51 }, (_, i) => ({ id: i + 1 })) }]
  const calls = []
  await enrichShopifyShipments(orders, async (_, { ids }) => {
    calls.push(ids.length)
    return { data: { nodes: ids.map((id) => ({ id, displayStatus: id.endsWith('/1') ? 'DELIVERED' : 'IN_TRANSIT', events: { nodes: [{ message: id, happenedAt: '2026-11-01T12:00:00Z' }] } })) } }
  }, '2026-11-03T00:00:00Z')
  assert.deepEqual(calls, [50, 1])
  assert.equal(orders[0].fulfillments[0].shipmentDetails.status, 'DELIVERED')
  assert.equal(orders[0].fulfillments[0].shipment_status, 'delivered')
  assert.equal(orders[0].fulfillments[1].shipmentDetails.status, 'IN_TRANSIT')
  assert.equal(orders[0].fulfillments[50].shipmentDetails.latestMessage, 'gid://shopify/Fulfillment/51')
  await assert.rejects(enrichShopifyShipments(orders, async () => ({ errors: [{ message: 'Access denied' }] })), /Access denied/)
})

test('carrier delay warns before the age threshold without flagging delivered rows', () => {
  const base = { date: '11/02/2026', businessDaysOpen: 1, shipmentDetails: [{ latestMessage: 'Arriving Late' }] }
  const summary = getOrderWarningSummary([
    { ...base, orderNumber: '#late', status: 'In transit', normalizedStatus: 'transit' },
    { ...base, orderNumber: '#done', status: 'Delivered', normalizedStatus: 'delivered' },
  ], new Date('2026-11-03T12:00:00Z'))
  assert.deepEqual(summary.overdueOrders.map((r) => r.orderNumber), ['#late'])
  assert.equal(summary.overdueOrders[0].status, 'In transit')
})

test('a Shopify delivered event overrides stale fulfillment display status', async () => {
  const orders = [{ fulfillments: [{ id: 7045, shipment_status: 'in_transit' }] }]
  await enrichShopifyShipments(orders, async (_, { ids }) => ({ data: { nodes: [{
    id: ids[0], displayStatus: 'IN_TRANSIT', events: { nodes: [{ status: 'DELIVERED' }] },
  }] } }))
  assert.equal(orders[0].fulfillments[0].shipment_status, 'delivered')
})

test('missing Shopify fulfillment results cannot count as a successful update', async () => {
  await assert.rejects(enrichShopifyShipments([{ fulfillments: [{ id: 7045 }] }],
    async () => ({ data: { nodes: [null] } })), /missing one or more fulfillments/)
})
