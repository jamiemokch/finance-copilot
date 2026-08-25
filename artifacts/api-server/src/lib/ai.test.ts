import assert from 'node:assert/strict';
import test from 'node:test';
import type OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { analyseSpreadsheet, analyseSpreadsheetStructure, inspectSpreadsheet } from './spreadsheet.js';
import {
  analyseSpreadsheetWithAI,
  detectColumnSchema,
  fingerprintSpreadsheetProviderResponse,
  normalizeSpreadsheetProviderResponse,
  providerCallWithTimeout,
  resetDirectSpreadsheetProviderForTests,
  resetManagedSpreadsheetProviderPolicyForTests,
  runSpreadsheetProviderCompatibilityCheck,
  runSpreadsheetProviderPositiveSemanticCompatibilityCheck,
  SPREADSHEET_PROVIDER_MODEL,
  type SpreadsheetSemanticSession,
} from './ai.js';
import type { SpreadsheetProviderAttempt } from './spreadsheet-understanding.js';
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
  let calls = 0;
  return {
    responses: {
      create: async (input: Record<string, unknown>) => {
        calls += 1;
        const payload = payloadFromResponsesInput(input);
        return completedResponsesEnvelope(
          `direct-scripted-${calls}`,
          { response: responder(payload) as Record<string, unknown> },
        );
      },
    },
    chat: { completions: { create: async () => { throw new Error('spreadsheet semantics must not use Chat Completions'); } } },
  } as unknown as OpenAI;
}

function payloadFromResponsesInput(input: Record<string, unknown>): Record<string, unknown> {
  const message = Array.isArray(input.input) ? input.input.at(-1) : null;
  const content = message && typeof message === 'object' && !Array.isArray(message)
    ? (message as { content?: unknown }).content
    : null;
  const text = Array.isArray(content)
    ? content.find((part) => part && typeof part === 'object' && !Array.isArray(part)
      && (part as { type?: unknown }).type === 'input_text'
      && typeof (part as { text?: unknown }).text === 'string') as { text?: string } | undefined
    : undefined;
  return JSON.parse(text?.text ?? '{}') as Record<string, unknown>;
}

function directResponsesClient(
  responder: (input: Record<string, unknown>, requestOptions?: { signal?: AbortSignal; maxRetries?: number }) => Promise<unknown> | unknown,
): OpenAI {
  return {
    responses: {
      create: async (input: Record<string, unknown>, requestOptions?: { signal?: AbortSignal; maxRetries?: number }) =>
        responder(input, requestOptions),
    },
    chat: { completions: { create: async () => { throw new Error('spreadsheet semantics must not use Chat Completions'); } } },
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

function completedResponsesEnvelope(id: string, payload: Record<string, unknown>, outputParsed?: Record<string, unknown>) {
  const outputText = JSON.stringify(payload);
  return {
    id,
    object: 'response',
    created_at: 0,
    completed_at: 0,
    status: 'completed',
    output_text: outputText,
    ...(outputParsed ? { output_parsed: outputParsed } : {}),
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model: SPREADSHEET_PROVIDER_MODEL,
    output: [{
      id: `${id}-message`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{
        type: 'output_text',
        text: outputText,
        annotations: [],
      }],
    }],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
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

test('provider adapter normalizes every supported non-empty structured output carrier before unchanged validation', async () => {
  const token = 'normalization-token';
  const wireResponse = { response: finalResponse(token, [semanticSheet('sheet_1', 'transactional')]) };
  const serialized = JSON.stringify(wireResponse);
  const variants: unknown[] = [
    { output_parsed: wireResponse },
    { output_text: serialized },
    { output_text: JSON.stringify(serialized) },
    { output_text: `\`\`\`json\n${serialized}\n\`\`\`` },
    {
      output_text: '   ',
      output: [{
        type: 'message',
        parsed: wireResponse,
        content: [],
      }],
    },
    {
      output_text: 'not-json',
      output: [{
        type: 'reasoning',
        content: [],
      }, {
        type: 'message',
        content: [{ type: 'output_text', text: '  ' }, { type: 'output_text', parsed: wireResponse }],
      }, {
        type: 'message',
        content: [{ type: 'output_text', text: serialized }],
      }],
    },
    {
      output: [{
        type: 'message',
        content: [
          { type: 'output_text', text: serialized.slice(0, Math.floor(serialized.length / 2)) },
          { type: 'output_text', text: serialized.slice(Math.floor(serialized.length / 2)) },
        ],
      }],
    },
    { choices: [{ message: { content: serialized } }] },
    { choices: [{ message: { content: [{ type: 'text', text: serialized }] } }] },
    { choices: [{ message: { content: null, parsed: wireResponse } }] },
    {
      choices: [
        { message: { content: 'not-json' } },
        { message: { content: [{ type: 'text', text: serialized }] } },
      ],
    },
  ];
  for (const variant of variants) {
    assert.deepEqual(JSON.parse(normalizeSpreadsheetProviderResponse(variant)), wireResponse);
  }

  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,SDK normalization fixture,37\n'), 'text/csv', 'normalization.csv');
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: directResponsesClient((input) => {
      const payload = payloadFromResponsesInput(input);
      const dynamicWireResponse = {
        response: finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]),
      };
      return {
        status: 'completed',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(dynamicWireResponse) }],
        }],
      };
    }),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.providerAttempts?.[0]?.outcomeCategory, 'success');
});

