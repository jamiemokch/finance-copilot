import { createContext, useContext, useState, ReactNode } from 'react';

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
  sourceFull: string;   // full citation
  dataPeriod: string;
  geography: string;
  peerDefinition: string;
  sampleSize: string;
  confidence: 'high' | 'medium' | 'low';
  freshness: string;
  isIllustrative: boolean; // true = sample/illustrative, false = researched external figure
  relevanceToIdea?: string; // which business idea this benchmark supports
}

// ─── Business Ideas (merged Decisions + Tax Ideas) ───────────────────────────

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
}

export interface PLExpense {
  label: string;
  amount: number;
  category: string;
  basis: string;
}

export interface PLBreakdown {
  revenues: PLRevenue[];
  expenses: PLExpense[];
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
}

export interface APEntry {
  supplier: string;
  description: string;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
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

  inboxItems: InboxItem[];
  resolveInboxItem: (id: string, resolution: string) => void;

  chatHistory: ChatSession[];
  addChatMessage: (sessionId: string, message: Omit<ChatMessage, 'id'>) => void;
  createChatSession: (title: string, initialMessage?: Omit<ChatMessage, 'id'>) => string;

  // Peer benchmarking
  peerCategory: PeerCategory | null;
  updatePeerCategory: (data: Partial<PeerCategory>) => void;
  benchmarks: BenchmarkMetric[];

  // Business Ideas (merged decisions + tax ideas)
  businessIdeas: BusinessIdea[];
  updateBusinessIdea: (id: string, updates: Partial<BusinessIdea>) => void;
  updateIdeaAssumption: (ideaId: string, key: string, value: number) => void;

  // Decision Memory
  decisionMemory: DecisionMemoryEntry[];
  commitDecision: (entry: Omit<DecisionMemoryEntry, 'id'>) => string;
  updateDecisionMemoryStatus: (id: string, status: DecisionMemoryEntry['status']) => void;

  // Compliance timeline
  complianceItems: ComplianceItem[];

  // SA Checklist
  saChecklist: SAChecklistItem[];
  updateSAChecklistItem: (id: string, status: SAChecklistItem['status']) => void;

  yearEndPackGenerated: boolean;
  setYearEndPackGenerated: (val: boolean) => void;

  // Financial drilldowns
  plBreakdown: PLBreakdown;
  taxCalculation: TaxCalculation;
  arEntries: AREntry[];
  apEntries: APEntry[];
  cashBreakdown: CashBreakdown;

  // Copilot trigger (for cross-component communication)
  copilotTrigger: string | null;
  setCopilotTrigger: (msg: string | null) => void;
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const initialProfiles: Profile[] = [
  { id: 'p1', type: 'individual', name: 'Priya (Personal)' },
  { id: 'p2', type: 'sole_trader', name: 'Design Consulting (Sole Trader)' },
];

const initialPositionItems: PositionItem[] = [
  {
    id: 'kpi1', profileId: 'p2', title: 'YTD Profit/Loss', description: 'your trading performance this year', value: '£24,500', type: 'kpi',
    basis: 'Calculated from 142 linked bank transactions minus £4,200 allowable expenses.',
    documents: ['Starling Bank Feed (Synced 2h ago)'], assumptions: ['No major unlogged cash expenses'], confidence: 'high',
  },
  {
    id: 'kpi2', profileId: 'p2', title: 'Estimated Tax', description: 'money you need to set aside', value: '£5,800', type: 'kpi',
    basis: 'Based on £24,500 trading profit + £12,000 personal property income at Basic Rate.',
    documents: [], assumptions: ['No further large equipment purchases before April 5th'], confidence: 'medium',
  },
  {
    id: 'kpi3', profileId: 'p2', title: 'Accounts Receivable', description: 'money customers still owe you', value: '£3,400', type: 'kpi',
    basis: '2 unpaid invoices matching sent records.',
    documents: ['Invoice #1042', 'Invoice #1043'], assumptions: [], confidence: 'high',
  },
  {
    id: 'kpi4', profileId: 'p2', title: 'Accounts Payable', description: 'bills you still need to pay', value: '£250', type: 'kpi',
    basis: '1 upcoming subscription and 1 pending supplier bill.',
    documents: ['Adobe Invoice', 'WeWork statement'], assumptions: [], confidence: 'high',
  },
  {
    id: 'kpi5', profileId: 'p2', title: 'Available Cash', description: 'money in your business accounts', value: '£8,240', type: 'kpi',
    basis: 'Current balance of Starling Business Account.',
    documents: ['Starling Bank Feed'], assumptions: [], confidence: 'high',
  },
  {
    id: 'f1', profileId: 'p2', title: 'VAT Status', description: 'registration details', value: 'Registered (Effective 01/04/2022)', type: 'fact',
    basis: 'Confirmed via onboarding input and verified against previous return.',
    documents: ['VAT Certificate'], assumptions: [], confidence: 'high',
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
          { label: 'Depreciation 30% p.a.', isSuggested: true },
          { label: 'Depreciation 20% p.a.' },
          { label: 'Manual input' },
        ],
      },
      { label: 'Software/Services' },
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
    aiReasoning: 'This is tagged as "meeting room hire", but it was at a restaurant/hotel location which is often classed as client entertainment (not tax deductible). If it was purely room hire, it is allowable.',
    options: [
      { label: 'Purely room hire (Allowable)', isSuggested: true },
      { label: 'Client entertainment (Disallowable)' },
    ],
  },
];

