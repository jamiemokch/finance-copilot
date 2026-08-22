import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
  // Optional opening-position setup for the current activity period
  openingPositionStatus: text('opening_position_status').notNull().default('not_started'),
  openingBalance: doublePrecision('opening_balance'),
  openingDetails: text('opening_details'),
  coverageStartDate: text('coverage_start_date'),
  coverageEndDate: text('coverage_end_date'),
  // Optional non-business income used only for an income-tax estimate.
  // Null means the estimate must remain incomplete rather than assuming £0.
  otherTaxableIncome: doublePrecision('other_taxable_income'),
  otherTaxableIncomeTaxYear: text('other_taxable_income_tax_year'),
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

// ─── Private Upload Ownership ──────────────────────────────────────────────────

/**
 * Object storage paths are unguessable but still need a database ownership
 * record. This prevents a private object path from being attached to another
 * user's bank-import batch and gives the serving route a real access check.
 */
export const privateUploadObjectsTable = pgTable('private_upload_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectPath: text('object_path').notNull(),
  // Derived server-side for durable same-user object reuse. It is never trusted
  // from the browser as a claim about file contents.
  contentHash: text('content_hash'),
  objectSize: integer('object_size'),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('private_upload_objects_path_unique').on(table.objectPath),
  index('private_upload_objects_user_idx').on(table.userId, table.createdAt),
  index('private_upload_objects_user_hash_idx').on(table.userId, table.contentHash),
  uniqueIndex('private_upload_objects_user_hash_unique').on(table.userId, table.contentHash)
    .where(sql`${table.contentHash} is not null`),
]);

/**
 * A private blob may be physically reused, but every profile that uses it gets
 * an explicit logical binding. Profile-scoped evidence routes are the only
 * supported way to read or mutate evidence once it is registered.
 */
export const privateUploadProfileBindingsTable = pgTable('private_upload_profile_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  objectPath: text('object_path').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('private_upload_profile_binding_unique').on(table.profileId, table.objectPath),
  index('private_upload_profile_binding_object_idx').on(table.objectPath, table.userId),
]);

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
  // A processor holds this short lease while extracting or importing. Expired
  // leases can be reclaimed after a browser/network interruption.
  processingLeaseExpiresAt: timestamp('processing_lease_expires_at', { withTimezone: true }),
  // Changes with every lease claim. Final writes must present this token, which
  // fences an older worker after its interrupted lease has been reclaimed.
  processingToken: text('processing_token'),
  // M9 document fields are deliberately additive. Legacy evidence remains on
  // workflow 1 so its historical transaction/inbox semantics are preserved.
  workflowVersion: integer('workflow_version').notNull().default(1),
  documentLifecycle: text('document_lifecycle').notNull().default('active'),
  reviewState: text('review_state').notNull().default('pending'),
  contentHash: text('content_hash'),
  objectSize: integer('object_size'),
  replacementOfEvidenceId: uuid('replacement_of_evidence_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('evidence_items_m9_active_hash_unique')
    .on(table.profileId, table.workflowVersion, table.contentHash)
    .where(sql`${table.workflowVersion} = 2 and ${table.documentLifecycle} = 'active' and ${table.contentHash} is not null`),
]);

export const insertEvidenceItemSchema = createInsertSchema(evidenceItemsTable).omit({
  id: true,
  createdAt: true,
});
export type EvidenceItem = typeof evidenceItemsTable.$inferSelect;
export type InsertEvidenceItem = z.infer<typeof insertEvidenceItemSchema>;

// ─── Financial Accounts & Bank Import Audit ────────────────────────────────────

/**
 * Identity only. These accounts deliberately do not model a reconciled balance
 * or a bank feed; they record which owned account a bank CSV came from.
 */
export const financialAccountsTable = pgTable('financial_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  lastFour: text('last_four'),
  currency: text('currency').notNull().default('GBP'),
  accountType: text('account_type').notNull().default('current'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index('financial_accounts_profile_idx').on(table.profileId, table.createdAt),
]);

