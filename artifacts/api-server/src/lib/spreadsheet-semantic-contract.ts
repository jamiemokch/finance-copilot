import { z } from 'zod';
import {
  analyseSpreadsheet,
  type SpreadsheetAnalysis,
  type SpreadsheetMapping,
  type SpreadsheetWorkbook,
} from './spreadsheet.js';

/**
 * This protocol is intentionally separate from the parser. Parser output is
 * structural evidence; this versioned protocol is the only normal-path source
 * of worksheet semantics.
 */
export const SPREADSHEET_SEMANTIC_SCHEMA_VERSION = 'spreadsheet-semantic.v2' as const;
export const SPREADSHEET_SEMANTIC_LIMITS = {
  maxHierarchyDepth: 4,
  maxProviderCalls: 6,
  // Normal spreadsheet semantics use one verified strict-schema policy. A
  // separate bounded repair may consume one additional provider call.
  maxCallsPerStage: 2,
  maxOverviewRowsPerSheet: 8,
  maxOverviewCellsPerSheet: 96,
  maxRequestedRanges: 4,
  maxRowsPerRequestedRange: 40,
  maxCellsPerRequestedRange: 480,
  maxCellCharacters: 160,
  maxRequestBytes: 65_536,
  maxResponseBytes: 65_536,
  maxOutputTokens: 4_000,
  timeoutMs: 30_000,
  reviewTimeoutMs: 90_000,
  retryCount: 1,
  retryDelayMs: 250,
  cacheTtlMs: 24 * 60 * 60 * 1000,
  maxCacheEntries: 100,
} as const;

const sheetId = z.string().regex(/^sheet_[A-Za-z0-9_-]{1,127}$/);
const columnId = z.string().regex(/^col_[A-Za-z]{1,4}$/);
const rowNumber = z.number().int().min(1).max(1_048_576);
const columnNumber = z.number().int().min(1).max(16_384);
const boundedText = z.string().min(1).max(240);
const nullableRange = z.object({
  startRow: rowNumber, endRow: rowNumber, startColumn: columnNumber, endColumn: columnNumber,
}).strict().refine((value) => value.startRow <= value.endRow && value.startColumn <= value.endColumn, 'range is ordered');

export const spreadsheetStructuralWorkbookSchema = z.object({
  schemaVersion: z.literal(SPREADSHEET_SEMANTIC_SCHEMA_VERSION),
  fileType: z.enum(['csv', 'xls', 'xlsx']),
  sheets: z.array(z.object({
    sheetId,
    index: z.number().int().nonnegative(),
    displayName: z.string().min(1).max(255),
    dimensions: z.object({ rows: z.number().int().nonnegative(), columns: z.number().int().nonnegative() }).strict(),
    parserRange: nullableRange.nullable(),
    populatedArea: nullableRange.nullable(),
    structuralSignals: z.object({
      nonEmptyCellCount: z.number().int().nonnegative(),
      formulaCount: z.number().int().nonnegative(),
      mergedCellCount: z.number().int().nonnegative(),
      mergedRangeCount: z.number().int().nonnegative(),
      styledCellCount: z.number().int().nonnegative(),
      hiddenRowCount: z.number().int().nonnegative(),
    }).strict(),
    availableColumnIds: z.array(columnId).max(16_384),
    overviewRows: z.array(z.object({
      rowNumber,
      values: z.array(z.string().max(SPREADSHEET_SEMANTIC_LIMITS.maxCellCharacters)).max(64),
    }).strict()).max(SPREADSHEET_SEMANTIC_LIMITS.maxOverviewRowsPerSheet),
  }).strict()).min(1).max(100),
}).strict();

export type SpreadsheetStructuralWorkbook = z.infer<typeof spreadsheetStructuralWorkbookSchema>;

export const spreadsheetContextRangeSchema = z.object({
  sheetId,
  startRow: rowNumber,
  endRow: rowNumber,
  startColumn: columnNumber,
  endColumn: columnNumber,
  chunk: z.number().int().min(0).max(99),
  reason: boundedText,
}).strict().refine((value) => value.startRow <= value.endRow && value.startColumn <= value.endColumn, 'range is ordered');

export const spreadsheetContextRequestSchema = z.object({
  schemaVersion: z.literal(SPREADSHEET_SEMANTIC_SCHEMA_VERSION),
  continuationToken: z.string().min(8).max(128),
  allowedSheetIds: z.array(sheetId).min(1).max(100),
  requests: z.array(spreadsheetContextRangeSchema).min(1).max(SPREADSHEET_SEMANTIC_LIMITS.maxRequestedRanges),
}).strict();

export type SpreadsheetContextRequest = z.infer<typeof spreadsheetContextRequestSchema>;

export const spreadsheetUnresolvedQuestionSchema = z.object({
  id: z.string().regex(/^question_[A-Za-z0-9_-]{1,127}$/),
  sheetId: sheetId.nullable(),
  question: boundedText,
  whyNeeded: boundedText,
  choices: z.array(z.object({ id: z.string().min(1).max(80), label: boundedText }).strict()).min(1).max(5),
  blocking: z.boolean(),
}).strict();

export const spreadsheetAbstentionSchema = z.object({
  reason: z.enum([
    'insufficient_evidence', 'unsupported_layout', 'ambiguous_candidates',
    'provider_unavailable', 'provider_timeout', 'provider_rate_limited',
    'provider_schema_invalid', 'operational_limit',
  ]),
  detail: boundedText,
  manualRecoveryRequired: z.literal(true),
}).strict();

/**
 * Stable, developer-authored identifiers for the two bounded custom
 * refinements below. These exist only so a contract-invalid response can be
 * attributed to the specific predicate that rejected it (never to the Zod
 * message text or any workbook content) once it reaches diagnostic
 * telemetry. Extend this list only when a new custom predicate is added to
 * finalSheetPlan; never source an identifier from provider-influenced data.
 */
