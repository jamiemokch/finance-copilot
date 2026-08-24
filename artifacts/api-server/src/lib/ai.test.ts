import assert from 'node:assert/strict';
import test from 'node:test';
import type OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { analyseSpreadsheet, analyseSpreadsheetStructure, inspectSpreadsheet } from './spreadsheet.js';
import { analyseSpreadsheetWithAI, detectColumnSchema, providerCallWithTimeout, type SpreadsheetSemanticSession } from './ai.js';
import {
  buildRequestedSpreadsheetContext,
  buildSpreadsheetWorkbookOverview,
  SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
  validateSpreadsheetImportPlan,
  type SpreadsheetImportPlan,
} from './spreadsheet-semantic-contract.js';

function failingClient(responses: Array<() => Promise<never>>): OpenAI {
  let index = 0;
  return {
    chat: {
      completions: {
        create: async () => responses[Math.min(index++, responses.length - 1)!](),
      },
    },
  } as unknown as OpenAI;
}

function scriptedClient(responder: (payload: Record<string, unknown>) => unknown): OpenAI {
  return {
    chat: {
      completions: {
        create: async (input: { messages: Array<{ content: string }> }) => ({
          choices: [{ message: { content: JSON.stringify(responder(JSON.parse(input.messages.at(-1)?.content ?? '{}') as Record<string, unknown>)) } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

function semanticSheet(sheetId: string, disposition: 'transactional' | 'reference', overrides: Record<string, unknown> = {}) {
  const field = (columnId: string | null) => ({ columnId, confidence: columnId ? 92 : 0, rationale: columnId ? 'Observed in bounded context.' : 'Not needed for this sheet.' });
  return {
    sheetId,
    disposition,
    decisionSource: 'ai',
    validationReason: disposition === 'transactional' ? 'This sheet contains dated individual movements.' : 'This sheet contains supporting reference values.',
    purpose: disposition === 'transactional' ? 'Movement ledger' : 'Reference data',
    headerRow: disposition === 'transactional' ? 1 : null,
    dataRange: disposition === 'transactional' ? { startRow: 2, endRow: 2 } : null,
    rowRules: { include: disposition === 'transactional' ? [{ startRow: 2, endRow: 2, reason: 'Movement rows.' }] : [], exclude: [] },
    fields: {
      date: field(disposition === 'transactional' ? 'col_A' : null),
      description: field(disposition === 'transactional' ? 'col_B' : null),
      signedAmount: field(disposition === 'transactional' ? 'col_C' : null),
      debit: field(null), credit: field(null), category: field(null),
    },
    transactionSemantics: { direction: disposition === 'transactional' ? 'mixed' : 'unknown', rationale: 'Bounded workbook evidence.' },
    duplicateOrOverlap: [],
    unresolvedQuestionIds: [],
    ...overrides,
  };
}

function finalResponse(token: string, sheets: unknown[]) {
  return {
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    stage: 'final_plan',
    request: null,
    plan: {
      schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
      status: 'complete',
      continuationToken: token,
      sheets,
      unresolvedQuestions: [],
      abstention: null,
      summary: 'A bounded semantic review is ready for human confirmation.',
    },
  };
}

test('provider retry and timeout failures retain the actual attempt count', async () => {
  const client = failingClient([
    async () => {
      const error = new Error('service unavailable') as Error & { status?: number };
      error.status = 503;
      throw error;
    },
    async () => new Promise<never>(() => undefined),
  ]);

  await assert.rejects(
    () => providerCallWithTimeout(client, '{}', { timeoutMs: 5, retryDelayMs: 0 }),
    (error: unknown) => {
      assert.equal((error as { message?: string }).message, 'timeout');
      assert.equal((error as { providerCalls?: number }).providerCalls, 2);
      return true;
    },
  );
});

test('AI fallback telemetry reports both retry and timeout attempts', async () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Date,Description,Amount',
    '06/04/2025,Consulting payment,125.00',
  ].join('\n')), 'text/csv', 'ledger.csv');
  const analysis = analyseSpreadsheet(workbook);
  const client = failingClient([
    async () => {
      const error = new Error('rate limited') as Error & { status?: number };
      error.status = 429;
      throw error;
    },
    async () => new Promise<never>(() => undefined),
  ]);

  const result = await analyseSpreadsheetWithAI(workbook, analysis, {
    client,
    timeoutMs: 5,
    retryDelayMs: 0,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI analysis timed out.');
  assert.equal(result.providerCalls, 2);
  assert.equal(result.analysis?.sheets.every((sheet) => !sheet.selected), true, 'a provider failure is never an import plan');
  assert.deepEqual(result.analysis?.sheets.map((sheet) => sheet.mapping.columns), [{}], 'manual recovery must not receive locally inferred column defaults');
});

test('structural overview inspects every worksheet without assigning local semantics or exposing narrative values', () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Date,Description,Amount',
    '06/04/2025,"Jane Example jane@example.com",-42.00',
  ].join('\n')), 'text/csv', 'ledger.csv');
  const structural = analyseSpreadsheetStructure(workbook);
  const overview = buildSpreadsheetWorkbookOverview(workbook);

  assert.equal(structural.sheets[0]?.role, 'unknown');
  assert.equal(structural.sheets[0]?.selected, false);
  assert.equal(structural.sheets[0]?.finalDisposition, 'not_analysed');
  assert.equal(overview.sheets.length, workbook.sheets.length);
  assert.match(JSON.stringify(overview), /\[header:date\]/);
  assert.doesNotMatch(JSON.stringify(overview), /Jane Example|jane@example\.com/);
});

test('only the parser-established header row can expose safe labels, never early transaction narratives', () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Jane Example,Travel,06/04/2025,42.00',
    'John Example,Meals,07/04/2025,13.00',
  ].join('\n')), 'text/csv', 'no-header.csv');
  assert.equal(workbook.sheets[0]?.inferredHeaderRow, null);
  const overview = JSON.stringify(buildSpreadsheetWorkbookOverview(workbook));
  const context = JSON.stringify(buildRequestedSpreadsheetContext(workbook, {
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    continuationToken: '12345678',
    allowedSheetIds: ['sheet_1'],
    requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 2, startColumn: 1, endColumn: 4, chunk: 0, reason: 'Inspect safe structure.' }],
  }));
  for (const payload of [overview, context]) {
    assert.doesNotMatch(payload, /Jane Example|John Example|Travel|Meals/);
    assert.match(payload, /\[text:length-/);
  }
});

