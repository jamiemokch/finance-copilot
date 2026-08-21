import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  profilesApi, positionApi, inboxApi, evidenceApi, transactionsApi,
  decisionsApi, ideasApi, saChecklistApi, demoApi, getAuthUser,
  type APITransaction, type APIFinancialPosition, type APIInboxItem,
  type APIEvidenceItem, type APIDecision, type APIBusinessIdea,
  type APISAChecklistItem, type AuthUser,
  type APIMonthlyDataPoint, type APIVATWarning,
  type APIEvidenceCoverage,
} from './api';

// ─── Core entity types ────────────────────────────────────────────────────────

export type ProfileType = 'individual' | 'sole_trader' | 'landlord' | 'company';

export interface Profile {
  id: string;
  type: ProfileType;
  name: string;
  industry?: string;
  vatRegistered?: boolean;
  taxYear?: string;
  accountingBasis?: string;
  openingPositionStatus?: 'not_started' | 'skipped' | 'complete';
  openingBalance?: number | null;
  openingDetails?: string | null;
  coverageStartDate?: string | null;
  coverageEndDate?: string | null;
  otherTaxableIncome?: number | null;
  otherTaxableIncomeTaxYear?: string | null;
}

export interface SharedContext {
  name: string;
  address: string;
  utr: string;
  niNumber: string;
}

export interface PositionItem {
  id: string;
  profileId: string;
  title: string;
  description: string;
  value: string;
  rawValue?: number;
  type: 'kpi' | 'fact';
  basis: string;
  documents: string[];
  assumptions: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface InboxItem {
  id: string;
  profileId: string;
  date: string;
  description: string;
  amount?: number;
  status: 'pending' | 'resolved';
  aiReasoning: string;
  options: {
    label: string;
    isSuggested?: boolean;
    subOptions?: { label: string; isSuggested?: boolean }[];
  }[];
  customAnswer?: string;
  evidenceId?: string | null;
  sourceRowIndex?: number | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'system';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  date: string;
  messages: ChatMessage[];
}

export interface TransactionItem {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  source: 'bank' | 'manual' | 'receipt';
  evidenceTier?: number;
  evidenceId?: string | null;
}

// ─── Evidence items ───────────────────────────────────────────────────────────

export type EvidenceCategory =
  | 'bank_statement'
  | 'invoice_sent'
  | 'receipt'
  | 'prior_return'
  | 'contract'
  | 'other';

export type EvidenceStatus = 'received' | 'processing' | 'categorised' | 'needs_review';

export interface EvidenceItem {
  id: string;
  profileId: string;
  category: EvidenceCategory;
  filename: string;
  uploadedAt: string;
  status: EvidenceStatus;
  extractedLines?: number;
  linkedInboxItemId?: string;
  evidenceType?: 'document' | 'bank_csv' | 'ledger' | 'manual';
  totalRows?: number;
  processedRows?: number;
  autoPostedRows?: number;
  inboxRows?: number;
  skippedRows?: number;
  importStatus?: string;
}

// ─── Peer benchmarking ────────────────────────────────────────────────────────

export interface PeerCategory {
  id: string;
  profileId: string;
  sector: string;
  geography: string;
  sizeBand: string;
  customerType: string;
  revenueModel: string;
  reviewedByUser: boolean;
}

export interface BenchmarkMetric {
  id: string;
  categoryId: string;
  label: string;
  peerMedian: string;
  peerRange: string;
  userCurrent: string;
  userStatus: 'above' | 'inline' | 'below' | 'unknown';
  source: string;
  sourceFull: string;
  dataPeriod: string;
  geography: string;
  peerDefinition: string;
  sampleSize: string;
  confidence: 'high' | 'medium' | 'low';
  freshness: string;
  isIllustrative: boolean;
  relevanceToIdea?: string;
}

// ─── Business Ideas ───────────────────────────────────────────────────────────

export type BusinessIdeaCategory = 'tax' | 'cash' | 'growth' | 'operations' | 'hiring' | 'pricing' | 'assets';

export interface AssumptionField {
  key: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export interface ImpactRange { min: number; max: number; }
export interface PaybackRange { minMonths: number | null; maxMonths: number | null; }

export interface BusinessIdea {
  id: string;
  profileId: string;
  category: BusinessIdeaCategory;
  title: string;
  summary: string;
  triggerBenchmark?: string;
  benchmarkGap?: string;
  currentPosition: string;
  proposedAction: string;
  editableAssumptions: AssumptionField[];
  whatMustBeTrue: string[];
  source: string;
  confidence: 'high' | 'medium' | 'low';
  impactLabel: string;
  deadlines?: string[];
  status: 'new' | 'saved' | 'actioned' | 'dismissed';
  committedDecisionId?: string;
  priorityTier: 'do_now' | 'consider' | 'watch';
  plImpactRange?: ImpactRange;
  cashImpactRange?: ImpactRange;
  taxImpactRange?: ImpactRange;
  paybackRange?: PaybackRange;
  urgencyNote?: string;
}

// ─── Decision Memory ──────────────────────────────────────────────────────────

export interface DecisionMemoryEntry {
  id: string;
  profileId: string;
  ideaId: string;
  ideaTitle: string;
  ideaCategory: BusinessIdeaCategory;
  date: string;
  assumptionsSnapshot: AssumptionField[];
  userDecision: string;
  userRationale: string;
  expectedPLImpact: number;
  expectedCashImpact: number;
  expectedTaxImpact: number;
  status: 'committed' | 'monitoring' | 'completed' | 'abandoned';
  actualOutcome?: string;
  actualPLImpact?: number;
  actualCashImpact?: number;
  actualTaxImpact?: number;
}

// ─── Compliance timeline ──────────────────────────────────────────────────────

export interface ComplianceItem {
  id: string;
  profileId: string;
  title: string;
  description: string;
  dueDate: string;
  preparationLeadDays: number;
  status: 'upcoming' | 'due-soon' | 'overdue' | 'done';
  responsibleParty: 'client' | 'platform' | 'accountant';
  documentsRequired: string[];
  actionsRequired: string[];
  category: 'tax' | 'vat' | 'filing' | 'payroll' | 'accounts';
  periodCovered: string;
}

// ─── Self-Assessment checklist ────────────────────────────────────────────────

export type SAChecklistCategory = 'data' | 'inbox' | 'filing' | 'payment';

export interface SAChecklistItem {
  id: string;
  profileId: string;
  label: string;
  detail: string;
  status: 'done' | 'pending' | 'blocked';
  category: SAChecklistCategory;
}

// ─── Financial drilldown types ────────────────────────────────────────────────

export interface PLRevenue {
  label: string;
  amount: number;
  basis: string;
  evidenceRef?: string;
}

export interface PLExpense {
  label: string;
  amount: number;
  category: string;
  basis: string;
  evidenceRef?: string;
  isPending?: boolean;
  inboxItemId?: string;
}

export interface PLBreakdown {
  revenues: PLRevenue[];
  confirmedExpenses: PLExpense[];
  pendingExpenses: PLExpense[];
  nonDeductibleExpenses: PLExpense[];
}

export interface TaxLine {
  label: string;
  amount: string;
  note?: string;
}

export interface TaxCalculation {
  lines: TaxLine[];
  unresolvedItems: string[];
  assumptions: string[];
  taxBasis: string;
}

export interface AREntry {
  customer: string;
  invoiceRef: string;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
  daysOverdue?: number;
  evidenceRef?: string;
}

export interface APEntry {
  supplier: string;
  description: string;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
  evidenceRef?: string;
}

export interface CashAccount {
  name: string;
  balance: number;
  type: 'business' | 'personal';
}

export interface CashFlow {
  label: string;
  amount: number;
  expectedDate: string;
}

export interface CashBreakdown {
  accounts: CashAccount[];
  taxReserve: number;
  apDueWithin30Days: number;
  nearTermInflows: CashFlow[];
  nearTermOutflows: CashFlow[];
}

export interface EvidenceCoverage extends APIEvidenceCoverage {}

// ─── AppState ─────────────────────────────────────────────────────────────────

export interface AppState {
  // Auth
  isAuthenticated: boolean;
  isLoading: boolean;
  authUser: AuthUser | null;
  login: () => void;

