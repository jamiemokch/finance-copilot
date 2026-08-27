import assert from 'node:assert/strict';
import test from 'node:test';
import type OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { analyseSpreadsheet, analyseSpreadsheetStructure, inspectSpreadsheet } from './spreadsheet.js';
import {
  analyseSpreadsheetWithAI,
  detectColumnSchema,
  providerCallWithTimeout,
  resetManagedSpreadsheetProviderPolicyForTests,
  runSpreadsheetProviderCompatibilityCheck,
  runSpreadsheetProviderPositiveSemanticCompatibilityCheck,
  SPREADSHEET_PROVIDER_MODEL,
  type SpreadsheetSemanticSession,
} from './ai.js';
import { SPREADSHEET_PROVIDER_ATTEMPT_CONTRACT_DIAGNOSTIC_VERSION, type SpreadsheetProviderAttempt } from './spreadsheet-understanding.js';
import {
  buildRequestedSpreadsheetContext,
  buildSpreadsheetWorkbookOverview,
  SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
  spreadsheetAIResponseJsonSchema,
  spreadsheetAIResponseSchema,
  spreadsheetAIProviderWireResponseSchema,
  validateSpreadsheetImportPlan,
  type SpreadsheetImportPlan,
} from './spreadsheet-semantic-contract.js';
import {
  buildSpreadsheetProviderCompatibilityPayload,
  SPREADSHEET_PROVIDER_COMPATIBILITY_SHEET_ID,
  SPREADSHEET_PROVIDER_COMPATIBILITY_TOKEN,
  buildSpreadsheetProviderPositiveCompatibilityPayload,
  SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_SHEET_ID,
  SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_TOKEN,
} from './spreadsheet-semantic-contract.js';

function failingClient(responses: Array<() => Promise<never>>): OpenAI {
  let index = 0;
  return {
    chat: {
      completions: {
        create: async (_input: unknown, requestOptions?: { signal?: AbortSignal }) => {
          const response = responses[Math.min(index++, responses.length - 1)!]();
          const signal = requestOptions?.signal;
          if (!signal) return response;
          if (signal.aborted) throw signal.reason;
          return Promise.race([
            response,
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            }),
          ]);
        },
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
    () => providerCallWithTimeout(client, '{}', { timeoutMs: 5, retryDelayMs: 0, maxProviderCalls: 2 }),
    (error: unknown) => {
      assert.equal((error as { message?: string }).message, 'timeout');
      assert.equal((error as { providerCalls?: number }).providerCalls, 2);
      return true;
    },
  );
});

