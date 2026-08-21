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

export interface TaxIdea {
  id: string;
  profileId: string;
  title: string;
  description: string;
  impact: string;
  confidence: 'high' | 'medium' | 'low';
  status: 'new' | 'saved' | 'dismissed' | 'actioned';
  assumptions: string[];
  missingData?: string[];
  deadlines?: string[];
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
  dataPeriod: string;
  geography: string;
  confidence: 'high' | 'medium' | 'low';
  freshness: string;
}

// ─── Decision cards ───────────────────────────────────────────────────────────

export interface DecisionScenario {
  label: string;
  cashImpactOneOff: string;
  cashImpactOngoing: string;
  plImpact: string;
  taxImpact: string;
  benchmarkEffect: string;
  paybackPeriod: string;
  downsideCase: string;
}

export interface DecisionCard {
  id: string;
  profileId: string;
  title: string;
  category: 'hiring' | 'asset' | 'pricing' | 'collection' | 'cost' | 'timing';
  summary: string;
  triggerBenchmark?: string;
  currentPosition: string;
  proposedAction: string;
  scenarios: DecisionScenario[];
  assumptions: string[];
  confidence: 'high' | 'medium' | 'low';
  whatMustBeTrue: string[];
  status: 'new' | 'comparing' | 'saved' | 'actioned' | 'dismissed';
  savedDecision?: string;
  savedRationale?: string;
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

  taxIdeas: TaxIdea[];
  updateTaxIdeaStatus: (id: string, status: TaxIdea['status']) => void;

  chatHistory: ChatSession[];
  addChatMessage: (sessionId: string, message: Omit<ChatMessage, 'id'>) => void;
  createChatSession: (title: string, initialMessage?: Omit<ChatMessage, 'id'>) => string;

  yearEndPackGenerated: boolean;
  setYearEndPackGenerated: (val: boolean) => void;
  yearEndReadiness: {
    evidenceMissing: number;
    tasksRemaining: number;
    deadline: string;
  };

  // Peer benchmarking
  peerCategory: PeerCategory | null;
  updatePeerCategory: (data: Partial<PeerCategory>) => void;
  benchmarks: BenchmarkMetric[];

  // Decision cards
  decisionCards: DecisionCard[];
  updateDecisionCard: (id: string, updates: Partial<DecisionCard>) => void;