export const SPREADSHEET_SHEET_PLAN_CUSTOM_PREDICATE_IDS = [
  'sheet_header_data_order',
  'sheet_transactional_required_bindings',
] as const;
export type SpreadsheetSheetPlanCustomPredicateId = typeof SPREADSHEET_SHEET_PLAN_CUSTOM_PREDICATE_IDS[number];

const fieldBinding = z.object({
  columnId: columnId.nullable(),
  confidence: z.number().int().min(0).max(100),
  rationale: boundedText,
}).strict();

const finalSheetPlan = z.object({
  sheetId,
  disposition: z.enum(['transactional', 'summary', 'reference', 'duplicate', 'excluded', 'unresolved', 'not_analysed']),
  decisionSource: z.enum(['ai', 'user', 'manual_recovery']),
  validationReason: boundedText,
  purpose: boundedText,
  headerRow: rowNumber.nullable(),
  dataRange: z.object({ startRow: rowNumber, endRow: rowNumber }).strict().nullable(),
  rowRules: z.object({
    include: z.array(z.object({ startRow: rowNumber, endRow: rowNumber, reason: boundedText }).strict()).max(40),
    exclude: z.array(z.object({ startRow: rowNumber, endRow: rowNumber, reason: boundedText }).strict()).max(80),
  }).strict(),
  fields: z.object({
    date: fieldBinding,
    description: fieldBinding,
    signedAmount: fieldBinding,
    debit: fieldBinding,
    credit: fieldBinding,
    category: fieldBinding,
  }).strict(),
  transactionSemantics: z.object({
    direction: z.enum(['income', 'expense', 'mixed', 'unknown']),
    rationale: boundedText,
  }).strict(),
  duplicateOrOverlap: z.array(z.object({
    otherSheetId: sheetId,
    confidence: z.number().int().min(0).max(100),
    rationale: boundedText,
  }).strict()).max(20),
  unresolvedQuestionIds: z.array(z.string().regex(/^question_[A-Za-z0-9_-]{1,127}$/)).max(20),
}).strict().superRefine((sheet, context) => {
  if (sheet.dataRange && sheet.headerRow && sheet.dataRange.startRow <= sheet.headerRow) {
    context.addIssue({
      code: 'custom',
      message: 'data begins after header',
      params: { predicateId: 'sheet_header_data_order' satisfies SpreadsheetSheetPlanCustomPredicateId },
    });
  }
  if (sheet.disposition === 'transactional') {
    if (!sheet.headerRow || !sheet.dataRange || !sheet.fields.date.columnId
      || (!sheet.fields.signedAmount.columnId && !(sheet.fields.debit.columnId && sheet.fields.credit.columnId))
      || !sheet.fields.description.columnId) {
      context.addIssue({
        code: 'custom',
        message: 'transactional sheet has required bindings',
        params: { predicateId: 'sheet_transactional_required_bindings' satisfies SpreadsheetSheetPlanCustomPredicateId },
      });
    }
  }
});

export const spreadsheetImportPlanSchema = z.object({
  schemaVersion: z.literal(SPREADSHEET_SEMANTIC_SCHEMA_VERSION),
  status: z.enum(['complete', 'incomplete']),
  continuationToken: z.string().min(8).max(128),
  sheets: z.array(finalSheetPlan).min(1).max(100),
  unresolvedQuestions: z.array(spreadsheetUnresolvedQuestionSchema).max(100),
  abstention: spreadsheetAbstentionSchema.nullable(),
  summary: boundedText,
}).strict().superRefine((plan, context) => {
  const ids = new Set(plan.sheets.map((sheet) => sheet.sheetId));
  if (ids.size !== plan.sheets.length) context.addIssue({ code: 'custom', message: 'sheets are unique' });
  if (plan.status === 'complete' && plan.abstention) context.addIssue({ code: 'custom', message: 'complete plans do not abstain' });
  if (plan.status === 'incomplete' && !plan.abstention && plan.unresolvedQuestions.length === 0) {
    context.addIssue({ code: 'custom', message: 'incomplete plans state why' });
  }
});

export type SpreadsheetImportPlan = z.infer<typeof spreadsheetImportPlanSchema>;