test('provider adapter keeps empty, refusal, and incomplete Responses terminal states away from the JSON parser', async () => {
  const token = 'terminal-state-token';
  const wireResponse = { response: finalResponse(token, [semanticSheet('sheet_1', 'transactional')]) };
  const serialized = JSON.stringify(wireResponse);
  const terminalResponses: Array<{ name: string; response: unknown }> = [
    {
      name: 'empty',
      response: {
        status: 'completed',
        output_text: '  ',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '\n\t' }] }],
      },
    },
    {
      name: 'refusal',
      response: {
        status: 'completed',
        output_text: serialized,
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'synthetic refusal' }] }],
      },
    },
    {
      name: 'incomplete',
      response: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output_text: serialized,
        output: [{ type: 'message', content: [{ type: 'output_text', text: serialized }] }],
      },
    },
  ];

  for (const terminal of terminalResponses) {
    assert.equal(normalizeSpreadsheetProviderResponse(terminal.response), '', terminal.name);
    let classifiedContent: string | undefined;
    let responseCalls = 0;
    const client = {
      responses: {
        create: async () => {
          responseCalls += 1;
          return terminal.response;
        },
      },
      chat: { completions: { create: async () => { throw new Error('terminal Responses states must not use chat'); } } },
    } as unknown as OpenAI;
    await providerCallWithTimeout(client, JSON.stringify({ continuationToken: token }), {
      routeClass: 'replit_ai_integrations',
      maxProviderCalls: 1,
      classifyResponse: (content) => {
        classifiedContent = content;
        return content
          ? null
          : { outcomeCategory: 'contract_invalid', safeStatus: 'contract_invalid', failurePhase: 'response_validation' };
      },
    });
    assert.equal(classifiedContent, '', terminal.name);
    assert.equal(responseCalls, 1, terminal.name);
  }
});

test('empty, refusal, and incomplete direct Responses output each fail closed after one attempt', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Terminal response fixture,37\n'), 'text/csv', 'terminal-direct.csv');
  const terminalResponses: Array<{ name: string; response: unknown }> = [
    { name: 'empty', response: { status: 'completed', output_text: '', output: [] } },
    { name: 'refusal', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] } },
    { name: 'incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } },
  ];
  for (const terminal of terminalResponses) {
    let calls = 0;
    let chatCalls = 0;
    const client = directResponsesClient(() => {
      calls += 1;
      return terminal.response;
    });
    (client.chat.completions.create as unknown as () => Promise<never>) = async () => {
      chatCalls += 1;
      throw new Error('Chat Completions fallback is forbidden');
    };
    const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
      client,
      inFlightKey: `terminal-direct-${terminal.name}`,
    });
    assert.equal(result.status, 'failed', terminal.name);
    assert.equal(result.providerCalls, 1, terminal.name);
    assert.equal(calls, 1, terminal.name);
    assert.equal(chatCalls, 0, terminal.name);
    assert.equal(result.providerAttempts?.[0]?.routeClass, 'direct_openai', terminal.name);
  }
});