test('a provider timeout aborts the upstream request and records one bounded attempt', async () => {
  let observedSignal: AbortSignal | undefined;
  let aborted = false;
  const client = {
    chat: { completions: { create: async (_input: unknown, requestOptions?: { signal?: AbortSignal; maxRetries?: number }) => {
      observedSignal = requestOptions?.signal;
      assert.equal(requestOptions?.maxRetries, 0, 'spreadsheet calls disable SDK retries');
      return new Promise<never>((_resolve, reject) => {
        const signal = observedSignal;
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    } } },
  } as unknown as OpenAI;

  await assert.rejects(
    () => providerCallWithTimeout(client, '{}', { timeoutMs: 5, maxProviderCalls: 1 }),
    (error: unknown) => {
      assert.equal((error as Error).message, 'timeout');
      assert.equal((error as { providerCalls?: number }).providerCalls, 1);
      return true;
    },
  );
  assert.equal(observedSignal?.aborted, true, 'the request signal is aborted rather than merely raced');
  assert.equal(aborted, true, 'the upstream request observes cancellation');
});

test('spreadsheet retry accounting is the only retry authority', async () => {
  const sdkRetryLimits: Array<number | undefined> = [];
  let calls = 0;
  const client = {
    chat: { completions: { create: async (_input: unknown, requestOptions?: { maxRetries?: number }) => {
      sdkRetryLimits.push(requestOptions?.maxRetries);
      calls += 1;
      if (calls === 1) {
        const error = new Error('temporary upstream failure') as Error & { status?: number };
        error.status = 503;
        throw error;
      }
      return { choices: [{ message: { content: '{}' } }] };
    } } },
  } as unknown as OpenAI;

  const result = await providerCallWithTimeout(client, '{}', { retryDelayMs: 0, maxProviderCalls: 2 });
  assert.equal(result.providerCalls, 2);
  assert.equal(calls, 2, 'only the bounded application retry issues the second request');
  assert.deepEqual(sdkRetryLimits, [0, 0]);
});

test('a managed strict-schema alias rejection is safe, typed, and never selects another model or object mode', async () => {
  const attemptedModes: string[] = [];
  const attemptedModels: string[] = [];
  const telemetry: Array<{ telemetryVersion: string; requestedModel: string; resolvedModel: string; responseMode: string; outcomeCategory: string; safeStatus: string }> = [];
  let calls = 0;
  const client = {
    chat: { completions: { create: async (input: { model?: string; response_format?: { type?: string } }) => {
      calls += 1;
      attemptedModes.push(input.response_format?.type ?? 'missing');
      attemptedModels.push(input.model ?? 'missing');
      if (calls === 1) {
        const error = new Error('response_format json_schema is unsupported; never persist raw workbook value: private-123') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      return { choices: [{ message: { content: '{}' } }] };
    } } },
  } as unknown as OpenAI;

  await assert.rejects(() => providerCallWithTimeout(client, '{}', {
    retryDelayMs: 0,
    routeClass: 'replit_ai_integrations',
    onAttempt: async (attempt) => { telemetry.push(attempt); },
  }), (error: unknown) => {
    assert.equal((error as Error).message, 'provider_schema_invalid');
    assert.equal((error as { providerCalls?: number }).providerCalls, 1);
    return true;
  });
  assert.deepEqual(attemptedModes, ['json_schema']);
  assert.deepEqual(attemptedModels, [SPREADSHEET_PROVIDER_MODEL]);
  assert.deepEqual(telemetry.map((attempt) => [attempt.requestedModel, attempt.resolvedModel, attempt.responseMode, attempt.outcomeCategory, attempt.safeStatus]), [
    [SPREADSHEET_PROVIDER_MODEL, SPREADSHEET_PROVIDER_MODEL, 'json_schema', 'provider_schema_invalid', 'provider_schema_invalid'],
  ]);
  assert.equal(telemetry.every((attempt) => attempt.telemetryVersion === 'spreadsheet-provider-attempt.v1'), true);
  assert.equal(telemetry.every((attempt) => !/unsupported|private-123|workbook value|messages|content/i.test(JSON.stringify(attempt))), true);
});

test('JSON-object fallback is available only to an explicit non-managed compatibility caller', async () => {
  const attempted: Array<[string, string]> = [];
  let calls = 0;
  const client = {
    chat: { completions: { create: async (input: { model?: string; response_format?: { type?: string } }) => {
      calls += 1;
      attempted.push([input.model ?? 'missing', input.response_format?.type ?? 'missing']);
      if (calls < 2) {
        const error = new Error('response_format json_schema is unsupported') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      return { choices: [{ message: { content: '{}' } }] };
    } } },
  } as unknown as OpenAI;

  const result = await providerCallWithTimeout(client, '{}', {
    retryDelayMs: 0, routeClass: 'direct_openai', allowJsonObjectFallback: true,
  });
  assert.equal(result.providerCalls, 2);
  assert.deepEqual(attempted, [
    [SPREADSHEET_PROVIDER_MODEL, 'json_schema'],
    [SPREADSHEET_PROVIDER_MODEL, 'json_object'],
  ]);
});

test('a provider attempt without contractDiagnostic keeps its existing outcome, status, and failure behavior', async () => {
  const telemetry: SpreadsheetProviderAttempt[] = [];
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }] }) } },
  } as unknown as OpenAI;

  const result = await providerCallWithTimeout(client, '{}', {
    retryDelayMs: 0,
    classifyResponse: () => null,
    onAttempt: async (attempt) => { telemetry.push(attempt); },
  });

  assert.equal(result.providerCalls, 1);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].outcomeCategory, 'success');
  assert.equal(telemetry[0].safeStatus, 'ok');
  assert.equal(telemetry[0].failurePhase, null);
  assert.equal(telemetry[0].contractDiagnostic, undefined);
  assert.equal('contractDiagnostic' in JSON.parse(JSON.stringify(telemetry[0])), false, 'an absent optional field must not appear in the serialized attempt shape');
});

test('a provider-request failure attempt keeps its existing shape with contractDiagnostic absent', async () => {
  const telemetry: SpreadsheetProviderAttempt[] = [];
  const client = {
    chat: { completions: { create: async () => {
      const error = new Error('synthetic upstream failure') as Error & { status?: number };
      error.status = 500;
      throw error;
    } } },
  } as unknown as OpenAI;

  await assert.rejects(() => providerCallWithTimeout(client, '{}', {
    retryDelayMs: 0,
    maxProviderCalls: 1,
    onAttempt: async (attempt) => { telemetry.push(attempt); },
  }));

  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].failurePhase, 'provider_request');
  assert.equal(telemetry[0].contractDiagnostic, undefined);
});

test('a classifyResponse implementation may optionally carry contractDiagnostic through without changing outcome/status/failure semantics', async () => {
  const telemetry: SpreadsheetProviderAttempt[] = [];
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }] }) } },
  } as unknown as OpenAI;
  const contractDiagnostic = { diagnosticVersion: 'spreadsheet-provider-attempt-contract-diagnostic.v1' as const };

  const result = await providerCallWithTimeout(client, '{}', {
    retryDelayMs: 0,
    classifyResponse: () => ({ outcomeCategory: 'contract_invalid', safeStatus: 'contract_invalid', failurePhase: 'response_validation', contractDiagnostic }),
    onAttempt: async (attempt) => { telemetry.push(attempt); },
  });

  assert.equal(result.providerCalls, 1);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].outcomeCategory, 'contract_invalid');
  assert.equal(telemetry[0].safeStatus, 'contract_invalid');
  assert.equal(telemetry[0].failurePhase, 'response_validation');
  assert.deepEqual(telemetry[0].contractDiagnostic, contractDiagnostic);
});