export const insertFinancialAccountSchema = createInsertSchema(financialAccountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type FinancialAccount = typeof financialAccountsTable.$inferSelect;
export type InsertFinancialAccount = z.infer<typeof insertFinancialAccountSchema>;

/**
 * Bank-import batches and rows are staging/audit records only. Financial
 * calculations always read the canonical transactions table.
 */
export const bankImportBatchesTable = pgTable('bank_import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  financialAccountId: uuid('financial_account_id')
    .notNull()
    .references(() => financialAccountsTable.id, { onDelete: 'restrict' }),
  taxYearSnapshot: text('tax_year_snapshot').notNull(),
  accountingBasisSnapshot: text('accounting_basis_snapshot').notNull().default('cash'),
  filename: text('filename').notNull(),
  objectPath: text('object_path').notNull(),
  fileHash: text('file_hash').notNull(),
  encoding: text('encoding').notNull().default('utf-8'),
  delimiter: text('delimiter').notNull().default(','),
  confirmedMapping: jsonb('confirmed_mapping'),
  mappingVersion: integer('mapping_version').notNull().default(0),
  previewVersion: integer('preview_version').notNull().default(0),
  // uploaded | mapping_required | preview_ready | committing | committed | failed | discarded
  status: text('status').notNull().default('uploaded'),
  totalRows: integer('total_rows').notNull().default(0),
  validRows: integer('valid_rows').notNull().default(0),
  invalidRows: integer('invalid_rows').notNull().default(0),
  duplicateRows: integer('duplicate_rows').notNull().default(0),
  possibleDuplicateRows: integer('possible_duplicate_rows').notNull().default(0),
  outOfScopeRows: integer('out_of_scope_rows').notNull().default(0),
  selectedRows: integer('selected_rows').notNull().default(0),
  committedRows: integer('committed_rows').notNull().default(0),
  lastError: text('last_error'),
  processingLeaseExpiresAt: timestamp('processing_lease_expires_at', { withTimezone: true }),
  processingToken: text('processing_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('bank_import_batches_profile_hash_unique').on(table.profileId, table.fileHash),
  index('bank_import_batches_profile_created_idx').on(table.profileId, table.createdAt),
  index('bank_import_batches_account_idx').on(table.financialAccountId, table.createdAt),
]);

export const insertBankImportBatchSchema = createInsertSchema(bankImportBatchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BankImportBatch = typeof bankImportBatchesTable.$inferSelect;
export type InsertBankImportBatch = z.infer<typeof insertBankImportBatchSchema>;

export const bankImportRowsTable = pgTable('bank_import_rows', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => bankImportBatchesTable.id, { onDelete: 'cascade' }),
  sourceRowNumber: integer('source_row_number').notNull(),
  sourceFingerprint: text('source_fingerprint').notNull(),
  occurrenceIdentity: integer('occurrence_identity').notNull().default(1),
  date: text('date'),
  amount: doublePrecision('amount'),
  // money_in | money_out — intentionally independent from accounting classification
  direction: text('direction'),
  description: text('description'),
  reference: text('reference'),
  balance: doublePrecision('balance'),
  // valid | invalid | out_of_scope
  validationStatus: text('validation_status').notNull().default('invalid'),
  // none | already_imported | possible_duplicate
  duplicateStatus: text('duplicate_status').notNull().default('none'),
  validationErrors: jsonb('validation_errors').notNull().default('[]'),
  selectedForCommit: boolean('selected_for_commit').notNull().default(false),
  canonicalTransactionId: uuid('canonical_transaction_id'),
  rawRowData: jsonb('raw_row_data').notNull().default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('bank_import_rows_batch_source_unique').on(table.batchId, table.sourceRowNumber),
  index('bank_import_rows_fingerprint_idx').on(table.sourceFingerprint),
  index('bank_import_rows_committed_idx').on(table.canonicalTransactionId),
]);