test('a direct Responses timeout aborts once and never falls back', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Direct timeout fixture,38\n'), 'text/csv', 'direct-timeout.csv');
  let calls = 0;
  let observedSignal: AbortSignal | undefined;
  let chatCalls = 0;
  const client = directResponsesClient((_input, requestOptions) => {
    calls += 1;
    observedSignal = requestOptions?.signal;
    assert.equal(requestOptions?.maxRetries, 0);
    return new Promise<never>((_resolve, reject) => {
      observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
    });
  });
  (client.chat.completions.create as unknown as () => Promise<never>) = async () => {
    chatCalls += 1;
    throw new Error('Chat Completions fallback is forbidden');
  };
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
    timeoutMs: 5,
    inFlightKey: 'direct-timeout',
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.providerCalls, 1);
  assert.equal(calls, 1);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(chatCalls, 0);
  assert.equal(result.providerAttempts?.[0]?.retryable, false);
});

test('managed credentials cannot enable spreadsheet semantics when the dedicated direct credential is absent', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Missing credential fixture,39\n'), 'text/csv', 'missing-direct-key.csv');
  const savedDirectKey = process.env.OPENAI_API_KEY;
  const savedManagedKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'managed-only-must-not-route-spreadsheets';
    resetDirectSpreadsheetProviderForTests();
    const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
      inFlightKey: 'missing-direct-credential',
    });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.providerCalls, 0);
    assert.equal(result.failureCategory, undefined);
    assert.match(result.reason ?? '', /AI analysis is unavailable/i);
  } finally {
    if (savedDirectKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedDirectKey;
    if (savedManagedKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = savedManagedKey;
    resetDirectSpreadsheetProviderForTests();
  }
});

test('direct provider failures never expose dedicated credentials or raw provider text', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,No secret leakage fixture,40\n'), 'text/csv', 'direct-privacy.csv');
  const directCredential = 'direct-secret-never-persist';
  const rawProviderText = 'private-provider-response-never-persist';
  const client = directResponsesClient(() => {
    const error = new Error(`${directCredential} ${rawProviderText}`) as Error & { status?: number };
    error.status = 503;
    throw error;
  });
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
    inFlightKey: 'direct-privacy',
  });
  const persistedShape = JSON.stringify(result);
  assert.equal(result.status, 'failed');
  assert.equal(persistedShape.includes(directCredential), false);
  assert.equal(persistedShape.includes(rawProviderText), false);
});

test('managed Responses message output normalizes with an empty output_text without recording values', () => {
  const structureOnlyPayload = { response: { fixture: 'structure-only' } };
  const response = {
    output_text: null,
    output: [{
      type: 'message',
      unknownOutputField: 'must-not-persist',
      content: [{
        type: 'output_text',
        text: JSON.stringify(structureOnlyPayload),
        unknownContentField: 'must-not-persist',
      }],
    }],
  };

  assert.deepEqual(
    JSON.parse(normalizeSpreadsheetProviderResponse(response)),
    structureOnlyPayload,
  );

  const fingerprint = fingerprintSpreadsheetProviderResponse(response);
  assert.deepEqual(
    fingerprint.containers.filter((container) => container.path.startsWith('$.output')),
    [
      {
        path: '$.output',
        type: 'array',
        keys: [],
        valueTypes: [],
        arrayLengths: [{ path: '$.output', length: 1, truncated: false }],
      },
      {
        path: '$.output[0]',
        type: 'object',
        keys: ['content'],
        valueTypes: [{ key: 'content', type: 'array' }],
        arrayLengths: [{ path: '$.output[0].content', length: 1, truncated: false }],
      },
      {
        path: '$.output[0].content',
        type: 'array',
        keys: [],
        valueTypes: [],
        arrayLengths: [{ path: '$.output[0].content', length: 1, truncated: false }],
      },
      {
        path: '$.output[0].content[0]',
        type: 'object',
        keys: ['type', 'text'],
        valueTypes: [{ key: 'type', type: 'string' }, { key: 'text', type: 'string' }],
        arrayLengths: [],
      },
      {
        path: '$.output_text',
        type: 'null',
        keys: [],
        valueTypes: [],
        arrayLengths: [],
      },
      {
        path: '$.output_parsed',
        type: 'not_available',
        keys: [],
        valueTypes: [],
        arrayLengths: [],
      },
    ],
  );
  const serializedFingerprint = JSON.stringify(fingerprint);
  for (const forbidden of [
    'structure-only',
    'must-not-persist',
    'unknownOutputField',
    'unknownContentField',
  ]) {
    assert.equal(serializedFingerprint.includes(forbidden), false);
  }
});