  profiles: Profile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  addProfile: (profile: Omit<Profile, 'id'>) => Promise<string>;
  profilesLoaded: boolean;
  updateProfile: (id: string, updates: Partial<Omit<Profile, 'id'>>) => Promise<void>;
  refreshData: () => Promise<void>;
  loadSampleData: () => Promise<void>;

  sharedContext: SharedContext;
  updateSharedContext: (data: Partial<SharedContext>) => void;

  positionItems: PositionItem[];

  transactions: TransactionItem[];
  addTransaction: (transaction: Omit<TransactionItem, 'id'>, idempotencyKey: string) => Promise<void>;

  evidenceItems: EvidenceItem[];
  addEvidenceItem: (item: Omit<EvidenceItem, 'id'>) => string;

  inboxItems: InboxItem[];
  resolveInboxItem: (id: string, resolution: string) => Promise<boolean>;
  resolveInboxBatch: (ids: string[], resolution: string) => Promise<boolean>;

  chatHistory: ChatSession[];
  addChatMessage: (sessionId: string, message: Omit<ChatMessage, 'id'>) => void;
  createChatSession: (title: string, initialMessage?: Omit<ChatMessage, 'id'>) => string;

  peerCategory: PeerCategory | null;
  updatePeerCategory: (data: Partial<PeerCategory>) => void;
  benchmarks: BenchmarkMetric[];

  businessIdeas: BusinessIdea[];
  updateBusinessIdea: (id: string, updates: Partial<BusinessIdea>) => void;
  updateIdeaAssumption: (ideaId: string, key: string, value: number) => void;

  decisionMemory: DecisionMemoryEntry[];
  commitDecision: (entry: Omit<DecisionMemoryEntry, 'id'>) => string;
  updateDecisionMemoryStatus: (id: string, status: DecisionMemoryEntry['status']) => void;
  updateDecisionMemoryOutcome: (id: string, outcome: string, actualPL?: number, actualCash?: number, actualTax?: number) => void;

  complianceItems: ComplianceItem[];