test('safe unseen multilingual structural headers reach the semantic provider without exposing row narratives', () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Tarehe,Maelezo,Kiasi',
    '06/04/2025,Malipo ya mteja binafsi,42.00',
    '07/04/2025,Chakula cha biashara,13.00',
  ].join('\n')), 'text/csv', 'kiswahili.csv');
  const overview = JSON.stringify(buildSpreadsheetWorkbookOverview(workbook));
  assert.match(overview, /\[header-label:Tarehe\]/);
  assert.match(overview, /\[header-label:Maelezo\]/);
  assert.match(overview, /\[header-label:Kiasi\]/);
  assert.doesNotMatch(overview, /Malipo ya mteja binafsi|Chakula cha biashara/);
});

test('semantic overview exposes only safe structural title and sheet labels, not personal labels or local source metadata', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['現金帳'],
    ['Tarikh', 'Butiran', 'Jumlah'],
    ['06/04/2025', 'Bayaran pelanggan peribadi', 42],
  ]), '現金帳');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Jane Example private accounts'],
    ['Date', 'Description', 'Amount'],
    ['06/04/2025', 'Private narrative', 10],
  ]), 'Jane Example ledger');
  const workbook = inspectSpreadsheet(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'private.xlsx');
  const overview = JSON.stringify(buildSpreadsheetWorkbookOverview(workbook));
  assert.match(overview, /\[title-label:現金帳\]/);
  assert.match(overview, /\[sheet-label:現金帳\]/);
  assert.doesNotMatch(overview, /Jane Example|Bayaran pelanggan peribadi|Private narrative/);
  assert.doesNotMatch(overview, /contentHash|sourceByteLength/);
});

