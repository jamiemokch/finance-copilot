import { runSpreadsheetProviderCompatibilityCheck } from './ai.js';

async function main() {
  const result = await runSpreadsheetProviderCompatibilityCheck();
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== 'compatible') {
    process.exitCode = 1;
  }
}

void main().catch(() => {
  console.error('The provider compatibility check could not run.');
  process.exitCode = 1;
});