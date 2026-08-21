import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to migrate legacy transaction record types");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // This is an explicit, one-time migration for pre-classification rows only.
  // It must never reinterpret a persisted non-null classification: a positive
  // imported row can be explicitly classified as an expense.
  const result = await client.query(`
    UPDATE transactions
    SET record_type = CASE WHEN amount > 0 THEN 'income' ELSE 'expense' END
    WHERE record_type IS NULL
  `);
  console.info(`Migrated ${result.rowCount ?? 0} legacy transaction record type(s).`);
} finally {
  await client.end();
}