import { z } from "zod";
import type OpenAI from "openai";
import {
  SPREADSHEET_PROVIDER_MODEL,
  SPREADSHEET_PROVIDER_POLICY,
  getDirectSpreadsheetClient,
  isSpreadsheetDirectProviderConfigured,
  normalizeSpreadsheetProviderResponse,
} from "./ai.js";
import {
  analyseSpreadsheet,
  type SpreadsheetAnalysis,
  type SpreadsheetWorkbook,
} from "./spreadsheet.js";

export const SPREADSHEET_SEMANTIC_V3_SCHEMA_VERSION = "spreadsheet-semantic.v3" as const;
const MAX_SHEETS_IN_REQUEST = 25;
const MAX_SAMPLE_ROWS_PER_SHEET = 4;
const MAX_SAMPLE_COLUMNS_PER_SHEET = 12;
const MAX_CELL_CHARACTERS = 64;
const MAX_REQUEST_BYTES = 48 * 1024;
const PROVIDER_TIMEOUT_MS = 30_000;

const columnFieldSchema = z.enum(["date", "amount", "debit", "credit", "description", "category"]);
const sheetDispositionSchema = z.enum(["transactional", "reference", "unknown"]);

export const spreadsheetSemanticV3PlanSchema = z.object({
  schemaVersion: z.literal(SPREADSHEET_SEMANTIC_V3_SCHEMA_VERSION),
  status: z.enum(["complete", "incomplete"]),
  sheets: z.array(z.object({
    sheetId: z.string().regex(/^sheet_[A-Za-z0-9_-]{1,127}$/),
    disposition: sheetDispositionSchema,
    headerRowIndex: z.number().int().nonnegative().max(10_000),
    columnMappings: z.array(z.object({
      field: columnFieldSchema,
      columnId: z.string().regex(/^col_[A-Z]{1,3}$/),
      confidence: z.number().min(0).max(1),
    }).strict()).max(6),
    classificationRules: z.array(z.object({
      kind: z.enum(["signed_amount", "separate_debit_credit", "all_income", "all_expense", "unknown"]),
      rationale: z.string().min(1).max(240),
    }).strict()).max(4),
    warnings: z.array(z.string().min(1).max(240)).max(5),
    confidence: z.number().min(0).max(1),
  }).strict()).max(MAX_SHEETS_IN_REQUEST),
  warnings: z.array(z.string().min(1).max(240)).max(12),
  confidence: z.number().min(0).max(1),
}).strict();

export type SpreadsheetSemanticV3Plan = z.infer<typeof spreadsheetSemanticV3PlanSchema>;

export type SpreadsheetSemanticV3Result = {
  status: "success" | "incomplete" | "failed";
  reason?: string;
  failureCategory?: "provider_unavailable" | "transport_failure" | "response_contract_invalid";
  semanticPlan: SpreadsheetSemanticV3Plan;
  analysis: SpreadsheetAnalysis;
  semanticOverview: ReturnType<typeof buildSpreadsheetSemanticV3Input>["workbook"];
  sampledSheetIds: string[];
  providerCalls: number;
  providerAttempts: Array<{
    telemetryVersion: "spreadsheet-provider-attempt.v1";
    attemptNumber: number;
    routeClass: "direct_openai";
    requestedModel: string;
    resolvedModel: string;
    model: string;
    responseMode: "json_schema";
    startedAt: string;
    durationMs: number;
    outcomeCategory: string;
    safeStatus: string;
    statusCode: number | null;
    retryable: false;
    failurePhase: "provider_request" | "response_validation" | null;
  }>;
  limits: {
    maxSheets: number;
    maxSampleRowsPerSheet: number;
    maxSampleColumnsPerSheet: number;
    maxCellCharacters: number;
    maxRequestBytes: number;
    maxProviderCalls: 1;
  };
};

function columnId(index: number) {
  let current = index + 1;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return `col_${label}`;
}

