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
      description: 'Design services — Client A (invoice #001)',
      amount: 18000,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
      accountingCategory: 'income',
      allowablePercentage: 100,
      allowableAmount: 18000,
    },
    {
      profileId,
      date: '2024-08-20',
      description: 'Design services — Client A (invoice #002)',
      amount: 12000,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
      accountingCategory: 'income',
      allowablePercentage: 100,
      allowableAmount: 12000,
    },
    {
      profileId,
      date: '2024-09-10',
      description: 'Consulting — Client B (invoice #003)',
      amount: 5400,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
      accountingCategory: 'income',
      allowablePercentage: 100,
      allowableAmount: 5400,
    },
    {
      profileId,
      date: '2024-11-05',
      description: 'Workshop facilitation — Client C (invoice #004)',
      amount: 4400,
      category: 'income',
      taxTreatment: 'income',
      source: 'demo',
      accountingCategory: 'income',
      allowablePercentage: 100,
      allowableAmount: 4400,
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
      accountingCategory: 'subscriptions',
      allowablePercentage: 100,
      allowableAmount: -600,
    },
    {
      profileId,
      date: '2024-05-15',
      description: 'Office supplies — Amazon Business',
      amount: -340,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
      accountingCategory: 'office_costs',
      allowablePercentage: 100,
      allowableAmount: -340,
    },
    {
      profileId,
      date: '2024-06-01',
      description: 'Business insurance — Direct Line',
      amount: -780,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
      accountingCategory: 'insurance',
      allowablePercentage: 100,
      allowableAmount: -780,
    },
    {
      profileId,
      date: '2024-07-20',
      description: 'Equipment — MacBook Air M3 (AIA)',
      amount: -1450,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
      accountingCategory: 'equipment',
      allowablePercentage: 100,
      allowableAmount: -1450,
      capitalAllowanceType: 'aia',
    },
    {
      profileId,
      date: '2024-08-15',
      description: 'Professional development — UX course',
      amount: -320,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
      accountingCategory: 'training',
      allowablePercentage: 100,
      allowableAmount: -320,
    },
    {
      profileId,
      date: '2024-09-01',
      description: 'Mobile phone — business contract',
      amount: -540,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
      accountingCategory: 'utilities',
      allowablePercentage: 100,
      allowableAmount: -540,
    },
    {
      profileId,
      date: '2024-10-15',
      description: 'Accountancy — Smith & Co (quarterly)',
      amount: -770,
      category: 'expense',
      taxTreatment: 'deductible',
      source: 'demo',
      accountingCategory: 'professional_fees',
      allowablePercentage: 100,
      allowableAmount: -770,
    },
  ].map((transaction) => ({ ...transaction, evidenceTier: 0 }));
}

/** Inbox items to seed (pending classification) */
export function getDemoInboxItems(profileId: string): InsertInboxItem[] {
  return [
    {
      profileId,
      date: '2024-11-15',
      description: 'App Store — design tools purchase',
      amount: 1249,
      aiReasoning:
        "Categorised as design tools. Business use is plausible (design software, Figma plugins) but HMRC requires primary purpose to be business. If mixed personal/business use, only the business portion is deductible.",
      options: [
        { label: 'Fully deductible — 100% business use (design software)', isSuggested: true },
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
      description: 'Meeting room hire — co-working space',
      amount: 150,
      aiReasoning:
        "Receipt shows 1-day meeting room hire. Client meetings and business discussions are deductible. HMRC allows reasonable meeting facility costs.",
      options: [
        { label: 'Fully deductible — client meeting or business discussion', isSuggested: true },
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
      completedAt: new Date('2024-04-01'),
    },
    {
      profileId,
      checkId: 'income_recorded',
      label: 'All income recorded',
      detail: 'Every invoice and payment for the tax year must be captured',
      category: 'records',
      completed: true,
      completedAt: new Date('2024-12-01'),
    },
    {
      profileId,
      checkId: 'expenses_categorised',
      label: 'Expenses categorised',
      detail: 'All business expenses reviewed and categorised correctly',
      category: 'records',
      completed: false,
    },
    {
      profileId,
      checkId: 'inbox_cleared',
      label: 'Inbox items resolved',
      detail: 'All flagged transactions classified or dismissed',
      category: 'records',
      completed: false,
    },
    {
      profileId,
      checkId: 'ni_class2_check',
      label: 'Class 2 NI liability confirmed',
      detail: 'Verify whether Class 2 NI applies (profits above Small Profits Threshold)',
      category: 'tax',
      completed: false,
    },
    {
      profileId,
      checkId: 'poa_reviewed',
      label: 'Payments on Account reviewed',
      detail: 'First PoA due 31 January, second PoA due 31 July',
      category: 'tax',
      completed: false,
    },
    {
      profileId,
      checkId: 'bank_reconciled',
      label: 'Bank account reconciled',
      detail: 'Business bank statements reconcile with recorded transactions',
      category: 'records',
      completed: false,
    },
  ];
}

/** Default profile setup values for a demo profile */
export const DEMO_PROFILE_DEFAULTS = {
  industry: 'technology',
  type: 'sole_trader',
  taxReserve: 3500,
  cashAccounts: [
    { name: 'Starling Business', balance: 9840 },
  ],
  arEntries: [
    { name: 'Client A', amount: 2400, daysPastDue: 0, invoiceCount: 1 },
    { name: 'Client B', amount: 1000, daysPastDue: 14, invoiceCount: 1 },
  ],
  apEntries: [
    { name: 'Adobe Creative Cloud', amount: 50, daysUntilDue: 12 },
    { name: 'Co-working space', amount: 200, daysUntilDue: 18 },
  ],
};