  // Compliance timeline
  complianceItems: ComplianceItem[];

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

const initialTaxIdeas: TaxIdea[] = [
  {
    id: '1', profileId: 'p2', title: 'Claim Working From Home Allowance',
    description: 'Since you work 4 days a week from home, you can claim a portion of your household bills or a flat rate to reduce your taxable profit.',
    impact: '~£312 tax saved', confidence: 'high', status: 'new',
    assumptions: ['You do not have a separate dedicated office space outside your home.'],
    missingData: ['Actual household utility bills for the year (if claiming apportioned method)'],
    deadlines: ['Action before 31 Jan 2025 (Self-Assessment deadline)'],
  },
  {
    id: '2', profileId: 'p2', title: 'Accelerate Equipment Purchases',
    description: "You have room in your basic rate band. Buying planned equipment before April 5th will reduce this year's tax bill.",
    impact: 'Up to £900 tax delayed/saved', confidence: 'medium', status: 'new',
    assumptions: ['You intend to make equipment purchases soon anyway.'],
    deadlines: ['Must purchase before 5 April 2024'],
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
  geography: 'UK (London & South East)',
  sizeBand: 'Solo / 1–2 employees',
  customerType: 'B2B (Agency & Corporate clients)',
  revenueModel: 'Project fees + retainers',
  reviewedByUser: false,
};

const initialBenchmarks: BenchmarkMetric[] = [
  {
    id: 'b1', categoryId: 'pc1', label: 'Revenue per Employee',
    peerMedian: '£65,000', peerRange: '£42k–£95k', userCurrent: '~£36,500',
    userStatus: 'below',
    source: 'Sample — ONS UK Business Survey 2022 (Creative sector, <10 employees)',
    dataPeriod: '2022', geography: 'UK', confidence: 'medium',
    freshness: '2022 data — live refresh is a future feature',
  },
  {
    id: 'b2', categoryId: 'pc1', label: 'Gross Margin',
    peerMedian: '72%', peerRange: '58–85%', userCurrent: '~88%',
    userStatus: 'above',
    source: 'Sample — Companies House micro-entity benchmarks 2022–23',
    dataPeriod: '2022–23', geography: 'UK', confidence: 'medium',
    freshness: '2022–23 data — live refresh is a future feature',
  },
  {
    id: 'b3', categoryId: 'pc1', label: 'Operating Margin',
    peerMedian: '28%', peerRange: '15–45%', userCurrent: '~67%',
    userStatus: 'above',
    source: 'Sample — ICAEW SME benchmarking data 2023',
    dataPeriod: '2023', geography: 'UK', confidence: 'medium',
    freshness: '2023 data — live refresh is a future feature',
  },
  {
    id: 'b4', categoryId: 'pc1', label: 'Debtor Days',
    peerMedian: '28 days', peerRange: '14–55 days', userCurrent: '~34 days',
    userStatus: 'below',
    source: 'Sample — Xero Small Business Insights UK 2023',
    dataPeriod: '2023', geography: 'UK', confidence: 'high',
    freshness: '2023 data — live refresh is a future feature',
  },
];

// ─── Decision cards ───────────────────────────────────────────────────────────

const initialDecisionCards: DecisionCard[] = [
  {
    id: 'd1', profileId: 'p2', category: 'hiring',
    title: 'Hire a junior designer / VA',
    summary: 'Your revenue per employee sits below the peer median. Taking on one part-time hire could extend capacity and grow revenue without proportionally growing costs.',
    triggerBenchmark: 'Revenue per Employee',
    currentPosition: 'You are billing ~£36,500 this year as a solo. Peer median for your category is £65,000 per employee.',
    proposedAction: 'Hire one part-time junior designer or VA at ~£18,000/yr (0.5 FTE)',
    scenarios: [
      {
        label: 'Base case (revenue grows 35%)',
        cashImpactOneOff: '-£1,200 (recruitment, onboarding)',
        cashImpactOngoing: '-£18,000/yr salary, +£12,750 incremental revenue = net -£5,250 in year 1',
        plImpact: 'Salary is fully deductible — reduces taxable profit by £18,000',
        taxImpact: 'Tax saving ~£3,600 in year 1 (basic rate 20%)',
        benchmarkEffect: 'Revenue per employee moves from £36,500 to ~£49,250 — narrows gap to peer median',
        paybackPeriod: '~18 months if revenue grows as projected',
        downsideCase: 'If revenue does not grow, net cost is £18,000/yr. Ensure you have 6 months of salary in reserves before hiring.',
      },
      {
        label: 'Conservative case (revenue grows 15%)',
        cashImpactOneOff: '-£1,200',
        cashImpactOngoing: '-£18,000/yr salary, +£5,475 incremental revenue = net -£12,525/yr',
        plImpact: 'Still tax-deductible — saves ~£3,600 in tax',
        taxImpact: 'Tax saving ~£3,600',
        benchmarkEffect: 'Revenue per employee reaches ~£42,975 — approaches peer lower quartile',
        paybackPeriod: 'Breakeven requires ~30% revenue growth',
        downsideCase: 'Cash buffer required: £12,525/yr shortfall. With current £8,240 cash, runway is ~8 months before needing new revenue.',
      },
    ],
    assumptions: ['Revenue will grow proportionally with added capacity', 'Salary at £18,000 for 0.5 FTE junior', 'You retain existing clients throughout the transition'],
    confidence: 'medium',
    whatMustBeTrue: ['You have a consistent pipeline of more work than you can handle alone', 'Your cash reserves can cover at least 6 months of salary before incremental revenue arrives'],
    status: 'new',
  },
  {
    id: 'd2', profileId: 'p2', category: 'collection',
    title: 'Reduce debtor days',
    summary: 'Your customers take ~34 days to pay on average — slightly above the peer median of 28 days. Tightening payment terms could free up ~£700 in working capital.',
    triggerBenchmark: 'Debtor Days',
    currentPosition: '£3,400 outstanding across 2 invoices. Current debtor days ~34. Peer median is 28 days.',
    proposedAction: 'Switch to 14-day payment terms on new contracts; send payment reminders at day 10',
    scenarios: [
      {
        label: 'Tighten terms to 14 days',
        cashImpactOneOff: '+£700 cash freed immediately (estimated early collection)',
        cashImpactOngoing: '+£700 permanent improvement in working capital cycle',
        plImpact: 'No direct P&L impact',
        taxImpact: 'No direct tax impact',
        benchmarkEffect: 'Debtor days moves from ~34 to ~20 — above peer median',
        paybackPeriod: 'Immediate — within 1 billing cycle',
        downsideCase: 'Some clients may push back on shorter terms. Offer a 2% early-payment discount as incentive if needed.',
      },
    ],
    assumptions: ['Existing clients will accept updated terms', 'No bad debts on current outstanding invoices'],
    confidence: 'high',
    whatMustBeTrue: ['New contract terms updated', 'Invoice template and payment reminder sequence set up'],
    status: 'new',
  },
  {
    id: 'd3', profileId: 'p2', category: 'asset',
    title: 'Buy a professional display before year end',
    summary: 'A professional display qualifies for Annual Investment Allowance, reducing your tax bill this year. Must be purchased before 5 April 2024.',
    currentPosition: 'You use a standard laptop. Professional displays (£800–£1,500) are standard in your peer category and fully deductible in year of purchase under AIA.',
    proposedAction: 'Purchase a professional display (e.g. £1,100) before 5 April 2024',
    scenarios: [
      {
        label: 'Purchase before year end',
        cashImpactOneOff: '-£1,100 cash',
        cashImpactOngoing: 'No ongoing cost',
        plImpact: 'Full £1,100 deducted from taxable profit via AIA',
        taxImpact: '-£220 tax liability this year (basic rate 20%)',
        benchmarkEffect: 'Not directly benchmarked — quality improvement for colour-critical work',
        paybackPeriod: 'Tax saving is immediate (in your Jan 2025 return). Equipment payback depends on productivity gain.',
        downsideCase: 'If profits fall below the basic rate threshold, tax saving reduces. Verify your profit estimate before purchase.',
      },
    ],
    assumptions: ['Your profits remain ~£24,500 for the year', 'Purchase made before 5 April 2024'],
    confidence: 'high',
    whatMustBeTrue: ['You genuinely need the asset for business use', 'Profits are sufficient to absorb the expense'],
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
    'Apple Store £1,249 (Inbox) — if Hardware: small capital adjustment; if Software: deductible in full — could change tax by up to £250',
    'Meeting room £150 (Inbox) — if disallowable: adds ~£30 to tax bill',
  ],
  assumptions: [
    'Trading profit figure excludes the 2 pending Inbox items',
    'No further equipment purchases before 5 April 2024',
    'Student Loan repayment not shown (repaid via HMRC separately)',
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
  const [taxIdeas, setTaxIdeas] = useState(initialTaxIdeas);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [chatHistory, setChatHistory] = useState(initialChatHistory);
  const [yearEndPackGenerated, setYearEndPackGenerated] = useState(false);
  const [peerCategory, setPeerCategory] = useState<PeerCategory>(initialPeerCategory);
  const [decisionCards, setDecisionCards] = useState(initialDecisionCards);
  const [copilotTrigger, setCopilotTrigger] = useState<string | null>(null);

  const value: AppState = {
    profiles,
    activeProfileId,
    setActiveProfileId,
    addProfile: (p) => {
      const id = Math.random().toString();
      setProfiles(prev => [...prev, { ...p, id }]);
      return id;
    },
    sharedContext,
    updateSharedContext: (data) => setSharedContext(prev => ({ ...prev, ...data })),
    positionItems,
    transactions,
    addTransaction: (transaction) =>
      setTransactions(prev => [{ ...transaction, id: Math.random().toString() }, ...prev]),
    inboxItems,
    resolveInboxItem: (id, res) =>
      setInboxItems(prev => prev.map(i => i.id === id ? { ...i, status: 'resolved', customAnswer: res } : i)),
    taxIdeas,
    updateTaxIdeaStatus: (id, status) =>
      setTaxIdeas(prev => prev.map(t => t.id === id ? { ...t, status } : t)),
    chatHistory,
    addChatMessage: (sessionId, msg) =>
      setChatHistory(prev =>
        prev.map(s =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, { ...msg, id: Math.random().toString() }] }
            : s
        )
      ),
    createChatSession: (title, initialMsg) => {
      const id = Math.random().toString();
      const messages = initialMsg ? [{ ...initialMsg, id: Math.random().toString() }] : [];
      setChatHistory(prev => [{ id, title, date: new Date().toISOString().split('T')[0], messages }, ...prev]);
      return id;
    },
    yearEndPackGenerated,
    setYearEndPackGenerated,
    yearEndReadiness: {
      evidenceMissing: 2,
      tasksRemaining: inboxItems.filter(i => i.status === 'pending').length + 2,
      deadline: '31 Jan 2025',
    },

    // Peer benchmarking
    peerCategory,
    updatePeerCategory: (data) => setPeerCategory(prev => ({ ...prev, ...data })),
    benchmarks: initialBenchmarks,

    // Decision cards
    decisionCards,
    updateDecisionCard: (id, updates) =>
      setDecisionCards(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d)),

    // Compliance
    complianceItems: initialComplianceItems,

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