test('provider response fingerprints keep only allowlisted extraction shape metadata', () => {
  const response = {
    id: 'provider-response-id-must-not-persist',
    usage: { prompt_tokens: 901 },
    choices: [{
      unknownChoiceKey: 'must-not-persist',
      message: {
        unknownMessageKey: 'must-not-persist',
        content: [{
          type: 'text',
          text: 'provider-text-must-not-persist',
          unknownContentKey: 'must-not-persist',
        }, {
          type: 'text',
          text: 'second-provider-text-must-not-persist',
        }],
        parsed: {
          secret: 'parsed-value-must-not-persist',
          amount: 12345,
        },
      },
    }],
  };
  const fingerprint = fingerprintSpreadsheetProviderResponse(response);
  assert.deepEqual(fingerprint, {
    version: 'spreadsheet-provider-response-shape-fingerprint.v1',
    containers: [
      {
        path: '$',
        type: 'object',
        keys: ['choices'],
        valueTypes: [{ key: 'choices', type: 'array' }],
        arrayLengths: [{ path: '$.choices', length: 1, truncated: false }],
      },
      {
        path: '$.choices',
        type: 'array',
        keys: [],
        valueTypes: [],
        arrayLengths: [{ path: '$.choices', length: 1, truncated: false }],
      },
      {
        path: '$.choices[0]',
        type: 'object',
        keys: ['message'],
        valueTypes: [{ key: 'message', type: 'object' }],
        arrayLengths: [],
      },
      {
        path: '$.choices[0].message',
        type: 'object',
        keys: ['content', 'parsed'],
        valueTypes: [{ key: 'content', type: 'array' }, { key: 'parsed', type: 'object' }],
        arrayLengths: [{ path: '$.choices[0].message.content', length: 2, truncated: false }],
      },
      {
        path: '$.choices[0].message.content',
        type: 'array',
        keys: [],
        valueTypes: [],
        arrayLengths: [{ path: '$.choices[0].message.content', length: 2, truncated: false }],
      },
      {
        path: '$.choices[0].message.content[0]',
        type: 'object',
        keys: ['type', 'text'],
        valueTypes: [{ key: 'type', type: 'string' }, { key: 'text', type: 'string' }],
        arrayLengths: [],
      },
      {
        path: '$.choices[0].message.parsed',
        type: 'object',
        keys: [],
        valueTypes: [],
        arrayLengths: [],
      },
    ],
  });
  const serialized = JSON.stringify(fingerprint);
  for (const forbidden of [
    'provider-response-id-must-not-persist',
    'provider-text-must-not-persist',
    'second-provider-text-must-not-persist',
    'parsed-value-must-not-persist',
    'unknownChoiceKey',
    'unknownMessageKey',
    'unknownContentKey',
    'secret',
    'amount',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('unfixable provider text still produces the existing invalid-json contract failure', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Unfixable response fixture,41\n'), 'text/csv', 'unfixable-response.csv');
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: directResponsesClient(() => ({
      status: 'completed',
      output_text: 'not-json',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'not-json' }] }],
    })),
  });
  const diagnostic = result.providerAttempts?.find((attempt) => attempt.outcomeCategory === 'contract_invalid')?.diagnostic;
  assert.equal(result.status, 'failed');
  assert.equal(diagnostic?.validationStage, 'json_parse');
  assert.ok(diagnostic?.issues.some((issue) => issue.code === 'invalid_json'));
  assert.deepEqual(diagnostic?.providerResponseShapeFingerprint?.containers.slice(0, 2), [
    {
      path: '$',
      type: 'object',
      keys: ['output', 'output_text'],
      valueTypes: [{ key: 'output', type: 'array' }, { key: 'output_text', type: 'string' }],
      arrayLengths: [{ path: '$.output', length: 1, truncated: false }],
    },
    {
      path: '$.choices',
      type: 'not_available',
      keys: [],
      valueTypes: [],
      arrayLengths: [],
    },
  ]);
  assert.equal(JSON.stringify(diagnostic?.providerResponseShapeFingerprint).includes('not-json'), false);
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