test('a historical provider attempt literal built without contractDiagnostic remains a valid SpreadsheetProviderAttempt and round-trips through JSON unchanged', () => {
  const attempt: SpreadsheetProviderAttempt = {
    telemetryVersion: 'spreadsheet-provider-attempt.v1',
    attemptNumber: 1,
    routeClass: 'replit_ai_integrations',
    requestedModel: SPREADSHEET_PROVIDER_MODEL,
    resolvedModel: SPREADSHEET_PROVIDER_MODEL,
    model: SPREADSHEET_PROVIDER_MODEL,
    responseMode: 'json_schema',
    startedAt: '2026-08-24T12:48:28.303Z',
    durationMs: 10,
    outcomeCategory: 'success',
    safeStatus: 'ok',
    statusCode: null,
    retryable: false,
    failurePhase: null,
  };

  const roundTripped = JSON.parse(JSON.stringify(attempt));
  assert.deepEqual(roundTripped, attempt);
  assert.equal('contractDiagnostic' in roundTripped, false);
});

test('a response exceeding the response-size safety limit gets only the bounded response_size contractDiagnostic, with existing outcome/status/failure semantics unchanged', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Sale,11\n'), 'text/csv', 'oversized-response.csv');
  const sentinel = 'RESPONSE_SIZE_SENTINEL_MUST_NOT_APPEAR_IN_TELEMETRY';
  const oversized = sentinel + 'x'.repeat(70_000);
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: oversized } }] }) } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client, retryDelayMs: 0 });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI returned a response that did not pass the protected spreadsheet contract.');
  assert.equal(result.providerCalls, 1, 'an oversized response is never sent to the repair pass');
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.outcomeCategory, attempt.safeStatus, attempt.failurePhase]), [
    ['contract_invalid', 'contract_invalid', 'response_validation'],
  ]);
  assert.deepEqual(result.providerAttempts?.[0]?.contractDiagnostic, {
    diagnosticVersion: SPREADSHEET_PROVIDER_ATTEMPT_CONTRACT_DIAGNOSTIC_VERSION,
  });
  assert.doesNotMatch(JSON.stringify(result.providerAttempts), new RegExp(sentinel), 'raw oversized response content must never reach telemetry');
});

test('a non-response-size contract failure remains diagnostic-free', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Sale,11\n'), 'text/csv', 'malformed-response.csv');
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ invalid: true }) } }] }) } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client, retryDelayMs: 0 });

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.outcomeCategory, attempt.failurePhase]), [
    ['contract_invalid', 'response_validation'],
    ['contract_invalid', 'repair_validation'],
  ]);
  assert.equal(result.providerAttempts?.every((attempt) => attempt.contractDiagnostic === undefined), true);
});

test('the manual compatibility probe sends only a synthetic semantic payload and validates the response contract', async () => {
  let request: Record<string, unknown> | undefined;
  const client = {
    chat: { completions: { create: async (input: Record<string, unknown>) => {
      request = input;
      return {
        choices: [{
          message: {
            content: JSON.stringify({ response: {
              schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
              stage: 'abstain',
              request: null,
              plan: {
                schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
                status: 'incomplete',
                continuationToken: SPREADSHEET_PROVIDER_COMPATIBILITY_TOKEN,
                sheets: [{
                  sheetId: SPREADSHEET_PROVIDER_COMPATIBILITY_SHEET_ID,
                  disposition: 'not_analysed',
                  decisionSource: 'manual_recovery',
                  validationReason: 'Synthetic compatibility probe.',
                  purpose: 'Synthetic probe',
                  headerRow: null,
                  dataRange: null,
                  rowRules: { include: [], exclude: [] },
                  fields: {
                    date: { columnId: null, confidence: 0, rationale: 'Not applicable.' },
                    description: { columnId: null, confidence: 0, rationale: 'Not applicable.' },
                    signedAmount: { columnId: null, confidence: 0, rationale: 'Not applicable.' },
                    debit: { columnId: null, confidence: 0, rationale: 'Not applicable.' },
                    credit: { columnId: null, confidence: 0, rationale: 'Not applicable.' },
                    category: { columnId: null, confidence: 0, rationale: 'Not applicable.' },
                  },
                  transactionSemantics: { direction: 'unknown', rationale: 'Not applicable.' },
                  duplicateOrOverlap: [],
                  unresolvedQuestionIds: [],
                }],
                unresolvedQuestions: [],
                abstention: { reason: 'insufficient_evidence', detail: 'Synthetic compatibility probe.', manualRecoveryRequired: true },
                summary: 'Synthetic compatibility probe.',
              },
            } }),
          },
        }],
      };
    } } },
  } as unknown as OpenAI;

  const result = await runSpreadsheetProviderCompatibilityCheck({
    client,
    environment: 'test',
    managedRouteConfigured: true,
    retryDelayMs: 0,
  });
  assert.equal(result.status, 'compatible');
  assert.deepEqual(result.checks, {
    strictSchemaAlias: 'accepted',
    json: 'valid',
    zod: 'valid',
    continuation: 'valid',
    parserBounds: 'valid',
    semanticPlan: 'valid',
    responseContract: 'valid',
  });
  const payload = JSON.parse(String((request?.messages as Array<{ content: string }>).at(-1)?.content)) as Record<string, unknown>;
  assert.equal(payload.stage, 'workbook_overview');
  assert.equal(payload.continuationToken, SPREADSHEET_PROVIDER_COMPATIBILITY_TOKEN);
  assert.deepEqual(payload.overview, buildSpreadsheetProviderCompatibilityPayload().overview);
  assert.doesNotMatch(JSON.stringify(payload.overview), /Jane|email|private/i);
  assert.equal(result.payload.containsWorkbookData, false);
  assert.equal(result.payload.createsRecords, false);
});