test('AI can request bounded follow-up context and return an all-sheet semantic plan', async () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Date,Description,Amount',
    '06/04/2025,Invoice paid,125.00',
  ].join('\n')), 'text/csv', 'ledger.csv');
  let calls = 0;
  const client = scriptedClient((payload) => {
    calls += 1;
    const token = String(payload.continuationToken);
    if (calls === 1) {
      return {
        schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
        stage: 'request_context',
        request: {
          schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
          continuationToken: token,
          allowedSheetIds: ['sheet_1'],
          requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 2, startColumn: 1, endColumn: 3, chunk: 0, reason: 'Check the header and one movement.' }],
        },
        plan: null,
      };
    }
    return finalResponse(token, [semanticSheet('sheet_1', 'transactional')]);
  });

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client, retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(result.status, 'success');
  assert.equal(result.analysis?.sheets[0]?.decisionSource, 'ai');
  assert.equal(result.analysis?.sheets[0]?.selected, true);
});

test('provider receives the complete nested strict JSON schema contract', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Sale,10\n'), 'text/csv', 'contract.csv');
  let request: Record<string, unknown> | undefined;
  const client = {
    chat: { completions: { create: async (input: Record<string, unknown>) => {
      request = input;
      const payload = JSON.parse((input.messages as Array<{ content: string }>).at(-1)?.content ?? '{}') as Record<string, unknown>;
      return { choices: [{ message: { content: JSON.stringify(finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')])) } }] };
    } } },
  } as unknown as OpenAI;
  await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client, retryDelayMs: 0 });
  const responseFormat = request?.response_format as { type?: string; json_schema?: { strict?: boolean; schema?: Record<string, unknown> } };
  assert.equal(responseFormat.type, 'json_schema');
  assert.equal(responseFormat.json_schema?.strict, true);
  assert.equal(responseFormat.json_schema?.schema?.additionalProperties, false);
  const defs = responseFormat.json_schema?.schema?.$defs as Record<string, Record<string, unknown>>;
  assert.equal(defs.plan?.additionalProperties, false);
  assert.equal(defs.sheetPlan?.additionalProperties, false);
  assert.equal(defs.fields?.additionalProperties, false);
  assert.equal(defs.request?.additionalProperties, false);
});

test('a persisted pending continuation resumes after an interrupted worker without repeating its overview call', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Restart-only sale,11\n'), 'text/csv', 'resume.csv');
  const checkpoints: SpreadsheetSemanticSession[] = [];
  let firstCalls = 0;
  const interrupted = scriptedClient((payload) => {
    firstCalls += 1;
    if (firstCalls === 1) {
      return {
        schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
        stage: 'request_context',
        request: {
          schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
          continuationToken: String(payload.continuationToken),
          allowedSheetIds: ['sheet_1'],
          requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 2, startColumn: 1, endColumn: 3, chunk: 0, reason: 'Need bounded structure.' }],
        },
        plan: null,
      };
    }
    throw new Error('simulated_worker_interruption');
  });
  await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: interrupted,
    retryDelayMs: 0,
    persistSession: async (session) => { checkpoints.push(structuredClone(session)); },
  });
  const pending = checkpoints.find((session) => session.stage === 'requested_context');
  assert.ok(pending, 'the continuation is durable before the next provider call');
  let resumedCalls = 0;
  const resumed = scriptedClient((payload) => {
    resumedCalls += 1;
    assert.equal(payload.stage, 'requested_context');
    return finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]);
  });
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: resumed,
    retryDelayMs: 0,
    session: pending,
  });
  assert.equal(result.status, 'success');
  assert.equal(resumedCalls, 1);
});