test('direct spreadsheet semantic failures are terminal after one attempt', async () => {
  const workbook = inspectSpreadsheet(Buffer.from([
    'Date,Description,Amount',
    '06/04/2025,Consulting payment,125.00',
  ].join('\n')), 'text/csv', 'ledger.csv');
  const analysis = analyseSpreadsheet(workbook);
  let calls = 0;
  const client = directResponsesClient(async (_input, requestOptions) => {
    calls += 1;
    assert.equal(requestOptions?.maxRetries, 0, 'the direct SDK disables retries');
    const error = new Error('rate limited') as Error & { status?: number };
    error.status = 429;
    throw error;
  });

  const result = await analyseSpreadsheetWithAI(workbook, analysis, {
    client,
    timeoutMs: 5,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI analysis could not complete.');
  assert.equal(calls, 1);
  assert.equal(result.providerCalls, 1);
  assert.deepEqual(result.providerAttempts?.map((attempt) => attempt.outcomeCategory), ['rate_limited']);
  assert.equal(result.providerAttempts?.every((attempt) => attempt.routeClass === 'direct_openai' && attempt.retryable === false), true);
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
  let chatCalls = 0;
  const client = directResponsesClient((input, requestOptions) => {
    request = input;
    assert.equal(requestOptions?.maxRetries, 0);
    assert.equal(input.model, SPREADSHEET_PROVIDER_MODEL);
    const payload = payloadFromResponsesInput(input);
    return completedResponsesEnvelope('direct-contract', {
      response: finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]),
    });
  });
  (client.chat.completions.create as unknown as () => Promise<never>) = async () => {
    chatCalls += 1;
    throw new Error('Chat Completions fallback is forbidden');
  };
  await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client });
  const responseFormat = (request?.text as { format?: { type?: string; strict?: boolean; schema?: Record<string, unknown> } } | undefined)?.format;
  assert.equal(responseFormat?.type, 'json_schema');
  assert.equal(responseFormat?.strict, true);
  assert.equal(Array.isArray(responseFormat?.schema?.anyOf), false);
  const responseSchema = (responseFormat?.schema?.properties as Record<string, { anyOf?: unknown }> | undefined)?.response;
  assert.equal(Array.isArray(responseSchema?.anyOf), true);
  const defs = responseFormat?.schema?.$defs as Record<string, Record<string, unknown>>;
  assert.equal(defs.requestContextResponse?.additionalProperties, false);
  assert.equal(defs.finalPlanResponse?.additionalProperties, false);
  assert.equal(defs.abstainResponse?.additionalProperties, false);
  assert.equal(defs.plan?.additionalProperties, false);
  assert.equal(defs.sheetPlan?.additionalProperties, false);
  assert.equal(defs.fields?.additionalProperties, false);
  assert.equal(defs.request?.additionalProperties, false);
  assert.deepEqual(request?.input, [{
    role: 'user',
    content: [{ type: 'input_text', text: (request?.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text }],
  }]);
  assert.equal(chatCalls, 0);
});

