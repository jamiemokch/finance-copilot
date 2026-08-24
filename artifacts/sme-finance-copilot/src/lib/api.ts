/**
 * Typed API client for the SME Finance Copilot backend.
 * All routes are relative to /api (the API server artifact path).
 */
import type {
  SelfAssessmentIdentity,
  SelfAssessmentIdentityUpdate,
  SelfAssessmentReadinessResponse,
  SelfAssessmentSa100Context,
  SelfAssessmentSa100ContextUpdate,
  SelfAssessmentSa103sContext,
  SelfAssessmentSa103sContextUpdate,
} from '@workspace/api-client-react';

const API = "/api";

export type SpreadsheetSourceRowConflict = {
  sheetId: string;
  worksheet: string;
  rowNumber: number;
};

export type SpreadsheetIssue = {
  sheetId?: string;
  worksheet?: string;
  rowNumber?: number;
  field?: 'date' | 'amount' | 'description' | 'tax_year' | 'selection';
  message: string;
};

export type SpreadsheetImportError = {
  code: 'source_row_conflict' | 'spreadsheet_import_failed';
  message: string;
  conflict?: SpreadsheetSourceRowConflict;
  issues?: SpreadsheetIssue[];
  rolledBack?: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: {
      code?: string;
      conflict?: SpreadsheetSourceRowConflict;
      issues?: SpreadsheetIssue[];
      rolledBack?: boolean;
    },
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let details: ApiError['details'];
    try {
      const body = await res.json() as {
        error?: unknown;
        code?: unknown;
        conflict?: SpreadsheetSourceRowConflict;
        issues?: SpreadsheetIssue[];
        rolledBack?: unknown;
      };
      msg = typeof body.error === 'string' ? body.error : msg;
      details = {
        ...(typeof body.code === 'string' ? { code: body.code } : {}),
        ...(body.conflict ? { conflict: body.conflict } : {}),
        ...(Array.isArray(body.issues) ? { issues: body.issues } : {}),
        ...(body.rolledBack === true ? { rolledBack: true } : {}),
      };
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, msg, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const data = await apiFetch<{ user: AuthUser | null }>("/auth/user", {
      cache: "no-store",
    });
    return data.user;
  } catch {
    return null;
  }
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export interface APIProfile {
  id: string;
  userId: string;
  name: string;
  type: string;
  taxYear?: string | null;
  taxReserve?: number | null;
  industry?: string;
  vatRegistered?: boolean;
  accountingBasis?: string;
  cashAccounts?: unknown;
  arEntries?: unknown;
  apEntries?: unknown;
  openingPositionStatus?: 'not_started' | 'skipped' | 'complete' | null;
  openingBalance?: number | null;
  openingDetails?: string | null;
  coverageStartDate?: string | null;
  coverageEndDate?: string | null;
  businessStartDate?: string | null;
  otherTaxableIncome?: number | null;
  otherTaxableIncomeTaxYear?: string | null;
  createdAt?: string;
}

export const profilesApi = {
  list: () => apiFetch<APIProfile[]>("/profiles"),
  create: (data: {
    name: string;
    type?: string;
    industry?: string;
    vatRegistered?: boolean;
    accountingBasis?: string;
    businessStartDate?: string | null;
  }) =>
    apiFetch<APIProfile>("/profiles", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    profileId: string,
    data: {
      name?: string;
      industry?: string;
      vatRegistered?: boolean;
      taxYear?: string;
      accountingBasis?: string;
      taxReserve?: number;
      cashAccounts?: Array<{ name: string; balance: number }>;
      arEntries?: Array<{ name: string; amount: number; daysPastDue?: number; invoiceCount?: number }>;
      apEntries?: Array<{ name: string; amount: number; daysUntilDue?: number }>;
      openingPositionStatus?: 'not_started' | 'skipped' | 'complete';
      openingBalance?: number | null;
      openingDetails?: string | null;
      coverageStartDate?: string | null;
      coverageEndDate?: string | null;
      businessStartDate?: string | null;
      otherTaxableIncome?: number | null;
      otherTaxableIncomeTaxYear?: string | null;
    },
  ) =>
    apiFetch<APIProfile>(`/profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// ── Financial Position ────────────────────────────────────────────────────────

export interface APITaxLine {
  label: string;
  amount: number;
}

export interface APITaxCalculation {
  lines: APITaxLine[];
  balanceDue: number;
  reserveGap: number;
}

export interface APIPLBreakdown {
  revenues: number;
  confirmedExpenses: number;
  nonDeductibleExpenses: number;
  pendingExpenses: number;
  profit: number;
}

export interface APIAccountBalance {
  name: string;
  balance: number;
}

export interface APICashPosition {
  accounts: APIAccountBalance[];
  taxReserve: number;
  apDueWithin30Days: number;
  netAvailable: number;
}

export interface APIAREntry {
  name: string;
  amount: number;
  daysPastDue: number;
  invoiceCount: number;
}

export interface APIAPEntry {
  name: string;
  amount: number;
  daysUntilDue: number;
}

export interface APIKPI {
  id: string;
  label: string;
  value: string;
  trend: string;
  basis: string;
  rawValue?: number;
  detail?: string;
}

export interface APISAReadiness {
  score: number;
  completedCount: number;
  totalCount: number;
}

export interface APIMonthlyDataPoint {
  month: string;          // "2024-11"
  revenue: number;
  expenses: number;
  profit: number;
  cumulativeProfit: number;
}

export interface APIVATWarning {
  currentRevenue: number;
  threshold: number;
  registrationThreshold: number;
  warning: boolean;
  urgency: 'none' | 'watch' | 'urgent';
  message: string;
}

export interface APIEvidenceCoverage {
  tierAmounts: Record<'0' | '1' | '2' | '3' | '4', number>;
  strongEvidencePct: number;
  selfDeclaredPct: number;
  documentedPct: number;
  coveragePct: number;
  defensibilityPct: number;
  classificationPct: number;
  financialConfidenceScore: number;
  financialConfidenceLabel: 'high' | 'medium' | 'low' | 'very_low';
}

export interface APIFinancialPosition {
  plBreakdown: APIPLBreakdown;
  taxCalculation: APITaxCalculation;
  cashPosition: APICashPosition;
  arEntries: APIAREntry[];
  apEntries: APIAPEntry[];
  kpis: APIKPI[];
  saReadiness: APISAReadiness;
  pendingInboxCount: number;
  monthlyTrend: APIMonthlyDataPoint[];
  vatWarning: APIVATWarning | null;
  nonDeductibleTotal?: number;
  evidenceCoverage: APIEvidenceCoverage;
}

export const positionApi = {
  get: (profileId: string) =>
    apiFetch<APIFinancialPosition>(`/profiles/${profileId}/position`),
};

// ── Inbox ─────────────────────────────────────────────────────────────────────

export interface APIInboxItem {
  id: string;
  profileId: string;
  evidenceId?: string | null;
  sourceRowIndex?: number | null;
  rawRowData?: unknown;
  date: string;
  description: string;
  amount?: number | null;
  status: string;
  resolution?: string | null;
  taxImpact?: number | null;
  aiReasoning?: string | null;
  evidenceType?: 'document' | 'bank_csv' | 'ledger' | 'manual';
  mappingSchema?: unknown;
  totalRows?: number;
  processedRows?: number;
  autoPostedRows?: number;
  inboxRows?: number;
  skippedRows?: number;
  importStatus?: string;
  options: unknown;
  resolvedAt?: string | null;
}

export const inboxApi = {
  list: (profileId: string) =>
    apiFetch<APIInboxItem[]>(`/profiles/${profileId}/inbox`),
  resolve: (profileId: string, itemId: string, resolution: string) =>
    apiFetch<APIInboxItem>(`/profiles/${profileId}/inbox/${itemId}/resolve`, {
      method: "PATCH",
      body: JSON.stringify({ resolution }),
    }),
};

// ── Evidence ──────────────────────────────────────────────────────────────────

export interface APIEvidenceItem {
  id: string;
  profileId: string;
  filename: string;
  objectPath: string;
  mimeType: string;
  category?: string | null;
  status: string;
  confidence?: number | null;
  extractedData?: unknown;
  aiReasoning?: string | null;
  evidenceType?: 'document' | 'bank_csv' | 'ledger' | 'manual';
  mappingSchema?: unknown;
  totalRows?: number;
  processedRows?: number;
  autoPostedRows?: number;
  inboxRows?: number;
  skippedRows?: number;
  importStatus?: string;
  uploadedAt?: string;
  workflowVersion?: number;
  documentLifecycle?: 'active' | 'replaced' | 'tombstoned';
  reviewState?: 'pending' | 'review_required' | 'reviewed' | 'confirmed' | 'failed';
  contentHash?: string | null;
  objectSize?: number | null;
  replacementOfEvidenceId?: string | null;
}

export interface APIEvidenceLink {
  id: string;
  evidenceId: string;
  linkedAt: string;
  filename: string;
  mimeType: string;
  documentLifecycle: 'active' | 'replaced' | 'tombstoned';
}

export type SpreadsheetReviewAnalysis = {
  taxYears: string[];
  coverage: { status: 'known' | 'partial' | 'unknown'; startDate: string | null; endDate: string | null };
  dispositionCounts: Record<string, number>;
  sheets: Array<{
    sheetId: string;
    displayName: string;
    dimensions: { rows: number; columns: number };
    disposition: string;
    selected: boolean;
    role: 'transactional' | 'non_transactional' | 'mixed' | 'unknown';
    confidence: number;
    reviewRequired: boolean;
    auditVisibility: 'default' | 'advanced';
    decisionSource: 'structural' | 'deterministic' | 'ai' | 'user' | 'manual_recovery';
    finalDisposition?: 'transactional' | 'summary' | 'reference' | 'duplicate' | 'excluded' | 'unresolved' | 'not_analysed';
    mapping: { headerRow?: number; columns: Record<string, number | undefined> };
    previewRows: Array<{ rowNumber: number; values: string[] }>;
    warnings: string[];
    rows: Array<{ sourceRow: number; primaryDisposition: string; reason: string; normalizedValueReference: { date: string | null; amount: number | null; description: string | null } }>;
  }>;
};

export type SpreadsheetInspectionResponse = {
  mappingSchema: unknown;
  previewRows: string[][];
  analysis?: SpreadsheetReviewAnalysis;
  aiProposal?: unknown;
  aiStatus?: {
    status: string;
    reason?: string | null;
    failureCategory?: 'model_unavailable' | 'provider_schema_invalid' | 'transport_failure' | 'response_contract_invalid' | 'provider_unavailable' | null;
    sampledSheetIds?: string[];
    continuationToken?: string | null;
    recoveryState?: 'automatic_ready' | 'automatic_unavailable' | 'manual_recovery';
    providerCalls?: number;
    providerAttempts?: Array<{
      telemetryVersion: 'spreadsheet-provider-attempt.v1';
      attemptNumber: number;
      routeClass: 'replit_ai_integrations' | 'direct_openai';
      requestedModel: string;
      resolvedModel: string;
      model: string;
      responseMode: 'json_schema' | 'json_object';
      startedAt: string;
      durationMs: number;
      outcomeCategory: string;
      safeStatus: string;
      statusCode: number | null;
      retryable: boolean;
      failurePhase: 'provider_request' | 'response_validation' | 'repair_validation' | null;
    }>;
  };
  userDecision?: unknown;
  reviewDraft?: {
    selectedSheetIds: string[];
    sheetMappings: Record<string, unknown>;
    sheetRoleOverrides?: Record<string, 'transactional' | 'non_transactional' | 'mixed' | 'unknown'>;
    filingScope: string[];
    excludedRowRefs: Array<{ sheetId: string; rowNumber: number }>;
    preTradingStartMode: 'retain' | 'exclude';
    outsideScopeMode: 'retain' | 'exclude';
    sheetResolutions?: Record<string, 'include_income' | 'include_expense' | 'reference_only' | 'duplicate_sheet' | 'leave_out'>;
    mappingRevision?: string;
    semanticPlanIdentity?: string;
    decisionSources?: Record<string, string>;
  } | null;
  reviewRevisionHistory?: Array<{ mappingRevision: string; savedAt: string }>;
  lastImportError?: SpreadsheetImportError | null;
};

export interface APIUploadUrl {
  uploadURL: string;
  objectPath: string;
}

export const evidenceApi = {
  list: (profileId: string) =>
    apiFetch<APIEvidenceItem[]>(`/profiles/${profileId}/evidence`),
  unmatched: (profileId: string) =>
    apiFetch<APIEvidenceItem[]>(`/profiles/${profileId}/evidence/unmatched`),
  discard: (profileId: string, evidenceId: string) =>
    apiFetch<{ deleted: boolean }>(`/profiles/${profileId}/evidence/${evidenceId}`, {
      method: "DELETE",
    }),
  /** Upload file bytes directly through the API server (avoids GCS CORS) */
  uploadDirect: async (profileId: string, file: File): Promise<{ objectPath: string }> => {
    const buffer = await file.arrayBuffer();
    return apiFetch<{ objectPath: string }>("/storage/uploads/direct", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
        "X-Content-Type": file.type || "application/octet-stream",
        "X-Profile-Id": profileId,
      },
      body: buffer,
    });
  },
  register: (
    profileId: string,
    data: { filename: string; objectPath: string; mimeType: string; category?: string; evidenceType?: 'document' | 'bank_csv' | 'ledger' | 'manual' },
  ) =>
    apiFetch<APIEvidenceItem>(`/profiles/${profileId}/evidence`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  process: (profileId: string, evidenceId: string) =>
    apiFetch<APIEvidenceItem>(`/profiles/${profileId}/evidence/${evidenceId}/process`, {
      method: "POST",
    }),
  review: (profileId: string, evidenceId: string, data: { extractedData?: Record<string, unknown>; category?: string }) =>
    apiFetch<APIEvidenceItem>(`/profiles/${profileId}/evidence/${evidenceId}/review`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
  confirmTransaction: (profileId: string, evidenceId: string, data: {
    idempotencyKey: string; date: string; description: string; amount: number;
    category: string; taxTreatment: string; allowablePercentage: number;
  }) => apiFetch<APITransaction>(`/profiles/${profileId}/evidence/${evidenceId}/confirm-transaction`, {
    method: "POST", body: JSON.stringify(data),
  }),
  tombstone: (profileId: string, evidenceId: string) =>
    apiFetch<APIEvidenceItem>(`/profiles/${profileId}/evidence/${evidenceId}/tombstone`, { method: "POST" }),
  replace: (profileId: string, evidenceId: string, data: { objectPath: string; filename: string; mimeType: string }) =>
    apiFetch<APIEvidenceItem>(`/profiles/${profileId}/evidence/${evidenceId}/replace`, {
      method: "POST", body: JSON.stringify(data),
    }),
  replaceSpreadsheet: (profileId: string, evidenceId: string, data: { objectPath: string; filename: string; mimeType: string }) =>
    apiFetch<APIEvidenceItem>(`/profiles/${profileId}/evidence/${evidenceId}/replace-spreadsheet`, {
      method: "POST", body: JSON.stringify(data),
    }),
  detach: (profileId: string, evidenceId: string, transactionId: string) =>
    apiFetch<void>(`/profiles/${profileId}/evidence/${evidenceId}/links/${transactionId}`, { method: "DELETE" }),
  downloadUrl: (profileId: string, evidenceId: string) =>
    `${API}/profiles/${encodeURIComponent(profileId)}/evidence/${encodeURIComponent(evidenceId)}/download`,
  detectSchema: (profileId: string, evidenceId: string, mode?: 'retry_automatic' | 'manual_recovery') =>
    apiFetch<SpreadsheetInspectionResponse>(`/profiles/${profileId}/evidence/${evidenceId}/detect-schema`, {
      method: "POST",
      body: JSON.stringify(mode ? { mode } : {}),
    }),
  saveSpreadsheetReview: (profileId: string, evidenceId: string, data: {
    selectedSheetIds: string[];
    sheetMappings: Record<string, unknown>;
    sheetRoleOverrides?: Record<string, 'transactional' | 'non_transactional' | 'mixed' | 'unknown'>;
    filingScope: string[];
    excludedRowRefs: Array<{ sheetId: string; rowNumber: number }>;
    preTradingStartMode: 'retain' | 'exclude';
    outsideScopeMode: 'retain' | 'exclude';
    sheetResolutions?: Record<string, 'include_income' | 'include_expense' | 'reference_only' | 'duplicate_sheet' | 'leave_out'>;
  }) => apiFetch<{
    reviewDraft: SpreadsheetInspectionResponse['reviewDraft'];
    analysis: SpreadsheetReviewAnalysis;
  }>(
    `/profiles/${profileId}/evidence/${evidenceId}/spreadsheet-review`,
    { method: "PATCH", body: JSON.stringify(data) },
  ),
  confirmSpreadsheet: (profileId: string, evidenceId: string, data: {
    confirmation: true;
    reviewRevision: string;
    semanticPlanIdentity: string;
    selectedSheetIds: string[];
    sheetMappings: Record<string, unknown>;
    sheetRoleOverrides?: Record<string, 'transactional' | 'non_transactional' | 'mixed' | 'unknown'>;
    filingScope: string[];
    excludedRowRefs: Array<{ sheetId: string; rowNumber: number }>;
    preTradingStartMode: 'retain' | 'exclude';
    outsideScopeMode: 'retain' | 'exclude';
    sheetResolutions?: Record<string, 'include_income' | 'include_expense' | 'reference_only' | 'duplicate_sheet' | 'leave_out'>;
  }) => apiFetch<{
    evidence: APIEvidenceItem;
    dispositionCounts: Record<string, number>;
    taxYears: string[];
    importedRows: number;
  }>(`/profiles/${profileId}/evidence/${evidenceId}/confirm-spreadsheet`, {
    method: "POST", body: JSON.stringify(data),
  }),
};

// ── Transactions ──────────────────────────────────────────────────────────────

export interface APITransaction {
  id: string;
  profileId: string;
  date: string;
  description: string;
  amount: number;
  recordType?: 'income' | 'expense' | 'unknown';
  category: string;
  taxTreatment: string;
  source: string;
  evidenceId?: string | null;
  accountingCategory?: string;
  allowablePercentage?: number;
  allowableAmount?: number | null;
  capitalAllowanceType?: string | null;
  vatMetadata?: { rate: 0 | 5 | 20; vatAmount: number | null; isVatInclusive: boolean } | null;
  userOverride?: boolean;
  evidenceTier?: number;
  sourceRowIndex?: number | null;
  rawRowData?: unknown;
  classificationConfidence?: number | null;
  accountingClassification?: string | null;
  financialAccountId?: string | null;
  bankImportBatchId?: string | null;
  bankImportRowId?: string | null;
  ledgerStatus?: 'active' | 'voided';
  createdAt?: string;
  updatedAt?: string;
}

export const transactionsApi = {
  list: (profileId: string) =>
    apiFetch<APITransaction[]>(`/profiles/${profileId}/transactions`),
  get: (profileId: string, transactionId: string) =>
    apiFetch<APITransaction>(`/profiles/${profileId}/transactions/${transactionId}`),
  create: (
    profileId: string,
    data: { date: string; description: string; amount: number; category?: string; taxTreatment?: string; allowablePercentage?: number; idempotencyKey: string },
  ) =>
    apiFetch<APITransaction>(`/profiles/${profileId}/transactions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    profileId: string,
    transactionId: string,
    data: {
      date?: string;
      description?: string;
      amount?: number;
      category?: string;
      taxTreatment?: string;
      allowablePercentage?: number;
      accountingClassification?: 'income' | 'expense' | 'transfer' | 'owner_funds' | 'drawings' | 'loan' | 'tax_payment' | 'unknown';
    },
  ) =>
    apiFetch<APITransaction>(`/profiles/${profileId}/transactions/${transactionId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  remove: (profileId: string, transactionId: string) =>
    apiFetch<void>(`/profiles/${profileId}/transactions/${transactionId}`, {
      method: "DELETE",
    }),
  attachEvidence: (profileId: string, transactionId: string, evidenceId: string) =>
    apiFetch<APITransaction>(`/profiles/${profileId}/transactions/${transactionId}/attach-evidence`, {
      method: "PATCH", body: JSON.stringify({ evidenceId }),
    }),
  evidenceLinks: (profileId: string, transactionId: string) =>
    apiFetch<APIEvidenceLink[]>(`/profiles/${profileId}/transactions/${transactionId}/evidence-links`),
};

// ── Bank CSV imports ───────────────────────────────────────────────────────────

export interface FinancialAccount {
  id: string;
  profileId: string;
  displayName: string;
  lastFour: string | null;
  currency: string;
  accountType: 'current' | 'savings' | 'credit_card' | 'cash';
  createdAt: string;
}

export interface BankCsvMapping {
  headerRow: number;
  columns: {
    date: number;
    amount?: number;
    debit?: number;
    credit?: number;
    description: number;
    reference?: number;
    balance?: number;
  };
  dateFormat: 'dmy' | 'ymd';
  decimalConvention: 'dot' | 'comma';
}

export interface BankImportRow {
  id: string;
  sourceRowNumber: number;
  date: string | null;
  amount: number | null;
  direction: 'money_in' | 'money_out' | null;
  description: string | null;
  reference: string | null;
  balance: number | null;
  validationStatus: 'valid' | 'invalid' | 'out_of_scope';
  duplicateStatus: 'none' | 'already_imported' | 'possible_duplicate';
  validationErrors: string[];
  selectedForCommit: boolean;
}

export interface BankImportBatch {
  id: string;
  profileId: string;
  financialAccountId: string;
  taxYearSnapshot: string;
  filename: string;
  encoding: string;
  delimiter: string;
  status: 'mapping_required' | 'preview_ready' | 'committing' | 'committed' | 'discarded' | 'failed';
  confirmedMapping: BankCsvMapping | null;
  mappingVersion: number;
  previewVersion: number;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  possibleDuplicateRows: number;
  outOfScopeRows: number;
  selectedRows: number;
  committedRows: number;
  lastError: string | null;
  createdAt: string;
}

type BankMappingProposal = {
  mapping: BankCsvMapping;
  decimalConvention: 'dot' | 'comma' | 'ambiguous';
  headers: string[];
  examples: string[][];
};

export const bankImportsApi = {
  accounts: (profileId: string) =>
    apiFetch<FinancialAccount[]>(`/profiles/${profileId}/financial-accounts`),
  createAccount: (profileId: string, data: {
    displayName: string;
    lastFour?: string | null;
    accountType?: FinancialAccount['accountType'];
  }) => apiFetch<FinancialAccount>(`/profiles/${profileId}/financial-accounts`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  list: (profileId: string) =>
    apiFetch<BankImportBatch[]>(`/profiles/${profileId}/bank-imports`),
  register: (profileId: string, data: { filename: string; objectPath: string; accountId: string }) =>
    apiFetch<{ batch: BankImportBatch; rows: BankImportRow[]; proposal: BankMappingProposal; reused: boolean }>(
      `/profiles/${profileId}/bank-imports`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  get: (profileId: string, batchId: string) =>
    apiFetch<{ batch: BankImportBatch; rows: BankImportRow[]; proposal?: BankMappingProposal }>(`/profiles/${profileId}/bank-imports/${batchId}`),
  preview: (profileId: string, batchId: string, mapping: BankCsvMapping) =>
    apiFetch<{ batch: BankImportBatch; rows: BankImportRow[] }>(`/profiles/${profileId}/bank-imports/${batchId}/preview`, {
      method: 'POST', body: JSON.stringify({ mapping }),
    }),
  updateSelections: (profileId: string, batchId: string, selections: Array<{ rowId: string; selectedForCommit: boolean }>) =>
    apiFetch<{ batch: BankImportBatch; rows: BankImportRow[] }>(`/profiles/${profileId}/bank-imports/${batchId}/rows`, {
      method: 'PATCH', body: JSON.stringify({ selections }),
    }),
  commit: (profileId: string, batchId: string, previewVersion: number) =>
    apiFetch<{ batch: BankImportBatch; rows: BankImportRow[]; replayed: boolean }>(`/profiles/${profileId}/bank-imports/${batchId}/commit`, {
      method: 'POST', body: JSON.stringify({ previewVersion }),
    }),
  discard: (profileId: string, batchId: string) =>
    apiFetch<{ batch: BankImportBatch }>(`/profiles/${profileId}/bank-imports/${batchId}`, { method: 'DELETE' }),
};

// ── M10 Reconciliation ────────────────────────────────────────────────────────

export type ReconciliationStatus = 'open' | 'resolving' | 'resolved' | 'dismissed' | 'superseded';
export type ReconciliationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface APIReconciliationException {
  id: string;
  profileId: string;
  ruleKey: string;
  exceptionType: string;
  status: ReconciliationStatus;
  severity: ReconciliationSeverity;
  sourceKind: string;
  sourceId: string;
  sourceRevision: string;
  observationFingerprint: string;
  observedFacts: Record<string, unknown>;
  detectorVersion: number;
  isCurrent: boolean;
  currentResolutionSummary?: string | null;
  dismissalRevision?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  source: { kind: string; id: string };
}

export interface APIReconciliationEvent {
  id: string;
  profileId: string;
  exceptionId: string;
  action: string;
  idempotencyKey?: string | null;
  reason?: string | null;
  observedFacts: Record<string, unknown>;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  relationshipRefs: Record<string, unknown>;
  createdAt: string;
}

export interface APIReconciliationWorkflowTask {
  id: string;
  kind: 'staged_bank_import';
  title: string;
  status: string;
  source: { batchId: string; financialAccountId: string };
  href: string;
  updatedAt: string;
}

export interface APIReconciliationCoverageCheck {
  id: string;
  profileId: string;
  financialAccountId: string;
  periodStart: string;
  periodEnd: string;
  completeExpectedCoverage: boolean;
  statementClosingBalance?: number | null;
  statementSourceBatchId?: string | null;
  statementEndpointRowId?: string | null;
  state: 'declared' | 'confirmed' | 'amended';
  calculatedFacts: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface APIReconciliationResponse {
  exceptions: APIReconciliationException[];
  workflowTasks: APIReconciliationWorkflowTask[];
  coverageChecks: APIReconciliationCoverageCheck[];
}

type ReconciliationResolution = {
  action:
    | 'acknowledge'
    | 'dismiss'
    | 'classify_transaction'
    | 'attach_evidence'
    | 'detach_evidence'
    | 'audit_void'
    | 'retain_both'
    | 'return_to_staging'
    | 'confirm_coverage'
    | 'set_support_expectation';
  expectedRevision: string;
  idempotencyKey: string;
  reason?: string;
  transactionId?: string;
  evidenceId?: string;
  coverageCheckId?: string;
  expectationState?: 'required' | 'not_required' | 'unspecified';
  expectationSource?: string;
  fields?: {
    date?: string;
    description?: string;
    amount?: number;
    category?: string;
    taxTreatment?: string;
    accountingClassification?: 'income' | 'expense' | 'transfer' | 'owner_funds' | 'drawings' | 'loan' | 'tax_payment' | 'unknown';
  };
};

type CoverageCheckInput = {
  accountId: string;
  periodStart: string;
  periodEnd: string;
  completeExpectedCoverage: boolean;
  statementClosingBalance?: number | null;
  statementSourceBatchId?: string | null;
  statementEndpointRowId?: string | null;
};

export const reconciliationApi = {
  list: (profileId: string) =>
    apiFetch<APIReconciliationResponse>(`/profiles/${profileId}/reconciliation`),
  scan: (profileId: string) =>
    apiFetch<APIReconciliationResponse>(`/profiles/${profileId}/reconciliation/scan`, { method: 'POST' }),
  detail: (profileId: string, exceptionId: string) =>
    apiFetch<{ exception: APIReconciliationException; events: APIReconciliationEvent[] }>(
      `/profiles/${profileId}/reconciliation/exceptions/${exceptionId}`,
    ),
  resolve: (profileId: string, exceptionId: string, data: ReconciliationResolution) =>
    apiFetch<{ exception: APIReconciliationException; replayed: boolean }>(
      `/profiles/${profileId}/reconciliation/exceptions/${exceptionId}/resolve`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  coverageChecks: (profileId: string) =>
    apiFetch<APIReconciliationCoverageCheck[]>(`/profiles/${profileId}/reconciliation/coverage-checks`),
  createCoverageCheck: (profileId: string, data: CoverageCheckInput) =>
    apiFetch<{ coverageCheck: APIReconciliationCoverageCheck } & APIReconciliationResponse>(
      `/profiles/${profileId}/reconciliation/coverage-checks`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  updateCoverageCheck: (profileId: string, checkId: string, data: CoverageCheckInput) =>
    apiFetch<{ coverageCheck: APIReconciliationCoverageCheck } & APIReconciliationResponse>(
      `/profiles/${profileId}/reconciliation/coverage-checks/${checkId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),
};

// ── Income-tax estimate ───────────────────────────────────────────────────────

export interface APIIncomeTaxBand {
  label: string;
  rate: number;
  taxableAmount: number;
  tax: number;
}

export interface APIIncomeTaxEstimate {
  status: 'complete' | 'incomplete';
  taxYear: string;
  accountingBasis: 'cash' | 'accrual';
  businessProfitInput: number;
  otherTaxableIncome: number | null;
  totalIncome: number | null;
  personalAllowance: number | null;
  taxableIncome: number | null;
  estimatedIncomeTax: number | null;
  bands: APIIncomeTaxBand[];
  assumptions: string[];
  missingInputs: string[];
}

export interface APIIncomeTaxEstimateResponse {
  period: { start: string; end: string };
  taxYear: string;
  accountingBasis: 'cash' | 'accrual';
  profitLoss: {
    totalIncome: number;
    totalExpenses: number;
    profitLoss: number;
    taxableBusinessProfit: number;
    recordCount: number;
  };
  categories: Array<{
    category: string;
    recordType: 'income' | 'expense';
    amount: number;
    records: Array<{ id: string; date: string; description: string; amount: number }>;
  }>;
  estimate: APIIncomeTaxEstimate;
}

export const incomeTaxEstimateApi = {
  get: (profileId: string) =>
    apiFetch<APIIncomeTaxEstimateResponse>(`/profiles/${profileId}/income-tax-estimate`),
};

// ── Self Assessment readiness ─────────────────────────────────────────────────

export type APISelfAssessmentIdentity = SelfAssessmentIdentity;
export type APISelfAssessmentSa100Context = SelfAssessmentSa100Context;
export type APISelfAssessmentSa103sContext = SelfAssessmentSa103sContext;
export type APISelfAssessmentReadinessResponse = SelfAssessmentReadinessResponse;

export const selfAssessmentApi = {
  getIdentity: () => apiFetch<SelfAssessmentIdentity>('/self-assessment/identity'),
  updateIdentity: (data: SelfAssessmentIdentityUpdate) =>
    apiFetch<SelfAssessmentIdentity>('/self-assessment/identity', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getSa100Context: (taxYear: string) =>
    apiFetch<SelfAssessmentSa100Context>(`/self-assessment/sa100/${encodeURIComponent(taxYear)}`),
  updateSa100Context: (taxYear: string, data: SelfAssessmentSa100ContextUpdate) =>
    apiFetch<SelfAssessmentSa100Context>(`/self-assessment/sa100/${encodeURIComponent(taxYear)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateSa103sContext: (profileId: string, data: SelfAssessmentSa103sContextUpdate) =>
    apiFetch<SelfAssessmentSa103sContext>(`/profiles/${profileId}/self-assessment/sa103s`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getReadiness: (profileId: string) =>
    apiFetch<SelfAssessmentReadinessResponse>(`/profiles/${profileId}/self-assessment/readiness`),
};

// ── Decisions ─────────────────────────────────────────────────────────────────

export interface APIDecision {
  id: string;
  profileId: string;
  ideaId: string;
  ideaTitle: string;
  ideaCategory: string;
  date: string;
  userDecision: string;
  userRationale?: string | null;
  assumptionsSnapshot: unknown;
  expectedPLImpact: number;
  expectedCashImpact: number;
  expectedTaxImpact: number;
  status: string;
  actualOutcome?: string | null;
  actualPLImpact?: number | null;
  actualCashImpact?: number | null;
  actualTaxImpact?: number | null;
}

export const decisionsApi = {
  list: (profileId: string) =>
    apiFetch<APIDecision[]>(`/profiles/${profileId}/decisions`),
  commit: (profileId: string, data: object) =>
    apiFetch<APIDecision>(`/profiles/${profileId}/decisions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (profileId: string, decisionId: string, data: object) =>
    apiFetch<APIDecision>(`/profiles/${profileId}/decisions/${decisionId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// ── Business Ideas ────────────────────────────────────────────────────────────

export interface APIBusinessIdea {
  id: string;
  category: string;
  title: string;
  summary: string;
  currentPosition: string;
  proposedAction: string;
  priorityTier: string;
  plImpactRange?: { min: number; max: number } | null;
  cashImpactRange?: { min: number; max: number } | null;
  taxImpactRange?: { min: number; max: number } | null;
  paybackRange?: { minMonths: number | null; maxMonths: number | null } | null;
  urgencyNote?: string | null;
  editableAssumptions: Array<{
    key: string; label: string; value: number; unit: string;
    min: number; max: number; step: number;
  }>;
  whatMustBeTrue: string[];
  source: string;
  confidence: string;
  status: string;
  committedDecisionId: string | null;
}

export const ideasApi = {
  list: (profileId: string) =>
    apiFetch<APIBusinessIdea[]>(`/profiles/${profileId}/business-ideas`),
};

// ── SA Checklist ──────────────────────────────────────────────────────────────

export interface APISAChecklistItem {
  id: string;
  profileId: string;
  checkId: string;
  label: string;
  detail?: string | null;
  completed: boolean;
  category?: string | null;
  completedAt?: string | null;
}

export const saChecklistApi = {
  list: (profileId: string) =>
    apiFetch<APISAChecklistItem[]>(`/profiles/${profileId}/sa-checklist`),
  update: (profileId: string, itemId: string, completed: boolean) =>
    apiFetch<APISAChecklistItem>(`/profiles/${profileId}/sa-checklist/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ completed }),
    }),
};

// ── Copilot ───────────────────────────────────────────────────────────────────

export const copilotApi = {
  message: (profileId: string, message: string) =>
    apiFetch<{ reply: string; contextSummary: string }>("/copilot/message", {
      method: "POST",
      body: JSON.stringify({ profileId, message }),
    }),
};

// ── Demo ──────────────────────────────────────────────────────────────────────

export const demoApi = {
  seed: () => apiFetch<{ profileId: string; message: string }>("/demo/seed", { method: "POST" }),
  reset: () => apiFetch<{ profileId: string; message: string }>("/demo/reset", { method: "POST" }),
  seedTransactions: (profileId: string) =>
    apiFetch<{ success: boolean; message: string }>(`/demo/seed-transactions/${profileId}`, { method: "POST" }),
};

// ── Development / UAT ─────────────────────────────────────────────────────────

export const uatApi = {
  freshUserReset: () =>
    apiFetch<{ success: boolean; message: string; cleanupPending: boolean }>("/uat/fresh-user-reset", {
      method: "POST",
    }),
};
