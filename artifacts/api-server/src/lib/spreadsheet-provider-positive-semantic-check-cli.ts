import { runSpreadsheetProviderPositiveSemanticCompatibilityCheck } from './ai.js';

async function main() {
  const result = await runSpreadsheetProviderPositiveSemanticCompatibilityCheck();
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== 'compatible' || result.semanticBranch !== 'final_plan') {
    process.exitCode = 1;
  }
}

void main().catch(() => {
  console.error('The positive spreadsheet provider compatibility check could not run.');
  process.exitCode = 1;
});