test('managed provider normalizes full Responses envelopes for output_text and output_parsed', async () => {
  const token = 'managed-responses-token';
  const expected = { response: finalResponse(token, [semanticSheet('sheet_1', 'transactional')]) };
  const payload = JSON.stringify({ continuationToken: token });
  const variants = [
    { name: 'output_text', response: completedResponsesEnvelope('responses-output-text', expected) },
    { name: 'output_parsed', response: completedResponsesEnvelope('responses-output-parsed', expected, expected) },
    {
      name: 'output_message_when_output_text_is_empty_string',
      response: {
        object: 'response',
        status: 'completed',
        output_text: '',
        output: [{
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(expected) }],
        }],
      },
    },
  ];

  for (const variant of variants) {
    let request: Record<string, unknown> | undefined;
    let chatCalls = 0;
    const client = {
      responses: {
        create: async (input: Record<string, unknown>) => {
          request = input;
          return variant.response;
        },
      },
      chat: {
        completions: {
          create: async () => {
            chatCalls += 1;
            throw new Error('managed calls must use the Responses API');
          },
        },
      },
    } as unknown as OpenAI;

    const result = await providerCallWithTimeout(client, payload, {
      routeClass: 'replit_ai_integrations',
      maxProviderCalls: 1,
      retryDelayMs: 0,
    });

    assert.deepEqual(JSON.parse(result.content), expected, variant.name);
    assert.equal(chatCalls, 0, variant.name);
    assert.deepEqual(request?.input, [{
      role: 'user',
      content: [{ type: 'input_text', text: payload }],
    }], variant.name);
    assert.equal(typeof request?.instructions, 'string', variant.name);
    assert.equal(request?.max_output_tokens, 4_000, variant.name);
    const format = (request?.text as { format?: { type?: string; strict?: boolean; schema?: Record<string, unknown> } } | undefined)?.format;
    assert.equal(format?.type, 'json_schema', variant.name);
    assert.equal(format?.strict, true, variant.name);
    assert.equal(format?.schema, spreadsheetAIResponseJsonSchema, variant.name);
  }
});

test('a contract-invalid direct response fails closed without a repair request', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Private consulting payment,10\n'), 'text/csv', 'invalid-contract.csv');
  let calls = 0;
  const client = directResponsesClient((input) => {
    calls += 1;
    const payload = payloadFromResponsesInput(input);
    return completedResponsesEnvelope('invalid-contract', {
      response: {
        ...finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]),
        unexpectedField: true,
      },
    });
  });
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client });
  assert.equal(result.status, 'failed');
  assert.equal(result.providerCalls, 1);
  assert.equal(calls, 1, 'contract failure never triggers a re-prompt or repair');
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.routeClass, attempt.responseMode, attempt.outcomeCategory, attempt.failurePhase]), [
    ['direct_openai', 'json_schema', 'contract_invalid', 'response_validation'],
  ]);
});

test('contract-invalid responses retain a bounded shape diagnostic without persisting provider values', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Sale,11\n'), 'text/csv', 'diagnostic.csv');
  const sensitiveName = 'PRIVATE_CUSTOMER_NAME_DO_NOT_PERSIST';
  const sensitiveDescription = 'PRIVATE_DESCRIPTION_DO_NOT_PERSIST';
  const sensitiveToken = 'PRIVATE_PROVIDER_TOKEN_DO_NOT_PERSIST';
  const sensitiveAmount = '917.23';
  const persistedAttempts: SpreadsheetProviderAttempt[][] = [];
  const client = directResponsesClient((input) => {
    const payload = payloadFromResponsesInput(input);
    return completedResponsesEnvelope('privacy-shape-only', {
      response: {
        schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
        stage: 'final_plan',
        request: null,
        plan: {
          schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
          status: 'complete',
          continuationToken: payload.continuationToken ?? 'token_missing',
          sheets: [],
          unresolvedQuestions: [],
          abstention: null,
          summary: sensitiveDescription,
          [sensitiveToken]: {
            counterparty: sensitiveName,
            amount: sensitiveAmount,
          },
        },
      },
    });
  });

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
    retryDelayMs: 0,
    persistProviderAttempts: async (attempts) => {
      persistedAttempts.push(JSON.parse(JSON.stringify(attempts)) as SpreadsheetProviderAttempt[]);
    },
  });

  const diagnostic = result.providerAttempts?.find((attempt) => attempt.outcomeCategory === 'contract_invalid')?.diagnostic;
  assert.equal(result.status, 'failed');
  assert.ok(diagnostic);
  assert.equal(diagnostic?.validationStage, 'transport_envelope');
  assert.ok(diagnostic?.unexpectedFields.includes('$.response.plan.unexpected_field'));
  assert.deepEqual(diagnostic?.arrayLengths.find((entry) => entry.path === '$.response.plan.sheets'), {
    path: '$.response.plan.sheets',
    length: 0,
    truncated: false,
  });
  assert.ok(diagnostic?.issues.some((issue) => issue.code === 'unrecognized_keys' || issue.code === 'too_small'));

  const persisted = JSON.stringify({ attempts: result.providerAttempts, checkpointAttempts: persistedAttempts });
  for (const sensitiveValue of [sensitiveName, sensitiveDescription, sensitiveToken, sensitiveAmount]) {
    assert.doesNotMatch(persisted, new RegExp(sensitiveValue.replace('.', '\\.')));
  }
});