test('the positive compatibility probe requires a parser-valid synthetic final plan', async () => {
  let request: Record<string, unknown> | undefined;
  const client = {
    chat: { completions: { create: async (input: Record<string, unknown>) => {
      request = input;
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              response: finalResponse(
                SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_TOKEN,
                [semanticSheet(SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_SHEET_ID, 'transactional')],
              ),
            }),
          },
        }],
      };
    } } },
  } as unknown as OpenAI;

  const result = await runSpreadsheetProviderPositiveSemanticCompatibilityCheck({
    client,
    environment: 'test',
    managedRouteConfigured: true,
    retryDelayMs: 0,
  });
  assert.equal(result.status, 'compatible');
  assert.equal(result.semanticBranch, 'final_plan');
  assert.deepEqual(result.checks, {
    strictSchemaAlias: 'accepted',
    json: 'valid',
    zod: 'valid',
    continuation: 'valid',
    parserBounds: 'valid',
    semanticPlan: 'valid',
    responseContract: 'valid',
  });
  const payload = JSON.parse(String((request?.messages as Array<{ content: string }>).at(-1)?.content)) as Record<string, unknown>;
  assert.equal(payload.continuationToken, SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_TOKEN);
  assert.deepEqual(payload.overview, buildSpreadsheetProviderPositiveCompatibilityPayload().overview);
  assert.doesNotMatch(JSON.stringify(payload), /Jane|email|private|yatson/i);
  assert.equal(result.payload.containsWorkbookData, false);
  assert.equal(result.payload.createsRecords, false);
});

test('the strict provider wire schema is a closed discriminated union with explicit primitive const and enum types', () => {
  const schema = spreadsheetAIResponseJsonSchema as unknown as {
    anyOf?: ReadonlyArray<Record<string, unknown>>;
    properties?: Record<string, unknown>;
  };
  assert.equal(Array.isArray(schema.anyOf), false, 'the managed route requires a plain object root');
  assert.equal(typeof schema.properties, 'object');
  const responseSchema = schema.properties?.response as { anyOf?: ReadonlyArray<Record<string, unknown>> };
  assert.equal(Array.isArray(responseSchema.anyOf), true);
  assert.equal(responseSchema.anyOf?.length, 3);
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      if (Object.hasOwn(node, 'const')) assert.equal(typeof node.type, 'string');
      if (Object.hasOwn(node, 'enum')) assert.equal(typeof node.type, 'string');
      Object.values(node).forEach(visit);
    }
  };
  visit(schema);
  assert.equal(spreadsheetAIProviderWireResponseSchema.safeParse({
    response: {
      schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
      stage: 'request_context',
      request: {
        schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
        continuationToken: 'valid-token',
        allowedSheetIds: ['sheet_1'],
        requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 1, startColumn: 1, endColumn: 1, chunk: 0, reason: 'Need safe context.' }],
      },
      plan: null,
    },
  }).success, true);
});

