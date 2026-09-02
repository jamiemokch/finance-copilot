import assert from 'node:assert/strict';
import test from 'node:test';
import { isConfirmedFinancialMemoryRecord } from './financial-memory.js';

test('classified bank rows and confirmed spreadsheet/document records count as confirmed Financial Memory', () => {
  assert.equal(isConfirmedFinancialMemoryRecord({ recordType: 'income' }), true);
  assert.equal(isConfirmedFinancialMemoryRecord({ recordType: 'expense' }), true);
});

test('an unresolved bank CSV row is excluded from confirmed Financial Memory', () => {
  assert.equal(isConfirmedFinancialMemoryRecord({ recordType: 'unknown' }), false);
});

test('a record with no recordType at all is treated as unresolved, not confirmed', () => {
  assert.equal(isConfirmedFinancialMemoryRecord({}), false);
});
