import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canBuildYearEndPack,
  computeYearEndTotals,
  shouldShowGeneratedYearEndPack,
  yearEndReadinessPercent,
} from './year-end-pack.js';

test('pack can only be built once Inbox is clear and the checklist is materially complete', () => {
  assert.equal(canBuildYearEndPack({ total: 4, done: 4 }, 0), true);
  assert.equal(canBuildYearEndPack({ total: 4, done: 3 }, 0), true);
  assert.equal(canBuildYearEndPack({ total: 4, done: 2 }, 0), false);
  assert.equal(canBuildYearEndPack({ total: 4, done: 4 }, 1), false);
});

test('a previously generated pack stops presenting as ready once new pending Inbox items appear', () => {
  const readyChecklist = { total: 4, done: 4 };
  assert.equal(shouldShowGeneratedYearEndPack(true, readyChecklist, 0), true);
  assert.equal(shouldShowGeneratedYearEndPack(true, readyChecklist, 2), false);
});

test('a previously generated pack stops presenting as ready if a checklist task is reopened', () => {
  assert.equal(shouldShowGeneratedYearEndPack(true, { total: 4, done: 2 }, 0), false);
});

test('an ungenerated pack never shows regardless of readiness', () => {
  assert.equal(shouldShowGeneratedYearEndPack(false, { total: 4, done: 4 }, 0), false);
});

test('confirmed totals sum revenues and confirmed expenses only and derive profit without new arithmetic ownership', () => {
  const totals = computeYearEndTotals(
    [{ amount: 1000 }, { amount: 500 }],
    [{ amount: 300 }],
  );
  assert.deepEqual(totals, { confirmedIncome: 1500, confirmedAllowableExpenses: 300, confirmedProfit: 1200 });
});

test('readiness percent rounds and guards a zero-total checklist', () => {
  assert.equal(yearEndReadinessPercent({ total: 0, done: 0 }), 0);
  assert.equal(yearEndReadinessPercent({ total: 3, done: 1 }), 33);
});
