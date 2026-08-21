import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';

// ─── Core entity types ────────────────────────────────────────────────────────

export type ProfileType = 'individual' | 'sole_trader' | 'landlord' | 'company';

export interface Profile {
  id: string;
  type: ProfileType;
  name: string;
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

// Impact ranges — show numerical estimates even when uncertain
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
  // Quantified impact ranges (shown even when uncertain, as ranges)
  priorityTier: 'do_now' | 'consider' | 'watch';
  plImpactRange?: ImpactRange;       // annual P&L £ change (+ = gain, - = cost)
  cashImpactRange?: ImpactRange;     // cash £ change (- = outflow)
  taxImpactRange?: ImpactRange;      // tax saving £ range (always positive)
  paybackRange?: PaybackRange;       // null = immediate/N/A
  urgencyNote?: string;              // why act now vs later
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
  // Actual outcomes — filled in later to close the loop
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
  inboxItemId?: string;   // links to InboxItem.id so we can remove on resolve
}

export interface PLBreakdown {
  revenues: PLRevenue[];
  confirmedExpenses: PLExpense[];
  pendingExpenses: PLExpense[];   // excluded from headline profit until resolved
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
  taxReserve: number;           // ringfenced for Jan tax
  apDueWithin30Days: number;    // committed/due AP
  nearTermInflows: CashFlow[];
  nearTermOutflows: CashFlow[];
}

// ─── AppState ─────────────────────────────────────────────────────────────────

export interface AppState {
  profiles: Profile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  addProfile: (profile: Omit<Profile, 'id'>) => string;

  sharedContext: SharedContext;
  updateSharedContext: (data: Partial<SharedContext>) => void;

  positionItems: PositionItem[];

  transactions: TransactionItem[];
  addTransaction: (transaction: Omit<TransactionItem, 'id'>) => void;

  evidenceItems: EvidenceItem[];
  addEvidenceItem: (item: Omit<EvidenceItem, 'id'>) => string;

  inboxItems: InboxItem[];
  resolveInboxItem: (id: string, resolution: string) => void;

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

  copilotTrigger: string | null;
  setCopilotTrigger: (msg: string | null) => void;

