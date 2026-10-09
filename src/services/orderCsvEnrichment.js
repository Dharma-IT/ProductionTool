export const requiredOrderCsvHeaders = [
  'firstName', 'lastName', 'phone', 'formattedAddress', 'street', 'street2',
  'city', 'state', 'zip', 'purchase',
]

export const requiredStriveCsvHeaders = ['First Name', 'Last Name', 'Medication', 'Order']

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

function medicationFamily(value) {
  const normalized = cleanCsvValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')

  if (normalized.includes('tirzepatide')) return 'tirzepatide'
  if (normalized.includes('semaglutide')) return 'semaglutide'
  if (normalized.includes('sermorelin') || normalized.includes('sermorlin')) return 'sermorelin'
  if (/\bghk\s*cu\b/.test(normalized)) return 'ghk-cu'
  if (/\bnad\b/.test(normalized)) return 'nad+'
  return ''
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
  if (normalized.includes('semaglutide')) products.add('semaglutide')
  if (normalized.includes('sermorelin') || normalized.includes('sermorlin')) products.add('sermorelin')
  if (/ghk[\s-]*cu/.test(normalized)) products.add('ghk-cu')
  return products
}

function medicalDosage(value) {
  const match = cleanCsvValue(value).match(/\b(\d+(?:\.\d+)?)\s*mg\b/i)
  return match ? Number(match[1]) : null
}

function normalizedDosage(product, dosage) {
  if (product === 'tirzepatide' && (dosage === 24 || dosage === 30)) return '24-30'
  return dosage
}

function medicalProductMatches(treatment, purchase) {
  const treatmentProducts = medicalProducts(treatment)
  const purchaseProducts = medicalProducts(purchase)
  const treatmentDosage = medicalDosage(treatment)
  const purchaseDosage = medicalDosage(purchase)

  return [...treatmentProducts].some((product) => {
    if (!purchaseProducts.has(product)) return false
    if (treatmentDosage === null && purchaseDosage === null) return true
    if (treatmentDosage === null || purchaseDosage === null) return false

    return normalizedDosage(product, treatmentDosage) === normalizedDosage(product, purchaseDosage)
  })
}

function displayLanguage(value) {
  const language = cleanCsvValue(value)
  return /^es(?:[-_]|$)/i.test(language) ? 'Spanish' : language
}

function completionTime(row) {
  const timestamp = Date.parse(cleanCsvValue(row.purchaseSurveyCompletionDate))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function validateOrderCsvHeaders(headers) {
  return requiredOrderCsvHeaders.filter((header) => !headers.includes(header))
}

export function validateStriveCsvHeaders(headers) {
  return requiredStriveCsvHeaders.filter((header) => !headers.includes(header))
}

export function buildStriveCsvLookup(csvRows) {
  const byClientMedication = new Map()
  const clientNames = new Set()

  csvRows.forEach((rawRow) => {
    const row = Object.fromEntries(
      Object.entries(rawRow).map(([key, value]) => [cleanCsvValue(key), cleanCsvValue(value)]),
    )
    const clientName = normalizeName(`${row['First Name']} ${row['Last Name']}`)
    const family = medicationFamily(row.Medication)
    const orderNumber = cleanCsvValue(row.Order)
    if (!clientName || !orderNumber) return

    clientNames.add(clientName)
    if (!family) return

    const key = `${clientName}|${family}`
    const orderNumbers = byClientMedication.get(key) ?? []
    if (!orderNumbers.includes(orderNumber)) orderNumbers.push(orderNumber)
    byClientMedication.set(key, orderNumbers)
  })

  return { byClientMedication, clientNames, rowCount: csvRows.length }
}

export function enrichStriveOrderNumbers(orders, lookup) {
  let matchedCount = 0
  let unmatchedCount = 0
  let ambiguousCount = 0

  const rows = orders.map((order) => {
    const clientName = normalizeName(order.clientName)
    const family = medicationFamily(order.treatment)
    const orderNumbers = family
      ? lookup.byClientMedication.get(`${clientName}|${family}`) ?? []
      : []

    if (orderNumbers.length) {
      matchedCount += 1
      return { ...order, striveOrderNumber1: orderNumbers.join(', ') }
    }

    if (clientName && lookup.clientNames.has(clientName)) ambiguousCount += 1
    else unmatchedCount += 1
    return order
  })

  return { rows, matchedCount, unmatchedCount, ambiguousCount }
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
    const qualifyingMatch = matches.find((row) => medicalProductMatches(order.treatment, row.purchase))
    const hasSubmittedMedicalForm = matches.some((row) => medicalProducts(row.purchase).size > 0)
    const medicalStatus = hubSpotProducts.size > 0
      ? qualifyingMatch
        ? hasCompleteAddress(address) ? 'Yes' : 'Pending'
        : hasSubmittedMedicalForm ? 'Mismatch' : 'Pending'
      : ''

    return {
      ...order,
      language: displayLanguage(languageMatch?.preferredLanguages || order.language),
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
