import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to backfill transaction record types");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`
    UPDATE transactions
    SET record_type = CASE WHEN amount > 0 THEN 'income' ELSE 'expense' END
    WHERE record_type IS NULL
      OR (record_type = 'expense' AND amount > 0)
  `);
} finally {
  await client.end();
}