const initialTransactions: TransactionItem[] = [
  { id: 't1', date: '2024-03-01', description: 'Adobe Creative Cloud', amount: -49.99, category: 'Software', source: 'bank' },
  { id: 't2', date: '2024-03-05', description: 'Client Invoice #1042', amount: 3400, category: 'Sales', source: 'bank' },
  { id: 't3', date: '2024-03-10', description: 'WeWork Desk hire', amount: -250, category: 'Office', source: 'bank' },
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
        content: "Based on your £24,500 trading profit and £12,000 property income, you sit within the Basic Rate band. Your estimated combined income tax and NI liability for 23/24 is currently around £5,800.\n\nPlease note: this is a conservative estimate based only on the transactions we have logged. We still have 1 pending item in your Inbox that could adjust this slightly.",
        timestamp: '10:01',
      },
    ],
  },
];

// ─── Peer category & benchmarks ───────────────────────────────────────────────

const initialPeerCategory: PeerCategory = {
  id: 'pc1',
  profileId: 'p2',
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
    peerMedian: '£65,000', peerRange: '£42k–£95k', userCurrent: '~£36,500',
    userStatus: 'below',
    source: 'ONS UK Business Survey 2022 (Creative sector, <10 employees) — illustrative sample',
    sourceFull: 'Office for National Statistics, Annual Business Survey 2022, Creative Industries sub-sector, micro-businesses',
    dataPeriod: '2022',
    geography: 'UK (England)',
    peerDefinition: 'Solo / micro creative businesses, <2 employees, project-fee model, UK-registered',
    sampleSize: 'n ≈ 2,400 (ONS survey — actual figures are illustrative for prototype)',
    confidence: 'low',
    freshness: '2022 data — 2–3 years old. Live benchmark refresh is a planned feature.',
    isIllustrative: true,
    relevanceToIdea: 'bi1',
  },
  {
    id: 'b2', categoryId: 'pc1',
    label: 'Gross Margin',
    peerMedian: '72%', peerRange: '58–85%', userCurrent: '~88%',
    userStatus: 'above',
    source: 'Companies House micro-entity benchmarks 2022–23 — illustrative sample',
    sourceFull: 'Companies House / HMRC small company accounts analysis, creative sector micro-entities, 2022–23',
    dataPeriod: '2022–23',
    geography: 'UK',
    peerDefinition: 'Micro limited companies and sole traders, creative/design services, £20k–£100k revenue',
    sampleSize: 'Not disclosed (illustrative for prototype)',
    confidence: 'low',
    freshness: '2022–23 data. Live benchmark refresh is a planned feature.',
    isIllustrative: true,
    relevanceToIdea: undefined,
  },
  {
    id: 'b3', categoryId: 'pc1',
    label: 'Operating Margin',
    peerMedian: '28%', peerRange: '15–45%', userCurrent: '~67%',
    userStatus: 'above',
    source: 'ICAEW SME benchmarking data 2023 — illustrative sample',
    sourceFull: 'Institute of Chartered Accountants in England and Wales, SME Business Conditions Survey 2023, creative services segment',
    dataPeriod: '2023',
    geography: 'UK',
    peerDefinition: 'Sole trader and micro limited company design/creative consultants, B2B clients',
    sampleSize: 'Not disclosed (illustrative for prototype)',
    confidence: 'low',
    freshness: '2023 data. Live benchmark refresh is a planned feature.',
    isIllustrative: true,
    relevanceToIdea: undefined,
  },
  {
    id: 'b4', categoryId: 'pc1',
    label: 'Debtor Days',
    peerMedian: '28 days', peerRange: '14–55 days', userCurrent: '~34 days',
    userStatus: 'below',
    source: 'Xero Small Business Insights UK 2023 — illustrative sample',
    sourceFull: 'Xero Small Business Insights, UK, Q3 2023 — Services sector, <10 employees',
    dataPeriod: '2023',
    geography: 'UK',
    peerDefinition: 'UK small service businesses, B2B invoicing model, <10 employees',
    sampleSize: 'Not disclosed (illustrative for prototype)',
    confidence: 'medium',
    freshness: '2023 data. Live benchmark refresh is a planned feature.',
    isIllustrative: true,
    relevanceToIdea: 'bi2',
  },
];