test('malformed direct output remains unavailable and cannot become an import plan', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Sale,11\n'), 'text/csv', 'malformed-direct-response.csv');
  let calls = 0;
  const client = directResponsesClient(() => {
    calls += 1;
    return { status: 'completed', output_text: '{"invalid":true}' };
  });
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), { client });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI returned a response that did not pass the protected spreadsheet contract.');
  assert.equal(result.providerCalls, 1);
  assert.equal(calls, 1);
  assert.equal((result.semanticPlan as { status?: string }).status, 'incomplete');
  assert.deepEqual(result.providerAttempts?.map((attempt) => [attempt.outcomeCategory, attempt.failurePhase]), [
    ['contract_invalid', 'response_validation'],
  ]);
});

test('a failed semantic session retries to success without replaying prior provider attempts', async () => {
  const workbook = inspectSpreadsheet(Buffer.from('Date,Description,Amount\n06/04/2025,Retry-only sale,17\n'), 'text/csv', 'retry-after-contract-failure.csv');
  const checkpoints: SpreadsheetSemanticSession[] = [];
  let failedCalls = 0;
  const failedClient = directResponsesClient(() => {
    failedCalls += 1;
    return { status: 'completed', output_text: JSON.stringify({ invalid: true }) };
  });
  const first = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: failedClient,
    persistSession: async (session) => { checkpoints.push(structuredClone(session)); },
  });
  assert.equal(first.status, 'failed');
  assert.equal(failedCalls, 1, 'an invalid response is terminal without repair');
  const failedSession = checkpoints.at(-1);
  assert.ok(failedSession, 'the failed state is durable before an explicit retry');

  let retryCalls = 0;
  const retryClient = scriptedClient((payload) => {
    retryCalls += 1;
    return finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]);
  });
  const retried = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client: retryClient,
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
  assert.equal(retried.providerAttempts?.length, 2, 'prior attempts are retained rather than duplicated');
  assert.equal(retried.providerAttempts?.at(-1)?.attemptNumber, 2, 'attempt ordinals remain globally auditable across executions');
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
  const client = directResponsesClient(() => {
    calls += 1;
    return { status: 'completed', output_text: JSON.stringify({ invalid: true }) };
  });

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
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
  const client = directResponsesClient(() => {
    calls += 1;
    const error = new Error('synthetic upstream failure') as Error & { status?: number };
    error.status = 500;
    throw error;
  });

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
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
  assert.equal(result.providerAttempts?.at(-1)?.retryable, false);
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
  const client = directResponsesClient((input) => {
    const format = (input.text as { format?: { type?: string } } | undefined)?.format;
    requests.push({ model: input.model as string | undefined, mode: format?.type });
    const payload = payloadFromResponsesInput(input);
    return completedResponsesEnvelope('explicit-retry-direct', {
      response: finalResponse(String(payload.continuationToken), [semanticSheet('sheet_1', 'transactional')]),
    });
  });
  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheet(workbook), {
    client,
    session,
    resetProviderState: true,
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
  const client = directResponsesClient((input) => {
    calls += 1;
    const payload = payloadFromResponsesInput(input);
    nowMs = 51;
    return completedResponsesEnvelope('deadline-direct', {
      response: {
        schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
        stage: 'request_context',
        request: {
          schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
          continuationToken: String(payload.continuationToken),
          allowedSheetIds: ['sheet_1'],
          requests: [{ sheetId: 'sheet_1', startRow: 1, endRow: 2, startColumn: 1, endColumn: 3, chunk: 0, reason: 'Need bounded structure.' }],
        },
        plan: null,
      },
    });
  });

  const result = await analyseSpreadsheetWithAI(workbook, analyseSpreadsheetStructure(workbook), {
    client,
    reviewTimeoutMs: 50,
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