  saChecklist: SAChecklistItem[];
  updateSAChecklistItem: (id: string, status: SAChecklistItem['status']) => void;

  yearEndPackGenerated: boolean;
  setYearEndPackGenerated: (val: boolean) => void;

  plBreakdown: PLBreakdown;
  taxCalculation: TaxCalculation;
  arEntries: AREntry[];
  apEntries: APEntry[];
  cashBreakdown: CashBreakdown;
  monthlyTrend: APIMonthlyDataPoint[];
  vatWarning: APIVATWarning | null;
  nonDeductibleTotal: number;
  taxLinesRaw: Array<{ label: string; amount: number }>;
  evidenceCoverage: EvidenceCoverage;

  copilotTrigger: string | null;
  setCopilotTrigger: (msg: string | null) => void;

  resetDemoData: () => Promise<void>;
}

// ─── Mappers — API format → frontend format ───────────────────────────────────

function mapPLBreakdown(rawTxns: APITransaction[], inbox: InboxItem[]): PLBreakdown {
  const revenues: PLRevenue[] = rawTxns
    .filter(t => t.category === 'income' || t.taxTreatment === 'income')
    .map(t => ({ label: t.description, amount: Math.abs(t.amount), basis: 'Bank / invoice' }));

  const confirmedExpenses: PLExpense[] = rawTxns
    .filter(t => t.amount < 0 && t.taxTreatment === 'deductible')
    .map(t => {
      // Use allowableAmount if set (mixed-use items); otherwise full amount
      const displayAmount = t.allowableAmount != null
        ? Math.abs(t.allowableAmount)
        : Math.abs(t.amount);
      const mixedNote = (t.allowablePercentage != null && t.allowablePercentage < 100)
        ? ` (${t.allowablePercentage}% business use)` : '';
      return {
        label: t.description + mixedNote,
        amount: displayAmount,
        category: t.accountingCategory ?? t.category,
        basis: 'Confirmed deductible',
      };
    });

  const nonDeductibleExpenses: PLExpense[] = rawTxns
    .filter(t => t.amount < 0 && t.taxTreatment === 'non_deductible')
    .map(t => ({
      label: t.description,
      amount: Math.abs(t.amount),
      category: t.accountingCategory ?? t.category,
      basis: 'Recorded — not deductible (personal)',
    }));

  const pendingExpenses: PLExpense[] = inbox
    .filter(i => i.status === 'pending' && i.amount)
    .map(i => ({
      label: i.description, amount: i.amount!, category: 'pending',
      basis: 'Inbox — awaiting classification', isPending: true, inboxItemId: i.id,
    }));

  return { revenues, confirmedExpenses, pendingExpenses, nonDeductibleExpenses };
}

function mapTaxCalculation(pos: APIFinancialPosition): TaxCalculation {
  return {
    lines: pos.taxCalculation.lines.map(l => ({
      label: l.label,
      amount: `£${Math.round(l.amount).toLocaleString()}`,
    })),
    unresolvedItems: [],
    assumptions: ['UK sole trader 2024/25 rates', 'Trading income only', 'Standard personal allowance £12,570'],
    taxBasis: 'Self-Assessment: income tax + Class 4 NI + Class 2 NI',
  };
}

function mapCashBreakdown(pos: APIFinancialPosition): CashBreakdown {
  const today = new Date();
  return {
    accounts: pos.cashPosition.accounts.map(a => ({
      name: a.name, balance: a.balance, type: 'business' as const,
    })),
    taxReserve: pos.cashPosition.taxReserve,
    apDueWithin30Days: pos.cashPosition.apDueWithin30Days,
    nearTermInflows: pos.arEntries.map(ar => ({
      label: ar.name, amount: ar.amount,
      expectedDate: new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0],
    })),
    nearTermOutflows: pos.apEntries.map(ap => ({
      label: ap.name, amount: ap.amount,
      expectedDate: new Date(today.getTime() + ap.daysUntilDue * 86400000).toISOString().split('T')[0],
    })),
  };
}

function mapAREntries(pos: APIFinancialPosition): AREntry[] {
  const today = new Date();
  return pos.arEntries.map((ar, i) => ({
    customer: ar.name,
    invoiceRef: `INV-${1040 + i}`,
    amount: ar.amount,
    dueDate: new Date(today.getTime() - ar.daysPastDue * 86400000).toISOString().split('T')[0],
    isOverdue: ar.daysPastDue > 0,
    daysOverdue: ar.daysPastDue > 0 ? ar.daysPastDue : undefined,
  }));
}

function mapAPEntries(pos: APIFinancialPosition): APEntry[] {
  const today = new Date();
  return pos.apEntries.map(ap => ({
    supplier: ap.name,
    description: ap.name,
    amount: ap.amount,
    dueDate: new Date(today.getTime() + ap.daysUntilDue * 86400000).toISOString().split('T')[0],
    isOverdue: ap.daysUntilDue < 0,
  }));
}

function mapPositionItems(pos: APIFinancialPosition, profileId: string): PositionItem[] {
  return pos.kpis.map(kpi => ({
    id: kpi.id,
    profileId,
    title: kpi.label,
    description: kpi.basis,
    value: kpi.value,
    rawValue: kpi.rawValue,
    type: 'kpi' as const,
    basis: kpi.basis,
    documents: [],
    assumptions: [],
    confidence: 'high' as const,
  }));
}

function mapInboxItem(item: APIInboxItem): InboxItem {
  return {
    id: item.id,
    profileId: item.profileId,
    date: item.date,
    description: item.description,
    amount: item.amount ?? undefined,
    status: (item.status as 'pending' | 'resolved'),
    aiReasoning: item.aiReasoning ?? 'Please classify this item.',
    options: (item.options as InboxItem['options']) ?? [
      { label: 'Fully deductible business expense', isSuggested: true },
      { label: 'Not deductible — personal purchase', isSuggested: false },
    ],
    customAnswer: item.resolution ?? undefined,
    evidenceId: item.evidenceId,
    sourceRowIndex: item.sourceRowIndex,
  };
}

function mapEvidenceItem(item: APIEvidenceItem): EvidenceItem {
  const statusMap: Record<string, EvidenceStatus> = {
    processed: 'categorised',
    needs_review: 'needs_review',
    processing: 'processing',
    received: 'received',
    error: 'needs_review',
  };
  return {
    id: item.id,
    profileId: item.profileId,
    category: (item.category ?? 'other') as EvidenceCategory,
    filename: item.filename,
    uploadedAt: item.uploadedAt?.split('T')[0] ?? new Date().toISOString().split('T')[0],
    status: statusMap[item.status] ?? 'received',
    evidenceType: item.evidenceType,
    totalRows: item.totalRows,
    processedRows: item.processedRows,
    autoPostedRows: item.autoPostedRows,
    inboxRows: item.inboxRows,
    skippedRows: item.skippedRows,
    importStatus: item.importStatus,
  };
}

function mapDecision(d: APIDecision, profileId: string): DecisionMemoryEntry {
  return {
    id: d.id,
    profileId,
    ideaId: d.ideaId,
    ideaTitle: d.ideaTitle,
    ideaCategory: d.ideaCategory as BusinessIdeaCategory,
    date: d.date,
    assumptionsSnapshot: (d.assumptionsSnapshot as AssumptionField[]) ?? [],
    userDecision: d.userDecision,
    userRationale: d.userRationale ?? '',
    expectedPLImpact: d.expectedPLImpact,
    expectedCashImpact: d.expectedCashImpact,
    expectedTaxImpact: d.expectedTaxImpact,
    status: (d.status as DecisionMemoryEntry['status']) ?? 'committed',
    actualOutcome: d.actualOutcome ?? undefined,
    actualPLImpact: d.actualPLImpact ?? undefined,
    actualCashImpact: d.actualCashImpact ?? undefined,
    actualTaxImpact: d.actualTaxImpact ?? undefined,
  };
}

function mapIdea(idea: APIBusinessIdea, profileId: string): BusinessIdea {
  const ranges = [idea.plImpactRange, idea.taxImpactRange, idea.cashImpactRange].flatMap(r =>
    r ? [Math.abs(r.min), Math.abs(r.max)] : []
  );
  const impactLabel = ranges.length
    ? `£${Math.min(...ranges).toLocaleString()}–£${Math.max(...ranges).toLocaleString()}`
    : 'Varies';
  return {
    id: idea.id,
    profileId,
    category: idea.category as BusinessIdeaCategory,
    title: idea.title,
    summary: idea.summary,
    currentPosition: idea.currentPosition,
    proposedAction: idea.proposedAction,
    editableAssumptions: idea.editableAssumptions,
    whatMustBeTrue: idea.whatMustBeTrue,
    source: idea.source,
    confidence: idea.confidence as BusinessIdea['confidence'],
    impactLabel,
    status: (idea.status as BusinessIdea['status']) ?? 'new',
    committedDecisionId: idea.committedDecisionId ?? undefined,
    priorityTier: (idea.priorityTier as BusinessIdea['priorityTier']) ?? 'consider',
    plImpactRange: idea.plImpactRange ?? undefined,
    cashImpactRange: idea.cashImpactRange ?? undefined,
    taxImpactRange: idea.taxImpactRange ?? undefined,
    paybackRange: idea.paybackRange ?? undefined,
    urgencyNote: idea.urgencyNote ?? undefined,
  };
}

function mapSAItem(item: APISAChecklistItem, profileId: string): SAChecklistItem {
  return {
    id: item.id,
    profileId,
    label: item.label,
    detail: item.detail ?? '',
    status: item.completed ? 'done' : 'pending',
    category: (item.category ?? 'filing') as SAChecklistCategory,
  };
}

function mapTransaction(t: APITransaction): TransactionItem {
  const src = t.source;
  return {
    id: t.id,
    date: t.date,
    description: t.description,
    amount: t.amount,
    category: t.category,
    source: (src === 'bank' || src === 'manual' || src === 'receipt') ? src : 'manual',
    evidenceTier: t.evidenceTier,
    evidenceId: t.evidenceId,
  };
}

// ─── Static data (not from API) ───────────────────────────────────────────────

const EMPTY_PL: PLBreakdown = { revenues: [], confirmedExpenses: [], pendingExpenses: [], nonDeductibleExpenses: [] };
const EMPTY_TAX: TaxCalculation = {
  lines: [], unresolvedItems: [], assumptions: [], taxBasis: 'Loading…',
};
const EMPTY_CASH: CashBreakdown = {
  accounts: [], taxReserve: 0, apDueWithin30Days: 0, nearTermInflows: [], nearTermOutflows: [],
};

const INITIAL_BENCHMARKS: BenchmarkMetric[] = []; // Static benchmarks removed for Alpha-lite
const INITIAL_COMPLIANCE: ComplianceItem[] = [];

// ─── Context ──────────────────────────────────────────────────────────────────

const StoreContext = createContext<AppState | null>(null);

export function useStore(): AppState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function StoreProvider({ children }: { children: ReactNode }) {
  // ── Auth
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── Profiles
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  // ── API data (raw, for computing derived types)
  const [rawPosition, setRawPosition] = useState<APIFinancialPosition | null>(null);
  const [rawTransactions, setRawTransactions] = useState<APITransaction[]>([]);

  // ── Frontend-typed data
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [decisionMemory, setDecisionMemory] = useState<DecisionMemoryEntry[]>([]);
  const [businessIdeas, setBusinessIdeas] = useState<BusinessIdea[]>([]);
  const [saChecklist, setSAChecklist] = useState<SAChecklistItem[]>([]);

  // ── UI-only state
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [peerCategory, setPeerCategory] = useState<PeerCategory | null>(null);
  const [sharedContext, setSharedContext] = useState<SharedContext>({ name: '', address: '', utr: '', niNumber: '' });
  const [copilotTrigger, setCopilotTrigger] = useState<string | null>(null);
  const [yearEndPackGenerated, setYearEndPackGenerated] = useState(false);
  const resolvingInboxIds = useRef(new Set<string>());
  const dataFetchVersion = useRef(0);

  // ── Auth check on mount
  useEffect(() => {
    getAuthUser().then(user => {
      setAuthUser(user);
      setAuthLoading(false);
    });
  }, []);

  // ── Core data fetcher
  const fetchAll = useCallback(async (profileId: string) => {
    if (!profileId) return;
    const fetchVersion = ++dataFetchVersion.current;
    const [posResult, inboxResult, evidResult, txnResult, decResult, saResult] =
      await Promise.allSettled([
        positionApi.get(profileId),
        inboxApi.list(profileId),
        evidenceApi.list(profileId),
        transactionsApi.list(profileId),
        decisionsApi.list(profileId),
        saChecklistApi.list(profileId),
      ]);

    // Ignore a response from an older load. In particular, a pre-mutation
    // refresh must not overwrite the server-confirmed result from a newer one.
    if (fetchVersion !== dataFetchVersion.current) return;
    if (posResult.status === 'fulfilled') setRawPosition(posResult.value);
    if (inboxResult.status === 'fulfilled') setInboxItems(inboxResult.value.map(mapInboxItem));
    if (evidResult.status === 'fulfilled') setEvidenceItems(evidResult.value.map(mapEvidenceItem));
    if (txnResult.status === 'fulfilled') setRawTransactions(txnResult.value);
    if (decResult.status === 'fulfilled')
      setDecisionMemory(decResult.value.map(d => mapDecision(d, profileId)));
    if (saResult.status === 'fulfilled')
      setSAChecklist(saResult.value.map(i => mapSAItem(i, profileId)));

    // Business Ideas can involve a slower AI call. It should never hold the
    // records, Inbox, or Tasks screens blank after a confirmed mutation.
    void ideasApi.list(profileId)
      .then(ideas => {
        if (fetchVersion === dataFetchVersion.current) {
          setBusinessIdeas(ideas.map(idea => mapIdea(idea, profileId)));
        }
      })
      // A route change can intentionally abort this non-critical background
      // request. Its next page visit will request a fresh set of ideas.
      .catch(() => undefined);
  }, []);

  // ── Initialise once authenticated
  useEffect(() => {
    if (authLoading || !authUser) return;
    (async () => {
      try {
        const profs = await profilesApi.list().catch(() => []);
        if (profs.length === 0) {
          // New user — no profiles yet; signal routing to redirect to /onboarding
          setProfilesLoaded(true);
          return;
        }
        const mapProfile = (p: typeof profs[0]): Profile => ({
          id: p.id,
          type: (p.type as ProfileType) || 'sole_trader',
          name: p.name,
          industry: (p as Record<string, unknown>).industry as string | undefined,
          vatRegistered: (p as Record<string, unknown>).vatRegistered as boolean | undefined,
          taxYear: ((p as Record<string, unknown>).taxYear ?? '2024/25') as string,
          accountingBasis: (p as Record<string, unknown>).accountingBasis as string | undefined,
          openingPositionStatus: p.openingPositionStatus ?? 'not_started',
          openingBalance: p.openingBalance ?? null,
          openingDetails: p.openingDetails ?? null,
          coverageStartDate: p.coverageStartDate ?? null,
          coverageEndDate: p.coverageEndDate ?? null,
          otherTaxableIncome: p.otherTaxableIncome ?? null,
          otherTaxableIncomeTaxYear: p.otherTaxableIncomeTaxYear ?? null,
        });
        const mapped = profs.map(mapProfile);
        setProfiles(mapped);
        const firstId = profs[0].id;
        setActiveProfileId(firstId);
        setProfilesLoaded(true);
      } catch (err) {
        console.error('[store] init failed', err);
        setProfilesLoaded(true); // Unblock routing even on error
      }
    })();
  }, [authUser, authLoading, fetchAll]);

  // ── Re-fetch when active profile changes
  useEffect(() => {
    if (activeProfileId) fetchAll(activeProfileId);
  }, [activeProfileId, fetchAll]);

  // ── Derived types from raw API data
  const transactions = rawTransactions.map(mapTransaction);

  const plBreakdown: PLBreakdown = rawPosition
    ? mapPLBreakdown(rawTransactions, inboxItems)
    : EMPTY_PL;

  const taxCalculation: TaxCalculation = rawPosition
    ? mapTaxCalculation(rawPosition)
    : EMPTY_TAX;

  const cashBreakdown: CashBreakdown = rawPosition
    ? mapCashBreakdown(rawPosition)
    : EMPTY_CASH;

  const arEntries: AREntry[] = rawPosition ? mapAREntries(rawPosition) : [];
  const apEntries: APEntry[] = rawPosition ? mapAPEntries(rawPosition) : [];

  const positionItems: PositionItem[] = rawPosition
    ? mapPositionItems(rawPosition, activeProfileId)
    : [];

  const monthlyTrend: APIMonthlyDataPoint[] = rawPosition?.monthlyTrend ?? [];
  const vatWarning: APIVATWarning | null = rawPosition?.vatWarning ?? null;
  const nonDeductibleTotal: number = rawPosition?.nonDeductibleTotal ?? 0;
  const taxLinesRaw: Array<{ label: string; amount: number }> = rawPosition?.taxCalculation?.lines ?? [];
  const evidenceCoverage: EvidenceCoverage = rawPosition?.evidenceCoverage ?? {
    tierAmounts: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 },
    strongEvidencePct: 0, selfDeclaredPct: 0, documentedPct: 0, coveragePct: 0,
    defensibilityPct: 0, classificationPct: 0, financialConfidenceScore: 0,
    financialConfidenceLabel: 'very_low',
  };

