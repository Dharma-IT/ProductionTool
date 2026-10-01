export const requiredOrderCsvHeaders = [
  'firstName', 'lastName', 'phone', 'formattedAddress', 'street', 'street2',
  'city', 'state', 'zip', 'purchase',
]

const nullLikeValues = new Set(['null', 'undefined'])

export function cleanCsvValue(value) {
  const cleaned = String(value ?? '').trim()
  return nullLikeValues.has(cleaned.toLowerCase()) ? '' : cleaned
}

function normalizePhone(value) {
  const digits = cleanCsvValue(value).replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

function normalizeName(value) {
  return cleanCsvValue(value)
    .replace(/\s*\(\d+\)\s*$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseFormattedAddress(value) {
  const parts = cleanCsvValue(value).split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) return { address: parts[0] ?? '', city: '', state: '', zipCode: '' }

  const stateZip = parts.pop()
  const city = parts.pop()
  const stateZipMatch = stateZip.match(/^(.+?)\s+(\d{5}(?:-\d{4})?)$/)

  return {
    address: parts.join(', '),
    city,
    state: stateZipMatch?.[1]?.trim() ?? stateZip,
    zipCode: stateZipMatch?.[2] ?? '',
  }
}

function readAddress(row) {
  const formatted = parseFormattedAddress(row.formattedAddress)
  const street = cleanCsvValue(row.street)
  const street2 = cleanCsvValue(row.street2)
  const baseAddress = street || formatted.address
  const address = street2 && !normalizeName(baseAddress).includes(normalizeName(street2))
    ? `${baseAddress}, ${street2}`
    : baseAddress

  return {
    address,
    city: cleanCsvValue(row.city) || formatted.city,
    state: cleanCsvValue(row.state) || formatted.state,
    zipCode: cleanCsvValue(row.zip) || formatted.zipCode,
  }
}

function hasCompleteAddress(address) {
  return Boolean(address.address && address.city && address.state && address.zipCode)
}

function medicalProducts(value) {
  const normalized = cleanCsvValue(value).toLowerCase()
  const products = new Set()
  if (normalized.includes('tirzepatide')) products.add('tirzepatide')
  if (normalized.includes('sermorelin') || normalized.includes('sermorlin')) products.add('sermorelin')
  return products
}

function completionTime(row) {
  const timestamp = Date.parse(cleanCsvValue(row.purchaseSurveyCompletionDate))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function validateOrderCsvHeaders(headers) {
  return requiredOrderCsvHeaders.filter((header) => !headers.includes(header))
}

function readTreatmentItems(treatment) {
  const value = cleanCsvValue(treatment)
  const matches = [...value.matchAll(/(\d+)\s*x\s+(.+?)(?=,\s*\d+\s*x\s+|$)/gi)]
  if (!matches.length) return [{ quantity: 1, product: value }]

  const itemsByProduct = new Map()
  matches.forEach((match) => {
    const quantity = Number(match[1])
    const product = cleanCsvValue(match[2])
    const key = product.toLowerCase().replace(/\s+/g, ' ')
    const existing = itemsByProduct.get(key)
    itemsByProduct.set(key, {
      quantity: (existing?.quantity ?? 0) + quantity,
      product: existing?.product ?? product,
    })
  })

  return [...itemsByProduct.values()]
}

export function expandHubSpotOrderItems(orders) {
  return orders.flatMap((order) => {
    const baseName = cleanCsvValue(order.clientName).replace(/\s*\(\d+\)\s*$/, '')

    return readTreatmentItems(order.treatment).map((item, index) => ({
      ...order,
      id: `${order.id}:item-${index + 1}`,
      clientName: `${baseName}${item.quantity > 1 ? ` (${item.quantity})` : ''}`,
      treatment: item.product ? `${item.quantity}x ${item.product}` : '',
    }))
  })
}

export function buildOrderCsvLookup(csvRows) {
  const byPhone = new Map()
  const byName = new Map()

  csvRows.forEach((rawRow) => {
    const row = Object.fromEntries(
      Object.entries(rawRow).map(([key, value]) => [cleanCsvValue(key), cleanCsvValue(value)]),
    )
    const phone = normalizePhone(row.phone)
    const name = normalizeName(`${row.firstName} ${row.lastName}`)

    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), row])
    if (name) byName.set(name, [...(byName.get(name) ?? []), row])
  })

  return { byPhone, byName, rowCount: csvRows.length }
}

function findMatches(order, lookup) {
  const phoneMatches = lookup.byPhone.get(normalizePhone(order.number)) ?? []
  if (phoneMatches.length) return phoneMatches
  return lookup.byName.get(normalizeName(order.clientName)) ?? []
}

export function enrichHubSpotOrders(orders, lookup) {
  let matchedCount = 0

  const rows = orders.map((order) => {
    const matches = [...findMatches(order, lookup)]
      .sort((left, right) => completionTime(right) - completionTime(left))
    if (matches.length) matchedCount += 1

    const addressMatch = matches.find((row) => hasCompleteAddress(readAddress(row))) ?? matches[0]
    const languageMatch = matches.find((row) => cleanCsvValue(row.preferredLanguages))
    const address = addressMatch ? readAddress(addressMatch) : {
      address: '', city: '', state: '', zipCode: '',
    }
    const hubSpotProducts = medicalProducts(order.treatment)
    const qualifyingMatch = matches.find((row) => {
      const csvProducts = medicalProducts(row.purchase)
      return [...hubSpotProducts].some((product) => csvProducts.has(product))
    })
    const medicalStatus = hubSpotProducts.size > 0
      ? qualifyingMatch && hasCompleteAddress(address) ? 'Yes' : 'Pending'
      : ''

    return {
      ...order,
      language: cleanCsvValue(languageMatch?.preferredLanguages) || cleanCsvValue(order.language),
      address: address.address,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
      medicalForm: medicalStatus,
      doctorPrescribed: '',
    }
  })

  return { rows, matchedCount }
}
