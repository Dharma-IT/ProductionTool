import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOrderCsvLookup,
  enrichHubSpotOrders,
  expandHubSpotOrderItems,
  validateOrderCsvHeaders,
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

  assert.equal(result.rows[0].medicalForm, 'Pending')
  assert.equal(result.rows[0].doctorPrescribed, '')
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