  // ── Mutations

  const addProfile = useCallback(async (profile: Omit<Profile, 'id'>): Promise<string> => {
    const p = await profilesApi.create({
      name: profile.name,
      type: profile.type,
      industry: profile.industry,
      vatRegistered: profile.vatRegistered,
      taxYear: profile.taxYear ?? '2024/25',
      accountingBasis: profile.accountingBasis ?? 'cash',
    });
    const newProfile: Profile = {
      id: p.id,
      type: (p.type as ProfileType) || 'sole_trader',
      name: p.name,
      industry: (p as Record<string, unknown>).industry as string | undefined,
      vatRegistered: (p as Record<string, unknown>).vatRegistered as boolean | undefined,
      taxYear: ((p as Record<string, unknown>).taxYear ?? '2024/25') as string,
      accountingBasis: (p as Record<string, unknown>).accountingBasis as string | undefined,
      openingPositionStatus: p.openingPositionStatus ?? 'not_started',
      openingBalance: p.openingBalance ?? null,
      openingDetails: p.openingDetails ?? null,
      coverageStartDate: p.coverageStartDate ?? null,
      coverageEndDate: p.coverageEndDate ?? null,
      otherTaxableIncome: p.otherTaxableIncome ?? null,
      otherTaxableIncomeTaxYear: p.otherTaxableIncomeTaxYear ?? null,
    };
    setProfiles(prev => [...prev, newProfile]);
    return p.id;
  }, []);

