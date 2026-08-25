import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { and, eq } from 'drizzle-orm';
import {
  db,
  evidenceAuditEventsTable,
  evidenceItemsTable,
  pool,
  profilesTable,
  sessionsTable,
  spreadsheetSemanticExecutionsTable,
  spreadsheetSemanticProviderAttemptsTable,
  spreadsheetSemanticSessionsTable,
  transactionsTable,
  usersTable,
} from '@workspace/db';
import app from '../app.js';
import { createSession } from '../lib/auth.js';
import { invalidateSpreadsheetAICache } from '../lib/ai.js';
import { ObjectStorageService } from '../lib/objectStorage.js';

if (process.env.EVIDENCE_TEST_DATABASE !== '1') {
  throw new Error('Spreadsheet review acceptance requires an explicitly marked disposable test database.');
}
const databaseName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
if (!/(^|[-_])test($|[-_])/i.test(databaseName)) {
  throw new Error('Spreadsheet review acceptance requires DATABASE_URL to point to a dedicated test database.');
}

type ResponseBody = Record<string, unknown>;
let testPort = 0;

async function request(
  sessionId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: ResponseBody }> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${sessionId}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`http://127.0.0.1:${testPort}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as ResponseBody : {} };
}

async function upload(sessionId: string, profileId: string, content: string) {
  return request(sessionId, '/api/storage/uploads/direct', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-content-type': 'text/csv',
      'x-profile-id': profileId,
    },
    body: content,
  });
}

async function closeServer(server: ReturnType<typeof app.listen>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function completedResponsesEnvelope(id: string, payload: Record<string, unknown>) {
  const outputText = JSON.stringify(payload);
  return {
    id,
    object: 'response',
    created_at: 0,
    completed_at: 0,
    status: 'completed',
    // Match the managed live envelope: the aggregate convenience field may be
    // empty while the completed message carries the strict JSON payload.
    output_text: '',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model: 'gpt-5.4-mini',
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

test('development acceptance reviews fresh spreadsheet evidence without confirmation writes', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const userId = `spreadsheet-acceptance-${suffix}`;
  let profileId = '';
  let sessionId = '';
  let appServer: ReturnType<typeof app.listen> | undefined;
  let providerServer: ReturnType<typeof createServer> | undefined;
  let spreadsheetBuffer = Buffer.from('Date,Description,Amount\n06/04/2025,Fresh acceptance review,42.50\n');
  let providerCalls = 0;
  let receivedStrictJsonSchema = false;
  const originalSaveContent = ObjectStorageService.prototype.saveContent;
  const originalGetFile = ObjectStorageService.prototype.getObjectEntityFile;
  const savedAiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const savedAiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  ObjectStorageService.prototype.saveContent = async () => `/objects/uploads/spreadsheet-acceptance-${randomUUID()}`;
  ObjectStorageService.prototype.getObjectEntityFile = async () => ({
    delete: async () => undefined,
    download: async () => [spreadsheetBuffer],
  }) as never;

  try {
    await db.insert(usersTable).values({
      id: userId,
      email: `${userId}@example.test`,
      firstName: 'Spreadsheet',
      lastName: 'Acceptance',
    });
    const [profile] = await db.insert(profilesTable).values({
      userId,
      name: 'Spreadsheet acceptance profile',
      type: 'sole_trader',
      accountingBasis: 'cash',
    }).returning({ id: profilesTable.id });
    profileId = profile.id;
    sessionId = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: 'Spreadsheet',
        lastName: 'Acceptance',
        profileImageUrl: null,
      },
      access_token: `test-access-${userId}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });

    providerServer = createServer(async (providerRequest, providerResponse) => {
      const raw = await new Promise<string>((resolve, reject) => {
        let body = '';
        providerRequest.setEncoding('utf8');
        providerRequest.on('data', (chunk) => { body += chunk; });
        providerRequest.once('end', () => resolve(body));
        providerRequest.once('error', reject);
      });
      const requestBody = JSON.parse(raw) as {
        input?: unknown;
        text?: { format?: { type?: unknown; strict?: unknown; schema?: unknown } };
      };
      const inputText = typeof requestBody.input === 'string'
        ? requestBody.input
        : Array.isArray(requestBody.input)
          ? requestBody.input.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const content = (item as { content?: unknown }).content;
            if (!Array.isArray(content)) return [];
            return content.flatMap((part) => (
              part && typeof part === 'object' && !Array.isArray(part)
                && typeof (part as { text?: unknown }).text === 'string'
                ? [(part as { text: string }).text]
                : []
            ));
          }).join('')
          : '';
      const input = inputText ? JSON.parse(inputText) as { continuationToken?: string } : {};
      receivedStrictJsonSchema = requestBody.text?.format?.type === 'json_schema'
        && requestBody.text.format.strict === true
        && typeof requestBody.text.format.schema === 'object'
        && requestBody.text.format.schema !== null;
      providerCalls += 1;
      const semanticResponse = {
        response: {
          schemaVersion: 'spreadsheet-semantic.v2',
          stage: 'final_plan',
          request: null,
          plan: {
            schemaVersion: 'spreadsheet-semantic.v2',
            status: 'complete',
            continuationToken: input.continuationToken ?? '',
            sheets: [{
              sheetId: 'sheet_1',
              disposition: 'transactional',
              decisionSource: 'ai',
              validationReason: 'Dated movements are present in the bounded structural review.',
              purpose: 'Movement ledger',
              headerRow: 1,
              dataRange: { startRow: 2, endRow: 2 },
              rowRules: { include: [{ startRow: 2, endRow: 2, reason: 'One source movement.' }], exclude: [] },
              fields: {
                date: { columnId: 'col_A', confidence: 95, rationale: 'Bounded header and value structure.' },
                description: { columnId: 'col_B', confidence: 95, rationale: 'Bounded header and value structure.' },
                signedAmount: { columnId: 'col_C', confidence: 95, rationale: 'A signed amount column is present.' },
                debit: { columnId: null, confidence: 0, rationale: 'A signed amount column is present.' },
                credit: { columnId: null, confidence: 0, rationale: 'A signed amount column is present.' },
                category: { columnId: null, confidence: 0, rationale: 'Category is not needed to parse movements.' },
              },
              transactionSemantics: { direction: 'mixed', rationale: 'Direction is determined from signed values.' },
              duplicateOrOverlap: [],
              unresolvedQuestionIds: [],
            }],
            unresolvedQuestions: [],
            abstention: null,
            summary: 'A bounded semantic review is ready for confirmation.',
          },
        },
      };
      providerResponse.writeHead(200, { 'content-type': 'application/json' });
      providerResponse.end(JSON.stringify(completedResponsesEnvelope(
        `test-spreadsheet-acceptance-${providerCalls}`,
        semanticResponse,
      )));
    });
    await new Promise<void>((resolve) => providerServer!.listen(0, '127.0.0.1', resolve));
    const providerPort = (providerServer.address() as AddressInfo).port;
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test-semantic-key';
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${providerPort}/v1`;
    invalidateSpreadsheetAICache();

    appServer = app.listen(0);
    await new Promise<void>((resolve) => appServer!.once('listening', resolve));
    testPort = (appServer.address() as AddressInfo).port;

    const uploaded = await upload(sessionId, profileId, 'fresh spreadsheet acceptance upload');
    assert.equal(uploaded.status, 200);
    const evidence = await request(sessionId, `/api/profiles/${profileId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        filename: 'fresh-acceptance.csv',
        objectPath: uploaded.body.objectPath,
        mimeType: 'text/csv',
        evidenceType: 'ledger',
      }),
    });
    assert.equal(evidence.status, 201);
    const evidenceId = evidence.body.id as string;

    const review = await request(sessionId, `/api/profiles/${profileId}/evidence/${evidenceId}/detect-schema`, {
      method: 'POST',
    });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal((review.body.aiStatus as { status?: string } | undefined)?.status, 'success');
    assert.equal(providerCalls, 1, 'the fresh review uses the normal provider path exactly once');
    assert.equal(receivedStrictJsonSchema, true, 'the acceptance mock only accepts the managed strict JSON schema request');
    assert.equal(review.body.userDecision, null, 'review does not manufacture a confirmation decision');

    const [semanticSession] = await db.select().from(spreadsheetSemanticSessionsTable).where(and(
      eq(spreadsheetSemanticSessionsTable.profileId, profileId),
      eq(spreadsheetSemanticSessionsTable.evidenceId, evidenceId),
    ));
    assert.ok(semanticSession);
    assert.equal(semanticSession.automaticRetryCount, 0, 'fresh evidence does not reset or alter historical retry counters');
    const executions = await db.select().from(spreadsheetSemanticExecutionsTable).where(
      eq(spreadsheetSemanticExecutionsTable.semanticSessionId, semanticSession.id),
    );
    assert.equal(executions.length, 1, 'fresh evidence has its own review execution');
    const attempts = await db.select().from(spreadsheetSemanticProviderAttemptsTable).where(and(
      eq(spreadsheetSemanticProviderAttemptsTable.profileId, profileId),
      eq(spreadsheetSemanticProviderAttemptsTable.evidenceId, evidenceId),
    ));
    assert.equal(attempts.length, 1, 'the successful review records bounded provider telemetry');
    assert.equal(attempts[0]?.telemetryVersion, 'spreadsheet-provider-attempt.v1');
    assert.equal(attempts[0]?.failurePhase, null);

    const [storedEvidence] = await db.select().from(evidenceItemsTable).where(eq(evidenceItemsTable.id, evidenceId));
    assert.equal(storedEvidence.importStatus, 'mapping', 'review remains awaiting an explicit confirmation');
    assert.equal(
      (await db.select().from(transactionsTable).where(eq(transactionsTable.profileId, profileId))).length,
      0,
      'the acceptance review never writes Financial Memory before confirmation',
    );
    const auditEvents = await db.select().from(evidenceAuditEventsTable).where(and(
      eq(evidenceAuditEventsTable.profileId, profileId),
      eq(evidenceAuditEventsTable.evidenceId, evidenceId),
    ));
    assert.ok(auditEvents.some((event) => event.eventType === 'spreadsheet_inspected'));
    assert.equal(auditEvents.some((event) => event.eventType === 'spreadsheet_confirmed'), false);
  } finally {
    invalidateSpreadsheetAICache();
    if (savedAiKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = savedAiKey;
    if (savedAiBaseUrl === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = savedAiBaseUrl;
    if (providerServer) {
      await new Promise<void>((resolve, reject) => providerServer!.close((error) => error ? reject(error) : resolve()));
    }
    if (appServer) await closeServer(appServer);
    ObjectStorageService.prototype.saveContent = originalSaveContent;
    ObjectStorageService.prototype.getObjectEntityFile = originalGetFile;
    if (sessionId) await db.delete(sessionsTable).where(eq(sessionsTable.sid, sessionId));
    if (profileId) await db.delete(profilesTable).where(eq(profilesTable.id, profileId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
});