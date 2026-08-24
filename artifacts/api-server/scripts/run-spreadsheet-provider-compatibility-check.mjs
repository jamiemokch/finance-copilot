import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiServerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = 'dist/spreadsheet-provider-compatibility-check.cjs';

execFileSync('pnpm', [
  'exec',
  'esbuild',
  'src/lib/spreadsheet-provider-compatibility-check-cli.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--outfile=' + outputFile,
], { cwd: apiServerDir, stdio: 'inherit', env: process.env });

const check = spawnSync('node', [outputFile], {
  cwd: apiServerDir,
  stdio: 'inherit',
  env: process.env,
});

if (check.error) throw check.error;
process.exitCode = check.status ?? 1;