  const updateProfile = useCallback(async (id: string, updates: Partial<Omit<Profile, 'id'>>): Promise<void> => {
    const updated = await profilesApi.update(id, {
      name: updates.name,
      industry: updates.industry,
      vatRegistered: updates.vatRegistered,
      taxYear: updates.taxYear,
      accountingBasis: updates.accountingBasis,
      openingPositionStatus: updates.openingPositionStatus,
      openingBalance: updates.openingBalance,
      openingDetails: updates.openingDetails,
      coverageStartDate: updates.coverageStartDate,
      coverageEndDate: updates.coverageEndDate,
      otherTaxableIncome: updates.otherTaxableIncome,
      otherTaxableIncomeTaxYear: updates.otherTaxableIncomeTaxYear,
    });
    setProfiles(prev => prev.map(p =>
      p.id === id
        ? {
            ...p,
            ...updates,
            name: updated.name,
            industry: (updated as Record<string, unknown>).industry as string | undefined,
            vatRegistered: (updated as Record<string, unknown>).vatRegistered as boolean | undefined,
            openingPositionStatus: updated.openingPositionStatus ?? 'not_started',
            openingBalance: updated.openingBalance ?? null,
            openingDetails: updated.openingDetails ?? null,
            coverageStartDate: updated.coverageStartDate ?? null,
            coverageEndDate: updated.coverageEndDate ?? null,
            otherTaxableIncome: updated.otherTaxableIncome ?? null,
            otherTaxableIncomeTaxYear: updated.otherTaxableIncomeTaxYear ?? null,
          }
        : p
    ));
  }, []);

