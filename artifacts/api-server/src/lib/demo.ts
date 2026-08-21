/**
 * Canonical demo seed data for the UK Sole Trader sample journey.
 * Revenue £39,800 | Expenses £4,800 | Profit £35,000 | Tax ~£6,900
 * Two pending inbox items | Cash £9,840 gross | AR £3,400 | AP £250
 */

import type { InsertTransaction, InsertInboxItem, InsertSAChecklistItem } from '@workspace/db/schema';

/** Transactions to seed for a fresh demo profile */
export function getDemoTransactions(profileId: string): InsertTransaction[] {
  return [
    // ── Income ────────────────────────────────────────────────────────────
    {
      profileId,
      date: '2024-04-15',
      description: 'Design services — Axiom Ltd (invoice #001)',
      amount: 18000,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-08-20',
      description: 'Design services — Axiom Ltd (invoice #002)',
      amount: 12000,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-09-10',
      description: 'Consulting — Studio Nine (invoice #003)',
      amount: 5400,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-11-05',
      description: 'Workshop facilitation — Event XP (invoice #004)',
      amount: 4400,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
    },
    // ── Expenses ──────────────────────────────────────────────────────────
    {
      profileId,
      date: '2024-04-01',
      description: 'Adobe Creative Cloud (annual subscription)',
      amount: -600,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-05-15',
      description: 'Office supplies — Amazon Business',
      amount: -340,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-06-01',
      description: 'Business insurance — Direct Line',
      amount: -780,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-07-20',
      description: 'Equipment — MacBook Air M3',
      amount: -1450,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-08-15',
      description: 'Professional development — UX course',
      amount: -320,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-09-01',
      description: 'Mobile phone — EE business contract',
      amount: -540,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
    },
    {
      profileId,
      date: '2024-10-15',
      description: 'Accountancy — Smith & Co (quarterly)',
      amount: -770,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
    },
  ];
}

/** Inbox items to seed (pending classification) */
export function getDemoInboxItems(profileId: string): InsertInboxItem[] {
  return [
    {
      profileId,
      date: '2024-11-15',
      description: 'Apple App Store — design tools purchase',
      amount: 1249,
      aiReasoning:
        "Purchase categorised as 'design tools' from the App Store. Business use is plausible (design software subscriptions, Figma plugins, etc.) but HMRC requires the primary purpose to be business use. If this includes personal apps, only the business portion is deductible.",
      options: [
        {
          label: 'Fully deductible — 100% business use (design software)',
          isSuggested: true,
        },
        {
          label: 'Partially deductible — mixed personal and business use',
          subOptions: [
            { label: '50% business', isSuggested: false },
            { label: '75% business', isSuggested: false },
          ],
        },
        { label: 'Not deductible — personal purchase', isSuggested: false },
      ],
      status: 'pending',
    },
    {
      profileId,
      date: '2024-12-01',
      description: 'Meeting room hire — WeWork Moorgate',
      amount: 150,
      aiReasoning:
        "Receipt shows 'Meeting Room A, 1 day hire' from WeWork. Client meetings and business discussions are deductible. If this was for a team meeting or client presentation, it is fully deductible. HMRC allows reasonable meeting facility costs.",
      options: [
        {
          label: 'Fully deductible — client meeting or business discussion',
          isSuggested: true,
        },
        { label: 'Not deductible — personal or social event', isSuggested: false },
      ],
      status: 'pending',
    },
  ];
}

/** SA checklist items for a fresh demo profile */
export function getDemoSAChecklist(profileId: string): InsertSAChecklistItem[] {
  return [
    {
      profileId,
      checkId: 'sa_registration',
      label: 'Registered for Self Assessment',
      detail: 'Must register by 5 October in the year after the tax year',
      category: 'registration',
      completed: true,
    },
    {
      profileId,
      checkId: 'utr_confirmed',
      label: 'UTR number confirmed',
      detail: 'Your 10-digit Unique Taxpayer Reference from HMRC',
      category: 'registration',
      completed: true,
    },
    {
      profileId,
      checkId: 'ni_number',
      label: 'National Insurance number to hand',
      detail: 'Required for SA return completion',
      category: 'registration',
      completed: true,
    },
    {
      profileId,
      checkId: 'all_income_recorded',
      label: 'All income for 2024/25 recorded',
      detail: 'Includes invoices paid and any other income sources',
      category: 'income',
      completed: false,
    },
    {
      profileId,
      checkId: 'bank_interest',
      label: 'Bank interest / savings income noted',
      detail: 'Interest on business and personal accounts may be taxable',
      category: 'income',
      completed: false,
    },
    {
      profileId,
      checkId: 'all_expenses_recorded',
      label: 'All allowable business expenses recorded',
      detail: 'Include receipts and justification for each deduction',
      category: 'expenses',
      completed: false,
    },
    {
      profileId,
      checkId: 'inbox_cleared',
      label: 'Inbox items reviewed and classified',
      detail: 'Unclassified items in Inbox must be resolved before filing',
      category: 'expenses',
      completed: false,
    },
    {
      profileId,
      checkId: 'home_office',
      label: 'Home office expenses calculated (if applicable)',
      detail: 'Simplified flat rate or actual cost method — choose one',
      category: 'expenses',
      completed: false,
    },
    {
      profileId,
      checkId: 'class2_ni',
      label: 'Class 2 NI position confirmed',
      detail: '£3.45/week if profit above £12,570 (Small Profits Threshold)',
      category: 'ni',
      completed: false,
    },
    {
      profileId,
      checkId: 'poa_understood',
      label: 'Payments on Account understood',
      detail: 'Two POA instalments: Jan 31 and Jul 31 each year',
      category: 'payments',
      completed: false,
    },
    {
      profileId,
      checkId: 'tax_reserve_adequate',
      label: 'Tax reserve is adequate',
      detail: 'Reserve should cover full SA bill by Jan 31',
      category: 'payments',
      completed: false,
    },
  ];
}

/** Demo profile static data (cash accounts, AR, AP) */
export const DEMO_PROFILE_DATA = {
  name: 'Alex Rivera — Freelance Design',
  type: 'sole_trader',
  taxYear: '2024/25',
  taxReserve: 3500,
  // Pass arrays directly — Drizzle serialises jsonb automatically
  cashAccounts: [{ name: 'Starling Business', balance: 9840 }],
  arEntries: [
    { name: 'Axiom Ltd', amount: 2400, daysPastDue: 7, invoiceCount: 1 },
    { name: 'Studio Nine', amount: 1000, daysPastDue: 0, invoiceCount: 1 },
  ],
  apEntries: [
    { name: 'Freelance contractor', amount: 250, daysUntilDue: 14 },
  ],
};