test('the manual compatibility probe rejects a strict-schema route without trying fallback modes', async () => {
  const requests: Array<{ model?: string; mode?: string }> = [];
  let calls = 0;
  const client = {
    chat: { completions: { create: async (input: { model?: string; response_format?: { type?: string } }) => {
      calls += 1;
      requests.push({ model: input.model, mode: input.response_format?.type });
      if (calls === 1) {
        const error = new Error('response_format json_schema is unsupported') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      throw new Error('compatibility check must not make a fallback request');
    } } },
  } as unknown as OpenAI;

  const result = await runSpreadsheetProviderCompatibilityCheck({
    client,
    environment: 'test',
    managedRouteConfigured: true,
    retryDelayMs: 0,
  });
  assert.equal(result.status, 'route_incompatible');
  assert.deepEqual(result.checks, {
    strictSchemaAlias: 'rejected',
    json: 'not_received',
    zod: 'not_received',
    continuation: 'not_received',
    parserBounds: 'not_received',
    semanticPlan: 'not_received',
    responseContract: 'not_received',
  });
  assert.deepEqual(requests, [
    { model: SPREADSHEET_PROVIDER_MODEL, mode: 'json_schema' },
  ]);
});

test('a malformed probe response is a contract failure, not a route compatibility failure', async () => {
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"unexpected":true}' } }] }) } },
  } as unknown as OpenAI;
  const result = await runSpreadsheetProviderCompatibilityCheck({
    client,
    environment: 'test',
    managedRouteConfigured: true,
    retryDelayMs: 0,
  });
  assert.equal(result.status, 'contract_invalid');
  assert.equal(result.checks.responseContract, 'invalid');
  assert.equal(result.checks.json, 'valid');
  assert.equal(result.checks.zod, 'invalid');
  assert.equal(result.attempts[0]?.outcomeCategory, 'contract_invalid');
});

test('schema-valid probe responses with unknown sheets or out-of-range context are contract failures', async () => {
  const invalidRequests = [
    {
      allowedSheetIds: ['sheet_unknown'],
      requests: [{
        sheetId: 'sheet_unknown',
        startRow: 1,
        endRow: 1,
        startColumn: 1,
        endColumn: 1,
        chunk: 0,
        reason: 'Synthetic compatibility probe.',
      }],
    },
    {
      allowedSheetIds: [SPREADSHEET_PROVIDER_COMPATIBILITY_SHEET_ID],
      requests: [{
        sheetId: SPREADSHEET_PROVIDER_COMPATIBILITY_SHEET_ID,
        startRow: 1,
        endRow: 2,
        startColumn: 1,
        endColumn: 1,
        chunk: 0,
        reason: 'Synthetic compatibility probe.',
      }],
    },
  ];
  for (const request of invalidRequests) {
    const client = {
      chat: { completions: { create: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
              stage: 'request_context',
              request: {
                schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
                continuationToken: SPREADSHEET_PROVIDER_COMPATIBILITY_TOKEN,
                ...request,
              },
              plan: null,
            }),
          },
        }],
      }) } },
    } as unknown as OpenAI;
    const result = await runSpreadsheetProviderCompatibilityCheck({
      client,
      environment: 'test',
      managedRouteConfigured: true,
      retryDelayMs: 0,
    });
    assert.equal(result.status, 'contract_invalid');
    assert.equal(result.checks.responseContract, 'invalid');
    assert.equal(result.attempts[0]?.outcomeCategory, 'contract_invalid');
  }
});

test('the manual compatibility probe refuses production and unknown environments without making a provider request', async () => {
  let calls = 0;
  const client = {
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: '{}' } }] };
    } } },
  } as unknown as OpenAI;
  for (const environment of ['production', 'preview', '']) {
    const result = await runSpreadsheetProviderCompatibilityCheck({
      client,
      environment,
      managedRouteConfigured: true,
    });
    assert.equal(result.status, 'blocked_non_production_environment');
  }
  assert.equal(calls, 0);
});

test('the manual compatibility probe refuses an unset environment without making a provider request', async () => {
  let calls = 0;
  const client = {
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: '{}' } }] };
    } } },
  } as unknown as OpenAI;
  const originalEnvironment = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    const result = await runSpreadsheetProviderCompatibilityCheck({
      client,
      managedRouteConfigured: true,
    });
    assert.equal(result.status, 'blocked_non_production_environment');
    assert.deepEqual(result.attempts, []);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
  assert.equal(calls, 0);
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
  assert.equal(result.reason, 'Automatic review timed out waiting for a response. No records were imported.');
  assert.equal(result.providerCalls, 2);
  assert.deepEqual(result.providerAttempts?.map((attempt) => attempt.outcomeCategory), ['rate_limited', 'timeout']);
  assert.equal(result.providerAttempts?.every((attempt) => attempt.routeClass === 'replit_ai_integrations' || attempt.routeClass === 'direct_openai'), true);
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
  assert.equal(Array.isArray(responseFormat.json_schema?.schema?.anyOf), false);
  const responseSchema = (responseFormat.json_schema?.schema?.properties as Record<string, { anyOf?: unknown }> | undefined)?.response;
  assert.equal(Array.isArray(responseSchema?.anyOf), true);
  const defs = responseFormat.json_schema?.schema?.$defs as Record<string, Record<string, unknown>>;
  assert.equal(defs.requestContextResponse?.additionalProperties, false);
  assert.equal(defs.finalPlanResponse?.additionalProperties, false);
  assert.equal(defs.abstainResponse?.additionalProperties, false);
  assert.equal(defs.plan?.additionalProperties, false);
  assert.equal(defs.sheetPlan?.additionalProperties, false);
  assert.equal(defs.fields?.additionalProperties, false);
  assert.equal(defs.request?.additionalProperties, false);
});

