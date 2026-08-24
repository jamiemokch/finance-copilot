import { z } from 'zod';
import type { SpreadsheetAnalysis, SpreadsheetWorkbook } from './spreadsheet.js';

export const SPREADSHEET_UNDERSTANDING_SCHEMA_VERSION = 'spreadsheet-understanding.v1' as const;

const confidence = z.number().int().min(0).max(100);
const sheetId = z.string().regex(/^sheet_[A-Za-z0-9_-]{1,127}$/);
const columnId = z.string().regex(/^col_[A-Za-z0-9_-]{1,127}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rowRef = z.object({
  sheetId,
  rowNumber: z.number().int().min(1).max(1048576),
}).strict();
const abstention = z.object({
  reason: z.enum(['insufficient_evidence', 'unsupported_layout', 'ambiguous_candidates', 'provider_error']),
  detail: z.string().min(1).max(160),
}).strict();

const mappedField = z.object({
  state: z.literal('mapped'),
  columnId,
  confidence: z.number().int().min(1).max(100),
  rationale: z.string().min(1).max(160),
  abstention: z.null(),
}).strict();
const unmappedField = z.object({
  state: z.literal('unmapped'),
  columnId: z.null(),
  confidence: z.literal(0),
  rationale: z.string().min(1).max(160),
  abstention: abstention,
}).strict();
const cannotMapField = z.object({
  state: z.literal('cannot_map'),
  columnId: z.null(),
  confidence: z.number().int().min(0).max(59),
  rationale: z.string().min(1).max(160),
  abstention,
}).strict();
const fieldMapping = z.discriminatedUnion('state', [mappedField, unmappedField, cannotMapField]);

const mappedHeader = z.object({
  state: z.literal('mapped'),
  rowNumber: z.number().int().min(1).max(1048576),
  confidence: z.number().int().min(1).max(100),
  abstention: z.null(),
}).strict();
const abstainedHeader = z.object({
  state: z.enum(['unmapped', 'cannot_map']),
  rowNumber: z.null(),
  confidence: z.number().int().min(0).max(59),
  abstention,
}).strict();
const header = z.discriminatedUnion('state', [mappedHeader, abstainedHeader]);

const mappedRange = z.object({
  state: z.literal('mapped'),
  startRow: z.number().int().min(1).max(1048576),
  endRow: z.number().int().min(1).max(1048576),
  confidence: z.number().int().min(1).max(100),
  abstention: z.null(),
}).strict();
const abstainedRange = z.object({
  state: z.enum(['unmapped', 'cannot_map']),
  startRow: z.null(),
  endRow: z.null(),
  confidence: z.number().int().min(0).max(59),
  abstention,
}).strict();
const dataRange = z.discriminatedUnion('state', [mappedRange, abstainedRange]);

const coverage = z.discriminatedUnion('status', [
  z.object({ status: z.literal('known'), startDate: date, endDate: date, rowRefs: z.array(rowRef).min(1).max(100).nonempty() }).strict(),
  z.object({ status: z.literal('partial'), startDate: date.nullable(), endDate: date.nullable(), rowRefs: z.array(rowRef).max(100) }).strict(),
  z.object({ status: z.literal('unknown'), startDate: z.null(), endDate: z.null(), rowRefs: z.array(rowRef).max(100) }).strict(),
]);

const fields = z.object({
  date: fieldMapping,
  description: fieldMapping,
  reference: fieldMapping,
  signedAmount: fieldMapping,
  debit: fieldMapping,
  credit: fieldMapping,
  currency: fieldMapping,
}).strict();

const exclusion = z.object({
  sheetId, startRow: z.number().int().min(1).max(1048576), endRow: z.number().int().min(1).max(1048576),
  reason: z.enum(['header', 'blank', 'balance_total', 'non_transactional', 'suspicious_exclusion', 'duplicate_candidate', 'date_issue', 'currency_issue', 'other']),
  confidence, rationale: z.string().min(1).max(160),
}).strict().refine((value) => value.startRow <= value.endRow, 'exclusion start must not exceed end');
const warning = z.object({
  code: z.enum(['coverage_gap', 'unresolved_date', 'mixed_currency', 'possible_duplicate', 'suspicious_exclusion', 'unsupported_layout', 'low_confidence', 'other']),
  severity: z.enum(['info', 'warning', 'blocking']),
  message: z.string().min(1).max(160),
  rowRefs: z.array(rowRef).max(100),
}).strict();
const anomaly = z.object({
  kind: z.enum(['possible_duplicate', 'balance_total', 'date_issue', 'currency_issue', 'suspicious_exclusion']),
  severity: z.enum(['info', 'warning', 'blocking']),
  rowRefs: z.array(rowRef).min(1).max(100),
  confidence, rationale: z.string().min(1).max(160),
}).strict();
const taxYear = z.object({
  taxYear: z.string().regex(/^[0-9]{4}-[0-9]{4}$/),
  rowRefs: z.array(rowRef).min(1).max(100),
  confidence,
}).strict();

export const spreadsheetUnderstandingProposalSchema = z.object({
  schemaVersion: z.literal(SPREADSHEET_UNDERSTANDING_SCHEMA_VERSION),
  analysisStatus: z.enum(['complete', 'partial', 'cannot_analyze']),
  overallConfidence: confidence,
  sheets: z.array(z.object({
    sheetId, analysisStatus: z.enum(['complete', 'partial', 'cannot_analyze']),
    role: z.enum(['transactional', 'non_transactional', 'mixed', 'unknown']),
    confidence, rationale: z.string().min(1).max(160),
    header, dataRange, fields,
    exclusions: z.array(exclusion).max(100),
    coverage, warnings: z.array(warning).max(20),
  }).strict()).max(20),
  warnings: z.array(warning).max(100),
  anomalies: z.array(anomaly).max(100),
  coverage,
  taxYears: z.array(taxYear).max(20),
}).strict();

export type SpreadsheetUnderstandingProposal = z.infer<typeof spreadsheetUnderstandingProposalSchema>;
export type SpreadsheetAIStatus = 'not_requested' | 'not_sampled' | 'success' | 'partial' | 'fallback' | 'failed' | 'incomplete' | 'abstained';

/** Literal schema metadata is kept beside the validator so the contract can be exported to tooling. */
export const spreadsheetUnderstandingJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SPREADSHEET_UNDERSTANDING_SCHEMA_VERSION,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'analysisStatus', 'overallConfidence', 'sheets', 'warnings', 'anomalies', 'coverage', 'taxYears'],
  description: 'The executable Zod validator in this module is authoritative for recursive object closure and semantic validation.',
} as const;