// ─── Business Ideas ───────────────────────────────────────────────────────────

const initialBusinessIdeas: BusinessIdea[] = [
  {
    id: 'bi1',
    profileId: 'p2',
    category: 'hiring',
    title: 'Hire a junior designer or VA',
    summary: 'Your revenue per employee sits well below the peer median. A part-time hire could extend capacity and grow revenue — but only if the pipeline supports it.',
    triggerBenchmark: 'Revenue per Employee',
    benchmarkGap: '44% below peer median of £65,000',
    currentPosition: 'You are billing ~£36,500 this year as a solo. Peer median for Creative & Design, solo/micro category is £65,000 per employee (illustrative — see benchmark detail).',
    proposedAction: 'Hire one part-time junior designer or VA (~0.5 FTE)',
    editableAssumptions: [
      { key: 'salary', label: 'Annual salary', value: 18000, unit: '£', min: 12000, max: 30000, step: 500 },
      { key: 'revenueGrowth', label: 'Expected revenue growth', value: 35, unit: '%', min: 0, max: 100, step: 5 },
      { key: 'recruitmentCost', label: 'One-off recruitment cost', value: 1200, unit: '£', min: 0, max: 5000, step: 100 },
    ],
    whatMustBeTrue: [
      'You have a consistent pipeline of more work than you can handle alone',
      'Cash reserves can cover at least 6 months of salary before incremental revenue arrives',
      'You have capacity to manage and train a junior hire',
    ],
    source: 'Financial Memory (YTD revenue) + ONS UK Business Survey 2022 (illustrative benchmark)',
    confidence: 'medium',
    impactLabel: 'Revenue growth + tax deduction',
    status: 'new',
  },
  {
    id: 'bi2',
    profileId: 'p2',
    category: 'cash',
    title: 'Reduce debtor days',
    summary: 'Your customers are taking ~34 days to pay — 6 days above the peer median. Tighter payment terms could free up working capital immediately.',
    triggerBenchmark: 'Debtor Days',
    benchmarkGap: '6 days above peer median of 28 days',
    currentPosition: '£3,400 outstanding across 2 invoices. Current debtor days ~34. Peer median for your category is 28 days (illustrative).',
    proposedAction: 'Switch to 14-day payment terms on new contracts; automated reminders at day 10',
    editableAssumptions: [
      { key: 'targetDebtorDays', label: 'Target debtor days', value: 14, unit: 'days', min: 7, max: 30, step: 1 },
      { key: 'earlyPaymentDiscount', label: 'Early payment discount to offer', value: 0, unit: '%', min: 0, max: 3, step: 0.5 },
    ],
    whatMustBeTrue: [
      'New contract terms updated and communicated to clients',
      'Invoice template updated with new payment terms',
      'Automated reminder sequence set up',
    ],
    source: 'Financial Memory (AR balance, invoice dates) + Xero Small Business Insights UK 2023 (illustrative benchmark)',
    confidence: 'high',
    impactLabel: 'Working capital release',
    status: 'new',
  },
  {
    id: 'bi3',
    profileId: 'p2',
    category: 'assets',
    title: 'Buy a professional display before year end',
    summary: 'Annual Investment Allowance lets you deduct the full purchase price from this year\'s profit — reducing your January tax bill.',
    currentPosition: 'You use a standard laptop. A professional display (£800–£1,500) qualifies for AIA — the full cost is deductible in the year of purchase under current HMRC rules.',
    proposedAction: 'Purchase a professional display before 5 April 2024 to claim in the 23/24 return',
    editableAssumptions: [
      { key: 'purchasePrice', label: 'Purchase price', value: 1100, unit: '£', min: 500, max: 2500, step: 50 },
    ],
    whatMustBeTrue: [
      'You genuinely need the asset for business use (HMRC "wholly and exclusively" test)',
      'Profits are sufficient to benefit from the deduction',
      'Purchase must be made before 5 April 2024',
    ],
    source: 'HMRC Capital Allowances — Annual Investment Allowance 2023/24 (gov.uk)',
    confidence: 'high',
    impactLabel: 'Tax saving via AIA deduction',
    deadlines: ['Purchase before 5 April 2024'],
    status: 'new',
  },
  {
    id: 'bi4',
    profileId: 'p2',
    category: 'tax',
    title: 'Claim Working From Home allowance',
    summary: 'Working from home regularly qualifies you for HMRC\'s flat-rate WFH allowance — a simple annual claim that reduces your taxable profit.',
    currentPosition: 'You work from home approximately 4 days per week. HMRC\'s flat rate applies when you work from home 25+ hours/month and covers a proportion of household costs.',
    proposedAction: 'Claim HMRC flat-rate WFH allowance in your Self-Assessment return',
    editableAssumptions: [
      { key: 'daysPerWeek', label: 'Days working from home per week', value: 4, unit: 'days', min: 1, max: 5, step: 1 },
    ],
    whatMustBeTrue: [
      'You genuinely work from home those days (keep a log if HMRC requests evidence)',
      'No separate rented office — the allowance reduces if you also rent workspace',
      'Must be claimed in your Self-Assessment return by the filing deadline',
    ],
    source: 'HMRC EIM32760 — Working from Home expenses, flat-rate allowances 2023/24 (gov.uk)',
    confidence: 'high',
    impactLabel: 'Tax saving via WFH allowance',
    deadlines: ['Claim in Self-Assessment by 31 Jan 2025'],
    status: 'new',
  },
  {
    id: 'bi5',
    profileId: 'p2',
    category: 'tax',
    title: 'Accelerate planned equipment purchase',
    summary: 'If you\'re planning equipment purchases anyway, buying before 5 April brings the tax deduction forward — reducing this year\'s bill rather than next year\'s.',
    currentPosition: 'You have room in your basic rate band. Any equipment purchased before year-end is fully deductible via Annual Investment Allowance (up to £1m/yr).',
    proposedAction: 'Bring forward planned equipment purchases to before 5 April 2024',
    editableAssumptions: [
      { key: 'equipmentBudget', label: 'Equipment budget', value: 1100, unit: '£', min: 500, max: 5000, step: 100 },
    ],
    whatMustBeTrue: [
      'You genuinely intend to make these purchases — not solely for tax purposes',
      'Your profits this year are sufficient to benefit from the deduction',
      'Purchase must be made before 5 April 2024',
    ],
    source: 'HMRC Capital Allowances — AIA 2023/24 (gov.uk)',
    confidence: 'medium',
    impactLabel: 'Tax saving — timing benefit',
    deadlines: ['Purchase before 5 April 2024'],
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
    documentsRequired: ['UTR number'],
    actionsRequired: [],
  },
  {
    id: 'c2', profileId: 'p2',
    title: 'Self-Assessment Tax Return 2023/24',
    description: 'Annual self-assessment return covering trading income, property income, and NI contributions.',
    dueDate: '2025-01-31', preparationLeadDays: 60, status: 'due-soon',
    responsibleParty: 'client', category: 'filing', periodCovered: '6 Apr 2023 – 5 Apr 2024',
    documentsRequired: ['P60 (if any PAYE)', 'Rental income statements', 'Business income & expense summary', 'Bank statements'],
    actionsRequired: ['Complete SA100 and SA103 supplementary pages', 'Declare rental income on SA105', 'Submit online by 31 Jan 2025'],
  },
  {
    id: 'c3', profileId: 'p2',
    title: 'Payment on Account 1 (2024/25)',
    description: 'First advance payment towards your 2024/25 tax liability, equal to 50% of last year\'s bill.',
    dueDate: '2025-01-31', preparationLeadDays: 30, status: 'due-soon',
    responsibleParty: 'client', category: 'tax', periodCovered: '2024/25 advance',
    documentsRequired: [],
    actionsRequired: ['Pay 50% of estimated 24/25 liability — currently estimated ~£2,900'],
  },
  {
    id: 'c4', profileId: 'p2',
    title: 'Payment on Account 2 (2024/25)',
    description: 'Second advance payment towards your 2024/25 tax liability.',
    dueDate: '2025-07-31', preparationLeadDays: 30, status: 'upcoming',
    responsibleParty: 'client', category: 'tax', periodCovered: '2024/25 advance',
    documentsRequired: [],
    actionsRequired: ['Pay remaining 50% of estimated 24/25 liability'],
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
    documentsRequired: [],
    actionsRequired: ['Platform prepares draft from linked bank data', 'User reviews and approves before submission'],
  },
];

