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
  // Tax years are inferred from dated evidence or chosen in tax-specific flows;
  // onboarding must not silently assign one.
  taxYear: text('tax_year'),
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
  // Durable onboarding fact. Imports may flag pre-trading records but must
  // never overwrite this date from an inference or temporary filing choice.
  businessStartDate: text('business_start_date'),
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
 * Durable cleanup intent for private objects after a full user-data reset. It
 * intentionally does not reference privateUploadObjects because its row is
 * removed in the same transaction as the reset. The worker retries until the
 * physical blob is gone, preventing a database rollback from deleting bytes
 * that live Finance Copilot records still reference.
 */
export const privateUploadDeletionJobsTable = pgTable('private_upload_deletion_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  objectPath: text('object_path').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('private_upload_deletion_jobs_user_object_unique').on(table.userId, table.objectPath),
  index('private_upload_deletion_jobs_user_idx').on(table.userId, table.createdAt),
]);

/**
 * A physical upload may be reused without copying bytes, but each business
 * profile gets an explicit logical authorization binding. The userId is
 * repeated deliberately so a profile binding can never outlive or drift from
 * the authenticated owner relationship.
 */
export const privateUploadBindingsTable = pgTable('private_upload_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  objectId: uuid('object_id')
    .notNull()
    .references(() => privateUploadObjectsTable.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('private_upload_bindings_profile_object_unique').on(table.profileId, table.objectId),
  index('private_upload_bindings_user_profile_idx').on(table.userId, table.profileId),
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

// Every inspected spreadsheet source row gets one durable outcome after
// confirmation. This is deliberately separate from transactions: skipped,
// invalid, duplicate, and unselected rows are part of the audit population but
// must never become financial records.
export const spreadsheetRowOutcomesTable = pgTable('spreadsheet_row_outcomes', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidenceItemsTable.id, { onDelete: 'cascade' }),
  sheetId: text('sheet_id').notNull(),
  worksheet: text('worksheet').notNull(),
  sourceRowIndex: integer('source_row_index').notNull(),
  sourceRowNumber: integer('source_row_number').notNull(),
  physicalLineStart: integer('physical_line_start'),
  physicalLineEnd: integer('physical_line_end'),
  primaryDisposition: text('primary_disposition').notNull(),
  secondaryFindings: jsonb('secondary_findings').notNull().default('[]'),
  reason: text('reason').notNull(),
  rawValueReference: jsonb('raw_value_reference').notNull(),
  normalizedValueReference: jsonb('normalized_value_reference').notNull(),
  duplicateFingerprint: text('duplicate_fingerprint'),
  decisionSource: text('decision_source').notNull().default('deterministic'),
  mappingRevision: text('mapping_revision').notNull(),
  semanticPlanIdentity: text('semantic_plan_identity').notNull().default('manual-recovery'),
  semanticSchemaVersion: text('semantic_schema_version').notNull().default('manual-recovery'),
  semanticSessionId: uuid('semantic_session_id'),
  sourceContentHash: text('source_content_hash'),
  sourceObjectPath: text('source_object_path').notNull().default(''),
  semanticDisposition: text('semantic_disposition').notNull().default('manual_recovery'),
  semanticValidationReason: text('semantic_validation_reason').notNull().default('No complete semantic plan was available.'),
  userResolution: text('user_resolution'),
  overrideReason: text('override_reason'),
  finalOperationalOutcome: text('final_operational_outcome').notNull().default('pending'),
  taxYear: text('tax_year'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('spreadsheet_row_outcomes_evidence_source_unique').on(table.evidenceId, table.sourceRowIndex),
  index('spreadsheet_row_outcomes_profile_created_idx').on(table.profileId, table.createdAt),
]);

export const insertSpreadsheetRowOutcomeSchema = createInsertSchema(spreadsheetRowOutcomesTable).omit({
  id: true,
  createdAt: true,
});
export type SpreadsheetRowOutcome = typeof spreadsheetRowOutcomesTable.$inferSelect;
export type InsertSpreadsheetRowOutcome = z.infer<typeof insertSpreadsheetRowOutcomeSchema>;

/**
 * This is the durable, fenced state machine for AI spreadsheet semantics. It
 * deliberately lives outside evidence_items.mapping_schema so a stale request
 * cannot replace a newer provider checkpoint through a JSON read/modify/write.
 */
export const spreadsheetSemanticSessionsTable = pgTable('spreadsheet_semantic_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidenceItemsTable.id, { onDelete: 'cascade' }),
  sourceContentHash: text('source_content_hash').notNull(),
  sourceObjectPath: text('source_object_path').notNull(),
  schemaVersion: text('schema_version').notNull(),
  // ready | working | complete | incomplete
  status: text('status').notNull().default('ready'),
  stage: text('stage').notNull().default('workbook_overview'),
  continuationToken: text('continuation_token').notNull(),
  requestPayload: jsonb('request_payload').notNull().default({}),
  contextHistory: jsonb('context_history').notNull().default('[]'),
  providerCalls: integer('provider_calls').notNull().default(0),
  // Operational-only provider telemetry. Never stores prompts, workbook
  // contents, model responses, headers, credentials, or raw error bodies.
  providerAttempts: jsonb('provider_attempts').notNull().default('[]'),
  currentPlan: jsonb('current_plan'),
  // Remains stable for the logical review. claimToken changes on every lease
  // claim and fences a worker that resumes after another has reclaimed it.
  workIdentity: text('work_identity').notNull(),
  // One logical review keeps this identity while each explicit automatic retry
  // receives a fresh, separately fenced execution epoch.
  currentExecutionId: uuid('current_execution_id'),
  executionNumber: integer('execution_number').notNull().default(1),
  automaticRetryCount: integer('automatic_retry_count').notNull().default(0),
  claimToken: text('claim_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('spreadsheet_semantic_session_evidence_unique').on(table.evidenceId),
  index('spreadsheet_semantic_session_claim_idx').on(table.evidenceId, table.status, table.leaseExpiresAt),
]);

export const insertSpreadsheetSemanticSessionSchema = createInsertSchema(spreadsheetSemanticSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type SpreadsheetSemanticSessionRecord = typeof spreadsheetSemanticSessionsTable.$inferSelect;
export type InsertSpreadsheetSemanticSession = z.infer<typeof insertSpreadsheetSemanticSessionSchema>;

/**
 * A bounded automatic-analysis execution under a stable semantic review.
 * Active executions are checkpointed under their claim token; once terminal,
 * their state is historical audit evidence and is never reused by a retry.
 */
export const spreadsheetSemanticExecutionsTable = pgTable('spreadsheet_semantic_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  semanticSessionId: uuid('semantic_session_id')
    .notNull()
    .references(() => spreadsheetSemanticSessionsTable.id, { onDelete: 'cascade' }),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidenceItemsTable.id, { onDelete: 'cascade' }),
  workIdentity: text('work_identity').notNull(),
  executionNumber: integer('execution_number').notNull(),
  sourceContentHash: text('source_content_hash').notNull(),
  sourceObjectPath: text('source_object_path').notNull(),
  schemaVersion: text('schema_version').notNull(),
  status: text('status').notNull().default('ready'),
  stage: text('stage').notNull().default('workbook_overview'),
  continuationToken: text('continuation_token').notNull(),
  requestPayload: jsonb('request_payload').notNull().default({}),
  contextHistory: jsonb('context_history').notNull().default('[]'),
  providerCalls: integer('provider_calls').notNull().default(0),
  currentPlan: jsonb('current_plan'),
  claimToken: text('claim_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('spreadsheet_semantic_execution_number_unique').on(table.semanticSessionId, table.executionNumber),
  index('spreadsheet_semantic_execution_current_idx').on(table.semanticSessionId, table.status, table.leaseExpiresAt),
]);

export type SpreadsheetSemanticExecution = typeof spreadsheetSemanticExecutionsTable.$inferSelect;

/**
 * Immutable privacy-safe provider call telemetry. The semantic session keeps a
 * compact copy for recovery while this table retains the audit-grade history.
 */
export const spreadsheetSemanticProviderAttemptsTable = pgTable('spreadsheet_semantic_provider_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidenceItemsTable.id, { onDelete: 'cascade' }),
  semanticSessionId: uuid('semantic_session_id')
    .notNull()
    .references(() => spreadsheetSemanticSessionsTable.id, { onDelete: 'cascade' }),
  executionId: uuid('execution_id')
    .references(() => spreadsheetSemanticExecutionsTable.id, { onDelete: 'restrict' }),
  workIdentity: text('work_identity').notNull(),
  // Globally monotonic within the logical review. It never resets when a fresh
  // execution epoch begins, so old rows remain immutable and unambiguous.
  attemptNumber: integer('attempt_number').notNull(),
  executionAttemptNumber: integer('execution_attempt_number'),
  telemetryVersion: text('telemetry_version').notNull(),
  routeClass: text('route_class').notNull(),
  // Defaults make this an additive schema push for historical attempt rows;
  // every new attempt explicitly writes its requested and resolved model.
  requestedModel: text('requested_model').notNull().default('gpt-5.4-mini'),
  resolvedModel: text('resolved_model').notNull().default('gpt-5.4-mini'),
  model: text('model').notNull(),
  responseMode: text('response_mode').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  durationMs: integer('duration_ms').notNull(),
  outcomeCategory: text('outcome_category').notNull(),
  safeStatus: text('safe_status').notNull(),
  statusCode: integer('status_code'),
  retryable: boolean('retryable').notNull(),
  failurePhase: text('failure_phase'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('spreadsheet_provider_attempt_work_number_unique').on(table.semanticSessionId, table.workIdentity, table.attemptNumber),
  index('spreadsheet_provider_attempt_evidence_idx').on(table.evidenceId, table.createdAt),
]);
export const insertSpreadsheetSemanticProviderAttemptSchema = createInsertSchema(spreadsheetSemanticProviderAttemptsTable).omit({
  id: true,
  createdAt: true,
});
export type SpreadsheetSemanticProviderAttempt = typeof spreadsheetSemanticProviderAttemptsTable.$inferSelect;
export type InsertSpreadsheetSemanticProviderAttempt = z.infer<typeof insertSpreadsheetSemanticProviderAttemptSchema>;

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

// ─── M10 Reconciliation & Completeness Review ────────────────────────────────

/**
 * Reconciliation exceptions are observations about existing owned records. They
 * deliberately do not contain ledger amounts, balances, tax treatment, or
 * replacement transactions.
 */
export const reconciliationExceptionsTable = pgTable('reconciliation_exceptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  ruleKey: text('rule_key').notNull(),
  exceptionType: text('exception_type').notNull(),
  // open | resolving | resolved | dismissed | superseded
  status: text('status').notNull().default('open'),
  // Determined by rule and observed facts, never by AI or a heuristic score.
  severity: text('severity').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceRevision: text('source_revision').notNull(),
  observationFingerprint: text('observation_fingerprint').notNull(),
  observedFacts: jsonb('observed_facts').notNull().default({}),
  detectorVersion: integer('detector_version').notNull().default(1),
  isCurrent: boolean('is_current').notNull().default(true),
  currentResolutionSummary: text('current_resolution_summary'),
  dismissalRevision: text('dismissal_revision'),
  claimToken: text('claim_token'),
  claimedByUserId: text('claimed_by_user_id')
    .references(() => usersTable.id, { onDelete: 'set null' }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('reconciliation_exception_identity_unique').on(
    table.profileId,
    table.ruleKey,
    table.sourceKind,
    table.sourceId,
    table.observationFingerprint,
  ),
  index('reconciliation_exception_profile_state_idx').on(table.profileId, table.isCurrent, table.status),
  index('reconciliation_exception_source_idx').on(table.profileId, table.sourceKind, table.sourceId),
]);

export const reconciliationEventsTable = pgTable('reconciliation_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  exceptionId: uuid('exception_id')
    .notNull()
    .references(() => reconciliationExceptionsTable.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id')
    .references(() => usersTable.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  idempotencyKey: text('idempotency_key'),
  reason: text('reason'),
  observedFacts: jsonb('observed_facts').notNull().default({}),
  beforeSnapshot: jsonb('before_snapshot'),
  afterSnapshot: jsonb('after_snapshot'),
  relationshipRefs: jsonb('relationship_refs').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('reconciliation_event_idempotency_unique').on(table.exceptionId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} is not null`),
  index('reconciliation_event_exception_idx').on(table.exceptionId, table.createdAt),
]);

/**
 * A coverage check is only eligible for reconciliation after the user declares
 * the account and period complete. Statement endpoint IDs point back to
 * statement/import metadata; they are never reconstructed from transactions.
 */
export const reconciliationCoverageChecksTable = pgTable('reconciliation_coverage_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  financialAccountId: uuid('financial_account_id')
    .notNull()
    .references(() => financialAccountsTable.id, { onDelete: 'cascade' }),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  completeExpectedCoverage: boolean('complete_expected_coverage').notNull().default(false),
  statementClosingBalance: doublePrecision('statement_closing_balance'),
  statementSourceBatchId: uuid('statement_source_batch_id'),
  statementEndpointRowId: uuid('statement_endpoint_row_id'),
  // declared | confirmed | amended
  state: text('state').notNull().default('declared'),
  calculatedFacts: jsonb('calculated_facts').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index('reconciliation_coverage_profile_period_idx').on(table.profileId, table.periodStart, table.periodEnd),
  index('reconciliation_coverage_account_idx').on(table.financialAccountId, table.periodStart, table.periodEnd),
]);

/**
 * Supporting-evidence expectation is review/compliance state with provenance,
 * not a boolean financial fact. It is intentionally separate from transactions.
 */
export const reconciliationSupportExpectationsTable = pgTable('reconciliation_support_expectations', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactionsTable.id, { onDelete: 'cascade' }),
  // required | not_required | unspecified
  expectationState: text('expectation_state').notNull().default('unspecified'),
  reason: text('reason'),
  source: text('source').notNull().default('user'),
  changedByUserId: text('changed_by_user_id')
    .references(() => usersTable.id, { onDelete: 'set null' }),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('reconciliation_support_expectation_transaction_unique').on(table.profileId, table.transactionId),
  index('reconciliation_support_expectation_profile_state_idx').on(table.profileId, table.expectationState),
]);

export const insertReconciliationExceptionSchema = createInsertSchema(reconciliationExceptionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ReconciliationException = typeof reconciliationExceptionsTable.$inferSelect;
export type InsertReconciliationException = z.infer<typeof insertReconciliationExceptionSchema>;
export type ReconciliationEvent = typeof reconciliationEventsTable.$inferSelect;
export type ReconciliationCoverageCheck = typeof reconciliationCoverageChecksTable.$inferSelect;
export type ReconciliationSupportExpectation = typeof reconciliationSupportExpectationsTable.$inferSelect;

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