  resetDemoData: () => void;
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const initialProfiles: Profile[] = [
  { id: 'p1', type: 'individual', name: 'Priya (Personal)' },
  { id: 'p2', type: 'sole_trader', name: 'Design Consulting (Sole Trader)' },
];

// ─── Canonical numbers (all figures must tie to these) ────────────────────────
//
//  Revenue (confirmed):          £39,800
//  Confirmed allowable expenses: £ 4,800
//  YTD Profit (confirmed only):  £35,000   ← headline
//  Pending Inbox items:          £ 1,399   (excluded until resolved)
//
//  Tax: trading £35k + property £10,200 = £45,200 gross income
//       less personal allowance £12,570 = £32,630 taxable
//       income tax 20%:   £6,526
//       Class 4 NI 9%:    £2,019  (on £35k − £12,570 = £22,430)
//       Class 2 NI:       £  179
//       Gross liability:  £8,724
//       Less PoA paid:   −£1,800
//       Balance due:     ~£6,924  → displayed as £6,900
//
//  Cash:  Total business cash £9,840 (Starling only; no personal mixing)
//         − Tax reserve £3,500 (ringfenced toward £6,900 balance due)
//         − AP due ≤30 days £250 (Adobe £50 + WeWork £200)
//         = Available cash £6,090
//
// ─────────────────────────────────────────────────────────────────────────────

const initialPositionItems: PositionItem[] = [
  {
    id: 'kpi1', profileId: 'p2',
    title: 'YTD Profit/Loss',
    description: 'your confirmed trading performance this year',
    value: '£35,000', rawValue: 35000,
    type: 'kpi',
    basis: 'Revenue £39,800 minus confirmed allowable expenses £4,800. Two Inbox items (£1,399) excluded until classified.',
    documents: ['Starling Bank Feed', 'Client Invoices #1001–#1042', 'Axiom retainer agreement'],
    assumptions: ['Pending items resolve as expenses — would reduce to £33,601', 'No major unlogged cash expenses'],
    confidence: 'medium',
  },
  {
    id: 'kpi2', profileId: 'p2',
    title: 'Estimated Tax',
    description: 'balance due 31 Jan 2025',
    value: '£6,900', rawValue: 6900,
    type: 'kpi',
    basis: 'Trading profit £35,000 + property income £10,200 − personal allowance £12,570 = £32,630 taxable. Income tax £6,526 + NI £2,198 = £8,724 gross − prior PoA £1,800 = £6,924 balance.',
    documents: [],
    assumptions: ['No further large equipment purchases before 5 April', 'Pending Inbox items resolve without changing taxable profit materially'],
    confidence: 'medium',
  },
  {
    id: 'kpi3', profileId: 'p2',
    title: 'Accounts Receivable',
    description: 'invoices sent, not yet collected',
    value: '£3,400', rawValue: 3400,
    type: 'kpi',
    basis: '2 unpaid invoices: Axiom Agency #1042 (£2,400, overdue 7d) and Studio Nine #1043 (£1,000, due 5 Apr).',
    documents: ['Invoice #1042', 'Invoice #1043'],
    assumptions: [],
    confidence: 'high',
  },
  {
    id: 'kpi4', profileId: 'p2',
    title: 'Accounts Payable',
    description: 'bills committed, not yet paid',
    value: '£250', rawValue: 250,
    type: 'kpi',
    basis: 'Adobe Creative Cloud £50 due 1 Apr + WeWork April £200 due 7 Apr.',
    documents: ['Adobe subscription', 'WeWork statement'],
    assumptions: [],
    confidence: 'high',
  },
  {
    id: 'kpi5', profileId: 'p2',
    title: 'Available Cash',
    description: 'free to use after tax reserve and committed bills',
    value: '£6,090', rawValue: 6090,
    type: 'kpi',
    basis: 'Starling Business £9,840 − tax reserve £3,500 − AP due ≤30 days £250 = £6,090. Tax reserve gap: £3,400 toward £6,900 balance due 31 Jan.',
    documents: ['Starling Bank Feed (synced 2h ago)'],
    assumptions: ['Tax reserve is held as internal ringfence — not a separate account', 'AR (£3,400) excluded until collected'],
    confidence: 'high',
  },
  {
    id: 'f1', profileId: 'p2',
    title: 'VAT Status',
    description: 'registration details',
    value: 'Registered (Effective 01/04/2022)',
    type: 'fact',
    basis: 'Confirmed via onboarding and verified against previous return.',
    documents: ['VAT Certificate'],
    assumptions: [], confidence: 'high',
  },
];

const initialInboxItems: InboxItem[] = [
  {
    id: '1', profileId: 'p2', date: '2023-11-15', description: 'Payment to "Apple Store"', amount: 1249.00, status: 'pending',
    aiReasoning: 'This looks like a large technology purchase. Because it is over £1,000, it is typically treated as a capital asset rather than a day-to-day expense, but I need to confirm what you bought.',
    options: [
      {
        label: 'Hardware (e.g. Laptop, Phone)',
        subOptions: [
          { label: 'Depreciation 30% p.a. (AIA — full deduction year 1)', isSuggested: true },
          { label: 'Depreciation 20% p.a. (standard WDA)' },
          { label: 'Manual input' },
        ],
      },
      { label: 'Software / App subscription (fully deductible as expense)' },
    ],
  },
  {
    id: '2', profileId: 'p1', date: '2023-12-01', description: 'Missing Q3 rental statement', status: 'pending',
    aiReasoning: 'I see a regular incoming payment of £1,000 from "Foxtons Letting", but I do not have the statement detailing any management fees deducted before you received this.',
    options: [
      { label: 'I will upload it later' },
      { label: 'Ignore (I will enter gross figures manually)' },
    ],
  },
  {
    id: '3', profileId: 'p2', date: '2024-01-10', description: 'Client meeting room hire', amount: 150.00, status: 'pending',
    aiReasoning: 'Tagged as "meeting room hire" but the merchant is a restaurant/hotel — HMRC often classifies this as client entertainment (not deductible). Purely room hire is allowable.',
    options: [
      { label: 'Purely room hire (Allowable — deductible)', isSuggested: true },
      { label: 'Client entertainment (Disallowable — not deductible)' },
    ],
  },
];

const initialEvidenceItems: EvidenceItem[] = [
  { id: 'ev1', profileId: 'p2', category: 'bank_statement', filename: 'starling-export-jan-mar-2024.csv', uploadedAt: '2024-03-12', status: 'categorised', extractedLines: 142 },
  { id: 'ev2', profileId: 'p2', category: 'invoice_sent', filename: 'invoice-1042-axiom.pdf', uploadedAt: '2024-03-01', status: 'categorised', extractedLines: 1 },
  { id: 'ev3', profileId: 'p2', category: 'invoice_sent', filename: 'invoice-1043-studio-nine.pdf', uploadedAt: '2024-03-20', status: 'categorised', extractedLines: 1 },
  { id: 'ev4', profileId: 'p2', category: 'receipt', filename: 'apple-store-receipt-nov23.pdf', uploadedAt: '2023-11-16', status: 'needs_review', linkedInboxItemId: '1' },
  { id: 'ev5', profileId: 'p2', category: 'receipt', filename: 'meeting-room-jan24.jpg', uploadedAt: '2024-01-11', status: 'needs_review', linkedInboxItemId: '3' },
];

const initialTransactions: TransactionItem[] = [
  { id: 't1', date: '2024-03-01', description: 'Adobe Creative Cloud', amount: -49.99, category: 'Software', source: 'bank' },
  { id: 't2', date: '2024-03-05', description: 'Client Invoice #1042 — Axiom Agency', amount: 2400, category: 'Sales', source: 'bank' },
  { id: 't3', date: '2024-03-10', description: 'WeWork Desk hire', amount: -200, category: 'Office', source: 'bank' },
  { id: 't4', date: '2024-02-15', description: 'Train tickets — client meetings', amount: -68.50, category: 'Travel', source: 'receipt' },
  { id: 't5', date: '2024-02-01', description: 'Adobe Creative Cloud', amount: -49.99, category: 'Software', source: 'bank' },
];

const initialChatHistory: ChatSession[] = [
  {
    id: 'c1',
    title: 'Checking my estimated tax bill',
    date: '2024-03-10',
    messages: [
      { id: 'm1', role: 'user', content: 'How much tax do I owe so far this year?', timestamp: '10:00' },
      {
        id: 'm2', role: 'system',
        content: "Based on your £35,000 confirmed trading profit and £10,200 property income, your estimated total liability for 23/24 is approximately £8,724 (income tax £6,526 + NI £2,198). After deducting prior payments on account of £1,800, the balance due on 31 January 2025 is approximately £6,924.\n\nNote: two Inbox items (Apple Store £1,249 and meeting room £150) could reduce this by up to £382 (income tax + Class 4 NI combined) if classified as allowable business expenses.",
        timestamp: '10:01',
      },
    ],
  },
];

// ─── Peer category & benchmarks ───────────────────────────────────────────────

const initialPeerCategory: PeerCategory = {
  id: 'pc1', profileId: 'p2',
  sector: 'Creative & Design Services',
  geography: 'UK — London & South East',
  sizeBand: 'Solo / 1–2 employees',
  customerType: 'B2B (Agency & Corporate clients)',
  revenueModel: 'Project fees + retainers',
  reviewedByUser: false,
};

const initialBenchmarks: BenchmarkMetric[] = [
  {
    id: 'b1', categoryId: 'pc1',
    label: 'Revenue per Employee',
    peerMedian: '£65,000', peerRange: '£42k–£95k', userCurrent: '~£39,800',
    userStatus: 'below',
    source: 'ONS UK Business Survey 2022 (Creative sector, <10 employees) — illustrative sample',
    sourceFull: 'Office for National Statistics, Annual Business Survey 2022, Creative Industries sub-sector, micro-businesses',
    dataPeriod: '2022', geography: 'UK (England)',
    peerDefinition: 'Solo / micro creative businesses, <2 employees, project-fee model, UK-registered',
    sampleSize: 'n ≈ 2,400 (ONS survey — actual figures are illustrative for prototype)',
    confidence: 'low', freshness: '2022 data — 2–3 years old. Live benchmark refresh is a planned feature.',
    isIllustrative: true, relevanceToIdea: 'bi1',
  },
  {
    id: 'b2', categoryId: 'pc1',
    label: 'Gross Margin',
    peerMedian: '72%', peerRange: '58–85%', userCurrent: '~88%',
    userStatus: 'above',
    source: 'Companies House micro-entity benchmarks 2022–23 — illustrative sample',
    sourceFull: 'Companies House / HMRC small company accounts analysis, creative sector micro-entities, 2022–23',
    dataPeriod: '2022–23', geography: 'UK',
    peerDefinition: 'Micro limited companies and sole traders, creative/design services, £20k–£100k revenue',
    sampleSize: 'Not disclosed (illustrative for prototype)',
    confidence: 'low', freshness: '2022–23 data. Live benchmark refresh is a planned feature.',
    isIllustrative: true, relevanceToIdea: undefined,
  },
  {
    id: 'b3', categoryId: 'pc1',
    label: 'Operating Margin',
    peerMedian: '28%', peerRange: '15–45%', userCurrent: '~88%',
    userStatus: 'above',
    source: 'ICAEW SME benchmarking data 2023 — illustrative sample',
    sourceFull: 'Institute of Chartered Accountants in England and Wales, SME Business Conditions Survey 2023, creative services segment',
    dataPeriod: '2023', geography: 'UK',
    peerDefinition: 'Sole trader and micro limited company design/creative consultants, B2B clients',
    sampleSize: 'Not disclosed (illustrative for prototype)',
    confidence: 'low', freshness: '2023 data. Live benchmark refresh is a planned feature.',
    isIllustrative: true, relevanceToIdea: undefined,
  },
  {
    id: 'b4', categoryId: 'pc1',
    label: 'Debtor Days',
    peerMedian: '28 days', peerRange: '14–55 days', userCurrent: '~34 days',
    userStatus: 'below',
    source: 'Xero Small Business Insights UK 2023 — illustrative sample',
    sourceFull: 'Xero Small Business Insights, UK, Q3 2023 — Services sector, <10 employees',
    dataPeriod: '2023', geography: 'UK',
    peerDefinition: 'UK small service businesses, B2B invoicing model, <10 employees',
    sampleSize: 'Not disclosed (illustrative for prototype)',
    confidence: 'medium', freshness: '2023 data. Live benchmark refresh is a planned feature.',
    isIllustrative: true, relevanceToIdea: 'bi2',
  },
];

// ─── Business Ideas ───────────────────────────────────────────────────────────

const initialBusinessIdeas: BusinessIdea[] = [
  {
    id: 'bi2', profileId: 'p2', category: 'cash',
    title: 'Reduce debtor days — chase overdue invoice',
    summary: 'Axiom Agency #1042 is already 7 days overdue (£2,400). Tighter payment terms and an immediate chase could unlock £1,500–£2,200 in cash this month — the biggest quick win available.',
    triggerBenchmark: 'Debtor Days',
    benchmarkGap: '6 days above peer median of 28 days',
    currentPosition: '£3,400 outstanding across 2 invoices — Axiom #1042 (£2,400) is 7 days overdue. Current debtor days ~34 vs peer median 28 days (illustrative).',
    proposedAction: 'Chase Axiom #1042 today; switch new contracts to 14-day terms with automated reminders at day 10',
    editableAssumptions: [
      { key: 'targetDebtorDays', label: 'Target debtor days', value: 14, unit: 'days', min: 7, max: 30, step: 1 },
      { key: 'earlyPaymentDiscount', label: 'Early payment discount to offer', value: 0, unit: '%', min: 0, max: 3, step: 0.5 },
    ],
    whatMustBeTrue: [
      'You contact Axiom today about the overdue invoice',
      'New contract terms updated and communicated to clients',
      'Automated reminder sequence set up in your invoicing tool',
    ],
    source: 'Financial Memory (AR £3,400, invoice dates) + Xero Small Business Insights UK 2023 (illustrative benchmark)',
    confidence: 'high', impactLabel: 'Cash released: £1,500–£2,200',
    priorityTier: 'do_now',
    plImpactRange: { min: -800, max: 0 },
    cashImpactRange: { min: 1500, max: 2200 },
    taxImpactRange: { min: 0, max: 0 },
    paybackRange: { minMonths: 0, maxMonths: 0 },
    urgencyNote: 'Axiom invoice #1042 already 7 days overdue — every day costs you cash',
    status: 'new',
  },
  {
    id: 'bi4', profileId: 'p2', category: 'tax',
    title: 'Claim Working From Home allowance',
    summary: 'HMRC\'s flat-rate WFH allowance is a zero-cost claim in your SA return. At 4 days/week it saves £24–£62 in tax — small but effort-free, and must be claimed by 31 Jan 2025.',
    currentPosition: 'You work from home approximately 4 days per week. The HMRC flat rate (£10–£26/month) applies at 25+ hours/month and requires no receipts.',
    proposedAction: 'Claim HMRC flat-rate WFH allowance in your 23/24 Self-Assessment return — takes 5 minutes',
    editableAssumptions: [
      { key: 'daysPerWeek', label: 'Days working from home per week', value: 4, unit: 'days', min: 1, max: 5, step: 1 },
    ],
    whatMustBeTrue: [
      'You genuinely work from home those days (keep a simple log)',
      'You are not also claiming a separate office rent deduction',
    ],
    source: 'HMRC EIM32760 — Working from Home expenses, flat-rate allowances 2023/24 (gov.uk)',
    confidence: 'high', impactLabel: 'Tax saving: +£24–£62',
    priorityTier: 'do_now',
    plImpactRange: { min: 120, max: 312 },
    cashImpactRange: { min: 24, max: 62 },
    taxImpactRange: { min: 24, max: 62 },
    paybackRange: { minMonths: 0, maxMonths: 0 },
    urgencyNote: 'Must be claimed in SA return by 31 Jan 2025 — zero cost to act now',
    deadlines: ['Claim in Self-Assessment by 31 Jan 2025'],
    status: 'new',
  },
  {
    id: 'bi3', profileId: 'p2', category: 'assets',
    title: 'Buy a qualifying asset before 5 April (AIA)',
    summary: 'Any equipment bought before 5 April 2024 is fully deductible via AIA — reducing your taxable profit by the purchase price and cutting the £6,900 balance due. Hard deadline in days.',
    currentPosition: 'A professional display or equipment (£500–£1,500) qualifies for AIA — the full purchase price deducted from 23/24 profit (£35,000). Saves 20% of purchase price in tax.',
    proposedAction: 'Purchase a business asset you genuinely need before 5 April 2024 and claim via AIA in SA return',
    editableAssumptions: [
      { key: 'purchasePrice', label: 'Purchase price', value: 1100, unit: '£', min: 500, max: 2500, step: 50 },
    ],
    whatMustBeTrue: [
      'You genuinely need the asset for business use (HMRC "wholly and exclusively" test)',
      'Profit of £35,000 is sufficient to benefit fully from the deduction',
      'Purchase made before 5 April 2024',
    ],
    source: 'HMRC Capital Allowances — Annual Investment Allowance 2023/24 (gov.uk)',
    confidence: 'high', impactLabel: 'Tax saving: £100–£300',
    priorityTier: 'do_now',
    plImpactRange: { min: 100, max: 300 },
    cashImpactRange: { min: -2500, max: -500 },
    taxImpactRange: { min: 100, max: 300 },
    paybackRange: { minMonths: null, maxMonths: null },
    urgencyNote: 'Hard deadline: must purchase before 5 April 2024 — after that, benefit deferred by a full year',
    deadlines: ['Purchase before 5 April 2024'],
    status: 'new',
  },
  {
    id: 'bi5', profileId: 'p2', category: 'tax',
    title: 'Accelerate planned equipment purchase',
    summary: 'If you\'re planning any equipment purchase anyway, bringing it forward to before 5 April 2024 pulls the full AIA deduction into this year\'s tax return — reducing the £6,900 January bill.',
    currentPosition: 'Trading profit stands at £35,000 (confirmed). Any qualifying equipment bought before year-end is fully deductible via AIA (up to £1m/yr). Available cash £6,090.',
    proposedAction: 'Bring forward any planned equipment purchases to before 5 April 2024',
    editableAssumptions: [
      { key: 'equipmentBudget', label: 'Equipment budget', value: 1100, unit: '£', min: 500, max: 5000, step: 100 },
    ],
    whatMustBeTrue: [
      'You genuinely intend to make these purchases — not solely for tax purposes',
      'Available cash (£6,090) can absorb the outlay before tax saving arrives',
      'Purchase made before 5 April 2024',
    ],
    source: 'HMRC Capital Allowances — AIA 2023/24 (gov.uk)',
    confidence: 'medium', impactLabel: 'Tax saving: £100–£1,000',
    priorityTier: 'consider',
    plImpactRange: { min: 100, max: 1000 },
    cashImpactRange: { min: -5000, max: -500 },
    taxImpactRange: { min: 100, max: 1000 },
    paybackRange: { minMonths: null, maxMonths: null },
    urgencyNote: 'Hard deadline: 5 April 2024 — only act if you have a genuine business need',
    deadlines: ['Purchase before 5 April 2024'],
    status: 'new',
  },
  {
    id: 'bi1', profileId: 'p2', category: 'hiring',
    title: 'Hire a junior designer or VA',
    summary: 'Your revenue per employee (~£39,800) sits 39% below the peer median (£65,000). A part-time hire could grow revenue — but current available cash (£6,090) covers less than 5 months of salary. Pipeline confidence is the key gate.',
    triggerBenchmark: 'Revenue per Employee',
    benchmarkGap: '39% below peer median of £65,000',
    currentPosition: 'Billing ~£39,800 as a solo consultant. Peer median for Creative & Design, solo/micro is £65,000/employee (illustrative). Available cash £6,090 — below 6-month salary reserve threshold of ~£9,000.',
    proposedAction: 'Hire one part-time junior designer or VA (~0.5 FTE) once pipeline and reserves are in place',
    editableAssumptions: [
      { key: 'salary', label: 'Annual salary', value: 18000, unit: '£', min: 12000, max: 30000, step: 500 },
      { key: 'revenueGrowth', label: 'Expected revenue growth', value: 35, unit: '%', min: 0, max: 100, step: 5 },
      { key: 'recruitmentCost', label: 'One-off recruitment cost', value: 1200, unit: '£', min: 0, max: 5000, step: 100 },
    ],
    whatMustBeTrue: [
      'You have a consistent pipeline of more work than you can handle alone',
      'Available cash covers at least 6 months of salary (need ~£9,000 — currently £6,090)',
      'You have capacity and systems to manage and train a hire',
    ],
    source: 'Financial Memory (YTD revenue £39,800) + ONS UK Business Survey 2022 (illustrative benchmark)',
    confidence: 'medium', impactLabel: 'Revenue growth +£8k–£14k (year 2+)',
    priorityTier: 'watch',
    plImpactRange: { min: -10000, max: 2000 },
    cashImpactRange: { min: -20000, max: -13000 },
    taxImpactRange: { min: 2400, max: 3600 },
    paybackRange: { minMonths: 12, maxMonths: null },
    urgencyNote: 'Watch: build cash reserves and pipeline confidence first — current cash below safe threshold',
    status: 'new',
  },
];

// ─── Compliance items ─────────────────────────────────────────────────────────

const initialComplianceItems: ComplianceItem[] = [
  {
    id: 'c1', profileId: 'p2',
    title: 'Self-Assessment Registration',
    description: 'Registered as a self-employed sole trader with HMRC.',
    dueDate: '2022-10-05', preparationLeadDays: 0, status: 'done',
    responsibleParty: 'client', category: 'filing', periodCovered: 'One-off',
    documentsRequired: ['UTR number'], actionsRequired: [],
  },
  {
    id: 'c2', profileId: 'p2',
    title: 'Self-Assessment Tax Return 2023/24',
    description: 'Annual return covering trading income, property income, and NI contributions.',
    dueDate: '2025-01-31', preparationLeadDays: 60, status: 'due-soon',
    responsibleParty: 'client', category: 'filing', periodCovered: '6 Apr 2023 – 5 Apr 2024',
    documentsRequired: ['P60 (if any PAYE)', 'Rental income statements', 'Business income & expense summary', 'Bank statements'],
    actionsRequired: ['Complete SA100 and SA103 supplementary pages', 'Declare rental income on SA105', 'Submit online by 31 Jan 2025'],
  },
  {
    id: 'c3', profileId: 'p2',
    title: 'Payment on Account 1 (2024/25)',
    description: 'First advance payment towards your 2024/25 tax liability — 50% of prior year bill.',
    dueDate: '2025-01-31', preparationLeadDays: 30, status: 'due-soon',
    responsibleParty: 'client', category: 'tax', periodCovered: '2024/25 advance',
    documentsRequired: [], actionsRequired: ['Pay ~£3,462 (50% of estimated £6,924 balance)'],
  },
  {
    id: 'c4', profileId: 'p2',
    title: 'Payment on Account 2 (2024/25)',
    description: 'Second advance payment towards your 2024/25 tax liability.',
    dueDate: '2025-07-31', preparationLeadDays: 30, status: 'upcoming',
    responsibleParty: 'client', category: 'tax', periodCovered: '2024/25 advance',
    documentsRequired: [], actionsRequired: ['Pay remaining ~£3,462 (50%)'],
  },
  {
    id: 'c5', profileId: 'p2',
    title: 'VAT Return Q4 2023/24',
    description: 'Quarterly VAT return covering February to April 2024.',
    dueDate: '2024-05-07', preparationLeadDays: 14, status: 'upcoming',
    responsibleParty: 'client', category: 'vat', periodCovered: 'Feb–Apr 2024',
    documentsRequired: ['VAT account/records', 'Sales invoices', 'Purchase receipts'],
    actionsRequired: ['File VAT return online', 'Pay VAT due to HMRC'],
  },
  {
    id: 'c6', profileId: 'p2',
    title: 'VAT Return Q1 2024/25',
    description: 'Quarterly VAT return covering May to July 2024. Platform prepares a draft for your review.',
    dueDate: '2024-08-07', preparationLeadDays: 14, status: 'upcoming',
    responsibleParty: 'platform', category: 'vat', periodCovered: 'May–Jul 2024',
    documentsRequired: [], actionsRequired: ['Platform prepares draft from linked bank data', 'Review and approve before submission'],
  },
];

// ─── SA Checklist ─────────────────────────────────────────────────────────────

const initialSAChecklist: SAChecklistItem[] = [
  { id: 'sa1', profileId: 'p2', label: 'Personal details verified', detail: 'UTR, NI number, address confirmed against HMRC records.', status: 'done', category: 'data' },
  { id: 'sa2', profileId: 'p2', label: 'Bank reconciliation complete', detail: 'All synced accounts balance — 142 transactions matched, revenue £39,800 confirmed.', status: 'done', category: 'data' },
  { id: 'sa3', profileId: 'p2', label: 'Resolve Inbox items (2 pending)', detail: 'Apple Store £1,249 and meeting room £150 need classification before the tax figure is final. Resolving as business expenses could reduce your tax bill by up to £382 (income tax + Class 4 NI combined).', status: 'pending', category: 'inbox' },
  { id: 'sa4', profileId: 'p2', label: 'Upload missing receipts', detail: '3 transactions over £100 have no linked receipt. Go to Evidence to upload.', status: 'pending', category: 'data' },
  { id: 'sa5', profileId: 'p2', label: 'Confirm rental income figures', detail: 'Q3 letting agent statement not yet uploaded — property profit estimate (£10,200) may change.', status: 'pending', category: 'data' },
  { id: 'sa6', profileId: 'p2', label: 'Complete SA100 & SA103 forms', detail: 'Self-assessment form and self-employment supplementary pages.', status: 'pending', category: 'filing' },
  { id: 'sa7', profileId: 'p2', label: 'Submit return by 31 Jan 2025', detail: 'Online filing deadline for 2023/24 tax year.', status: 'pending', category: 'filing' },
  { id: 'sa8', profileId: 'p2', label: 'Pay balance + first payment on account', detail: '~£6,924 balance due + ~£3,462 first PoA — both due 31 Jan 2025. Tax reserve (£3,500) set aside.', status: 'pending', category: 'payment' },
];

// ─── Financial drilldowns ─────────────────────────────────────────────────────

const initialPLBreakdown: PLBreakdown = {
  revenues: [
    { label: 'Design project fees', amount: 31200, basis: 'Client invoices #1001–#1042, 18 projects', evidenceRef: 'Bank feed + PDF invoices' },
    { label: 'Retainer — Axiom Agency', amount: 7200, basis: 'Monthly £600 retainer × 12 months', evidenceRef: 'Axiom retainer agreement' },
    { label: 'Stock illustration licensing', amount: 1400, basis: '2 licensing agreements', evidenceRef: 'Licensing contracts on file' },
  ],
  confirmedExpenses: [
    { label: 'Adobe Creative Cloud', amount: 600, category: 'Software & subscriptions', basis: 'Monthly £50 × 12', evidenceRef: 'Adobe invoices (bank feed)' },
    { label: 'WeWork hot-desk membership', amount: 2400, category: 'Office & workspace', basis: 'Monthly £200 × 12', evidenceRef: 'WeWork statements' },
    { label: 'Professional indemnity insurance', amount: 780, category: 'Insurance', basis: 'Annual premium', evidenceRef: 'Insurance certificate' },
    { label: 'Accountancy & bookkeeping (prior year)', amount: 600, category: 'Professional fees', basis: 'Invoice from previous accountant', evidenceRef: 'Accountant invoice' },
    { label: 'Travel (client meetings)', amount: 420, category: 'Travel', basis: '15 journeys — rail and TfL receipts', evidenceRef: 'Rail + TfL receipts (15 items)' },
  ],
  pendingExpenses: [
    { label: 'Apple Store purchase', amount: 1249, category: 'Pending — awaiting Inbox resolution', basis: 'See Inbox: hardware vs software affects deductibility', isPending: true, evidenceRef: 'Receipt uploaded — in Inbox', inboxItemId: '1' },
    { label: 'Client meeting room hire', amount: 150, category: 'Pending — awaiting Inbox resolution', basis: 'See Inbox: room hire vs entertainment affects allowability', isPending: true, evidenceRef: 'Receipt uploaded — in Inbox', inboxItemId: '3' },
  ],
};

const initialTaxCalculation: TaxCalculation = {
  lines: [
    { label: 'Trading profit (Design Consulting)', amount: '£35,000', note: 'Revenue £39,800 − confirmed expenses £4,800. Excludes 2 pending Inbox items (£1,399).' },
    { label: 'Property rental profit', amount: '£10,200', note: 'Gross rental £12,000 − letting agent fees £1,800. Estimate pending Q3 statement upload.' },
    { label: 'Personal allowance', amount: '−£12,570', note: 'Standard 2023/24 personal allowance' },
    { label: 'Taxable income', amount: '£32,630', note: '£35,000 + £10,200 − £12,570' },
    { label: 'Income tax (Basic Rate 20%)', amount: '£6,526', note: '£32,630 × 20%' },
    { label: 'Class 4 NI (9% on trading profit £12,570–£50,270)', amount: '£2,019', note: '(£35,000 − £12,570) × 9% = £22,430 × 9%' },
    { label: 'Class 2 NI', amount: '£179', note: 'Flat rate 2023/24' },
    { label: 'Total estimated liability', amount: '£8,724', note: '' },
    { label: 'Less: Prior payments on account', amount: '−£1,800', note: 'Paid Jan and Jul 2024 (50%+50% of prior year bill)' },
    { label: 'Balance due 31 Jan 2025', amount: '~£6,924' },
  ],
  unresolvedItems: [
    'Apple Store £1,249 (Inbox) — if Hardware with AIA: could reduce tax by ~£250; if Software: already assumed deductible',
    'Meeting room £150 (Inbox) — if Disallowable entertainment: adds ~£30 to tax bill',
    'Q3 rental statement missing — property profit £10,200 is an estimate',
  ],
  assumptions: [
    'Trading profit based on confirmed transactions only — 2 pending Inbox items excluded',
    'No further equipment purchases before 5 April 2024',
    'Personal allowance unchanged (no high-income restriction)',
    'Student Loan repayment not shown (handled via HMRC separately)',
  ],
  taxBasis: 'UK Income Tax and National Insurance 2023/24 — Basic Rate band',
};

const initialAREntries: AREntry[] = [
  { customer: 'Axiom Agency', invoiceRef: '#1042', amount: 2400, dueDate: '2024-03-25', isOverdue: true, daysOverdue: 7, evidenceRef: 'Invoice PDF on file' },
  { customer: 'Studio Nine Ltd', invoiceRef: '#1043', amount: 1000, dueDate: '2024-04-05', isOverdue: false, evidenceRef: 'Invoice PDF on file' },
];

const initialAPEntries: APEntry[] = [
  { supplier: 'Adobe Inc', description: 'Creative Cloud monthly', amount: 49.99, dueDate: '2024-04-01', isOverdue: false, evidenceRef: 'Adobe subscription' },
  { supplier: 'WeWork', description: 'Hot-desk April', amount: 200, dueDate: '2024-04-07', isOverdue: false, evidenceRef: 'WeWork statement' },
];

const initialCashBreakdown: CashBreakdown = {
  accounts: [
    { name: 'Starling Business', balance: 9840, type: 'business' },
  ],
  taxReserve: 3500,         // ringfenced toward £6,924 balance due
  apDueWithin30Days: 250,   // Adobe £50 + WeWork £200 (rounded)
  nearTermInflows: [
    { label: 'Axiom Agency Invoice #1042 (overdue — chasing)', amount: 2400, expectedDate: '2024-03-30' },
    { label: 'Studio Nine Invoice #1043', amount: 1000, expectedDate: '2024-04-05' },
  ],
  nearTermOutflows: [
    { label: 'Adobe Creative Cloud', amount: 49.99, expectedDate: '2024-04-01' },
    { label: 'WeWork April desk', amount: 200, expectedDate: '2024-04-07' },
    { label: 'Tax reserve top-up', amount: 500, expectedDate: '2024-04-15' },
  ],
};

// ─── Tax recalculator (pure — no side effects) ────────────────────────────────
//  All UK 2023/24 constants kept here so they're easy to update.

const TAX_CONFIG = {
  propertyIncome:    10200,   // estimate pending Q3 upload
  personalAllowance: 12570,
  basicRate:         0.20,
  niClass4Rate:      0.09,
  niClass2:          179,
  poaPaid:           1800,    // payments on account already made
} as const;

function computeTaxFromProfit(tradingProfit: number) {
  const totalIncome    = tradingProfit + TAX_CONFIG.propertyIncome;
  const taxableIncome  = Math.max(0, totalIncome - TAX_CONFIG.personalAllowance);
  const incomeTax      = Math.round(taxableIncome * TAX_CONFIG.basicRate);
  const niBase         = Math.max(0, tradingProfit - TAX_CONFIG.personalAllowance);
  const niClass4       = Math.round(niBase * TAX_CONFIG.niClass4Rate);
  const grossLiability = incomeTax + niClass4 + TAX_CONFIG.niClass2;
  const balanceDue     = Math.max(0, grossLiability - TAX_CONFIG.poaPaid);
  return { taxableIncome, incomeTax, niClass4, grossLiability, balanceDue };
}

/** Classify an inbox resolution text into its financial effect */
function classifyResolution(res: string): 'deductible' | 'personal' {
  const lower = res.toLowerCase();
  if (lower.includes('personal') || lower.includes('not a business') || lower.includes('not business')) {
    return 'personal';
  }
  // Everything else that the user explicitly selected is treated as a business deduction.
  // AIA capital assets (hardware) are also 100% deductible via Annual Investment Allowance in year of purchase.
  return 'deductible';
}

// Baseline tax balance before any session changes — used to compute total savings
// reported in SA checklist sa3 after inbox resolutions.
const INITIAL_TAX_BALANCE_DUE = initialPositionItems.find(p => p.id === 'kpi2')?.rawValue ?? 6900;

// ─── Storage persistence ──────────────────────────────────────────────────────

const STORAGE_KEY = 'sme-copilot-demo-v1';

function loadPersistedState(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function clearPersistedState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const StoreContext = createContext<AppState | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  // Load from localStorage once on mount — used as initial values only
  const initRef = useRef<Record<string, unknown> | null>(null);
  if (initRef.current === null) initRef.current = loadPersistedState();
  const sv = initRef.current;

  // Helper to safely read a typed value from persisted state with a fallback
  function sv_<T>(key: string, fallback: T): T {
    return (key in sv && sv[key] !== undefined && sv[key] !== null)
      ? (sv[key] as T)
      : fallback;
  }

  const [profiles, setProfiles] = useState<Profile[]>(sv_('profiles', initialProfiles));
  const [activeProfileId, setActiveProfileId] = useState<string>(sv_('activeProfileId', 'p2'));
  const [sharedContext, setSharedContext] = useState<SharedContext>(sv_('sharedContext', {
    name: 'Priya Shah', address: 'Flat 4, London, E8 2PC', utr: '1234567890', niNumber: 'AB123456C',
  }));
  const [positionItems, setPositionItems] = useState<PositionItem[]>(sv_('positionItems', initialPositionItems));
  const [plBreakdown, setPlBreakdown] = useState<PLBreakdown>(sv_('plBreakdown', initialPLBreakdown));
  const [taxCalculation, setTaxCalculation] = useState<TaxCalculation>(sv_('taxCalculation', initialTaxCalculation));
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(sv_('inboxItems', initialInboxItems));
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>(sv_('evidenceItems', initialEvidenceItems));
  const [transactions, setTransactions] = useState<TransactionItem[]>(sv_('transactions', initialTransactions));
  const [chatHistory, setChatHistory] = useState<ChatSession[]>(sv_('chatHistory', initialChatHistory));
  const [yearEndPackGenerated, setYearEndPackGenerated] = useState<boolean>(sv_('yearEndPackGenerated', false));
  const [peerCategory, setPeerCategory] = useState<PeerCategory>(sv_('peerCategory', initialPeerCategory));
  const [businessIdeas, setBusinessIdeas] = useState<BusinessIdea[]>(sv_('businessIdeas', initialBusinessIdeas));
  const [decisionMemory, setDecisionMemory] = useState<DecisionMemoryEntry[]>(sv_('decisionMemory', []));
  const [saChecklist, setSAChecklist] = useState<SAChecklistItem[]>(sv_('saChecklist', initialSAChecklist));
  const [cashBreakdown, setCashBreakdown] = useState<CashBreakdown>(sv_('cashBreakdown', initialCashBreakdown));
  const [copilotTrigger, setCopilotTrigger] = useState<string | null>(null);

  // Persist all mutable state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        profiles, activeProfileId, sharedContext, positionItems, plBreakdown, taxCalculation,
        inboxItems, evidenceItems, transactions, chatHistory, businessIdeas, decisionMemory,
        saChecklist, yearEndPackGenerated, peerCategory, cashBreakdown,
      }));
    } catch {
      // localStorage full or unavailable — ignore
    }
  }, [
    profiles, activeProfileId, sharedContext, positionItems, plBreakdown, taxCalculation,
    inboxItems, evidenceItems, transactions, chatHistory, businessIdeas, decisionMemory,
    saChecklist, yearEndPackGenerated, peerCategory, cashBreakdown,
  ]);

  // Reset all state to initial sample data (and clear localStorage)
  const resetDemoData = () => {
    clearPersistedState();
    setProfiles(initialProfiles);
    setActiveProfileId('p2');
    setSharedContext({ name: 'Priya Shah', address: 'Flat 4, London, E8 2PC', utr: '1234567890', niNumber: 'AB123456C' });
    setPositionItems(initialPositionItems);
    setPlBreakdown(initialPLBreakdown);
    setTaxCalculation(initialTaxCalculation);
    setInboxItems(initialInboxItems);
    setEvidenceItems(initialEvidenceItems);
    setTransactions(initialTransactions);
    setChatHistory(initialChatHistory);
    setBusinessIdeas(initialBusinessIdeas);
    setDecisionMemory([]);
    setSAChecklist(initialSAChecklist);
    setYearEndPackGenerated(false);
    setPeerCategory(initialPeerCategory);
    setCashBreakdown(initialCashBreakdown);
  };

  const value: AppState = {
    profiles,
    activeProfileId,
    setActiveProfileId,
    addProfile: (p) => {
      const id = Math.random().toString(36).slice(2);
      setProfiles(prev => [...prev, { ...p, id }]);
      return id;
    },
    sharedContext,
    updateSharedContext: (data) => setSharedContext(prev => ({ ...prev, ...data })),
    positionItems,
    transactions,
    addTransaction: (transaction) =>
      setTransactions(prev => [{ ...transaction, id: Math.random().toString(36).slice(2) }, ...prev]),
    evidenceItems,
    addEvidenceItem: (item) => {
      const id = Math.random().toString(36).slice(2);
      setEvidenceItems(prev => [{ ...item, id }, ...prev]);
      return id;
    },
    inboxItems,
    resolveInboxItem: (id, res) => {
      // 1. Locate item and mark it resolved
      const item = inboxItems.find(i => i.id === id);
      setInboxItems(prev => prev.map(i => i.id === id ? { ...i, status: 'resolved', customAnswer: res } : i));

      // Determine whether ALL profile inbox items will be resolved after this action
      const otherPending = inboxItems.filter(
        i => i.profileId === item?.profileId && i.id !== id && i.status === 'pending'
      );
      const allDone = otherPending.length === 0;

      // Helper: trim long classification labels for SA detail copy
      const shortLabel = (s: string) => s.length > 48 ? s.slice(0, 45) + '…' : s;

      // 2. Items with no amount — update SA status only, then return
      if (!item?.amount) {
        if (allDone) {
          setSAChecklist(prev => prev.map(sa =>
            sa.id === 'sa3' ? { ...sa, status: 'done' as const, detail: 'All Inbox items resolved.' } : sa
          ));
        }
        return;
      }

      // 3. Capture pre-resolve tax balance for savings calculation
      const prevTaxBalanceDue = positionItems.find(p => p.id === 'kpi2')?.rawValue ?? INITIAL_TAX_BALANCE_DUE;

      // 4. Classify resolution
      const effect = classifyResolution(res);
      if (effect === 'personal') {
        // Personal — no financial change; confirm classification in sa3 detail
        setSAChecklist(prev => prev.map(sa => {
          if (sa.id !== 'sa3') return sa;
          const detail = `${item.description}: classified as personal expense — no tax change. ${
            allDone ? 'All items resolved.' : '1 item still needs your input.'
          }`;
          return { ...sa, status: allDone ? 'done' as const : sa.status, detail };
        }));
        return;
      }

      // 5. Compute updated P&L
      const amount = item.amount;
      const totalRevenue = plBreakdown.revenues.reduce((s, r) => s + r.amount, 0);

      const newConfirmedExpenses: PLExpense[] = [
        ...plBreakdown.confirmedExpenses,
        {
          label: item.description,
          amount,
          category: res.toLowerCase().includes('hardware') || res.toLowerCase().includes('laptop') || res.toLowerCase().includes('phone')
            ? 'Equipment (AIA — fully deductible year of purchase)'
            : 'Business expense — resolved from Inbox',
          basis: `Inbox classification: "${res}"`,
          evidenceRef: 'Inbox resolved',
        },
      ];
      const newPendingExpenses = plBreakdown.pendingExpenses.filter(e => e.inboxItemId !== id);
      const newConfirmedTotal = newConfirmedExpenses.reduce((s, e) => s + e.amount, 0);
      const newTradingProfit  = totalRevenue - newConfirmedTotal;

      setPlBreakdown(prev => ({
        ...prev,
        confirmedExpenses: newConfirmedExpenses,
        pendingExpenses: newPendingExpenses,
      }));

      // 6. Recalculate tax from new profit
      const tax = computeTaxFromProfit(newTradingProfit);

      setTaxCalculation(prev => ({
        ...prev,
        lines: [
          { label: 'Trading profit (Design Consulting)', amount: `£${newTradingProfit.toLocaleString()}`, note: `Revenue £${totalRevenue.toLocaleString()} − confirmed expenses £${newConfirmedTotal.toLocaleString()}` },
          { label: 'Property rental profit', amount: '£10,200', note: 'Gross rental £12,000 − letting agent fees £1,800 (Q3 estimate pending)' },
          { label: 'Personal allowance', amount: '−£12,570', note: 'Standard 2023/24 personal allowance' },
          { label: 'Taxable income', amount: `£${tax.taxableIncome.toLocaleString()}`, note: `£${newTradingProfit.toLocaleString()} + £10,200 − £12,570` },
          { label: 'Income tax (Basic Rate 20%)', amount: `£${tax.incomeTax.toLocaleString()}`, note: `£${tax.taxableIncome.toLocaleString()} × 20%` },
          { label: 'Class 4 NI (9% on profit above £12,570)', amount: `£${tax.niClass4.toLocaleString()}`, note: `(£${newTradingProfit.toLocaleString()} − £12,570) × 9%` },
          { label: 'Class 2 NI', amount: `£${TAX_CONFIG.niClass2}`, note: 'Flat rate 2023/24' },
          { label: 'Total estimated liability', amount: `£${tax.grossLiability.toLocaleString()}`, note: '' },
          { label: 'Less: Prior payments on account', amount: `−£${TAX_CONFIG.poaPaid.toLocaleString()}`, note: 'Paid Jan and Jul 2024' },
          { label: 'Balance due 31 Jan 2025', amount: `~£${tax.balanceDue.toLocaleString()}` },
        ],
        unresolvedItems: prev.unresolvedItems.filter(u =>
          !(item.description && u.toLowerCase().includes(item.description.toLowerCase().slice(0, 12)))
        ),
      }));

      // 7. Update KPI positionItems (kpi1, kpi2, kpi5) so all screens stay consistent
      const newGap = Math.max(0, tax.balanceDue - initialCashBreakdown.taxReserve);
      setPositionItems(prev => prev.map(p => {
        if (p.id === 'kpi1') return {
          ...p,
          value: `£${newTradingProfit.toLocaleString()}`,
          rawValue: newTradingProfit,
          basis: `Revenue £${totalRevenue.toLocaleString()} minus confirmed expenses £${newConfirmedTotal.toLocaleString()}. "${item.description}" resolved as: ${res}.`,
        };
        if (p.id === 'kpi2') return {
          ...p,
          value: `£${tax.balanceDue.toLocaleString()}`,
          rawValue: tax.balanceDue,
          basis: `Updated after resolving Inbox: "${item.description}" → ${res}. Taxable income £${tax.taxableIncome.toLocaleString()}.`,
        };
        if (p.id === 'kpi5') return {
          ...p,
          basis: `Starling Business £9,840 − tax reserve £3,500 − AP due ≤30 days £250 = £6,090.${
            newGap > 0
              ? ` Tax reserve gap: £${newGap.toLocaleString()} toward £${tax.balanceDue.toLocaleString()} balance due 31 Jan.`
              : ` Tax reserve now covers your £${tax.balanceDue.toLocaleString()} balance due — gap closed.`
          }`,
        };
        return p;
      }));

      // 8. Update SA checklist sa3 with the actual confirmed tax saving
      const taxSavingThisItem = Math.max(0, prevTaxBalanceDue - tax.balanceDue);
      const totalSavingFromStart = Math.max(0, INITIAL_TAX_BALANCE_DUE - tax.balanceDue);

      setSAChecklist(prev => prev.map(sa => {
        if (sa.id !== 'sa3') return sa;
        const detail = allDone
          ? `All items resolved — £${totalSavingFromStart.toLocaleString()} total confirmed tax saving. Latest: ${item.description} → "${shortLabel(res)}".`
          : `${item.description} → "${shortLabel(res)}" — £${taxSavingThisItem.toLocaleString()} tax saving confirmed. 1 item still needs your input.`;
        return { ...sa, status: allDone ? 'done' as const : sa.status, detail };
      }));
    },
    chatHistory,
    addChatMessage: (sessionId, msg) =>
      setChatHistory(prev =>
        prev.map(s => s.id === sessionId
          ? { ...s, messages: [...s.messages, { ...msg, id: Math.random().toString(36).slice(2) }] }
          : s
        )
      ),
    createChatSession: (title, initialMsg) => {
      const id = Math.random().toString(36).slice(2);
      const messages = initialMsg ? [{ ...initialMsg, id: Math.random().toString(36).slice(2) }] : [];
      setChatHistory(prev => [{ id, title, date: new Date().toISOString().split('T')[0], messages }, ...prev]);
      return id;
    },
    peerCategory,
    updatePeerCategory: (data) => setPeerCategory(prev => ({ ...prev, ...data })),
    benchmarks: initialBenchmarks,
    businessIdeas,
    updateBusinessIdea: (id, updates) =>
      setBusinessIdeas(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b)),
    updateIdeaAssumption: (ideaId, key, value) =>
      setBusinessIdeas(prev => prev.map(b =>
        b.id === ideaId
          ? { ...b, editableAssumptions: b.editableAssumptions.map(a => a.key === key ? { ...a, value } : a) }
          : b
      )),
    decisionMemory,
    commitDecision: (entry) => {
      const id = Math.random().toString(36).slice(2);
      setDecisionMemory(prev => [{ ...entry, id }, ...prev]);
      setBusinessIdeas(prev => prev.map(b =>
        b.id === entry.ideaId ? { ...b, status: 'saved', committedDecisionId: id } : b
      ));
      return id;
    },
    updateDecisionMemoryStatus: (id, status) =>
      setDecisionMemory(prev => prev.map(d => d.id === id ? { ...d, status } : d)),
    updateDecisionMemoryOutcome: (id, outcome, actualPL, actualCash, actualTax) =>
      setDecisionMemory(prev => prev.map(d => d.id === id ? {
        ...d,
        actualOutcome: outcome,
        actualPLImpact: actualPL,
        actualCashImpact: actualCash,
        actualTaxImpact: actualTax,
        status: 'completed',
      } : d)),
    complianceItems: initialComplianceItems,
    saChecklist,
    updateSAChecklistItem: (id, status) =>
      setSAChecklist(prev => prev.map(i => i.id === id ? { ...i, status } : i)),
    yearEndPackGenerated,
    setYearEndPackGenerated,
    plBreakdown,           // reactive — updated by resolveInboxItem
    taxCalculation,        // reactive — updated by resolveInboxItem
    arEntries: initialAREntries,
    apEntries: initialAPEntries,
    cashBreakdown,         // reactive — persisted
    copilotTrigger,
    setCopilotTrigger,
    resetDemoData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
}
