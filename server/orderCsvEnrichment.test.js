import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOrderCsvLookup,
  enrichHubSpotOrders,
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
    (({ address, city, state, zipCode, medicalForm, doctorPrescribed }) => (
      { address, city, state, zipCode, medicalForm, doctorPrescribed }
    ))(result.rows[0]),
    {
      address: '10 Main Street, Apt 2',
      city: 'Newark',
      state: 'NJ',
      zipCode: '07105',
      medicalForm: 'Yes',
      doctorPrescribed: 'Yes',
    },
  )
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
  assert.equal(result.rows[0].doctorPrescribed, 'Pending')
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
