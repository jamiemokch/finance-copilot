import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { usersTable } from './auth';

// ─── Profiles ────────────────────────────────────────────────────────────────

export const profilesTable = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('My Business'),
  type: text('type').notNull().default('sole_trader'),
  taxYear: text('tax_year').notNull().default('2024/25'),
  // Cash account balances stored as jsonb: [{name, balance}]
  cashAccounts: jsonb('cash_accounts').notNull().default('[]'),
  // AR & AP stored as jsonb for demo simplicity
  arEntries: jsonb('ar_entries').notNull().default('[]'),
  apEntries: jsonb('ap_entries').notNull().default('[]'),
  // Tax reserve the user has set aside
  taxReserve: doublePrecision('tax_reserve').notNull().default(3500),
  // Industry/business context for AI classification
  industry: text('industry').notNull().default('other'),
  vatRegistered: boolean('vat_registered').notNull().default(false),
  // Cash vs accrual accounting
  accountingBasis: text('accounting_basis').notNull().default('cash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Profile = typeof profilesTable.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;

// ─── Evidence Items ───────────────────────────────────────────────────────────

export const evidenceItemsTable = pgTable('evidence_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  objectPath: text('object_path').notNull(),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  category: text('category').notNull().default('other'),
  // status: received | processing | processed | needs_review | error
  status: text('status').notNull().default('received'),
  // AI-extracted fields
  extractedData: jsonb('extracted_data'),
  confidence: doublePrecision('confidence'),
  aiReasoning: text('ai_reasoning'),
  // document | bank_csv | ledger | manual
  evidenceType: text('evidence_type').notNull().default('document'),
  totalRows: integer('total_rows').notNull().default(0),
  processedRows: integer('processed_rows').notNull().default(0),
  autoPostedRows: integer('auto_posted_rows').notNull().default(0),
  inboxRows: integer('inbox_rows').notNull().default(0),
  skippedRows: integer('skipped_rows').notNull().default(0),
  mappingSchema: jsonb('mapping_schema'),
  // idle | mapping | processing | done | error
  importStatus: text('import_status').notNull().default('idle'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const insertEvidenceItemSchema = createInsertSchema(evidenceItemsTable).omit({
  id: true,
  createdAt: true,
});
export type EvidenceItem = typeof evidenceItemsTable.$inferSelect;
export type InsertEvidenceItem = z.infer<typeof insertEvidenceItemSchema>;

// ─── Transactions ─────────────────────────────────────────────────────────────

export const transactionsTable = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  description: text('description').notNull(),
  // positive = income, negative = expense
  amount: doublePrecision('amount').notNull(),
  recordType: text('record_type').notNull().default('expense'),
  note: text('note'),
  // income | expense | ar | ap
  category: text('category').notNull().default('expense'),
  // deductible | non_deductible | income | ar | ap
  taxTreatment: text('tax_treatment').notNull().default('deductible'),
  // manual | extracted | demo
  source: text('source').notNull().default('manual'),
  evidenceId: uuid('evidence_id'),
  // 0 demo, 1 original document, 2 bank CSV, 3 ledger/spreadsheet, 4 manual
  evidenceTier: integer('evidence_tier').notNull().default(4),
  sourceRowIndex: integer('source_row_index'),
  rawRowData: jsonb('raw_row_data'),
  classificationConfidence: doublePrecision('classification_confidence'),
  // Structured accounting fields
  accountingCategory: text('accounting_category').notNull().default('other'),
  allowablePercentage: doublePrecision('allowable_percentage').notNull().default(100),
  allowableAmount: doublePrecision('allowable_amount'),   // null → use full |amount|
  capitalAllowanceType: text('capital_allowance_type'),   // AIA | main_pool | nil | null
  vatMetadata: jsonb('vat_metadata'),                     // {rate, vatAmount, isVatInclusive} | null
  userOverride: boolean('user_override').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('transactions_evidence_row_unique').on(table.evidenceId, table.sourceRowIndex),
]);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
  id: true,
  createdAt: true,
});
export type Transaction = typeof transactionsTable.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

// ─── Inbox Items ──────────────────────────────────────────────────────────────

export const inboxItemsTable = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id'),
  date: text('date').notNull(),
  description: text('description').notNull(),
  amount: doublePrecision('amount'),
  aiReasoning: text('ai_reasoning').notNull().default(''),
  // options: [{label, isSuggested, subOptions?: [{label, isSuggested}]}]
  options: jsonb('options').notNull().default('[]'),
  // pending | resolved
  status: text('status').notNull().default('pending'),
  resolution: text('resolution'),
  taxImpact: doublePrecision('tax_impact'),
  // Batch-import audit data; populated for spreadsheet rows awaiting review.
  sourceRowIndex: integer('source_row_index'),
  rawRowData: jsonb('raw_row_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('inbox_evidence_row_unique').on(table.evidenceId, table.sourceRowIndex),
]);

export const insertInboxItemSchema = createInsertSchema(inboxItemsTable).omit({
  id: true,
  createdAt: true,
});
export type InboxItem = typeof inboxItemsTable.$inferSelect;
export type InsertInboxItem = z.infer<typeof insertInboxItemSchema>;

// ─── Decision Memory ──────────────────────────────────────────────────────────

export const decisionMemoryTable = pgTable('decision_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  ideaId: text('idea_id').notNull(),
  ideaTitle: text('idea_title').notNull(),
  ideaCategory: text('idea_category').notNull(),
  date: text('date').notNull(),
  userDecision: text('user_decision').notNull(),
  userRationale: text('user_rationale').notNull().default(''),
  assumptionsSnapshot: jsonb('assumptions_snapshot').notNull().default('[]'),
  expectedPLImpact: doublePrecision('expected_pl_impact').notNull().default(0),
  expectedCashImpact: doublePrecision('expected_cash_impact').notNull().default(0),
  expectedTaxImpact: doublePrecision('expected_tax_impact').notNull().default(0),
  // committed | monitoring | completed | abandoned
  status: text('status').notNull().default('committed'),
  actualOutcome: text('actual_outcome'),
  actualPLImpact: doublePrecision('actual_pl_impact'),
  actualCashImpact: doublePrecision('actual_cash_impact'),
  actualTaxImpact: doublePrecision('actual_tax_impact'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const insertDecisionMemorySchema = createInsertSchema(decisionMemoryTable).omit({
  id: true,
  createdAt: true,
});
export type DecisionMemory = typeof decisionMemoryTable.$inferSelect;
export type InsertDecisionMemory = z.infer<typeof insertDecisionMemorySchema>;

// ─── SA Checklist Items ───────────────────────────────────────────────────────

export const saChecklistItemsTable = pgTable('sa_checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  checkId: text('check_id').notNull(),
  label: text('label').notNull(),
  detail: text('detail').notNull().default(''),
  category: text('category').notNull().default('records'),
  completed: boolean('completed').notNull().default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const insertSAChecklistItemSchema = createInsertSchema(saChecklistItemsTable).omit({
  id: true,
  createdAt: true,
});
export type SAChecklistItem = typeof saChecklistItemsTable.$inferSelect;
export type InsertSAChecklistItem = z.infer<typeof insertSAChecklistItemSchema>;