export const insertBankImportRowSchema = createInsertSchema(bankImportRowsTable).omit({
  id: true,
  createdAt: true,
});
export type BankImportRow = typeof bankImportRowsTable.$inferSelect;
export type InsertBankImportRow = z.infer<typeof insertBankImportRowSchema>;

// ─── Transactions ─────────────────────────────────────────────────────────────

export const transactionsTable = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  description: text('description').notNull(),
  // Existing manual/extracted records use income/expense. Bank imports use
  // unknown until a person explicitly confirms accounting classification.
  amount: doublePrecision('amount').notNull(),
  recordType: text('record_type').notNull(),
  note: text('note'),
  // income | expense | ar | ap
  category: text('category').notNull().default('expense'),
  // deductible | non_deductible | income | ar | ap
  taxTreatment: text('tax_treatment').notNull().default('deductible'),
  // manual | extracted | demo | bank_csv
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
  // Bank imports carry direction separately from accounting treatment. A value
  // of unknown or null must not be included in taxable/allowable calculations.
  accountingClassification: text('accounting_classification'),
  financialAccountId: uuid('financial_account_id')
    .references(() => financialAccountsTable.id, { onDelete: 'restrict' }),
  bankImportBatchId: uuid('bank_import_batch_id')
    .references(() => bankImportBatchesTable.id, { onDelete: 'restrict' }),
  bankImportRowId: uuid('bank_import_row_id'),
  // Stable normalized movement identity plus contextual occurrence number. This
  // is the durable cross-file duplicate fence, distinct from a batch row ID.
  bankMovementIdentity: text('bank_movement_identity'),
  originalImportSnapshot: jsonb('original_import_snapshot'),
  // active | voided. Imported records are voided rather than deleted so their
  // audit trail and repeat-upload protection remain durable.
  ledgerStatus: text('ledger_status').notNull().default('active'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('transactions_evidence_row_unique').on(table.evidenceId, table.sourceRowIndex),
  // A document creates one outcome, unlike a spreadsheet where each source row
  // is independently identified. This prevents a stale processor from posting
  // the same document twice after its lease has been reclaimed.
  uniqueIndex('transactions_document_evidence_unique')
    .on(table.evidenceId)
    .where(sql`${table.evidenceId} is not null and ${table.sourceRowIndex} is null`),
  uniqueIndex('transactions_bank_import_row_unique')
    .on(table.bankImportRowId)
    .where(sql`${table.bankImportRowId} is not null`),
  uniqueIndex('transactions_profile_bank_movement_identity_unique')
    .on(table.profileId, table.financialAccountId, table.bankMovementIdentity)
    .where(sql`${table.bankMovementIdentity} is not null`),
  index('transactions_profile_date_idx').on(table.profileId, table.date, table.createdAt),
  index('transactions_profile_ledger_status_idx').on(table.profileId, table.ledgerStatus, table.date),
]);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Transaction = typeof transactionsTable.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

// ─── Evidence links and audit history ─────────────────────────────────────────

/**
 * Supporting documents are independent from the financial ledger. This table
 * makes their zero-to-many relationship explicit without rewriting legacy
 * transactions.evidenceId values.
 */
export const evidenceTransactionLinksTable = pgTable('evidence_transaction_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidenceItemsTable.id, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactionsTable.id, { onDelete: 'cascade' }),
  linkStatus: text('link_status').notNull().default('active'),
  linkReason: text('link_reason').notNull().default('supporting_document'),
  detachedAt: timestamp('detached_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('evidence_transaction_link_unique').on(table.evidenceId, table.transactionId),
  index('evidence_transaction_link_profile_idx').on(table.profileId, table.evidenceId, table.linkStatus),
]);

export const evidenceAuditEventsTable = pgTable('evidence_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidenceItemsTable.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id')
    .references(() => usersTable.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('evidence_audit_events_evidence_idx').on(table.evidenceId, table.createdAt),
]);

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
  uniqueIndex('inbox_document_evidence_unique')
    .on(table.evidenceId)
    .where(sql`${table.evidenceId} is not null and ${table.sourceRowIndex} is null`),
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