export type SpreadsheetAIEnvelope = {
  status: SpreadsheetAIStatus;
  proposal: SpreadsheetUnderstandingProposal | null;
  /** v2 semantic plan; proposal is retained only for legacy readers. */
  semanticPlan?: unknown | null;
  semanticOverview?: unknown;
  analysis?: SpreadsheetAnalysis;
  continuationToken?: string;
  reason?: string;
  sampledSheetIds: string[];
  providerCalls: number;
  limits: {
    maxSheets: number; maxRowsPerSheet: number; maxCellsPerSheet: number; maxCellCharacters: number;
    maxRequestBytes: number; maxResponseBytes: number; maxOutputTokens: number; timeoutMs: number;
  };
};

export function aiSampleForWorkbook(workbook: SpreadsheetWorkbook, analysis: SpreadsheetAnalysis) {
  const candidates = analysis.sheets.filter((sheet) => sheet.selected && sheet.role !== 'non_transactional').slice(0, 20);
  return candidates.map((sheet) => {
    let cells = 0;
    const source = workbook.sheets.find((item) => item.sheetId === sheet.sheetId)!;
    const sampleRows = source.rows.filter((row) => row.values.some((value) => value.trim())).slice(0, 30).map((row) => ({
      rowNumber: row.rowNumber,
      values: row.values.map((value) => {
        if (cells >= 600) return '';
        cells += 1;
        return redactSpreadsheetValue(value).slice(0, 160);
      }),
    }));
    return {
      sheetId: sheet.sheetId,
      role: sheet.role,
      dimensions: sheet.dimensions,
      parserRange: sheet.parserRange,
      sampleRows,
    };
  });
}

function redactSpreadsheetValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Free text is never sent to the model. It is the most likely location for
  // customer names, phone numbers, addresses, payment references and other
  // sensitive data. Mapping needs column semantics and value *shape*, not the
  // original financial narrative or exact identifiers.
  const lower = trimmed.toLowerCase();
  const headerKeywords = ['date', 'posted', 'transaction', 'amount', 'debit', 'credit', 'description', 'details', 'memo', 'reference', 'category', 'balance', 'currency', 'income', 'expense'];
  const matchedHeaders = headerKeywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(lower));
  if (matchedHeaders.length) return `[header:${matchedHeaders.join('|')}]`;
  if (/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(trimmed) || /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(trimmed)) return '[date]';
  if (/^[£$€]?\s*\(?-?\d[\d,]*(?:\.\d{1,4})?\)?(?:\s*(?:cr|dr))?$/i.test(trimmed)) {
    const numeric = Number(trimmed.replace(/[£$€,\s()]/g, '').replace(/(cr|dr)$/i, ''));
    return `[number:${numeric < 0 || /^\(/.test(trimmed) ? 'negative' : numeric > 0 ? 'positive' : 'zero'}]`;
  }
  return `[text:length-${Math.min(trimmed.length, 160)}]`;
}