export const spreadsheetAIResponseSchema = z.union([
  z.object({
    schemaVersion: z.literal(SPREADSHEET_SEMANTIC_SCHEMA_VERSION),
    stage: z.literal('request_context'),
    request: spreadsheetContextRequestSchema,
    plan: z.null(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(SPREADSHEET_SEMANTIC_SCHEMA_VERSION),
    stage: z.literal('final_plan'),
    request: z.null(),
    plan: spreadsheetImportPlanSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(SPREADSHEET_SEMANTIC_SCHEMA_VERSION),
    stage: z.literal('abstain'),
    request: z.null(),
    plan: spreadsheetImportPlanSchema,
  }).strict().superRefine((value, context) => {
    if (value.plan.status !== 'incomplete' || !value.plan.abstention) {
      context.addIssue({ code: 'custom', message: 'abstention contains incomplete plan' });
    }
  }),
]);

export type SpreadsheetAIResponse = z.infer<typeof spreadsheetAIResponseSchema>;
export const spreadsheetAIProviderWireResponseSchema = z.object({
  response: spreadsheetAIResponseSchema,
}).strict();

/**
 * The same requested-context budgets enforced by buildRequestedSpreadsheetContext
 * below, derived directly from SPREADSHEET_SEMANTIC_LIMITS so the AI-visible
 * contract and the protected validator can never drift independently.
 */
export const spreadsheetRequestedContextBudget = {
  maxRequestedRanges: SPREADSHEET_SEMANTIC_LIMITS.maxRequestedRanges,
  maxRowsPerRequestedRange: SPREADSHEET_SEMANTIC_LIMITS.maxRowsPerRequestedRange,
  maxCellsPerRequestedRange: SPREADSHEET_SEMANTIC_LIMITS.maxCellsPerRequestedRange,
} as const;

/** Compact JSON-schema-like contract sent with every provider request. */
export const spreadsheetAIResponseContract = {
  schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
  response: {
    required: ['schemaVersion', 'stage', 'request', 'plan'],
    stages: ['request_context', 'final_plan', 'abstain'],
    requestContext: {
      request: {
        required: ['schemaVersion', 'continuationToken', 'allowedSheetIds', 'requests'],
        requestItem: { required: ['sheetId', 'startRow', 'endRow', 'startColumn', 'endColumn', 'chunk', 'reason'] },
      },
      requestBudget: {
        ...spreadsheetRequestedContextBudget,
        rule: 'Each request item\'s row count (endRow - startRow + 1) must be at most maxRowsPerRequestedRange, and its cell count (rows x columns) must be at most maxCellsPerRequestedRange. At most maxRequestedRanges request items are allowed. A request item that exceeds either budget is never rejected outright: it is served as the largest shrink-only reduction that fits (rows first, then columns), starting from its own startRow/startColumn, and the served range is reported back in that item\'s range; the served range never exceeds what was requested.',
      },
      plan: null,
    },
    finalOrAbstain: {
      request: null,
      plan: {
        required: ['schemaVersion', 'status', 'continuationToken', 'sheets', 'unresolvedQuestions', 'abstention', 'summary'],
        status: ['complete', 'incomplete'],
        sheetIdUniquenessRule: 'Every sheet plan\'s sheetId must be unique within sheets; the same sheetId must never be repeated across more than one sheet plan in the same response.',
        completeForbidsAbstentionRule: 'A plan with status "complete" must have abstention set to null.',
        incompleteRequiresReasonRule: 'A plan with status "incomplete" must have abstention set (non-null) or at least one entry in unresolvedQuestions; it can never be incomplete with neither present.',
        sheet: {
          required: ['sheetId', 'disposition', 'decisionSource', 'validationReason', 'purpose', 'headerRow', 'dataRange', 'rowRules', 'fields', 'transactionSemantics', 'duplicateOrOverlap', 'unresolvedQuestionIds'],
          disposition: ['transactional', 'summary', 'reference', 'duplicate', 'excluded', 'unresolved', 'not_analysed'],
          decisionSource: ['ai', 'user', 'manual_recovery'],
          fields: ['date', 'description', 'signedAmount', 'debit', 'credit', 'category'],
          headerDataOrderRule: 'For every sheet regardless of disposition, if both headerRow and dataRange are set, dataRange.startRow must be strictly after headerRow.',
          transactionalRule: 'A transactional sheet additionally requires headerRow, dataRange, column IDs for both date and description, column IDs for either signedAmount or both debit and credit together, and at least one include rowRule.',
        },
      },
    },
    continuationRule: 'Echo the supplied continuationToken exactly in request_context requests and final/abstain plans. Reference only supplied sheet IDs, column IDs, and parser-visible rows.',
  },
} as const;

/**
 * A deliberately synthetic, data-free request used by the manual provider
 * compatibility check. Keep this separate from workbook construction so the
 * check can never accidentally receive an uploaded file or an evidence record.
 */
export const SPREADSHEET_PROVIDER_COMPATIBILITY_TOKEN = 'provider-compatibility-check-v1';
export const SPREADSHEET_PROVIDER_COMPATIBILITY_SHEET_ID = 'sheet_compatibility_probe';
export const SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_TOKEN = 'provider-positive-compatibility-v1';
export const SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_SHEET_ID = 'sheet_positive_compatibility_probe';

export function buildSpreadsheetProviderCompatibilityWorkbook(): SpreadsheetWorkbook {
  return {
    sourceByteLength: 0,
    fileType: 'csv',
    totalParserRows: 1,
    totalParserCells: 3,
    sheets: [{
      sheetId: SPREADSHEET_PROVIDER_COMPATIBILITY_SHEET_ID,
      displayName: 'synthetic',
      index: 0,
      rowCount: 1,
      columnCount: 3,
      parserRange: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 },
      rows: [{
        rowNumber: 1,
        cells: [],
        values: ['Date', 'Description', 'Amount'],
        hidden: false,
        hasFormula: false,
        hasStyle: false,
        merged: false,
      }],
      headers: ['Date', 'Description', 'Amount'],
      inferredHeaderRow: 1,
      isEmpty: false,
      structural: {
        populatedArea: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 },
        nonEmptyCellCount: 3,
        formulaCount: 0,
        mergedCellCount: 0,
        mergedRangeCount: 0,
        styledCellCount: 0,
        hiddenRowCount: 0,
      },
    }],
  };
}

export function buildSpreadsheetProviderCompatibilityPayload(): Record<string, unknown> {
  return {
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    stage: 'workbook_overview',
    continuationToken: SPREADSHEET_PROVIDER_COMPATIBILITY_TOKEN,
    overview: {
      schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
      fileType: 'csv',
      sheets: [{
        sheetId: SPREADSHEET_PROVIDER_COMPATIBILITY_SHEET_ID,
        index: 0,
        displayName: '[sheet:synthetic]',
        dimensions: { rows: 1, columns: 3 },
        parserRange: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 },
        populatedArea: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 3 },
        structuralSignals: {
          nonEmptyCellCount: 3,
          formulaCount: 0,
          mergedCellCount: 0,
          mergedRangeCount: 0,
          styledCellCount: 0,
          hiddenRowCount: 0,
        },
        availableColumnIds: ['col_A', 'col_B', 'col_C'],
        overviewRows: [{ rowNumber: 1, values: ['[header:date]', '[header:description]', '[header:amount]'] }],
      }],
    },
    responseContract: spreadsheetAIResponseContract,
    instruction: 'This is a provider compatibility probe. Return only an abstain response using the supplied synthetic sheet and continuation token. Use no workbook facts, and do not write records or request real workbook context.',
  };
}

