import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiServerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDir = path.resolve(apiServerDir, '../..');
const administrationUrl = process.env.EVIDENCE_TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;

if (!administrationUrl) {
  console.error(
    'Refusing to run M9 evidence safety tests because DATABASE_URL is unavailable. '
    + 'The runner creates its own temporary database and never uses shared tables.',
  );
  process.exit(1);
}

const databaseName = `m9_evidence_test_${process.pid}_${Date.now()}_${randomUUID().slice(0, 8)}`;
const testDatabaseUrl = new URL(administrationUrl);
testDatabaseUrl.pathname = `/${databaseName}`;
const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl.toString(),
  NODE_ENV: 'test',
  EVIDENCE_TEST_DATABASE: '1',
  AI_INTEGRATIONS_OPENAI_API_KEY: '',
  OPENAI_API_KEY: '',
};

let databaseCreated = false;
try {
  console.log(`Creating isolated temporary database ${databaseName} for M9 evidence safety tests.`);
  execFileSync('createdb', ['--maintenance-db', administrationUrl, databaseName], {
    cwd: workspaceDir,
    stdio: 'inherit',
    env,
  });
  databaseCreated = true;
  execFileSync('pnpm', ['--filter', '@workspace/db', 'run', 'push'], {
    cwd: workspaceDir,
    stdio: 'inherit',
    env,
  });
  execFileSync('pnpm', [
    'exec',
    'esbuild',
    'src/routes/evidence.test.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:pino',
    '--external:pino-http',
    '--external:thread-stream',
    '--external:pino-pretty',
    '--outfile=dist/evidence.test.cjs',
  ], {
    cwd: apiServerDir,
    stdio: 'inherit',
    env,
  });
  execFileSync('node', ['--test', 'dist/evidence.test.cjs'], {
    cwd: apiServerDir,
    stdio: 'inherit',
    env,
  });
} finally {
  if (databaseCreated) {
    console.log(`Dropping isolated temporary database ${databaseName}.`);
    execFileSync('dropdb', ['--maintenance-db', administrationUrl, '--force', databaseName], {
      cwd: workspaceDir,
      stdio: 'inherit',
      env,
    });
  }
}