test('legacy spreadsheet column detection is deterministic and never invokes a provider', async () => {
  const mapping = await detectColumnSchema(
    [['Jane Example', 'jane@example.com', 'Account 12345678']],
    'Jane Example private.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  assert.equal(mapping.confidence, 0.35);
  assert.equal(Object.values(mapping.columns).every((value) => value === undefined), true);
});

test('AI plan assigns an explicit final disposition to unseen multilingual and reporting worksheets', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['日付', '内容', '金額'], ['06/04/2025', '売上', 125],
  ]), '今日帳');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['コード', '説明'], ['A1', 'internal reference'],
  ]), 'untitled_42');
  const workbook = inspectSpreadsheet(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'unseen.xlsx');
  let overviewPayload = '';
  const inspectingClient = scriptedClient((payload) => {
    overviewPayload = JSON.stringify(payload);
    return finalResponse(String(payload.continuationToken), [
      semanticSheet('sheet_1', 'transactional'),
      semanticSheet('sheet_2', 'reference'),
    ]);
  });

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client: inspectingClient, retryDelayMs: 0 });
  assert.equal(result.status, 'success');
  assert.match(overviewPayload, /\[header:date\]/, 'the provider receives canonical multilingual header meaning, not raw labels');
  assert.match(overviewPayload, /\[header:description\]/);
  assert.match(overviewPayload, /responseContract/);
  assert.match(overviewPayload, /request_context/);
  assert.match(overviewPayload, /transactionalRule/);
  assert.match(overviewPayload, /\[sheet-label:今日帳\]/, 'safe structural labels retain useful semantic context');
  assert.doesNotMatch(overviewPayload, /untitled_42|売上|internal reference/, 'unsafe tab names and ordinary transaction/reference narratives remain redacted');
  assert.deepEqual(result.analysis?.sheets.map((sheet) => [sheet.displayName, sheet.finalDisposition, sheet.selected]), [
    ['今日帳', 'transactional', true],
    ['untitled_42', 'reference', false],
  ]);
});

test('provider context never exposes worksheet names, title cells, or header-like personal information', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Jane Example — private client ledger'],
    ['Date', 'Description', 'Amount'],
    ['06/04/2025', 'Lunch with Morgan Example', 24],
  ]), 'Jane Example private accounts');
  const workbook = inspectSpreadsheet(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'private.xlsx');
  const overview = JSON.stringify(buildSpreadsheetWorkbookOverview(workbook));
  const context = JSON.stringify(buildRequestedSpreadsheetContext(workbook, {
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    continuationToken: '12345678',
    allowedSheetIds: ['sheet_1'],
    requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 3, startColumn: 1, endColumn: 3, chunk: 0, reason: 'Inspect safe structure.' }],
  }));
  for (const payload of [overview, context]) {
    assert.doesNotMatch(payload, /Jane Example|Morgan Example|private client ledger|private accounts/);
    assert.match(payload, /\[header:date\]/);
  }
  assert.match(overview, /\[sheet:1\]/);
});

test('context requests cannot escape parser-visible ranges or privacy budgets', () => {
  const workbook = inspectSpreadsheet(Buffer.from('A,B\n1,2\n'), 'text/csv', 'safe.csv');
  assert.throws(() => buildRequestedSpreadsheetContext(workbook, {
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    continuationToken: '12345678',
    allowedSheetIds: ['sheet_1'],
    requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 50, startColumn: 1, endColumn: 2, chunk: 0, reason: 'Too much context.' }],
  }));
});

test('completed plans require terminal sheet dispositions and explicit in-range transaction rules', () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Sale,10\n'), 'text/csv', 'plan.csv');
  const valid = finalResponse('12345678', [semanticSheet('sheet_1', 'transactional')]).plan as SpreadsheetImportPlan;
  assert.equal(validateSpreadsheetImportPlan(valid, workbook), null);
  const unresolved = structuredClone(valid);
  assert.ok(unresolved.sheets[0]);
  unresolved.sheets[0].disposition = 'unresolved';
  assert.equal(validateSpreadsheetImportPlan(unresolved, workbook), 'complete_plan_requires_terminal_disposition_for_every_sheet');
  const unbounded = structuredClone(valid);
  assert.ok(unbounded.sheets[0]);
  unbounded.sheets[0].rowRules.include = [];
  assert.equal(validateSpreadsheetImportPlan(unbounded, workbook), 'transactional_sheet_requires_explicit_include_rules');
  const outsideRange = structuredClone(valid);
  assert.ok(outsideRange.sheets[0]?.rowRules.include[0]);
  outsideRange.sheets[0].rowRules.include[0].endRow = 3;
  assert.equal(validateSpreadsheetImportPlan(outsideRange, workbook), 'row_rule_out_of_bounds');
});