/**
 * A separate, synthetic ledger that requires a provider-produced positive
 * final_plan. It is never derived from an upload, evidence record, or session.
 */
export function buildSpreadsheetProviderPositiveCompatibilityWorkbook(): SpreadsheetWorkbook {
  return {
    sourceByteLength: 0,
    fileType: 'csv',
    totalParserRows: 2,
    totalParserCells: 6,
    sheets: [{
      sheetId: SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_SHEET_ID,
      displayName: 'synthetic-positive',
      index: 0,
      rowCount: 2,
      columnCount: 3,
      parserRange: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 3 },
      rows: [
        {
          rowNumber: 1,
          cells: [],
          values: ['Date', 'Description', 'Amount'],
          hidden: false,
          hasFormula: false,
          hasStyle: false,
          merged: false,
        },
        {
          rowNumber: 2,
          cells: [],
          values: ['[date]', '[synthetic movement]', '[number:positive]'],
          hidden: false,
          hasFormula: false,
          hasStyle: false,
          merged: false,
        },
      ],
      headers: ['Date', 'Description', 'Amount'],
      inferredHeaderRow: 1,
      isEmpty: false,
      structural: {
        populatedArea: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 3 },
        nonEmptyCellCount: 6,
        formulaCount: 0,
        mergedCellCount: 0,
        mergedRangeCount: 0,
        styledCellCount: 0,
        hiddenRowCount: 0,
      },
    }],
  };
}

export function buildSpreadsheetProviderPositiveCompatibilityPayload(): Record<string, unknown> {
  return {
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    stage: 'workbook_overview',
    continuationToken: SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_TOKEN,
    overview: {
      schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
      fileType: 'csv',
      sheets: [{
        sheetId: SPREADSHEET_PROVIDER_POSITIVE_COMPATIBILITY_SHEET_ID,
        index: 0,
        displayName: '[sheet:synthetic-positive]',
        dimensions: { rows: 2, columns: 3 },
        parserRange: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 3 },
        populatedArea: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 3 },
        structuralSignals: {
          nonEmptyCellCount: 6,
          formulaCount: 0,
          mergedCellCount: 0,
          mergedRangeCount: 0,
          styledCellCount: 0,
          hiddenRowCount: 0,
        },
        availableColumnIds: ['col_A', 'col_B', 'col_C'],
        overviewRows: [
          { rowNumber: 1, values: ['[header:date]', '[header:description]', '[header:amount]'] },
          { rowNumber: 2, values: ['[date]', '[text:length-19]', '[number:positive]'] },
        ],
      }],
    },
    responseContract: spreadsheetAIResponseContract,
    instruction: 'This is a provider compatibility probe. Return only a final_plan response using the supplied synthetic sheet and continuation token. The plan must be complete, designate the one sheet as transactional, use header row 1 and data/include row 2, and bind date, description, and signedAmount to col_A, col_B, and col_C. Use no workbook facts beyond this synthetic payload, do not request context, and do not write records.',
  };
}

/**
 * Provider response-format schema. Every nested object is closed so providers
 * supporting strict JSON Schema can reject surplus or partial structure before
 * it reaches us. Zod below remains the authoritative semantic validator.
 */