test('a provider-success contract-invalid response gets one bounded repair pass and is revalidated', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Private consulting payment,10\n'), 'text/csv', 'repair.csv');
  let calls = 0;
  let repairPayload: Record<string, unknown> | undefined;
  const client = {
    chat: { completions: { create: async (input: { messages: Array<{ content: string }> }) => {
      calls += 1;
      const payload = JSON.parse(input.messages.at(-1)?.content ?? '{}') as Record<string, unknown>;
      if (calls === 1) {
        const invalid = {
          ...finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]),
          unexpectedField: true,
        };
        return { choices: [{ message: { content: JSON.stringify(invalid) } }] };
      }
      repairPayload = payload;
      const returned = payload.returnedSemanticContent as { plan?: { continuationToken?: string } };
      return {
        choices: [{
          message: {
            content: JSON.stringify(finalResponse(String(returned.plan?.continuationToken), [semanticSheet('sheet_1', 'transactional')])),
          },
        }],
      };
    } } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client, retryDelayMs: 0 });
  assert.equal(result.status, 'success');
  assert.equal(calls, 2);
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.outcomeCategory, attempt.failurePhase]), [
    ['contract_invalid', 'response_validation'],
    ['success', null],
  ]);
  assert.equal(repairPayload?.stage, 'repair_response_contract');
  assert.match(JSON.stringify(repairPayload), /returnedSemanticContent/);
  assert.equal(Object.hasOwn(repairPayload ?? {}, 'overview'), false);
  assert.equal(Object.hasOwn(repairPayload ?? {}, 'workbook'), false);
  assert.doesNotMatch(JSON.stringify(repairPayload), /Private consulting payment/);
});

test('repair remains on the verified strict policy even when historical attempts used object mode', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Strict repair,13\n'), 'text/csv', 'strict-repair.csv');
  const requests: Array<{ model?: string; mode?: string }> = [];
  let calls = 0;
  const client = {
    chat: { completions: { create: async (input: { model?: string; response_format?: { type?: string }; messages: Array<{ content: string }> }) => {
      calls += 1;
      requests.push({ model: input.model, mode: input.response_format?.type });
      const payload = JSON.parse(input.messages.at(-1)?.content ?? '{}') as Record<string, unknown>;
       if (calls === 1) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                ...finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]),
                unexpectedField: true,
              }),
            },
          }],
        };
      }
      const returned = payload.returnedSemanticContent as { plan?: { continuationToken?: string } };
      return { choices: [{ message: { content: JSON.stringify(finalResponse(String(returned.plan?.continuationToken), [semanticSheet('sheet_1', 'transactional')])) } }] };
    } } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client, retryDelayMs: 0 });
  assert.equal(result.status, 'success');
  assert.deepEqual(requests, [
    { model: SPREADSHEET_PROVIDER_MODEL, mode: 'json_schema' },
    { model: SPREADSHEET_PROVIDER_MODEL, mode: 'json_schema' },
  ]);
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.responseMode, attempt.outcomeCategory, attempt.failurePhase]), [
    ['json_schema', 'contract_invalid', 'response_validation'],
    ['json_schema', 'success', null],
  ]);
});

test('a contract-invalid repair result remains unavailable and cannot become an import plan', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Sale,11\n'), 'text/csv', 'repair-failure.csv');
  let calls = 0;
  const client = {
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify(calls === 1 ? { invalid: true } : { stillInvalid: true }) } }] };
    } } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client, retryDelayMs: 0 });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI returned a response that did not pass the protected spreadsheet contract.');
  assert.equal(result.providerCalls, 2);
  assert.equal((result.semanticPlan as { status?: string }).status, 'incomplete');
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.outcomeCategory, attempt.failurePhase]), [
    ['contract_invalid', 'response_validation'],
    ['contract_invalid', 'repair_validation'],
  ]);
});