  const refreshData = useCallback(async (): Promise<void> => {
    if (activeProfileId) await fetchAll(activeProfileId);
  }, [activeProfileId, fetchAll]);

  const loadSampleData = useCallback(async (): Promise<void> => {
    if (!activeProfileId) return;
    await demoApi.seedTransactions(activeProfileId);
    await fetchAll(activeProfileId);
  }, [activeProfileId, fetchAll]);

  const addTransaction = useCallback(async (tx: Omit<TransactionItem, 'id'>, idempotencyKey: string): Promise<void> => {
    const taxTreatment = tx.amount > 0 ? 'income' : 'deductible';
    await transactionsApi.create(activeProfileId, {
      date: tx.date, description: tx.description, amount: tx.amount,
      category: tx.category, taxTreatment, idempotencyKey,
    });
    await fetchAll(activeProfileId);
  }, [activeProfileId, fetchAll]);

  const addEvidenceItem = useCallback((item: Omit<EvidenceItem, 'id'>): string => {
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    // Optimistic: show immediately in UI
    setEvidenceItems(prev => [{ id: tempId, ...item }, ...prev]);
    // Background: register in DB
    evidenceApi.register(activeProfileId, {
      filename: item.filename,
      objectPath: `uploads/${item.filename}`,
      mimeType: 'application/octet-stream',
      category: item.category,
    }).then(() => {
      // Replace temp with real item on next fetch
      return evidenceApi.list(activeProfileId);
    }).then(items => setEvidenceItems(items.map(mapEvidenceItem)))
      .catch(console.error);
    return tempId;
  }, [activeProfileId]);