export const spreadsheetAIResponseJsonSchema = {
  // The managed route forbids anyOf/enum/const at the root. Keep the root as a
  // plain closed envelope and place the exact semantic union below `response`.
  type: 'object',
  additionalProperties: false,
  required: ['response'],
  properties: {
    response: { anyOf: [
    {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'stage', 'request', 'plan'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        stage: { type: 'string', const: 'request_context' },
        request: { $ref: '#/$defs/request' },
        plan: { type: 'null' },
      },
    },
    {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'stage', 'request', 'plan'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        stage: { type: 'string', const: 'final_plan' },
        request: { type: 'null' },
        plan: { $ref: '#/$defs/plan' },
      },
    },
    {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'stage', 'request', 'plan'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        stage: { type: 'string', const: 'abstain' },
        request: { type: 'null' },
        plan: { $ref: '#/$defs/abstainPlan' },
      },
    },
    ] },
  },
  $defs: {
    requestContextResponse: {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'stage', 'request', 'plan'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        stage: { type: 'string', const: 'request_context' },
        request: { $ref: '#/$defs/request' },
        plan: { type: 'null' },
      },
    },
    finalPlanResponse: {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'stage', 'request', 'plan'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        stage: { type: 'string', const: 'final_plan' },
        request: { type: 'null' },
        plan: { $ref: '#/$defs/plan' },
      },
    },
    abstainResponse: {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'stage', 'request', 'plan'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        stage: { type: 'string', const: 'abstain' },
        request: { type: 'null' },
        plan: { $ref: '#/$defs/abstainPlan' },
      },
    },
    request: {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'continuationToken', 'allowedSheetIds', 'requests'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        continuationToken: { type: 'string', minLength: 8, maxLength: 128 },
        allowedSheetIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', pattern: '^sheet_[A-Za-z0-9_-]{1,127}$' } },
        requests: { type: 'array', minItems: 1, maxItems: 4, items: { $ref: '#/$defs/requestItem' } },
      },
    },
    requestItem: {
      type: 'object', additionalProperties: false,
      required: ['sheetId', 'startRow', 'endRow', 'startColumn', 'endColumn', 'chunk', 'reason'],
      properties: {
        sheetId: { type: 'string', pattern: '^sheet_[A-Za-z0-9_-]{1,127}$' },
        startRow: { type: 'integer', minimum: 1, maximum: 1048576 },
        endRow: { type: 'integer', minimum: 1, maximum: 1048576 },
        startColumn: { type: 'integer', minimum: 1, maximum: 16384 },
        endColumn: { type: 'integer', minimum: 1, maximum: 16384 },
        chunk: { type: 'integer', minimum: 0, maximum: 99 },
        reason: { type: 'string', minLength: 1, maxLength: 240 },
      },
    },
    plan: {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'status', 'continuationToken', 'sheets', 'unresolvedQuestions', 'abstention', 'summary'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        status: { type: 'string', enum: ['complete', 'incomplete'] },
        continuationToken: { type: 'string', minLength: 8, maxLength: 128 },
        sheets: { type: 'array', minItems: 1, maxItems: 100, items: { $ref: '#/$defs/sheetPlan' } },
        unresolvedQuestions: { type: 'array', maxItems: 100, items: { $ref: '#/$defs/question' } },
        abstention: { anyOf: [{ $ref: '#/$defs/abstention' }, { type: 'null' }] },
        summary: { type: 'string', minLength: 1, maxLength: 240 },
      },
    },
    abstainPlan: {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'status', 'continuationToken', 'sheets', 'unresolvedQuestions', 'abstention', 'summary'],
      properties: {
        schemaVersion: { type: 'string', const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
        status: { type: 'string', const: 'incomplete' },
        continuationToken: { type: 'string', minLength: 8, maxLength: 128 },
        sheets: { type: 'array', minItems: 1, maxItems: 100, items: { $ref: '#/$defs/sheetPlan' } },
        unresolvedQuestions: { type: 'array', maxItems: 100, items: { $ref: '#/$defs/question' } },
        abstention: { $ref: '#/$defs/abstention' },
        summary: { type: 'string', minLength: 1, maxLength: 240 },
      },
    },
    sheetPlan: {
      type: 'object', additionalProperties: false,
      required: ['sheetId', 'disposition', 'decisionSource', 'validationReason', 'purpose', 'headerRow', 'dataRange', 'rowRules', 'fields', 'transactionSemantics', 'duplicateOrOverlap', 'unresolvedQuestionIds'],
      properties: {
        sheetId: { type: 'string', pattern: '^sheet_[A-Za-z0-9_-]{1,127}$' },
        disposition: { type: 'string', enum: ['transactional', 'summary', 'reference', 'duplicate', 'excluded', 'unresolved', 'not_analysed'] },
        decisionSource: { type: 'string', enum: ['ai', 'user', 'manual_recovery'] },
        validationReason: { type: 'string', minLength: 1, maxLength: 240 },
        purpose: { type: 'string', minLength: 1, maxLength: 240 },
        headerRow: { anyOf: [{ type: 'integer', minimum: 1, maximum: 1048576 }, { type: 'null' }] },
        dataRange: { anyOf: [{ $ref: '#/$defs/dataRange' }, { type: 'null' }] },
        rowRules: { $ref: '#/$defs/rowRules' },
        fields: { $ref: '#/$defs/fields' },
        transactionSemantics: { $ref: '#/$defs/transactionSemantics' },
        duplicateOrOverlap: { type: 'array', maxItems: 20, items: { $ref: '#/$defs/overlap' } },
        unresolvedQuestionIds: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^question_[A-Za-z0-9_-]{1,127}$' } },
      },
    },
    dataRange: { type: 'object', additionalProperties: false, required: ['startRow', 'endRow'], properties: { startRow: { type: 'integer', minimum: 1, maximum: 1048576 }, endRow: { type: 'integer', minimum: 1, maximum: 1048576 } } },
    rule: { type: 'object', additionalProperties: false, required: ['startRow', 'endRow', 'reason'], properties: { startRow: { type: 'integer', minimum: 1, maximum: 1048576 }, endRow: { type: 'integer', minimum: 1, maximum: 1048576 }, reason: { type: 'string', minLength: 1, maxLength: 240 } } },
    rowRules: { type: 'object', additionalProperties: false, required: ['include', 'exclude'], properties: { include: { type: 'array', maxItems: 40, items: { $ref: '#/$defs/rule' } }, exclude: { type: 'array', maxItems: 80, items: { $ref: '#/$defs/rule' } } } },
    field: { type: 'object', additionalProperties: false, required: ['columnId', 'confidence', 'rationale'], properties: { columnId: { anyOf: [{ type: 'string', pattern: '^col_[A-Za-z]{1,4}$' }, { type: 'null' }] }, confidence: { type: 'integer', minimum: 0, maximum: 100 }, rationale: { type: 'string', minLength: 1, maxLength: 240 } } },
    fields: { type: 'object', additionalProperties: false, required: ['date', 'description', 'signedAmount', 'debit', 'credit', 'category'], properties: { date: { $ref: '#/$defs/field' }, description: { $ref: '#/$defs/field' }, signedAmount: { $ref: '#/$defs/field' }, debit: { $ref: '#/$defs/field' }, credit: { $ref: '#/$defs/field' }, category: { $ref: '#/$defs/field' } } },
    transactionSemantics: { type: 'object', additionalProperties: false, required: ['direction', 'rationale'], properties: { direction: { type: 'string', enum: ['income', 'expense', 'mixed', 'unknown'] }, rationale: { type: 'string', minLength: 1, maxLength: 240 } } },
    overlap: { type: 'object', additionalProperties: false, required: ['otherSheetId', 'confidence', 'rationale'], properties: { otherSheetId: { type: 'string', pattern: '^sheet_[A-Za-z0-9_-]{1,127}$' }, confidence: { type: 'integer', minimum: 0, maximum: 100 }, rationale: { type: 'string', minLength: 1, maxLength: 240 } } },
    question: { type: 'object', additionalProperties: false, required: ['id', 'sheetId', 'question', 'whyNeeded', 'choices', 'blocking'], properties: { id: { type: 'string', pattern: '^question_[A-Za-z0-9_-]{1,127}$' }, sheetId: { anyOf: [{ type: 'string', pattern: '^sheet_[A-Za-z0-9_-]{1,127}$' }, { type: 'null' }] }, question: { type: 'string', minLength: 1, maxLength: 240 }, whyNeeded: { type: 'string', minLength: 1, maxLength: 240 }, choices: { type: 'array', minItems: 1, maxItems: 5, items: { $ref: '#/$defs/choice' } }, blocking: { type: 'boolean' } } },
    choice: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id: { type: 'string', minLength: 1, maxLength: 80 }, label: { type: 'string', minLength: 1, maxLength: 240 } } },
    abstention: { type: 'object', additionalProperties: false, required: ['reason', 'detail', 'manualRecoveryRequired'], properties: { reason: { type: 'string', enum: ['insufficient_evidence', 'unsupported_layout', 'ambiguous_candidates', 'provider_unavailable', 'provider_timeout', 'provider_rate_limited', 'provider_schema_invalid', 'operational_limit'] }, detail: { type: 'string', minLength: 1, maxLength: 240 }, manualRecoveryRequired: { type: 'boolean', const: true } } },
  },
} as const;

