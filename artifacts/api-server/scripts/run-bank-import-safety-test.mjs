import { execFileSync } from 'node:child_process';

const testDatabaseUrl = process.env.BANK_IMPORT_TEST_DATABASE_URL;
const testDatabaseMarker = process.env.BANK_IMPORT_TEST_DATABASE;

if (!testDatabaseUrl || testDatabaseMarker !== '1') {
  console.error(
    'Refusing to run bank-import safety tests. '
    + 'Set BANK_IMPORT_TEST_DATABASE=1 and BANK_IMPORT_TEST_DATABASE_URL '
    + 'to an isolated disposable test database.',
  );
  process.exit(1);
}

const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(databaseName)) {
  console.error(
    'Refusing to run bank-import safety tests because '
    + 'BANK_IMPORT_TEST_DATABASE_URL must name a dedicated test database.',
  );
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  NODE_ENV: 'test',
  BANK_IMPORT_TEST_DATABASE: '1',
};

execFileSync('pnpm', [
  'exec',
  'esbuild',
  'src/routes/bank-imports.test.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--external:pino',
  '--external:pino-http',
  '--external:thread-stream',
  '--external:pino-pretty',
  '--outfile=dist/bank-imports.test.cjs',
], { stdio: 'inherit', env });

execFileSync('node', ['--test', 'dist/bank-imports.test.cjs'], {
  stdio: 'inherit',
  env,
});