test('a failed semantic session retries to success without replaying prior provider attempts', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Retry-only sale,17\n'), 'text/csv', 'retry-after-contract-failure.csv');
  const checkpoints: SpreadsheetSemanticSession[] = [];
  let failedCalls = 0;
  const failedClient = {
    chat: { completions: { create: async () => {
      failedCalls += 1;
      return { choices: [{ message: { content: JSON.stringify(failedCalls === 1 ? { invalid: true } : { stillInvalid: true }) } }] };
    } } },
  } as unknown as OpenAI;
  const first = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: failedClient,
    retryDelayMs: 0,
    persistSession: async (session) => { checkpoints.push(structuredClone(session)); },
  });
  assert.equal(first.status, 'failed');
  assert.equal(failedCalls, 2, 'one invalid response and one repair attempt are bounded');
  const failedSession = checkpoints.at(-1);
  assert.ok(failedSession, 'the failed state is durable before an explicit retry');

  let retryCalls = 0;
  const retryClient = scriptedClient((payload) => {
    retryCalls += 1;
    return finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]);
  });
  const retried = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: retryClient,
    retryDelayMs: 0,
    session: {
      ...failedSession,
      stage: 'workbook_overview',
      payload: {},
      contextHistory: [],
      providerCalls: 0,
      currentPlan: null,
      executionId: '00000000-0000-4000-8000-000000000002',
      executionNumber: 2,
      attemptOffset: failedSession.providerAttempts.length,
    },
  });
  assert.equal(retried.status, 'success');
  assert.equal(retryCalls, 1, 'the explicit retry issues exactly one new provider request');
  assert.equal(retried.providerCalls, 1, 'the new execution receives a fresh provider-call budget');
  assert.equal(retried.providerAttempts?.length, 3, 'prior attempts are retained rather than duplicated');
  assert.equal(retried.providerAttempts?.at(-1)?.attemptNumber, 3, 'attempt ordinals remain globally auditable across executions');
});

test('a five-call execution permits exactly one remaining provider request and never starts repair', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Bounded sale,11\n'), 'text/csv', 'one-call-left.csv');
  const token = 'one-call-left-token';
  const historicalAttempts: SpreadsheetProviderAttempt[] = Array.from({ length: 5 }, (_, index) => ({
    telemetryVersion: 'spreadsheet-provider-attempt.v1',
    attemptNumber: index + 1,
    routeClass: 'replit_ai_integrations',
    requestedModel: SPREADSHEET_PROVIDER_MODEL,
    resolvedModel: SPREADSHEET_PROVIDER_MODEL,
    model: SPREADSHEET_PROVIDER_MODEL,
    responseMode: 'json_schema',
    startedAt: '2026-08-24T12:48:28.303Z',
    durationMs: 10,
    outcomeCategory: 'success',
    safeStatus: 'ok',
    statusCode: null,
    retryable: false,
    failurePhase: null,
  }));
  let calls = 0;
  const client = {
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify({ invalid: true }) } }] };
    } } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
    retryDelayMs: 0,
    session: {
      schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
      contentHash: workbook.contentHash ?? null,
      stage: 'workbook_overview',
      continuationToken: token,
      payload: { continuationToken: token, stage: 'workbook_overview' },
      contextHistory: [],
      providerCalls: 5,
      providerAttempts: historicalAttempts,
      currentPlan: null,
      executionId: '00000000-0000-4000-8000-000000000001',
      executionNumber: 1,
      attemptOffset: 0,
    },
  });
  assert.equal(calls, 1, 'the final allowance cannot issue a repair or retry request');
  assert.equal(result.status, 'failed');
  assert.equal(result.providerCalls, 6);
  assert.equal(result.providerAttempts?.length, 6);
  assert.equal(result.providerAttempts?.at(-1)?.attemptNumber, 6);
});

test('a retryable failure with one call remaining cannot overshoot the execution budget', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Retryable boundary sale,13\n'), 'text/csv', 'retryable-boundary.csv');
  const token = 'retryable-boundary-token';
  const historicalAttempts: SpreadsheetProviderAttempt[] = Array.from({ length: 5 }, (_, index) => ({
    telemetryVersion: 'spreadsheet-provider-attempt.v1',
    attemptNumber: index + 1,
    routeClass: 'replit_ai_integrations',
    requestedModel: SPREADSHEET_PROVIDER_MODEL,
    resolvedModel: SPREADSHEET_PROVIDER_MODEL,
    model: SPREADSHEET_PROVIDER_MODEL,
    responseMode: 'json_schema',
    startedAt: '2026-08-24T12:48:28.303Z',
    durationMs: 10,
    outcomeCategory: 'success',
    safeStatus: 'ok',
    statusCode: null,
    retryable: false,
    failurePhase: null,
  }));
  let calls = 0;
  const client = {
    chat: { completions: { create: async () => {
      calls += 1;
      const error = new Error('synthetic upstream failure') as Error & { status?: number };
      error.status = 500;
      throw error;
    } } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
    retryDelayMs: 0,
    session: {
      schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
      contentHash: workbook.contentHash ?? null,
      stage: 'workbook_overview',
      continuationToken: token,
      payload: { continuationToken: token, stage: 'workbook_overview' },
      contextHistory: [],
      providerCalls: 5,
      providerAttempts: historicalAttempts,
      currentPlan: null,
      executionId: '00000000-0000-4000-8000-000000000003',
      executionNumber: 3,
      attemptOffset: 0,
    },
  });

  assert.equal(calls, 1, 'a retryable failure cannot issue a seventh provider request');
  assert.equal(result.status, 'failed');
  assert.equal(result.providerCalls, 6, 'the execution stops at its six-call budget');
  assert.equal(result.providerAttempts?.length, 6);
  assert.equal(result.providerAttempts?.at(-1)?.attemptNumber, 6);
  assert.equal(result.providerAttempts?.at(-1)?.retryable, true);
  assert.equal(result.providerAttempts?.at(-1)?.failurePhase, 'provider_request');
  assert.equal(result.providerAttempts?.some((attempt) => attempt.failurePhase === 'repair_validation'), false, 'no repair call starts after the retryable boundary failure');
});