function truncateCell(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= MAX_CELL_CHARACTERS
    ? normalized
    : `${normalized.slice(0, MAX_CELL_CHARACTERS - 1)}…`;
}

function representativeRows(rows: SpreadsheetWorkbook["sheets"][number]["rows"]) {
  if (rows.length <= MAX_SAMPLE_ROWS_PER_SHEET) return rows;
  const indexes = new Set<number>([0, rows.length - 1]);
  for (let index = 1; indexes.size < MAX_SAMPLE_ROWS_PER_SHEET; index += 1) {
    indexes.add(Math.floor((index * (rows.length - 1)) / (MAX_SAMPLE_ROWS_PER_SHEET - 1)));
  }
  return [...indexes].sort((a, b) => a - b).map((index) => rows[index]!);
}

/**
 * The provider never receives the workbook body. It gets sheet dimensions,
 * generated column identifiers, and a bounded representative sample only.
 */
export function buildSpreadsheetSemanticV3Input(workbook: SpreadsheetWorkbook) {
  const workbookSummary = {
    contentHash: workbook.contentHash ?? null,
    sheetCount: workbook.sheets.length,
    totalParserRows: workbook.totalParserRows,
    sheets: workbook.sheets.slice(0, MAX_SHEETS_IN_REQUEST).map((sheet) => ({
      sheetId: sheet.sheetId,
      dimensions: { rows: sheet.rowCount, columns: sheet.columnCount },
      columns: Array.from({ length: Math.min(sheet.columnCount, MAX_SAMPLE_COLUMNS_PER_SHEET) }, (_, index) => columnId(index)),
      sampleRows: representativeRows(sheet.rows).map((row) => ({
        rowNumber: row.rowNumber,
        values: row.values.slice(0, MAX_SAMPLE_COLUMNS_PER_SHEET).map(truncateCell),
      })),
    })),
  };
  return {
    schemaVersion: SPREADSHEET_SEMANTIC_V3_SCHEMA_VERSION,
    task: "Infer only spreadsheet sheet purpose and bounded column mappings. Do not infer financial records or return rows.",
    workbook: workbookSummary,
  };
}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "status", "sheets", "warnings", "confidence"],
  properties: {
    schemaVersion: { type: "string", const: SPREADSHEET_SEMANTIC_V3_SCHEMA_VERSION },
    status: { type: "string", enum: ["complete", "incomplete"] },
    sheets: {
      type: "array",
      maxItems: MAX_SHEETS_IN_REQUEST,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sheetId", "disposition", "headerRowIndex", "columnMappings", "classificationRules", "warnings", "confidence"],
        properties: {
          sheetId: { type: "string" },
          disposition: { type: "string", enum: ["transactional", "reference", "unknown"] },
          headerRowIndex: { type: "integer", minimum: 0, maximum: 10000 },
          columnMappings: {
            type: "array", maxItems: 6,
            items: {
              type: "object", additionalProperties: false, required: ["field", "columnId", "confidence"],
              properties: {
                field: { type: "string", enum: ["date", "amount", "debit", "credit", "description", "category"] },
                columnId: { type: "string" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
          classificationRules: {
            type: "array", maxItems: 4,
            items: {
              type: "object", additionalProperties: false, required: ["kind", "rationale"],
              properties: {
                kind: { type: "string", enum: ["signed_amount", "separate_debit_credit", "all_income", "all_expense", "unknown"] },
                rationale: { type: "string", maxLength: 240 },
              },
            },
          },
          warnings: { type: "array", maxItems: 5, items: { type: "string", maxLength: 240 } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    warnings: { type: "array", maxItems: 12, items: { type: "string", maxLength: 240 } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

function incompletePlan(workbook: SpreadsheetWorkbook, warning: string): SpreadsheetSemanticV3Plan {
  return {
    schemaVersion: SPREADSHEET_SEMANTIC_V3_SCHEMA_VERSION,
    status: "incomplete",
    sheets: workbook.sheets.slice(0, MAX_SHEETS_IN_REQUEST).map((sheet) => ({
      sheetId: sheet.sheetId,
      disposition: "unknown",
      headerRowIndex: 0,
      columnMappings: [],
      classificationRules: [{ kind: "unknown", rationale: "Automatic review did not provide a usable bounded mapping." }],
      warnings: [warning],
      confidence: 0,
    })),
    warnings: [warning],
    confidence: 0,
  };
}

function validateAndApply(workbook: SpreadsheetWorkbook, candidate: unknown): {
  plan: SpreadsheetSemanticV3Plan;
  analysis: SpreadsheetAnalysis;
} {
  const parsed = spreadsheetSemanticV3PlanSchema.parse(candidate);
  const knownSheets = new Map(workbook.sheets.map((sheet) => [sheet.sheetId, sheet]));
  const seen = new Set<string>();
  const selectedSheetIds: string[] = [];
  const roleOverrides: Record<string, "transactional" | "non_transactional" | "unknown"> = {};
  const sheetMappings: Record<string, {
    headerRow: number; columns: Record<string, number | undefined>; dateFormat: null; currency: string; confidence: number; notes: string[];
  }> = {};
  const finalDispositions: Record<string, "transactional" | "reference" | "unresolved"> = {};
  for (const proposed of parsed.sheets) {
    const sheet = knownSheets.get(proposed.sheetId);
    if (!sheet || seen.has(proposed.sheetId) || proposed.headerRowIndex >= sheet.rowCount) throw new Error("semantic_mapping_invalid");
    seen.add(proposed.sheetId);
    const columns: Record<string, number | undefined> = {};
    for (const mapping of proposed.columnMappings) {
      const index = Array.from({ length: sheet.columnCount }, (_, value) => columnId(value)).indexOf(mapping.columnId);
      if (index < 0 || columns[mapping.field] !== undefined) throw new Error("semantic_mapping_invalid");
      columns[mapping.field] = index;
    }
    if (proposed.disposition === "transactional") {
      const hasMoney = columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
      if (columns.date === undefined || columns.description === undefined || !hasMoney) throw new Error("semantic_mapping_invalid");
      selectedSheetIds.push(proposed.sheetId);
      roleOverrides[proposed.sheetId] = "transactional";
      sheetMappings[proposed.sheetId] = {
        headerRow: proposed.headerRowIndex, columns, dateFormat: null, currency: "GBP",
        confidence: proposed.confidence,
        notes: proposed.warnings,
      };
      finalDispositions[proposed.sheetId] = "transactional";
    } else {
      roleOverrides[proposed.sheetId] = proposed.disposition === "reference" ? "non_transactional" : "unknown";
      finalDispositions[proposed.sheetId] = proposed.disposition === "reference" ? "reference" : "unresolved";
    }
  }
  if (parsed.status !== "complete" || !selectedSheetIds.length) throw new Error("semantic_incomplete");
  const analysis = analyseSpreadsheet(workbook, {
    selectedSheetIds,
    roleOverrides,
    sheetMappings,
    decisionSource: "ai",
    finalDispositions,
    semanticMode: "structural",
  });
  return { plan: parsed, analysis };
}

function safeAttempt(startedAt: Date, startedMs: number, outcomeCategory: string, failurePhase: "provider_request" | "response_validation" | null) {
  return {
    telemetryVersion: "spreadsheet-provider-attempt.v1" as const,
    attemptNumber: 1,
    routeClass: "direct_openai" as const,
    requestedModel: SPREADSHEET_PROVIDER_MODEL,
    resolvedModel: SPREADSHEET_PROVIDER_MODEL,
    model: SPREADSHEET_PROVIDER_MODEL,
    responseMode: "json_schema" as const,
    startedAt: startedAt.toISOString(),
    durationMs: Math.max(0, Date.now() - startedMs),
    outcomeCategory,
    safeStatus: outcomeCategory,
    statusCode: null,
    retryable: false as const,
    failurePhase,
  };
}

export async function analyseSpreadsheetWithSemanticV3(
  workbook: SpreadsheetWorkbook,
  options?: { client?: OpenAI; timeoutMs?: number },
): Promise<SpreadsheetSemanticV3Result> {
  const input = buildSpreadsheetSemanticV3Input(workbook);
  const limits = {
    maxSheets: MAX_SHEETS_IN_REQUEST, maxSampleRowsPerSheet: MAX_SAMPLE_ROWS_PER_SHEET,
    maxSampleColumnsPerSheet: MAX_SAMPLE_COLUMNS_PER_SHEET, maxCellCharacters: MAX_CELL_CHARACTERS,
    maxRequestBytes: MAX_REQUEST_BYTES, maxProviderCalls: 1 as const,
  };
  const unavailable = (reason: string, failureCategory: SpreadsheetSemanticV3Result["failureCategory"], providerAttempts: SpreadsheetSemanticV3Result["providerAttempts"] = []): SpreadsheetSemanticV3Result => ({
    status: "failed", reason, failureCategory, semanticPlan: incompletePlan(workbook, reason),
    analysis: analyseSpreadsheet(workbook, { selectedSheetIds: [], roleOverrides: {}, sheetMappings: {}, decisionSource: "structural", semanticMode: "structural" }),
    semanticOverview: input.workbook, sampledSheetIds: input.workbook.sheets.map((sheet) => sheet.sheetId),
    providerCalls: providerAttempts.length, providerAttempts, limits,
  });
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > MAX_REQUEST_BYTES) return unavailable(
    "Automatic review is unavailable because the bounded summary exceeded its safe limit.",
    "response_contract_invalid",
  );
  if (!options?.client && !isSpreadsheetDirectProviderConfigured()) {
    return unavailable("Automatic review is unavailable. Choose a specific sheet to review manually before importing.", "provider_unavailable");
  }
  const client = options?.client ?? getDirectSpreadsheetClient();
  const startedAt = new Date();
  const startedMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? PROVIDER_TIMEOUT_MS);
  try {
    const response = await client.responses.create({
      model: SPREADSHEET_PROVIDER_MODEL,
      max_output_tokens: 2_000,
      input: [{ role: "user", content: [{ type: "input_text", text: serialized }] }],
      text: { format: { type: "json_schema", name: "spreadsheet_semantic_v3_response", strict: true, schema: responseJsonSchema } },
    } as never, { signal: controller.signal } as never);
    const candidate = normalizeSpreadsheetProviderResponse(response);
    if (!candidate.trim()) {
      return unavailable("Automatic review returned no usable semantic result.", "response_contract_invalid", [safeAttempt(startedAt, startedMs, "contract_invalid", "response_validation")]);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(candidate);
    } catch {
      return unavailable("Automatic review returned an invalid semantic result.", "response_contract_invalid", [safeAttempt(startedAt, startedMs, "contract_invalid", "response_validation")]);
    }
    try {
      const applied = validateAndApply(workbook, decoded);
      return {
        status: "success", semanticPlan: applied.plan, analysis: applied.analysis, semanticOverview: input.workbook,
        sampledSheetIds: input.workbook.sheets.map((sheet) => sheet.sheetId), providerCalls: 1,
        providerAttempts: [safeAttempt(startedAt, startedMs, "success", null)], limits,
      };
    } catch {
      return unavailable("Automatic review could not validate a safe spreadsheet mapping.", "response_contract_invalid", [safeAttempt(startedAt, startedMs, "contract_invalid", "response_validation")]);
    }
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return unavailable(
      timedOut ? "Automatic review timed out. No records were imported." : "Automatic review could not reach the provider.",
      "transport_failure",
      [safeAttempt(startedAt, startedMs, timedOut ? "timeout" : "transport_failure", "provider_request")],
    );
  } finally {
    clearTimeout(timeout);
  }
}