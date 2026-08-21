/**
 * Typed API client for the SME Finance Copilot backend.
 * All routes are relative to /api (the API server artifact path).
 */

const API = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
    try {
      const body = await res.json();
      msg = body.error ?? msg;
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, msg);
  }
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
    const data = await apiFetch<{ user: AuthUser | null }>("/auth/user");
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
  cashAccounts?: unknown;
  arEntries?: unknown;
  apEntries?: unknown;
  createdAt?: string;
}

export const profilesApi = {
  list: () => apiFetch<APIProfile[]>("/profiles"),
  create: (data: {
    name: string;
    type?: string;
    industry?: string;
    vatRegistered?: boolean;
    taxYear?: string;
    accountingBasis?: string;
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
  uploadedAt?: string;
}

export interface APIUploadUrl {
  uploadURL: string;
  objectPath: string;
}

export const evidenceApi = {
  list: (profileId: string) =>
    apiFetch<APIEvidenceItem[]>(`/profiles/${profileId}/evidence`),
  /** Upload file bytes directly through the API server (avoids GCS CORS) */
  uploadDirect: async (file: File): Promise<{ objectPath: string }> => {
    const buffer = await file.arrayBuffer();
    return apiFetch<{ objectPath: string }>("/storage/uploads/direct", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
        "X-Content-Type": file.type || "application/octet-stream",
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
  detectSchema: (profileId: string, evidenceId: string) =>
    apiFetch<{ mappingSchema: unknown; previewRows: string[][] }>(`/profiles/${profileId}/evidence/${evidenceId}/detect-schema`, { method: "POST" }),
  processBatch: (profileId: string, evidenceId: string, confirmedMapping: unknown, bankCsv?: boolean) =>
    apiFetch<{ evidence: APIEvidenceItem; processedRows: number; autoPostedRows: number; inboxRows: number; skippedRows: number }>(
      `/profiles/${profileId}/evidence/${evidenceId}/process-batch`,
      { method: "POST", body: JSON.stringify({ confirmedMapping, bankCsv }) },
    ),
};

// ── Transactions ──────────────────────────────────────────────────────────────

export interface APITransaction {
  id: string;
  profileId: string;
  date: string;
  description: string;
  amount: number;
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
  createdAt?: string;
}

export const transactionsApi = {
  list: (profileId: string) =>
    apiFetch<APITransaction[]>(`/profiles/${profileId}/transactions`),
  create: (
    profileId: string,
    data: { date: string; description: string; amount: number; category?: string; taxTreatment?: string },
  ) =>
    apiFetch<APITransaction>(`/profiles/${profileId}/transactions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  attachEvidence: (profileId: string, transactionId: string, evidenceId: string) =>
    apiFetch<APITransaction>(`/profiles/${profileId}/transactions/${transactionId}/attach-evidence`, {
      method: "PATCH", body: JSON.stringify({ evidenceId }),
    }),
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