test('an explicit retry replaces inherited object mode with alias-only strict policy while preserving historical attempts', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Retry state sale,17\n'), 'text/csv', 'retry-state.csv');
  const token = 'retry-state-token';
  const historicalAttempts: SpreadsheetProviderAttempt[] = [{
    telemetryVersion: 'spreadsheet-provider-attempt.v1',
    attemptNumber: 1,
    routeClass: 'replit_ai_integrations',
    requestedModel: SPREADSHEET_PROVIDER_MODEL,
    resolvedModel: SPREADSHEET_PROVIDER_MODEL,
    model: SPREADSHEET_PROVIDER_MODEL,
    responseMode: 'json_object',
    startedAt: '2026-08-24T12:48:28.303Z',
    durationMs: 10,
    outcomeCategory: 'success',
    safeStatus: 'ok',
    statusCode: null,
    retryable: false,
    failurePhase: null,
  }];
  const session: SpreadsheetSemanticSession = {
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    contentHash: workbook.contentHash ?? null,
    stage: 'workbook_overview',
    continuationToken: token,
    payload: { continuationToken: token, stage: 'workbook_overview' },
    contextHistory: [],
    providerCalls: 1,
    providerAttempts: historicalAttempts,
    currentPlan: null,
  };
  const requests: Array<{ model?: string; mode?: string }> = [];
  const persistedAttempts: SpreadsheetProviderAttempt[][] = [];
  const client = {
      chat: { completions: { create: async (input: { model?: string; response_format?: { type?: string }; messages: Array<{ content: string }> }) => {
        requests.push({ model: input.model, mode: input.response_format?.type });
        const payload = JSON.parse(input.messages.at(-1)?.content ?? '{}') as Record<string, unknown>;
        return { choices: [{ message: { content: JSON.stringify(finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')])) } }] };
      } } },
  } as unknown as OpenAI;
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheet(workbook), {
    client,
    session,
    resetProviderState: true,
    retryDelayMs: 0,
    persistProviderAttempts: async (attempts) => { persistedAttempts.push(structuredClone(attempts)); },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(requests, [{
    model: SPREADSHEET_PROVIDER_MODEL,
    mode: 'json_schema',
  }]);
  assert.deepEqual(result.providerAttempts?.slice(0, 1), historicalAttempts);
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.attemptNumber, attempt.model, attempt.responseMode]), [
    [1, SPREADSHEET_PROVIDER_MODEL, 'json_object'],
    [2, SPREADSHEET_PROVIDER_MODEL, 'json_schema'],
  ]);
  assert.deepEqual(persistedAttempts.at(-1)?.slice(0, 1), historicalAttempts);
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

test('a whole-review deadline checkpoints safe continuation state and starts no further provider request', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Deadline-only sale,11\n'), 'text/csv', 'deadline.csv');
  const checkpoints: SpreadsheetSemanticSession[] = [];
  let nowMs = 0;
  let calls = 0;
  const client = {
    chat: { completions: { create: async (input: { messages: Array<{ content: string }> }) => {
      calls += 1;
      const payload = JSON.parse(input.messages.at(-1)?.content ?? '{}') as Record<string, unknown>;
      nowMs = 51;
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
              stage: 'request_context',
              request: {
                schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
                continuationToken: String(payload.continuationToken),
                allowedSheetIds: ['sheet_1'],
                requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 2, startColumn: 1, endColumn: 3, chunk: 0, reason: 'Need bounded structure.' }],
              },
              plan: null,
            }),
          },
        }],
      };
    } } },
  } as unknown as OpenAI;

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
    reviewTimeoutMs: 50,
    retryDelayMs: 0,
    now: () => nowMs,
    persistSession: async (session) => { checkpoints.push(structuredClone(session)); },
  });

  assert.equal(calls, 1, 'the review deadline prevents the next provider request');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.reason, 'Automatic review timed out waiting for a response. No records were imported.');
  assert.equal(result.providerCalls, 1, 'the existing execution budget remains accurate');
  assert.equal(result.analysis?.sheets.every((sheet) => !sheet.selected), true, 'deadline results never create an importable analysis');
  const checkpoint = checkpoints.at(-1);
  assert.equal(checkpoint?.stage, 'incomplete');
  assert.equal(checkpoint?.providerCalls, 1);
  assert.equal((checkpoint?.currentPlan as { status?: string } | null)?.status, 'incomplete');
  assert.equal((checkpoint?.payload as { stage?: string } | null)?.stage, 'requested_context', 'the latest safe continuation is retained');
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