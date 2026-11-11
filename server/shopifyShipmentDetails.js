export function excludeCancelledFulfillments(order) {
  return {
    ...order,
    fulfillments: (order.fulfillments ?? []).filter((fulfillment) =>
      !['cancelled', 'canceled'].includes(String(fulfillment.status ?? '').trim().toLowerCase())),
  }
}

export async function enrichShopifyShipments(orders, graphql, checkedAt = new Date().toISOString()) {
  const fulfillments = orders.flatMap((order) => order.fulfillments ?? [])
  const unique = [...new Map(fulfillments.map((f) => [String(f.id), f])).values()]
  const details = new Map()
  for (let offset = 0; offset < unique.length; offset += 50) {
    const ids = unique.slice(offset, offset + 50).map((f) => f.admin_graphql_api_id || `gid://shopify/Fulfillment/${f.id}`)
    const result = await graphql(`query ShipmentDetails($ids: [ID!]!) {
      nodes(ids: $ids) { ... on Fulfillment {
        id displayStatus estimatedDeliveryAt inTransitAt deliveredAt
        trackingInfo { company number url }
        events(first: 1, reverse: true) { nodes { status message happenedAt } }
      } }
    }`, { ids })
    if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '))
    if (!Array.isArray(result.data?.nodes)) throw new Error('Shopify shipment details response is incomplete')
    const returnedIds = new Set(result.data.nodes.filter(Boolean).map((node) => node.id))
    if (ids.some((id) => !returnedIds.has(id))) throw new Error('Shopify shipment details are missing one or more fulfillments')
    for (const node of result.data.nodes.filter(Boolean)) {
      const event = node.events?.nodes?.[0]
      details.set(node.id, {
        fulfillmentId: node.id,
        status: event?.status === 'DELIVERED' ? 'DELIVERED' : node.displayStatus,
        estimatedDeliveryAt: node.estimatedDeliveryAt ?? '',
        inTransitAt: node.inTransitAt ?? '',
        deliveredAt: node.deliveredAt ?? '',
        tracking: node.trackingInfo ?? [],
        latestMessage: event?.message ?? '',
        latestEventAt: event?.happenedAt ?? '',
        source: 'shopify',
        checkedAt,
      })
    }
  }
  for (const fulfillment of fulfillments) {
    fulfillment.shipmentDetails = details.get(fulfillment.admin_graphql_api_id || `gid://shopify/Fulfillment/${fulfillment.id}`)
    if (fulfillment.shipmentDetails?.status === 'DELIVERED' || fulfillment.shipmentDetails?.deliveredAt) {
      fulfillment.shipment_status = 'delivered'
      fulfillment.delivered_at = fulfillment.shipmentDetails.deliveredAt || fulfillment.delivered_at
    }
  }
}