const multilingualHeaderAliases: Record<string, string> = {
  '日付': 'date', '日期': 'date', '날짜': 'date', 'تاريخ': 'date', 'fecha': 'date', 'datum': 'date', 'tarikh': 'date',
  '内容': 'description', '內容': 'description', '摘要': 'description', '說明': 'description', 'รายละเอียด': 'description', 'keterangan': 'description',
  '金額': 'amount', '金额': 'amount', 'مبلغ': 'amount', 'jumlah': 'amount', 'monto': 'amount', 'betrag': 'amount',
  '借方': 'debit', '貸方': 'credit', '贷方': 'credit', '残高': 'balance', '餘額': 'balance', '余额': 'balance',
  'カテゴリ': 'category', '类别': 'category', '分類': 'category', '分类': 'category',
};

function safeStructuralLabel(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 40 || !/\p{L}/u.test(trimmed)) return null;
  if (/@|https?:\/\/|www\.|\d|(?:iban|swift|account|invoice|address|street|road|email|phone|sort.?code)/i.test(trimmed)) return null;
  const words = trimmed.match(/\p{L}+/gu) ?? [];
  if (words.length > 4 || /[,:;()[\]{}]/.test(trimmed)) return null;
  // The most common Western name form is intentionally not preserved in a
  // title/sheet label. This still permits non-Latin labels and finance terms.
  if (/(?:^|\s)[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}(?:\s|$)/.test(trimmed)) return null;
  return trimmed;
}

export function redactSpreadsheetValue(value: string, options: { preserveStructuralHeader?: boolean; preserveStructuralTitle?: boolean } = {}): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const headerKeywords = ['date', 'posted', 'transaction', 'amount', 'debit', 'credit', 'description', 'details', 'memo', 'reference', 'category', 'balance', 'currency', 'income', 'expense'];
  const matchedHeaders = headerKeywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(lower));
  if (matchedHeaders.length) return `[header:${matchedHeaders.join('|')}]`;
  const multilingualHeader = multilingualHeaderAliases[trimmed];
  if (multilingualHeader) return `[header:${multilingualHeader}]`;
  const safeLabel = options.preserveStructuralHeader || options.preserveStructuralTitle ? safeStructuralLabel(trimmed) : null;
  if (safeLabel) return `[${options.preserveStructuralHeader ? 'header-label' : 'title-label'}:${safeLabel}]`;
  if (/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(trimmed) || /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(trimmed)) return '[date]';
  if (/^[£$€]?\s*\(?-?\d[\d,]*(?:\.\d{1,4})?\)?(?:\s*(?:cr|dr))?$/i.test(trimmed)) {
    const numeric = Number(trimmed.replace(/[£$€,\s()]/g, '').replace(/(cr|dr)$/i, ''));
    return `[number:${numeric < 0 || /^\(/.test(trimmed) ? 'negative' : numeric > 0 ? 'positive' : 'zero'}]`;
  }
  return `[text:length-${Math.min(trimmed.length, SPREADSHEET_SEMANTIC_LIMITS.maxCellCharacters)}]`;
}

function overviewRowsFor(sheet: SpreadsheetWorkbook['sheets'][number]) {
  const rows = sheet.rows.filter((row) => row.values.some((value) => value.trim()));
  const selected = [...rows.slice(0, 5), ...rows.slice(-3)]
    .filter((row, index, array) => array.findIndex((candidate) => candidate.rowNumber === row.rowNumber) === index);
  let cells = 0;
  return selected.map((row) => ({
    rowNumber: row.rowNumber,
    values: row.values.slice(0, 64).map((value) => {
      if (cells >= SPREADSHEET_SEMANTIC_LIMITS.maxOverviewCellsPerSheet) return '';
      cells += 1;
      const isTitle = row.rowNumber < (sheet.inferredHeaderRow ?? 0)
        && row.values.filter((cell) => cell.trim()).length === 1;
      return redactSpreadsheetValue(value, {
        preserveStructuralHeader: row.rowNumber === sheet.inferredHeaderRow,
        preserveStructuralTitle: isTitle,
      }).slice(0, SPREADSHEET_SEMANTIC_LIMITS.maxCellCharacters);
    }),
  }));
}

