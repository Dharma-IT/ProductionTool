import assert from 'node:assert/strict'
import test from 'node:test'
import { selectImportedPendingMedicalForms } from '../src/services/pendingMedicalForms.js'

test('pending tab accepts only records imported from the specified pending sheet', () => {
  const imported = Array.from({ length: 13 }, (_, index) => ({
    id: `pending-${index}`, recordType: 'pending-medical-form-import',
    sourceFileName: 'DHARMA ORDERS - OCT 17 2024 + - PENDING MEDICAL FORMS.csv',
  }))
  const history = Array.from({ length: 564 }, (_, index) => ({ id: `history-${index}`, medicalForm: 'PENDING' }))
  const unrelated = { recordType: 'pending-medical-form-import', sourceFileName: 'other.csv' }
  assert.deepEqual(selectImportedPendingMedicalForms([...history, ...imported, unrelated]), imported)
})