// ─── SA Checklist ─────────────────────────────────────────────────────────────

const initialSAChecklist: SAChecklistItem[] = [
  { id: 'sa1', profileId: 'p2', label: 'Personal details verified', detail: 'UTR, NI number, address confirmed against HMRC records.', status: 'done', category: 'data' },
  { id: 'sa2', profileId: 'p2', label: 'Bank reconciliation complete', detail: 'All synced accounts balance — 142 transactions matched.', status: 'done', category: 'data' },
  { id: 'sa3', profileId: 'p2', label: 'Resolve Inbox items (2 pending)', detail: 'Apple Store £1,249 and meeting room £150 need classification before tax figure is final.', status: 'pending', category: 'inbox' },
  { id: 'sa4', profileId: 'p2', label: 'Upload missing receipts', detail: '3 transactions over £100 have no linked receipt in your records.', status: 'pending', category: 'data' },
  { id: 'sa5', profileId: 'p2', label: 'Confirm rental income figures', detail: 'Q3 letting agent statement not yet uploaded — rental profit estimate may change.', status: 'pending', category: 'data' },
  { id: 'sa6', profileId: 'p2', label: 'Complete SA100 & SA103 forms', detail: 'Self-assessment form and self-employment supplementary pages.', status: 'pending', category: 'filing' },
  { id: 'sa7', profileId: 'p2', label: 'Submit return by 31 Jan 2025', detail: 'Online filing deadline for 2023/24 tax year.', status: 'pending', category: 'filing' },
  { id: 'sa8', profileId: 'p2', label: 'Pay balance + first payment on account', detail: '~£5,800 balance due + ~£2,900 first PoA — both due 31 Jan 2025.', status: 'pending', category: 'payment' },
];

