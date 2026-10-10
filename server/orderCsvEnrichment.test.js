import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOrderCsvLookup,
  buildStriveCsvLookup,
  enrichHubSpotOrders,
  enrichStriveOrderNumbers,
  expandHubSpotOrderItems,
  validateOrderCsvHeaders,
  validateStriveCsvHeaders,
} from '../src/services/orderCsvEnrichment.js'

function csvRow(overrides = {}) {
  return {
    firstName: 'Jeuz',
    lastName: 'Vínci',
    phone: '(555) 123-4567',
    formattedAddress: '10 Main Street Apt 2, Newark, NJ 07105',
    street: '10 Main Street',
    street2: 'Apt 2',
    city: 'Newark',
    state: 'NJ',
    zip: '07105',
    purchase: 'Personalized Tirzepatide+ 52mg',
    preferredLanguages: 'Spanish',
    purchaseSurveyCompletionDate: '2026-09-30T12:00:00Z',
    ...overrides,
  }
}

function order(overrides = {}) {
  return {
    id: 'deal-1',
    number: '+1 555 123 4567',
    clientName: 'Jeuz Vinci (2)',
    treatment: '1x Compounded Tirzepatide 52mg',
    ...overrides,
  }
}

test('matches country-code phone numbers and separates address fields', () => {
  const result = enrichHubSpotOrders([order()], buildOrderCsvLookup([csvRow()]))

  assert.equal(result.matchedCount, 1)
  assert.deepEqual(
    (({ language, address, city, state, zipCode, medicalForm, doctorPrescribed }) => (
      { language, address, city, state, zipCode, medicalForm, doctorPrescribed }
    ))(result.rows[0]),
    {
      language: 'Spanish',
      address: '10 Main Street, Apt 2',
      city: 'Newark',
      state: 'NJ',
      zipCode: '07105',
      medicalForm: 'Yes',
      doctorPrescribed: '',
    },
  )
})

test('keeps the HubSpot language when the uploaded CSV has none', () => {
  const lookup = buildOrderCsvLookup([csvRow({ preferredLanguages: '' })])
  const result = enrichHubSpotOrders([order({ language: 'English' })], lookup)

  assert.equal(result.rows[0].language, 'English')
})

test('maps an uploaded es language code to Spanish', () => {
  const lookup = buildOrderCsvLookup([csvRow({ preferredLanguages: 'es' })])
  const result = enrichHubSpotOrders([order({ language: 'English' })], lookup)

  assert.equal(result.rows[0].language, 'Spanish')
})

test('falls back to normalized names and formatted addresses', () => {
  const input = csvRow({
    phone: '0000000000', street: '', street2: '', city: '', state: '', zip: '',
  })
  const result = enrichHubSpotOrders([order({ number: '' })], buildOrderCsvLookup([input]))

  assert.equal(result.matchedCount, 1)
  assert.equal(result.rows[0].address, '10 Main Street Apt 2')
  assert.equal(result.rows[0].zipCode, '07105')
})

test('requires the same medical product in HubSpot and the CSV', () => {
  const lookup = buildOrderCsvLookup([csvRow({ purchase: 'Sermorelin 60-Day Supply' })])
  const result = enrichHubSpotOrders([order()], lookup)

  assert.equal(result.rows[0].medicalForm, 'Mismatch')
  assert.equal(result.rows[0].doctorPrescribed, '')
})

test('marks a different dosage of the same medical product as a mismatch', () => {
  const lookup = buildOrderCsvLookup([csvRow({ purchase: 'Personalized Tirzepatide+ 30mg' })])
  const result = enrichHubSpotOrders([
    order({ clientName: 'Danay Martin', treatment: '1x Compounded Tirzepatide 52mg' }),
  ], lookup)

  assert.equal(result.rows[0].medicalForm, 'Mismatch')
})

test('treats Tirzepatide 24mg and 30mg forms as equivalent', () => {
  const lookup = buildOrderCsvLookup([csvRow({ purchase: 'Personalized Tirzepatide+ 30mg' })])
  const result = enrichHubSpotOrders([
    order({ treatment: '1x Compounded Tirzepatide 24mg' }),
  ], lookup)

  assert.equal(result.rows[0].medicalForm, 'Yes')
})

