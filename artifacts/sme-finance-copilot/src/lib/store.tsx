import { createContext, useContext, useState, ReactNode } from 'react';

export type ProfileType = 'individual' | 'sole_trader' | 'micro_company' | null;

export interface MemoryItem {
  id: string;
  category: 'personal' | 'business' | 'tax' | 'property';
  title: string;
  value: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

export interface ExceptionItem {
  id: string;
  date: string;
  description: string;
  amount?: number;
  status: 'unresolved' | 'resolved' | 'dismissed';
  type: 'ambiguity' | 'missing_info' | 'judgement';
}

export interface OptimisationItem {
  id: string;
  title: string;
  description: string;
  impact: number;
  confidence: 'high' | 'medium' | 'low';
  status: 'new' | 'saved' | 'dismissed' | 'actioned';
  assumptions: string[];
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
  profileType: ProfileType;
  setProfileType: (type: ProfileType) => void;
  memories: MemoryItem[];
  updateMemory: (id: string, value: string) => void;
  addMemory: (item: Omit<MemoryItem, 'id'>) => void;
  exceptions: ExceptionItem[];
  updateExceptionStatus: (id: string, status: ExceptionItem['status']) => void;
  addException: (item: Omit<ExceptionItem, 'id'>) => void;
  optimisations: OptimisationItem[];
  updateOptimisationStatus: (id: string, status: OptimisationItem['status']) => void;
  transactions: TransactionItem[];
  addTransaction: (item: Omit<TransactionItem, 'id'>) => void;
  yearEndReadiness: {
    evidenceMissing: number;
    tasksRemaining: number;
    deadline: string;
  };
}

const initialMemories: MemoryItem[] = [
  { id: '1', category: 'personal', title: 'Name', value: 'Priya Shah', confidence: 'high', source: 'Onboarding' },
  { id: '2', category: 'personal', title: 'Age', value: '34', confidence: 'high', source: 'HMRC Record' },
  { id: '3', category: 'business', title: 'Trading Status', value: 'Sole Trader (Design Consultant)', confidence: 'high', source: 'Onboarding' },
  { id: '4', category: 'business', title: 'VAT Registered', value: 'Yes, effective 01/04/2022', confidence: 'high', source: 'Tax Office' },
  { id: '5', category: 'property', title: 'Rental Property', value: 'Flat 4, E8 2PC', confidence: 'high', source: 'Land Registry' },
  { id: '6', category: 'tax', title: 'Student Loan', value: 'Plan 2', confidence: 'medium', source: 'Previous Return' },
];

const initialExceptions: ExceptionItem[] = [
  { id: '1', date: '2023-11-15', description: 'Payment to "Apple Store" - Hardware (capital) or software (expense)?', amount: 1249.00, status: 'unresolved', type: 'ambiguity' },
  { id: '2', date: '2023-12-01', description: 'Missing Q3 rental statement from letting agent', status: 'unresolved', type: 'missing_info' },
  { id: '3', date: '2024-01-10', description: 'Client entertainment - typically not allowable, but tagged as "meeting room hire"', amount: 150.00, status: 'unresolved', type: 'judgement' },
];

const initialOptimisations: OptimisationItem[] = [
  { 
    id: '1', 
    title: 'Claim Use of Home as Office', 
    description: 'Based on your memory showing 4 days/week working from home, you can claim a flat rate or apportioned bills.', 
    impact: 312, 
    confidence: 'high', 
    status: 'new',
    assumptions: ['You work 100+ hours per month from home', 'No dedicated office outside home']
  },
  { 
    id: '2', 
    title: 'Pre-year-end Equipment Purchase', 
    description: 'You have £4,500 of lower-rate band remaining. Purchasing planned equipment before April 5th will accelerate tax relief.', 
    impact: 900, 
    confidence: 'medium', 
    status: 'new',
    assumptions: ['You plan to buy equipment soon', 'Your profits remain stable']
  }
];

const initialTransactions: TransactionItem[] = [
  { id: '1', date: '2024-03-01', description: 'Adobe Creative Cloud', amount: -49.99, category: 'Software', source: 'bank' },
  { id: '2', date: '2024-03-05', description: 'Client Invoice #1042', amount: 3400.00, category: 'Sales', source: 'bank' },
  { id: '3', date: '2024-03-10', description: 'WeWork Desk hire', amount: -250.00, category: 'Office', source: 'bank' },
];

const StoreContext = createContext<AppState | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profileType, setProfileType] = useState<ProfileType>('sole_trader');
  const [memories, setMemories] = useState(initialMemories);
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [optimisations, setOptimisations] = useState(initialOptimisations);
  const [transactions, setTransactions] = useState(initialTransactions);

  const value: AppState = {
    profileType,
    setProfileType,
    memories,
    updateMemory: (id, val) => setMemories(m => m.map(x => x.id === id ? { ...x, value: val } : x)),
    addMemory: (item) => setMemories(m => [...m, { ...item, id: Math.random().toString() }]),
    exceptions,
    updateExceptionStatus: (id, status) => setExceptions(e => e.map(x => x.id === id ? { ...x, status } : x)),
    addException: (item) => setExceptions(e => [...e, { ...item, id: Math.random().toString() }]),
    optimisations,
    updateOptimisationStatus: (id, status) => setOptimisations(o => o.map(x => x.id === id ? { ...x, status } : x)),
    transactions,
    addTransaction: (item) => setTransactions(t => [{ ...item, id: Math.random().toString() }, ...t]),
    yearEndReadiness: {
      evidenceMissing: 2,
      tasksRemaining: 3,
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
