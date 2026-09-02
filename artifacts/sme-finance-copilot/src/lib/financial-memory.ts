// A bank CSV row stays `recordType: "unknown"` until a person assigns its
// accounting meaning; spreadsheet/document confirmation always produces
// "income" or "expense" directly. This is the one predicate that decides
// whether a record counts as confirmed Financial Memory, regardless of
// which ingestion path produced it — downstream P&L/tax readers already
// apply the same "unknown" exclusion server-side.
export function isConfirmedFinancialMemoryRecord(record: { recordType?: 'income' | 'expense' | 'unknown' }): boolean {
  return record.recordType === 'income' || record.recordType === 'expense';
}