/** Builds an all-sheet, redacted structural overview before any provider call. */
export function buildSpreadsheetWorkbookOverview(workbook: SpreadsheetWorkbook): SpreadsheetStructuralWorkbook {
  return spreadsheetStructuralWorkbookSchema.parse({
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    fileType: workbook.fileType,
    sheets: workbook.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      index: sheet.index,
      displayName: safeStructuralLabel(sheet.displayName) ? `[sheet-label:${safeStructuralLabel(sheet.displayName)}]` : `[sheet:${sheet.index + 1}]`,
      dimensions: { rows: sheet.rowCount, columns: sheet.columnCount },
      parserRange: sheet.parserRange,
      populatedArea: sheet.structural.populatedArea,
      structuralSignals: {
        nonEmptyCellCount: sheet.structural.nonEmptyCellCount,
        formulaCount: sheet.structural.formulaCount,
        mergedCellCount: sheet.structural.mergedCellCount,
        mergedRangeCount: sheet.structural.mergedRangeCount,
        styledCellCount: sheet.structural.styledCellCount,
        hiddenRowCount: sheet.structural.hiddenRowCount,
      },
      availableColumnIds: Array.from({ length: sheet.columnCount }, (_, index) => `col_${columnName(index)}`),
      overviewRows: overviewRowsFor(sheet),
    })),
  });
}