test('requires other dosages to match exactly', () => {
  const matchingLookup = buildOrderCsvLookup([csvRow({ purchase: 'Personalized Tirzepatide+ 52mg' })])
  const mismatchingLookup = buildOrderCsvLookup([csvRow({ purchase: 'Personalized Tirzepatide+ 24mg' })])

  assert.equal(enrichHubSpotOrders([order()], matchingLookup).rows[0].medicalForm, 'Yes')
  assert.equal(enrichHubSpotOrders([order()], mismatchingLookup).rows[0].medicalForm, 'Mismatch')
})

test('keeps a missing medical form pending instead of marking it as a mismatch', () => {
  const lookup = buildOrderCsvLookup([csvRow({ purchase: 'Nutrition Consultation' })])
  const result = enrichHubSpotOrders([order()], lookup)

  assert.equal(result.rows[0].medicalForm, 'Pending')
})

test('treats matching Semaglutide as a medical product', () => {
  const lookup = buildOrderCsvLookup([csvRow({ purchase: 'Personalized Semaglutide+ 1mg' })])
  const result = enrichHubSpotOrders([
    order({ treatment: '1x Compounded Semaglutide 1mg' }),
  ], lookup)

  assert.equal(result.rows[0].medicalForm, 'Yes')
  assert.equal(result.rows[0].doctorPrescribed, '')
})

test('marks GHK-Cu pending until it is verified by the uploaded CSV', () => {
  const unmatchedLookup = buildOrderCsvLookup([csvRow({ purchase: 'Lipo-Mino' })])
  const pendingResult = enrichHubSpotOrders([
    order({ treatment: '1x GHK-Cu Troches - 3 Months' }),
  ], unmatchedLookup)

  assert.equal(pendingResult.rows[0].medicalForm, 'Pending')

  const verifiedLookup = buildOrderCsvLookup([csvRow({ purchase: 'GHK-Cu Troches (One Time / 90-Day Supply)' })])
  const verifiedResult = enrichHubSpotOrders([
    order({ treatment: '1x GHK-Cu Troches - 3 Months' }),
  ], verifiedLookup)

  assert.equal(verifiedResult.rows[0].medicalForm, 'Yes')
})

test('leaves non-medical products blank and removes null-like address values', () => {
  const lookup = buildOrderCsvLookup([csvRow({
    formattedAddress: 'null', street: 'null', street2: 'undefined', city: 'null', state: 'null', zip: 'null',
    purchase: 'Nutrition Consultation',
  })])
  const result = enrichHubSpotOrders([
    order({ treatment: '1x Nutrition Consultation' }),
  ], lookup)

  assert.equal(result.rows[0].address, '')
  assert.equal(result.rows[0].medicalForm, '')
})

test('reports missing required headers', () => {
  assert.deepEqual(validateOrderCsvHeaders(['firstName', 'lastName']), [
    'phone', 'formattedAddress', 'street', 'street2', 'city', 'state', 'zip', 'purchase',
  ])
})

test('expands distinct products and keeps quantities on the matching name', () => {
  const expanded = expandHubSpotOrderItems([order({
    clientName: 'Norma Thorne (7)',
    treatment: '1x Personalized Nutrition Consultation, 1x Compounded Tirzepatide 52mg, 5x Subscription GLP-1 Support',
  })])

  assert.deepEqual(expanded.map(({ clientName, treatment }) => ({ clientName, treatment })), [
    { clientName: 'Norma Thorne', treatment: '1x Personalized Nutrition Consultation' },
    { clientName: 'Norma Thorne', treatment: '1x Compounded Tirzepatide 52mg' },
    { clientName: 'Norma Thorne (5)', treatment: '5x Subscription GLP-1 Support' },
  ])
})