// ─── Financial drilldown data ─────────────────────────────────────────────────

const initialPLBreakdown: PLBreakdown = {
  revenues: [
    { label: 'Design project fees', amount: 31200, basis: 'Client invoices #1001–#1042, 18 projects' },
    { label: 'Retainer — Axiom Agency', amount: 7200, basis: 'Monthly £600 retainer, 12 months' },
    { label: 'Stock illustration licensing', amount: 1400, basis: '2 licensing agreements' },
  ],
  expenses: [
    { label: 'Adobe Creative Cloud', amount: 600, category: 'Software & subscriptions', basis: 'Monthly £49.99 × 12' },
    { label: 'WeWork hot-desk membership', amount: 2400, category: 'Office & workspace', basis: 'Monthly £200 × 12' },
    { label: 'Professional indemnity insurance', amount: 780, category: 'Insurance', basis: 'Annual premium' },
    { label: 'Accountancy & bookkeeping (prior year)', amount: 600, category: 'Professional fees', basis: 'Invoice from previous accountant' },
    { label: 'Travel (client meetings)', amount: 420, category: 'Travel', basis: '15 journeys — rail and TfL receipts' },
    { label: 'Apple Store purchase (pending classification)', amount: 1249, category: 'Pending — Inbox', basis: 'See Inbox item for resolution' },
    { label: 'Client meeting room hire', amount: 150, category: 'Pending — Inbox', basis: 'See Inbox item for resolution' },
  ],
};