function columnName(index: number): string {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function columnIndex(id: string): number {
  return id.slice(4).split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/**
 * Re-checks every AI request against parser-visible bounds. The provider cannot
 * expand its own context window or request raw values outside this allow-list.
 * A range within bounds but above the row/cell budget is served shrink-only
 * clipped rather than rejected; see spreadsheetAIResponseContract's requestBudget rule.
 */
export function buildRequestedSpreadsheetContext(
  workbook: SpreadsheetWorkbook,
  request: SpreadsheetContextRequest,
) {
  const parsed = spreadsheetContextRequestSchema.parse(request);
  const allowed = new Set(parsed.allowedSheetIds);
  let totalCells = 0;
  const ranges = parsed.requests.map((requested) => {
    const sheet = workbook.sheets.find((item) => item.sheetId === requested.sheetId);
    if (!sheet || !allowed.has(requested.sheetId) || !sheet.parserRange) throw new Error('context_request_unknown_sheet');
    if (requested.startRow < sheet.parserRange.startRow || requested.endRow > sheet.parserRange.endRow
      || requested.startColumn < sheet.parserRange.startColumn || requested.endColumn > sheet.parserRange.endColumn) {
      throw new Error('context_request_out_of_bounds');
    }
    // A range above the safe budget is never rejected outright: it is
    // deterministically shrunk to fit, rows first and then columns, starting
    // from the requested startRow/startColumn. This can only reduce the
    // served range below what was requested, never expand it, and the actual
    // served coordinates are reported back below so a still-oversized
    // response can never silently look identical to what was asked for.
    const clippedEndRow = Math.min(requested.endRow, requested.startRow + SPREADSHEET_SEMANTIC_LIMITS.maxRowsPerRequestedRange - 1);
    const rowBudget = clippedEndRow - requested.startRow + 1;
    const maxColumnsForRowBudget = Math.floor(SPREADSHEET_SEMANTIC_LIMITS.maxCellsPerRequestedRange / rowBudget);
    const clippedEndColumn = Math.min(requested.endColumn, requested.startColumn + maxColumnsForRowBudget - 1);
    const columnBudget = clippedEndColumn - requested.startColumn + 1;
    const truncated = clippedEndRow !== requested.endRow || clippedEndColumn !== requested.endColumn;
    totalCells += rowBudget * columnBudget;
    const rowMap = new Map(sheet.rows.map((row) => [row.rowNumber, row]));
    return {
      sheetId: sheet.sheetId,
      range: { startRow: requested.startRow, endRow: clippedEndRow, startColumn: requested.startColumn, endColumn: clippedEndColumn },
      truncated,
      chunk: requested.chunk,
      reason: requested.reason,
      rows: Array.from({ length: rowBudget }, (_, offset) => {
        const row = rowMap.get(requested.startRow + offset);
        return {
          rowNumber: requested.startRow + offset,
          values: Array.from({ length: columnBudget }, (_, columnOffset) =>
            redactSpreadsheetValue(row?.values[requested.startColumn - 1 + columnOffset] ?? '', {
              preserveStructuralHeader: (requested.startRow + offset) === sheet.inferredHeaderRow,
              preserveStructuralTitle: (requested.startRow + offset) < (sheet.inferredHeaderRow ?? 0)
                && (row?.values.filter((cell) => cell.trim()).length ?? 0) === 1,
            }).slice(0, SPREADSHEET_SEMANTIC_LIMITS.maxCellCharacters)),
        };
      }),
    };
  });
  if (totalCells > SPREADSHEET_SEMANTIC_LIMITS.maxRequestedRanges * SPREADSHEET_SEMANTIC_LIMITS.maxCellsPerRequestedRange) {
    throw new Error('context_request_total_limit_exceeded');
  }
  return { schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION, continuationToken: parsed.continuationToken, ranges };
}

export function validateSpreadsheetImportPlan(plan: SpreadsheetImportPlan, workbook: SpreadsheetWorkbook): string | null {
  const known = new Map(workbook.sheets.map((sheet) => [sheet.sheetId, sheet]));
  if (plan.sheets.length !== workbook.sheets.length) return 'every_sheet_requires_disposition';
  if (plan.status === 'complete' && (plan.abstention || plan.sheets.some((sheet) => sheet.disposition === 'unresolved' || sheet.disposition === 'not_analysed'))) {
    return 'complete_plan_requires_terminal_disposition_for_every_sheet';
  }
  if (plan.status === 'incomplete' && !plan.abstention) return 'incomplete_plan_requires_abstention';
  for (const sheetPlan of plan.sheets) {
    const sheet = known.get(sheetPlan.sheetId);
    if (!sheet) return 'unknown_sheet_reference';
    if (!sheet.parserRange) {
      if (sheetPlan.disposition === 'transactional') return 'empty_transactional_sheet';
      continue;
    }
    const allowedColumns = new Set(Array.from({ length: sheet.columnCount }, (_, index) => `col_${columnName(index)}`));
    const inRange = (startRow: number, endRow: number) =>
      startRow >= sheet.parserRange!.startRow && endRow <= sheet.parserRange!.endRow && startRow <= endRow;
    if ([sheetPlan.fields.date, sheetPlan.fields.description, sheetPlan.fields.signedAmount, sheetPlan.fields.debit, sheetPlan.fields.credit, sheetPlan.fields.category]
      .some((field) => field.columnId && !allowedColumns.has(field.columnId))) return 'unknown_column_reference';
    if (sheetPlan.headerRow && (sheetPlan.headerRow < sheet.parserRange.startRow || sheetPlan.headerRow > sheet.parserRange.endRow)) return 'header_out_of_bounds';
    if (sheetPlan.dataRange && (!inRange(sheetPlan.dataRange.startRow, sheetPlan.dataRange.endRow) || (sheetPlan.headerRow !== null && sheetPlan.dataRange.startRow <= sheetPlan.headerRow))) return 'data_range_out_of_bounds';
    for (const rule of [...sheetPlan.rowRules.include, ...sheetPlan.rowRules.exclude]) {
      if (!inRange(rule.startRow, rule.endRow)) return 'row_rule_out_of_bounds';
      if (sheetPlan.dataRange && (rule.startRow < sheetPlan.dataRange.startRow || rule.endRow > sheetPlan.dataRange.endRow)) return 'row_rule_outside_data_range';
    }
    if (sheetPlan.disposition === 'transactional') {
      if (!sheetPlan.headerRow || !sheetPlan.dataRange) return 'transactional_sheet_requires_header_and_data_range';
      if (!sheetPlan.rowRules.include.length) return 'transactional_sheet_requires_explicit_include_rules';
      if (!sheetPlan.fields.date.columnId || (!sheetPlan.fields.signedAmount.columnId && !sheetPlan.fields.debit.columnId && !sheetPlan.fields.credit.columnId)) {
        return 'transactional_sheet_requires_date_and_amount';
      }
    }
    if (sheetPlan.duplicateOrOverlap.some((overlap) => !known.has(overlap.otherSheetId))) return 'unknown_overlap_reference';
  }
  return null;
}

/** Converts a validated semantic plan into deterministic parsing inputs. */
export function analysisFromSemanticPlan(
  workbook: SpreadsheetWorkbook,
  plan: SpreadsheetImportPlan,
  options: { tradingStartDate?: string | null; decisionSource?: 'ai' | 'user' | 'manual_recovery' } = {},
): SpreadsheetAnalysis {
  const mappings: Record<string, SpreadsheetMapping> = {};
  const roles: Record<string, 'transactional' | 'non_transactional' | 'mixed' | 'unknown'> = {};
  const dispositions: Record<string, SpreadsheetAnalysis['sheets'][number]['finalDisposition']> = {};
  const selected: string[] = [];
  for (const sheet of plan.sheets) {
    dispositions[sheet.sheetId] = sheet.disposition;
    roles[sheet.sheetId] = sheet.disposition === 'transactional' ? 'transactional'
      : sheet.disposition === 'unresolved' || sheet.disposition === 'not_analysed' ? 'unknown'
        : 'non_transactional';
    if (sheet.disposition === 'transactional') {
      selected.push(sheet.sheetId);
      const field = (id: string | null) => id ? columnIndex(id) : undefined;
      mappings[sheet.sheetId] = {
        headerRow: (sheet.headerRow ?? 1) - 1,
        columns: {
          date: field(sheet.fields.date.columnId),
          description: field(sheet.fields.description.columnId),
          amount: field(sheet.fields.signedAmount.columnId),
          debit: field(sheet.fields.debit.columnId),
          credit: field(sheet.fields.credit.columnId),
          category: field(sheet.fields.category.columnId),
        },
      };
    }
  }
  return analyseSpreadsheet(workbook, {
    selectedSheetIds: selected,
    roleOverrides: roles,
    sheetMappings: mappings,
    tradingStartDate: options.tradingStartDate ?? null,
    decisionSource: options.decisionSource ?? 'ai',
    finalDispositions: dispositions,
  });
}

/** Creates a protocol-valid, non-importable state for any provider failure. */
export function incompletePlanForWorkbook(
  workbook: SpreadsheetWorkbook,
  continuationToken: string,
  abstention: z.infer<typeof spreadsheetAbstentionSchema>,
): SpreadsheetImportPlan {
  const emptyField = { columnId: null, confidence: 0, rationale: 'No semantic binding is available.' };
  return spreadsheetImportPlanSchema.parse({
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    status: 'incomplete',
    continuationToken,
    sheets: workbook.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      disposition: 'not_analysed',
      decisionSource: 'manual_recovery',
      validationReason: 'Semantic interpretation was not completed; manual recovery is required.',
      purpose: 'Not interpreted',
      headerRow: null,
      dataRange: null,
      rowRules: { include: [], exclude: [] },
      fields: {
        date: emptyField, description: emptyField, signedAmount: emptyField,
        debit: emptyField, credit: emptyField, category: emptyField,
      },
      transactionSemantics: { direction: 'unknown', rationale: 'No completed semantic interpretation.' },
      duplicateOrOverlap: [],
      unresolvedQuestionIds: [],
    })),
    unresolvedQuestions: [{
      id: 'question_manual_recovery',
      sheetId: null,
      question: 'Which sheets contain individual money records?',
      whyNeeded: 'The automatic review did not complete, so a targeted manual choice is needed before anything can be imported.',
      choices: [
        { id: 'review_sheet', label: 'Review a specific sheet' },
        { id: 'leave_out', label: 'Leave this workbook out for now' },
      ],
      blocking: true,
    }],
    abstention,
    summary: 'Automatic workbook understanding is incomplete. Nothing is eligible for import until a person supplies targeted recovery choices and confirms them.',
  });
}