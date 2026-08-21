import { execFileSync } from 'node:child_process';

const testDatabaseUrl = process.env.SELF_ASSESSMENT_TEST_DATABASE_URL;
const testDatabaseMarker = process.env.SELF_ASSESSMENT_TEST_DATABASE;

if (!testDatabaseUrl || testDatabaseMarker !== '1') {
  console.error(
    'Refusing to run database-backed Self Assessment tests. '
    + 'Set SELF_ASSESSMENT_TEST_DATABASE=1 and SELF_ASSESSMENT_TEST_DATABASE_URL '
    + 'to an isolated disposable test database.',
  );
  process.exit(1);
}

const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(databaseName)) {
  console.error(
    'Refusing to run database-backed Self Assessment tests because '
    + 'SELF_ASSESSMENT_TEST_DATABASE_URL must name a dedicated test database.',
  );
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  NODE_ENV: 'test',
  SELF_ASSESSMENT_TEST_DATABASE: '1',
};

execFileSync('pnpm', [
  'exec',
  'esbuild',
  'src/routes/self-assessment.test.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--external:pino',
  '--external:pino-http',
  '--external:thread-stream',
  '--external:pino-pretty',
  '--outfile=dist/self-assessment.test.cjs',
], { stdio: 'inherit', env });

execFileSync('node', ['--test', 'dist/self-assessment.test.cjs'], {
  stdio: 'inherit',
  env,
});