const initialTaxCalculation: TaxCalculation = {
  lines: [
    { label: 'Trading profit (Design Consulting)', amount: '£36,800', note: 'Revenue £39,800 less allowable expenses £3,000 (pending 2 Inbox items)' },
    { label: 'Property rental profit', amount: '£10,200', note: 'Gross rental £12,000 less letting agent fees £1,800' },
    { label: 'Personal allowance', amount: '-£12,570', note: 'Standard 2023/24 personal allowance' },
    { label: 'Taxable income', amount: '£34,430', note: '£36,800 + £10,200 – £12,570' },
    { label: 'Income tax (Basic Rate 20%)', amount: '£4,886', note: '£34,430 × 20%' },
    { label: 'Class 4 NI (9% on profits £12,570–£50,270)', amount: '£2,191', note: '£24,230 × 9%' },
    { label: 'Class 2 NI', amount: '£179', note: 'Flat rate 2023/24' },
    { label: 'Total estimated liability', amount: '£7,256' },
    { label: 'Less: Payments on account already made', amount: '-£1,456', note: 'Prior year payments on account' },
    { label: 'Balance due 31 Jan 2025', amount: '~£5,800' },
  ],
  unresolvedItems: [
    'Apple Store £1,249 (Inbox) — if Hardware: capital adjustment; if Software: fully deductible — could change tax by up to £250',
    'Meeting room £150 (Inbox) — if disallowable: adds ~£30 to tax bill',
  ],
  assumptions: [
    'Trading profit figure excludes the 2 pending Inbox items',
    'No further equipment purchases before 5 April 2024',
    'Student Loan repayment not shown (handled via HMRC separately)',
  ],
  taxBasis: 'UK Income Tax and National Insurance 2023/24 — Basic Rate band',
};

const initialAREntries: AREntry[] = [
  { customer: 'Axiom Agency', invoiceRef: '#1042', amount: 2400, dueDate: '2024-03-25', isOverdue: true, daysOverdue: 7 },
  { customer: 'Studio Nine Ltd', invoiceRef: '#1043', amount: 1000, dueDate: '2024-04-05', isOverdue: false },
];

const initialAPEntries: APEntry[] = [
  { supplier: 'Adobe Inc', description: 'Creative Cloud monthly', amount: 49.99, dueDate: '2024-04-01', isOverdue: false },
  { supplier: 'WeWork', description: 'Hot-desk April', amount: 200, dueDate: '2024-04-07', isOverdue: false },
];