  const resolveInboxItem = useCallback(async (id: string, resolution: string): Promise<boolean> => {
    if (resolvingInboxIds.current.has(id)) return false;
    resolvingInboxIds.current.add(id);
    try {
      await inboxApi.resolve(activeProfileId, id, resolution);
      await fetchAll(activeProfileId);
      return true;
    } catch (err) {
      console.error('[store] resolveInboxItem failed', err);
      return false;
    } finally {
      resolvingInboxIds.current.delete(id);
    }
  }, [activeProfileId, fetchAll]);

  const resolveInboxBatch = useCallback(async (ids: string[], resolution: string): Promise<boolean> => {
    const uniqueIds = [...new Set(ids)].filter(id => !resolvingInboxIds.current.has(id));
    if (uniqueIds.length === 0) return false;
    uniqueIds.forEach(id => resolvingInboxIds.current.add(id));
    try {
      const outcomes = await Promise.allSettled(
        uniqueIds.map(id => inboxApi.resolve(activeProfileId, id, resolution)),
      );
      // The server can persist part of a batch before a transient client error.
      // Refresh only after every real mutation result has settled.
      await fetchAll(activeProfileId);
      return outcomes.every(outcome => outcome.status === 'fulfilled');
    } catch (err) {
      console.error('[store] resolveInboxBatch failed', err);
      return false;
    } finally {
      uniqueIds.forEach(id => resolvingInboxIds.current.delete(id));
    }
  }, [activeProfileId, fetchAll]);

  const addChatMessage = useCallback((sessionId: string, message: Omit<ChatMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setChatHistory(prev => prev.map(s =>
      s.id === sessionId ? { ...s, messages: [...s.messages, { id, ...message }] } : s
    ));
  }, []);

  const createChatSession = useCallback((title: string, initialMessage?: Omit<ChatMessage, 'id'>): string => {
    const id = Math.random().toString(36).slice(2);
    const session: ChatSession = {
      id, title, date: new Date().toLocaleDateString('en-GB'), messages: [],
    };
    if (initialMessage) {
      session.messages = [{ id: Math.random().toString(36).slice(2), ...initialMessage }];
    }
    setChatHistory(prev => [session, ...prev]);
    return id;
  }, []);

  const updatePeerCategory = useCallback((data: Partial<PeerCategory>) => {
    setPeerCategory(prev => prev ? { ...prev, ...data } : null);
  }, []);

  const updateBusinessIdea = useCallback((id: string, updates: Partial<BusinessIdea>) => {
    setBusinessIdeas(prev => prev.map(idea => idea.id === id ? { ...idea, ...updates } : idea));
  }, []);

  const updateIdeaAssumption = useCallback((ideaId: string, key: string, value: number) => {
    setBusinessIdeas(prev => prev.map(idea =>
      idea.id === ideaId
        ? { ...idea, editableAssumptions: idea.editableAssumptions.map(a => a.key === key ? { ...a, value } : a) }
        : idea
    ));
  }, []);

