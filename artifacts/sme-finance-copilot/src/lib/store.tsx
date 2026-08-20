import { createContext, useContext, useState, ReactNode } from 'react';

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
}

const initialProfiles: Profile[] = [
  { id: 'p1', type: 'individual', name: 'Priya (Personal)' },
  { id: 'p2', type: 'sole_trader', name: 'Design Consulting (Sole Trader)' }
];

const initialPositionItems: PositionItem[] = [
  { 
    id: 'kpi1', profileId: 'p2', title: 'YTD Profit/Loss', description: 'your trading performance this year', value: '£24,500', type: 'kpi', 
    basis: 'Calculated from 142 linked bank transactions minus £4,200 allowable expenses.',
    documents: ['Starling Bank Feed (Synced 2h ago)'], assumptions: ['No major unlogged cash expenses'], confidence: 'high'
  },
  { 
    id: 'kpi2', profileId: 'p2', title: 'Estimated Tax', description: 'money you need to set aside', value: '£5,800', type: 'kpi',
    basis: 'Based on £24,500 trading profit + £12,000 personal property income at Basic Rate.',
    documents: [], assumptions: ['No further large equipment purchases before April 5th'], confidence: 'medium'
  },
  { 
    id: 'kpi3', profileId: 'p2', title: 'Accounts Receivable', description: 'money customers still owe you', value: '£3,400', type: 'kpi',
    basis: '2 unpaid invoices matching sent records.',
    documents: ['Invoice #1042', 'Invoice #1043'], assumptions: [], confidence: 'high'
  },
  { 
    id: 'kpi4', profileId: 'p2', title: 'Accounts Payable', description: 'bills you still need to pay', value: '£250', type: 'kpi',
    basis: '1 upcoming subscription and 1 pending supplier bill.',
    documents: ['Adobe Invoice', 'WeWork statement'], assumptions: [], confidence: 'high'
  },
  { 
    id: 'kpi5', profileId: 'p2', title: 'Available Cash', description: 'money in your business accounts', value: '£8,240', type: 'kpi',
    basis: 'Current balance of Starling Business Account.',
    documents: ['Starling Bank Feed'], assumptions: [], confidence: 'high'
  },
  { 
    id: 'f1', profileId: 'p2', title: 'VAT Status', description: 'registration details', value: 'Registered (Effective 01/04/2022)', type: 'fact',
    basis: 'Confirmed via onboarding input and verified against previous return.',
    documents: ['VAT Certificate'], assumptions: [], confidence: 'high'
  }
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
          { label: 'Manual input' }
        ]
      },
      { label: 'Software/Services' }
    ]
  },
  { 
    id: '2', profileId: 'p1', date: '2023-12-01', description: 'Missing Q3 rental statement', status: 'pending',
    aiReasoning: 'I see a regular incoming payment of £1,000 from "Foxtons Letting", but I do not have the statement detailing any management fees deducted before you received this.',
    options: [
      { label: 'I will upload it later' },
      { label: 'Ignore (I will enter gross figures manually)' }
    ]
  },
  { 
    id: '3', profileId: 'p2', date: '2024-01-10', description: 'Client meeting room hire', amount: 150.00, status: 'pending',
    aiReasoning: 'This is tagged as "meeting room hire", but it was at a restaurant/hotel location which is often classed as client entertainment (not tax deductible). If it was purely room hire, it is allowable.',
    options: [
      { label: 'Purely room hire (Allowable)', isSuggested: true },
      { label: 'Client entertainment (Disallowable)' }
    ]
  }
];

const initialTaxIdeas: TaxIdea[] = [
  { 
    id: '1', profileId: 'p2', title: 'Claim Working From Home Allowance', 
    description: 'Since you work 4 days a week from home, you can claim a portion of your household bills or a flat rate to reduce your taxable profit.', 
    impact: '~£312 tax saved', confidence: 'high', status: 'new',
    assumptions: ['You do not have a separate dedicated office space outside your home.'],
    missingData: ['Actual household utility bills for the year (if claiming apportioned method)'],
    deadlines: ['Action before 31 Jan 2025 (Self-Assessment deadline)']
  },
  { 
    id: '2', profileId: 'p2', title: 'Accelerate Equipment Purchases', 
    description: 'You have room in your basic rate band. Buying planned equipment before April 5th will reduce this year\'s tax bill.', 
    impact: 'Up to £900 tax delayed/saved', confidence: 'medium', status: 'new',
    assumptions: ['You intend to make equipment purchases soon anyway.'],
    deadlines: ['Must purchase before 5 April 2024']
  }
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
      { id: 'm2', role: 'system', content: 'Based on your £24,500 trading profit and £12,000 property income, you sit within the Basic Rate band. Your estimated combined income tax and NI liability for 23/24 is currently around £5,800. \n\nPlease note: this is a conservative estimate based only on the transactions we have logged. We still have 1 pending item in your Inbox that could adjust this slightly.', timestamp: '10:01' }
    ]
  }
];

const StoreContext = createContext<AppState | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [activeProfileId, setActiveProfileId] = useState('p2');
  const [sharedContext, setSharedContext] = useState<SharedContext>({
    name: 'Priya Shah', address: 'Flat 4, London, E8 2PC', utr: '1234567890', niNumber: 'AB123456C'
  });
  const [positionItems, setPositionItems] = useState(initialPositionItems);
  const [inboxItems, setInboxItems] = useState(initialInboxItems);
  const [taxIdeas, setTaxIdeas] = useState(initialTaxIdeas);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [chatHistory, setChatHistory] = useState(initialChatHistory);
  const [yearEndPackGenerated, setYearEndPackGenerated] = useState(false);

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
    addTransaction: (transaction) => setTransactions(prev => [{ ...transaction, id: Math.random().toString() }, ...prev]),
    inboxItems,
    resolveInboxItem: (id, res) => setInboxItems(prev => prev.map(i => i.id === id ? { ...i, status: 'resolved', customAnswer: res } : i)),
    taxIdeas,
    updateTaxIdeaStatus: (id, status) => setTaxIdeas(prev => prev.map(t => t.id === id ? { ...t, status } : t)),
    chatHistory,
    addChatMessage: (sessionId, msg) => setChatHistory(prev => prev.map(s => s.id === sessionId ? { ...s, messages: [...s.messages, { ...msg, id: Math.random().toString() }] } : s)),
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
      deadline: '31 Jan 2025'
    }
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
}