const initialCashBreakdown: CashBreakdown = {
  accounts: [
    { name: 'Starling Business', balance: 7840, type: 'business' },
    { name: 'Personal Current (Monzo)', balance: 2100, type: 'personal' },
  ],
  taxReserve: 2900,
  nearTermInflows: [
    { label: 'Axiom Agency Invoice #1042', amount: 2400, expectedDate: '2024-03-30' },
  ],
  nearTermOutflows: [
    { label: 'Adobe Creative Cloud', amount: 49.99, expectedDate: '2024-04-01' },
    { label: 'WeWork April', amount: 200, expectedDate: '2024-04-07' },
    { label: 'Tax reserve top-up', amount: 500, expectedDate: '2024-04-15' },
  ],
};

// ─── Context ──────────────────────────────────────────────────────────────────

const StoreContext = createContext<AppState | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [activeProfileId, setActiveProfileId] = useState('p2');
  const [sharedContext, setSharedContext] = useState<SharedContext>({
    name: 'Priya Shah', address: 'Flat 4, London, E8 2PC', utr: '1234567890', niNumber: 'AB123456C',
  });
  const [positionItems] = useState(initialPositionItems);
  const [inboxItems, setInboxItems] = useState(initialInboxItems);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [chatHistory, setChatHistory] = useState(initialChatHistory);
  const [yearEndPackGenerated, setYearEndPackGenerated] = useState(false);
  const [peerCategory, setPeerCategory] = useState<PeerCategory>(initialPeerCategory);
  const [businessIdeas, setBusinessIdeas] = useState(initialBusinessIdeas);
  const [decisionMemory, setDecisionMemory] = useState<DecisionMemoryEntry[]>([]);
  const [saChecklist, setSAChecklist] = useState(initialSAChecklist);
  const [copilotTrigger, setCopilotTrigger] = useState<string | null>(null);

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
    inboxItems,
    resolveInboxItem: (id, res) =>
      setInboxItems(prev => prev.map(i => i.id === id ? { ...i, status: 'resolved', customAnswer: res } : i)),
    chatHistory,
    addChatMessage: (sessionId, msg) =>
      setChatHistory(prev =>
        prev.map(s =>
          s.id === sessionId
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

    // Peer benchmarking
    peerCategory,
    updatePeerCategory: (data) => setPeerCategory(prev => ({ ...prev, ...data })),
    benchmarks: initialBenchmarks,

    // Business Ideas
    businessIdeas,
    updateBusinessIdea: (id, updates) =>
      setBusinessIdeas(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b)),
    updateIdeaAssumption: (ideaId, key, value) =>
      setBusinessIdeas(prev => prev.map(b =>
        b.id === ideaId
          ? { ...b, editableAssumptions: b.editableAssumptions.map(a => a.key === key ? { ...a, value } : a) }
          : b
      )),

    // Decision Memory
    decisionMemory,
    commitDecision: (entry) => {
      const id = Math.random().toString(36).slice(2);
      setDecisionMemory(prev => [{ ...entry, id }, ...prev]);
      // Mark the idea as saved
      setBusinessIdeas(prev => prev.map(b =>
        b.id === entry.ideaId ? { ...b, status: 'saved', committedDecisionId: id } : b
      ));
      return id;
    },
    updateDecisionMemoryStatus: (id, status) =>
      setDecisionMemory(prev => prev.map(d => d.id === id ? { ...d, status } : d)),

    // Compliance
    complianceItems: initialComplianceItems,

    // SA Checklist
    saChecklist,
    updateSAChecklistItem: (id, status) =>
      setSAChecklist(prev => prev.map(i => i.id === id ? { ...i, status } : i)),

    yearEndPackGenerated,
    setYearEndPackGenerated,

    // Drilldowns (static for prototype)
    plBreakdown: initialPLBreakdown,
    taxCalculation: initialTaxCalculation,
    arEntries: initialAREntries,
    apEntries: initialAPEntries,
    cashBreakdown: initialCashBreakdown,

    // Copilot cross-component trigger
    copilotTrigger,
    setCopilotTrigger,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
}
