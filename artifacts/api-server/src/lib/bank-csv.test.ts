import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBankCsv,
  parseMappedBankRows,
  suggestBankMapping,
} from "./bank-csv.js";

test("bank CSV parser handles quoted multiline descriptions and debit/credit signs", () => {
  const csv = [
    "Date,Description,Debit,Credit,Reference,Balance",
    '21/04/2026,"Card purchase',
    'at local shop",12.50,,CARD-1,"1,234.50"',
    "22/04/2026,Client payment,,120.00,INV-7,1354.50",
  ].join("\n");
  const parsed = parseBankCsv(Buffer.from(csv));
  const rows = parseMappedBankRows(parsed.rows, {
    headerRow: 0,
    columns: { date: 0, description: 1, debit: 2, credit: 3, reference: 4, balance: 5 },
    dateFormat: "dmy",
    decimalConvention: "dot",
  }, "2026/27");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2026-04-21");
  assert.equal(rows[0].amount, -12.5);
  assert.equal(rows[0].description, "Card purchase\nat local shop");
  assert.equal(rows[0].balance, 1234.5);
  assert.equal(rows[1].amount, 120);
  assert.equal(rows[1].direction, "money_in");
});

test("bank CSV parser retains invalid and out-of-scope rows for review", () => {
  const csv = [
    "Booking Date;Description;Amount",
    "01/01/2026;Before period;10,00",
    "31/04/2026;Impossible date;10,00",
    "01/05/2026;Within period;-10,00",
  ].join("\n");
  const parsed = parseBankCsv(Buffer.from(csv));
  const rows = parseMappedBankRows(parsed.rows, {
    headerRow: 0,
    columns: { date: 0, description: 1, amount: 2 },
    dateFormat: "dmy",
    decimalConvention: "comma",
  }, "2026/27");

  assert.equal(rows[0].validationStatus, "out_of_scope");
  assert.equal(rows[1].validationStatus, "invalid");
  assert.match(rows[1].validationErrors.join(" "), /real date/);
  assert.equal(rows[2].validationStatus, "valid");
});

test("mapping suggestion detects bank-style headings and ambiguous decimals", () => {
  const parsed = parseBankCsv(Buffer.from([
    "Transaction Date,Details,Amount",
    '21/04/2026,Payment,"1,234"',
  ].join("\n")));
  const suggestion = suggestBankMapping(parsed.rows);
  assert.equal(suggestion.mapping.columns.date, 0);
  assert.equal(suggestion.mapping.columns.description, 1);
  assert.equal(suggestion.mapping.columns.amount, 2);
  assert.equal(suggestion.decimalConvention, "ambiguous");
});