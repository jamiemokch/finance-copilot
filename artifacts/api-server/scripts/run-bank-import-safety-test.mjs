import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiServerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDir = path.resolve(apiServerDir, '../..');
const administrationUrl = process.env.BANK_IMPORT_TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;

if (!administrationUrl) {
  console.error(
    'Refusing to run bank-import safety tests because DATABASE_URL is unavailable. '
    + 'The runner creates its own temporary database and never uses shared tables.',
  );
  process.exit(1);
}

const temporaryDatabaseName = `m8_bank_import_test_${process.pid}_${Date.now()}_${randomUUID().slice(0, 8)}`;
if (!/^m8_bank_import_test_[a-z0-9_]+$/i.test(temporaryDatabaseName)) {
  throw new Error('Generated bank-import test database name is invalid.');
}

const testDatabaseUrl = new URL(administrationUrl);
testDatabaseUrl.pathname = `/${temporaryDatabaseName}`;
const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl.toString(),
  NODE_ENV: 'test',
  BANK_IMPORT_TEST_DATABASE: '1',
};

let databaseCreated = false;
try {
  console.log(`Creating isolated temporary database ${temporaryDatabaseName} for bank-import safety tests.`);
  execFileSync('createdb', ['--maintenance-db', administrationUrl, temporaryDatabaseName], {
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
    'src/routes/bank-imports.test.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:pino',
    '--external:pino-http',
    '--external:thread-stream',
    '--external:pino-pretty',
    '--outfile=dist/bank-imports.test.cjs',
  ], { cwd: apiServerDir, stdio: 'inherit', env });

  execFileSync('node', ['--test', 'dist/bank-imports.test.cjs'], {
    cwd: apiServerDir,
    stdio: 'inherit',
    env,
  });
} finally {
  if (databaseCreated) {
    console.log(`Dropping isolated temporary database ${temporaryDatabaseName}.`);
    execFileSync('dropdb', ['--maintenance-db', administrationUrl, '--force', temporaryDatabaseName], {
      cwd: workspaceDir,
      stdio: 'inherit',
      env,
    });
  }
}