  const commitDecision = useCallback((entry: Omit<DecisionMemoryEntry, 'id'>): string => {
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    // Optimistic
    setDecisionMemory(prev => [{ id: tempId, ...entry }, ...prev]);
    setBusinessIdeas(prev => prev.map(idea =>
      idea.id === entry.ideaId ? { ...idea, status: 'saved', committedDecisionId: tempId } : idea
    ));
    decisionsApi.commit(activeProfileId, {
      ideaId: entry.ideaId,
      ideaTitle: entry.ideaTitle,
      ideaCategory: entry.ideaCategory,
      userDecision: entry.userDecision,
      userRationale: entry.userRationale,
      assumptionsSnapshot: entry.assumptionsSnapshot,
      expectedPLImpact: entry.expectedPLImpact,
      expectedCashImpact: entry.expectedCashImpact,
      expectedTaxImpact: entry.expectedTaxImpact,
      status: entry.status,
    }).then(d => {
      setDecisionMemory(prev => prev.map(dec =>
        dec.id === tempId ? mapDecision(d, activeProfileId) : dec
      ));
      setBusinessIdeas(prev => prev.map(idea =>
        idea.id === entry.ideaId ? { ...idea, status: 'saved', committedDecisionId: d.id } : idea
      ));
      // Refresh position/financials so Decision Memory immediately reflects on Tasks
      return fetchAll(activeProfileId);
    }).catch(console.error);
    return tempId;
  }, [activeProfileId]);

  const updateDecisionMemoryStatus = useCallback((id: string, status: DecisionMemoryEntry['status']) => {
    setDecisionMemory(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    decisionsApi.update(activeProfileId, id, { status }).catch(console.error);
  }, [activeProfileId]);

  const updateDecisionMemoryOutcome = useCallback((
    id: string, outcome: string, actualPL?: number, actualCash?: number, actualTax?: number
  ) => {
    setDecisionMemory(prev => prev.map(d =>
      d.id === id
        ? { ...d, status: 'completed', actualOutcome: outcome, actualPLImpact: actualPL, actualCashImpact: actualCash, actualTaxImpact: actualTax }
        : d
    ));
    decisionsApi.update(activeProfileId, id, {
      status: 'completed', actualOutcome: outcome,
      actualPLImpact: actualPL, actualCashImpact: actualCash, actualTaxImpact: actualTax,
    }).catch(console.error);
  }, [activeProfileId]);

  const updateSAChecklistItem = useCallback((id: string, status: SAChecklistItem['status']) => {
    setSAChecklist(prev => prev.map(item => item.id === id ? { ...item, status } : item));
    saChecklistApi.update(activeProfileId, id, status === 'done').catch(console.error);
  }, [activeProfileId]);

  const resetDemoData = useCallback(async (): Promise<void> => {
    const { profileId } = await demoApi.reset();
    // Reload the full profiles list so the store reflects the newly created profile
    const profs = await profilesApi.list().catch(() => []);
    const mapProfile = (p: typeof profs[0]): Profile => ({
      id: p.id,
      type: (p.type as ProfileType) || 'sole_trader',
      name: p.name,
      industry: (p as Record<string, unknown>).industry as string | undefined,
      vatRegistered: (p as Record<string, unknown>).vatRegistered as boolean | undefined,
      taxYear: ((p as Record<string, unknown>).taxYear ?? '2024/25') as string,
      accountingBasis: (p as Record<string, unknown>).accountingBasis as string | undefined,
      openingPositionStatus: p.openingPositionStatus ?? 'not_started',
      openingBalance: p.openingBalance ?? null,
      openingDetails: p.openingDetails ?? null,
      coverageStartDate: p.coverageStartDate ?? null,
      coverageEndDate: p.coverageEndDate ?? null,
      otherTaxableIncome: p.otherTaxableIncome ?? null,
      otherTaxableIncomeTaxYear: p.otherTaxableIncomeTaxYear ?? null,
    });
    setProfiles(profs.map(mapProfile));
    setActiveProfileId(profileId);
    await fetchAll(profileId);
  }, [fetchAll]);

  const updateSharedContext = useCallback((data: Partial<SharedContext>) => {
    setSharedContext(prev => ({ ...prev, ...data }));
  }, []);

  const login = useCallback(() => {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL?.replace(/\/+$/, '') ?? '';
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base || '/')}`;
  }, []);

  // ── Context value
  const value: AppState = {
    isAuthenticated: !!authUser,
    isLoading: authLoading,
    authUser,
    login,

    profiles,
    activeProfileId,
    setActiveProfileId,
    addProfile,
    profilesLoaded,
    updateProfile,
    refreshData,
    loadSampleData,

    sharedContext,
    updateSharedContext,

    positionItems,
    transactions,
    addTransaction,

    evidenceItems,
    addEvidenceItem,

    inboxItems,
    resolveInboxItem,
    resolveInboxBatch,

    chatHistory,
    addChatMessage,
    createChatSession,

    peerCategory,
    updatePeerCategory,
    benchmarks: INITIAL_BENCHMARKS,

    businessIdeas,
    updateBusinessIdea,
    updateIdeaAssumption,

    decisionMemory,
    commitDecision,
    updateDecisionMemoryStatus,
    updateDecisionMemoryOutcome,

    complianceItems: INITIAL_COMPLIANCE,

    saChecklist,
    updateSAChecklistItem,

    yearEndPackGenerated,
    setYearEndPackGenerated,

    plBreakdown,
    taxCalculation,
    arEntries,
    apEntries,
    cashBreakdown,
    monthlyTrend,
    vatWarning,
    nonDeductibleTotal,
    taxLinesRaw,
    evidenceCoverage,

    copilotTrigger,
    setCopilotTrigger,

    resetDemoData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