test('combines repeated identical products into one product row', () => {
  const expanded = expandHubSpotOrderItems([order({
    treatment: '2x GLP-1 Support, 3x GLP-1 Support',
  })])

  assert.equal(expanded.length, 1)
  assert.equal(expanded[0].clientName, 'Jeuz Vinci (5)')
  assert.equal(expanded[0].treatment, '5x GLP-1 Support')
})

test('validates the required Strive headers without requiring Strenght', () => {
  assert.deepEqual(validateStriveCsvHeaders([
    'First Name', 'Last Name', 'Medication', 'Order', 'Order Status', 'Strenght',
  ]), [])
  assert.deepEqual(validateStriveCsvHeaders(['First Name', 'Medication']), [
    'Last Name', 'Order', 'Order Status',
  ])
})

test('matches normalized client names and medication families', () => {
  const lookup = buildStriveCsvLookup([{
    'First Name': 'Jeuz', 'Last Name': 'V\u00ednci', Medication: 'TIRZEPATIDE/GLYCINE/B12',
    Order: '11111', 'Order Status': 'Complete Processing',
  }])
  const result = enrichStriveOrderNumbers([
    order({ clientName: '  JEUZ, VINCI (2) ', treatment: '1x Compounded Tirzepatide 52mg' }),
  ], lookup)

  assert.equal(result.matchedCount, 1)
  assert.equal(result.rows[0].striveOrderNumber1, '11111')
})

test('combines distinct Strive order numbers in CSV order and ignores blanks and duplicates', () => {
  const lookup = buildStriveCsvLookup([
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '11111', 'Order Status': 'Complete Processing' },
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '', 'Order Status': 'Complete Processing' },
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '212222', 'Order Status': 'Complete Processing' },
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '11111', 'Order Status': 'Complete Processing' },
  ])
  const result = enrichStriveOrderNumbers([order()], lookup)

  assert.equal(result.rows[0].striveOrderNumber1, '11111, 212222')
})

test('does not overwrite an existing Strive value when medication does not match', () => {
  const lookup = buildStriveCsvLookup([{
    'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'NAD+', Order: '99999',
    'Order Status': 'Complete Processing',
  }])
  const result = enrichStriveOrderNumbers([
    order({ striveOrderNumber1: 'existing' }),
    order({ id: 'deal-2', clientName: 'Someone Else', striveOrderNumber1: 'also existing' }),
  ], lookup)

  assert.equal(result.rows[0].striveOrderNumber1, 'existing')
  assert.equal(result.rows[1].striveOrderNumber1, 'also existing')
  assert.equal(result.ambiguousCount, 1)
  assert.equal(result.unmatchedCount, 1)
})

test('matches supported Strive medication aliases including NAD and GHK-Cu', () => {
  const lookup = buildStriveCsvLookup([
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'NAD+', Order: '300', 'Order Status': 'Complete Processing' },
    { 'First Name': 'Ana', 'Last Name': 'Calderon', Medication: 'GHK-CU peptide', Order: '400', 'Order Status': 'Complete Processing' },
  ])
  const result = enrichStriveOrderNumbers([
    order({ treatment: '1x NAD+ 200mg' }),
    order({ id: 'deal-2', clientName: 'Ana Calderon', treatment: '1x GHK-Cu Troches' }),
  ], lookup)

  assert.deepEqual(result.rows.map((row) => row.striveOrderNumber1), ['300', '400'])
})

test('routes Strive numbers into columns by order status', () => {
  const lookup = buildStriveCsvLookup([
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '100', 'Order Status': 'Complete Processing' },
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '200', 'Order Status': 'On Hold' },
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '300', 'Order Status': 'Future Orders' },
    { 'First Name': 'Jeuz', 'Last Name': 'Vinci', Medication: 'Tirzepatide', Order: '400', 'Order Status': 'Completed Orders' },
  ])
  const result = enrichStriveOrderNumbers([order()], lookup)

  assert.equal(result.rows[0].striveOrderNumber1, '100, 400')
  assert.equal(result.rows[0].striveOrderNumber2, '200')
  assert.equal(result.rows[0].futureOrderNumber, '300')
})
