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
  timeoutMs: 20_000,
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
  contentHash: z.string().min(16).max(128).nullable(),
  sourceByteLength: z.number().int().nonnegative(),
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
    context.addIssue({ code: 'custom', message: 'data begins after header' });
  }
  if (sheet.disposition === 'transactional') {
    if (!sheet.headerRow || !sheet.dataRange || !sheet.fields.date.columnId
      || (!sheet.fields.signedAmount.columnId && !(sheet.fields.debit.columnId && sheet.fields.credit.columnId))
      || !sheet.fields.description.columnId) {
      context.addIssue({ code: 'custom', message: 'transactional sheet has required bindings' });
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
      plan: null,
    },
    finalOrAbstain: {
      request: null,
      plan: {
        required: ['schemaVersion', 'status', 'continuationToken', 'sheets', 'unresolvedQuestions', 'abstention', 'summary'],
        status: ['complete', 'incomplete'],
        sheet: {
          required: ['sheetId', 'disposition', 'decisionSource', 'validationReason', 'purpose', 'headerRow', 'dataRange', 'rowRules', 'fields', 'transactionSemantics', 'duplicateOrOverlap', 'unresolvedQuestionIds'],
          disposition: ['transactional', 'summary', 'reference', 'duplicate', 'excluded', 'unresolved', 'not_analysed'],
          decisionSource: ['ai', 'user', 'manual_recovery'],
          fields: ['date', 'description', 'signedAmount', 'debit', 'credit', 'category'],
          transactionalRule: 'requires headerRow, dataRange, date and amount/debit/credit column IDs, and at least one include rowRule',
        },
      },
    },
    continuationRule: 'Echo the supplied continuationToken exactly in request_context requests and final/abstain plans. Reference only supplied sheet IDs, column IDs, and parser-visible rows.',
  },
} as const;

/** Provider response-format schema. Server Zod validation remains authoritative. */
export const spreadsheetAIResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'stage', 'request', 'plan'],
  properties: {
    schemaVersion: { const: SPREADSHEET_SEMANTIC_SCHEMA_VERSION },
    stage: { enum: ['request_context', 'final_plan', 'abstain'] },
    request: { type: ['object', 'null'], additionalProperties: true },
    plan: { type: ['object', 'null'], additionalProperties: true },
  },
} as const;

const multilingualHeaderAliases: Record<string, string> = {
  '日付': 'date', '日期': 'date', '날짜': 'date', 'تاريخ': 'date', 'fecha': 'date', 'datum': 'date', 'tarikh': 'date',
  '内容': 'description', '內容': 'description', '摘要': 'description', '說明': 'description', 'รายละเอียด': 'description', 'keterangan': 'description',
  '金額': 'amount', '金额': 'amount', 'مبلغ': 'amount', 'jumlah': 'amount', 'monto': 'amount', 'betrag': 'amount',
  '借方': 'debit', '貸方': 'credit', '贷方': 'credit', '残高': 'balance', '餘額': 'balance', '余额': 'balance',
  'カテゴリ': 'category', '类别': 'category', '分類': 'category', '分类': 'category',
};

function safeStructuralHeaderLabel(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 32 || !/\p{L}/u.test(trimmed)) return null;
  if (/@|https?:\/\/|www\.|\d|(?:iban|swift|account|invoice|address|street|road|email|phone)/i.test(trimmed)) return null;
  const words = trimmed.match(/\p{L}+/gu) ?? [];
  if (words.length > 3 || /[,:;()[\]{}]/.test(trimmed)) return null;
  return trimmed;
}

export function redactSpreadsheetValue(value: string, options: { preserveStructuralHeader?: boolean } = {}): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const headerKeywords = ['date', 'posted', 'transaction', 'amount', 'debit', 'credit', 'description', 'details', 'memo', 'reference', 'category', 'balance', 'currency', 'income', 'expense'];
  const matchedHeaders = headerKeywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(lower));
  if (matchedHeaders.length) return `[header:${matchedHeaders.join('|')}]`;
  const multilingualHeader = multilingualHeaderAliases[trimmed];
  if (multilingualHeader) return `[header:${multilingualHeader}]`;
  const safeHeader = options.preserveStructuralHeader ? safeStructuralHeaderLabel(trimmed) : null;
  if (safeHeader) return `[header-label:${safeHeader}]`;
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
       return redactSpreadsheetValue(value, { preserveStructuralHeader: row.rowNumber === sheet.inferredHeaderRow }).slice(0, SPREADSHEET_SEMANTIC_LIMITS.maxCellCharacters);
    }),
  }));
}

/** Builds an all-sheet, redacted structural overview before any provider call. */
export function buildSpreadsheetWorkbookOverview(workbook: SpreadsheetWorkbook): SpreadsheetStructuralWorkbook {
  return spreadsheetStructuralWorkbookSchema.parse({
    schemaVersion: SPREADSHEET_SEMANTIC_SCHEMA_VERSION,
    contentHash: workbook.contentHash ?? null,
    sourceByteLength: workbook.sourceByteLength,
    fileType: workbook.fileType,
    sheets: workbook.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      index: sheet.index,
      displayName: `[sheet:${sheet.index + 1}]`,
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
    const rowBudget = requested.endRow - requested.startRow + 1;
    const cellBudget = rowBudget * (requested.endColumn - requested.startColumn + 1);
    if (rowBudget > SPREADSHEET_SEMANTIC_LIMITS.maxRowsPerRequestedRange
      || cellBudget > SPREADSHEET_SEMANTIC_LIMITS.maxCellsPerRequestedRange) throw new Error('context_request_limit_exceeded');
    totalCells += cellBudget;
    const rowMap = new Map(sheet.rows.map((row) => [row.rowNumber, row]));
    return {
      sheetId: sheet.sheetId,
      range: { startRow: requested.startRow, endRow: requested.endRow, startColumn: requested.startColumn, endColumn: requested.endColumn },
      chunk: requested.chunk,
      reason: requested.reason,
      rows: Array.from({ length: rowBudget }, (_, offset) => {
        const row = rowMap.get(requested.startRow + offset);
        return {
          rowNumber: requested.startRow + offset,
          values: Array.from({ length: requested.endColumn - requested.startColumn + 1 }, (_, columnOffset) =>
            redactSpreadsheetValue(row?.values[requested.startColumn - 1 + columnOffset] ?? '', {
              preserveStructuralHeader: (requested.startRow + offset) === sheet.inferredHeaderRow,
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