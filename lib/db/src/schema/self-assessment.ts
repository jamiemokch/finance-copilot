import {
  boolean,
  date,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { usersTable } from './auth';
import { profilesTable } from './app';

// Write-only sensitive identifiers for the individual. Values are encrypted by
// the API before persistence and are never included in ordinary profile reads.
export const selfAssessmentIdentityTable = pgTable('self_assessment_identity', {
  userId: varchar('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  utrEncrypted: text('utr_encrypted'),
  nationalInsuranceNumberEncrypted: text('national_insurance_number_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertSelfAssessmentIdentitySchema = createInsertSchema(selfAssessmentIdentityTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type SelfAssessmentIdentity = typeof selfAssessmentIdentityTable.$inferSelect;
export type InsertSelfAssessmentIdentity = z.infer<typeof insertSelfAssessmentIdentitySchema>;

// One SA100-level context per person and tax year. It is deliberately separate
// from business profiles so one return can later compose many SA103S sections.
export const selfAssessmentSa100ContextsTable = pgTable('self_assessment_sa100_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  taxYear: text('tax_year').notNull(),
  otherTaxableIncome: doublePrecision('other_taxable_income'),
  allSelfEmploymentsDisclosed: boolean('all_self_employments_disclosed'),
  // Set only when legacy profile-held income conflicted across the same user/year.
  migrationConflict: boolean('migration_conflict').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('sa100_context_user_tax_year_unique').on(table.userId, table.taxYear),
  index('sa100_context_user_tax_year_idx').on(table.userId, table.taxYear),
]);

export const insertSelfAssessmentSa100ContextSchema = createInsertSchema(selfAssessmentSa100ContextsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type SelfAssessmentSa100Context = typeof selfAssessmentSa100ContextsTable.$inferSelect;
export type InsertSelfAssessmentSa100Context = z.infer<typeof insertSelfAssessmentSa100ContextSchema>;

// One SA103S-level context per business profile and tax year.
export const selfAssessmentSa103sContextsTable = pgTable('self_assessment_sa103s_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profilesTable.id, { onDelete: 'cascade' }),
  taxYear: text('tax_year').notNull(),
  selfEmploymentStartDate: date('self_employment_start_date', { mode: 'string' }),
  businessDescription: text('business_description'),
  accountingPeriodEndDate: date('accounting_period_end_date', { mode: 'string' }),
  accountingPeriodConfirmed: boolean('accounting_period_confirmed'),
  recordsCompleteConfirmed: boolean('records_complete_confirmed'),
  derivedFiguresReviewed: boolean('derived_figures_reviewed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('sa103s_context_profile_tax_year_unique').on(table.profileId, table.taxYear),
  index('sa103s_context_profile_tax_year_idx').on(table.profileId, table.taxYear),
]);

export const insertSelfAssessmentSa103sContextSchema = createInsertSchema(selfAssessmentSa103sContextsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type SelfAssessmentSa103sContext = typeof selfAssessmentSa103sContextsTable.$inferSelect;
export type InsertSelfAssessmentSa103sContext = z.infer<typeof insertSelfAssessmentSa103sContextSchema>;