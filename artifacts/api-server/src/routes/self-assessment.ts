import { Router } from 'express';
import {
  db,
  profilesTable,
  selfAssessmentIdentityTable,
  selfAssessmentSa103sContextsTable,
  transactionsTable,
} from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireProfile } from './profiles.js';
import { decryptTaxIdentifier, encryptTaxIdentifier, maskTaxIdentifier } from '../lib/tax-identifiers.js';
import { getOrMigrateSa100Context, updateSa100Context } from '../lib/self-assessment-context.js';
import { buildSelfAssessmentReadiness } from '../lib/self-assessment-readiness.js';
import { summarizeTaxYearLedger } from '../lib/tax-year-ledger.js';

const router = Router();
const TaxYearSchema = z.string().regex(/^\d{4}\/\d{2}$/);
const ISODateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD dates')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a real calendar date');

function normalizedTaxIdentifier(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

async function publicIdentity(userId: string) {
  const [identity] = await db.select().from(selfAssessmentIdentityTable)
    .where(eq(selfAssessmentIdentityTable.userId, userId));
  return {
    utrMasked: identity?.utrEncrypted ? maskTaxIdentifier(decryptTaxIdentifier(identity.utrEncrypted)) : null,
    nationalInsuranceNumberMasked: identity?.nationalInsuranceNumberEncrypted
      ? maskTaxIdentifier(decryptTaxIdentifier(identity.nationalInsuranceNumberEncrypted))
      : null,
    hasUtr: Boolean(identity?.utrEncrypted),
    hasNationalInsuranceNumber: Boolean(identity?.nationalInsuranceNumberEncrypted),
  };
}

async function businessContext(profileId: string, taxYear: string) {
  const [context] = await db.select().from(selfAssessmentSa103sContextsTable).where(
    and(
      eq(selfAssessmentSa103sContextsTable.profileId, profileId),
      eq(selfAssessmentSa103sContextsTable.taxYear, taxYear),
    ),
  );
  return context ?? null;
}

// GET /self-assessment/identity
router.get('/self-assessment/identity', async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    res.json(await publicIdentity(req.user.id));
  } catch (err) {
    req.log.error(err, 'Failed to read protected Self Assessment identity');
    res.status(500).json({ error: 'Could not load protected identity details' });
  }
});

// PATCH /self-assessment/identity
router.patch('/self-assessment/identity', async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const parsed = z.object({
    utr: z.string().max(32).optional().nullable(),
    nationalInsuranceNumber: z.string().max(32).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success || (parsed.data.utr === undefined && parsed.data.nationalInsuranceNumber === undefined)) {
    res.status(400).json({ error: 'Enter at least one valid identity field' });
    return;
  }

  const utr = parsed.data.utr == null ? parsed.data.utr : normalizedTaxIdentifier(parsed.data.utr);
  const nationalInsuranceNumber = parsed.data.nationalInsuranceNumber == null
    ? parsed.data.nationalInsuranceNumber
    : normalizedTaxIdentifier(parsed.data.nationalInsuranceNumber);
  if (utr && !/^\d{10}$/.test(utr)) {
    res.status(400).json({ error: 'Enter a valid 10-digit UTR' });
    return;
  }
  if (nationalInsuranceNumber && !/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(nationalInsuranceNumber)) {
    res.status(400).json({ error: 'Enter a valid National Insurance number' });
    return;
  }

  try {
    const values: { utrEncrypted?: string | null; nationalInsuranceNumberEncrypted?: string | null; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (utr !== undefined) values.utrEncrypted = utr === null ? null : encryptTaxIdentifier(utr);
    if (nationalInsuranceNumber !== undefined) {
      values.nationalInsuranceNumberEncrypted = nationalInsuranceNumber === null
        ? null
        : encryptTaxIdentifier(nationalInsuranceNumber);
    }

    await db.insert(selfAssessmentIdentityTable).values({
      userId: req.user.id,
      utrEncrypted: values.utrEncrypted ?? null,
      nationalInsuranceNumberEncrypted: values.nationalInsuranceNumberEncrypted ?? null,
    }).onConflictDoUpdate({
      target: selfAssessmentIdentityTable.userId,
      set: values,
    });
    res.json(await publicIdentity(req.user.id));
  } catch (err) {
    req.log.error(err, 'Failed to save protected Self Assessment identity');
    res.status(500).json({ error: 'Could not save protected identity details' });
  }
});

// GET /self-assessment/sa100/:taxYear
router.get('/self-assessment/sa100/:taxYear', async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const taxYear = TaxYearSchema.safeParse(req.params.taxYear);
  if (!taxYear.success) { res.status(400).json({ error: 'Invalid tax year' }); return; }
  try {
    res.json(await getOrMigrateSa100Context(req.user.id, taxYear.data) ?? {
      taxYear: taxYear.data,
      otherTaxableIncome: null,
      allSelfEmploymentsDisclosed: null,
      migrationConflict: false,
    });
  } catch (err) {
    req.log.error(err, 'Failed to read Self Assessment return context');
    res.status(500).json({ error: 'Could not load Self Assessment return context' });
  }
});

// PATCH /self-assessment/sa100/:taxYear
router.patch('/self-assessment/sa100/:taxYear', async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const taxYear = TaxYearSchema.safeParse(req.params.taxYear);
  const parsed = z.object({
    otherTaxableIncome: z.number().min(0).finite().optional().nullable(),
    allSelfEmploymentsDisclosed: z.boolean().optional().nullable(),
  }).safeParse(req.body);
  if (!taxYear.success || !parsed.success) { res.status(400).json({ error: 'Invalid return context' }); return; }
  if (parsed.data.otherTaxableIncome === undefined && parsed.data.allSelfEmploymentsDisclosed === undefined) {
    res.status(400).json({ error: 'Choose at least one return context value' });
    return;
  }
  try {
    const current = await getOrMigrateSa100Context(req.user.id, taxYear.data);
    const updated = await updateSa100Context(req.user.id, taxYear.data, {
      otherTaxableIncome: parsed.data.otherTaxableIncome === undefined
        ? current?.otherTaxableIncome ?? null
        : parsed.data.otherTaxableIncome,
      allSelfEmploymentsDisclosed: parsed.data.allSelfEmploymentsDisclosed === undefined
        ? current?.allSelfEmploymentsDisclosed ?? null
        : parsed.data.allSelfEmploymentsDisclosed,
    });
    res.json(updated);
  } catch (err) {
    req.log.error(err, 'Failed to save Self Assessment return context');
    res.status(500).json({ error: 'Could not save Self Assessment return context' });
  }
});

// PATCH /profiles/:profileId/self-assessment/sa103s
router.patch('/profiles/:profileId/self-assessment/sa103s', async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const parsed = z.object({
    selfEmploymentStartDate: ISODateSchema.optional().nullable(),
    businessDescription: z.string().trim().max(300).optional().nullable(),
    accountingPeriodEndDate: ISODateSchema.optional().nullable(),
    accountingPeriodConfirmed: z.boolean().optional().nullable(),
    recordsCompleteConfirmed: z.boolean().optional().nullable(),
    derivedFiguresReviewed: z.boolean().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid business return context' }); return; }
  if (Object.keys(parsed.data).length === 0) { res.status(400).json({ error: 'Choose at least one business return value' }); return; }

  try {
    const profile = await requireProfile(req.params.profileId as string, req.user.id);
    if (!profile) { res.status(404).json({ error: 'Profile not found' }); return; }
    if (profile.type !== 'sole_trader') { res.status(422).json({ error: 'Business return readiness is available for sole-trader profiles only' }); return; }
    const existing = await businessContext(profile.id, profile.taxYear);
    const values = {
      profileId: profile.id,
      taxYear: profile.taxYear,
      selfEmploymentStartDate: parsed.data.selfEmploymentStartDate === undefined
        ? existing?.selfEmploymentStartDate ?? null
        : parsed.data.selfEmploymentStartDate,
      businessDescription: parsed.data.businessDescription === undefined
        ? existing?.businessDescription ?? null
        : parsed.data.businessDescription,
      accountingPeriodEndDate: parsed.data.accountingPeriodEndDate === undefined
        ? existing?.accountingPeriodEndDate ?? null
        : parsed.data.accountingPeriodEndDate,
      accountingPeriodConfirmed: parsed.data.accountingPeriodConfirmed === undefined
        ? existing?.accountingPeriodConfirmed ?? null
        : parsed.data.accountingPeriodConfirmed,
      recordsCompleteConfirmed: parsed.data.recordsCompleteConfirmed === undefined
        ? existing?.recordsCompleteConfirmed ?? null
        : parsed.data.recordsCompleteConfirmed,
      derivedFiguresReviewed: parsed.data.derivedFiguresReviewed === undefined
        ? existing?.derivedFiguresReviewed ?? null
        : parsed.data.derivedFiguresReviewed,
      updatedAt: new Date(),
    };
    const [updated] = await db.insert(selfAssessmentSa103sContextsTable).values(values)
      .onConflictDoUpdate({
        target: [selfAssessmentSa103sContextsTable.profileId, selfAssessmentSa103sContextsTable.taxYear],
        set: values,
      })
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err, 'Failed to save business Self Assessment context');
    res.status(500).json({ error: 'Could not save business Self Assessment context' });
  }
});

// GET /profiles/:profileId/self-assessment/readiness
router.get('/profiles/:profileId/self-assessment/readiness', async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const profile = await requireProfile(req.params.profileId as string, req.user.id);
    if (!profile) { res.status(404).json({ error: 'Profile not found' }); return; }
    if (profile.type !== 'sole_trader') { res.status(422).json({ error: 'Business return readiness is available for sole-trader profiles only' }); return; }
    const [identity, sa100, sa103s, transactions, ownedProfiles] = await Promise.all([
      publicIdentity(req.user.id),
      getOrMigrateSa100Context(req.user.id, profile.taxYear),
      businessContext(profile.id, profile.taxYear),
      db.select().from(transactionsTable).where(and(
        eq(transactionsTable.profileId, profile.id),
        eq(transactionsTable.ledgerStatus, 'active'),
      )),
      db.select().from(profilesTable).where(and(
        eq(profilesTable.userId, req.user.id),
        eq(profilesTable.taxYear, profile.taxYear),
      )),
    ]);
    const ledger = summarizeTaxYearLedger(transactions, profile.taxYear);
    if (!ledger) { res.status(422).json({ error: 'The selected tax year is not supported' }); return; }
    const returnProfiles = ownedProfiles.filter((candidate) => candidate.type === 'sole_trader');
    const contextByProfileId = new Map((await Promise.all(
      returnProfiles.map(async (candidate) => [
        candidate.id,
        await businessContext(candidate.id, candidate.taxYear),
      ] as const),
    )));

    const readiness = buildSelfAssessmentReadiness({
      taxYear: profile.taxYear,
      profile: {
        id: profile.id,
        name: profile.name,
        type: profile.type,
        industry: profile.industry,
        accountingBasis: profile.accountingBasis,
        coverageStartDate: profile.coverageStartDate,
      },
      identity,
      sa100,
      sa103s,
      financials: {
        periodStart: ledger.period.start,
        periodEnd: ledger.period.end,
        hasStarted: ledger.hasStarted,
        isYearToDate: ledger.isYearToDate,
        turnover: ledger.totalIncome,
        totalExpenses: ledger.totalExpenses,
        allowableExpenses: ledger.allowableExpenses,
        taxableBusinessProfit: ledger.taxableBusinessProfit,
        recordCount: ledger.records.length,
      },
      businessSections: returnProfiles.map((candidate) => ({
        profileId: candidate.id,
        businessName: candidate.name,
        isActive: candidate.id === profile.id,
        hasBusinessContext: Boolean(contextByProfileId.get(candidate.id)),
      })),
    });
    res.json({
      identity,
      sa100Context: sa100 ?? {
        taxYear: profile.taxYear,
        otherTaxableIncome: null,
        allSelfEmploymentsDisclosed: null,
        migrationConflict: false,
      },
      sa103sContext: sa103s,
      readiness,
    });
  } catch (err) {
    req.log.error(err, 'Failed to build Self Assessment readiness');
    res.status(500).json({ error: 'Could not load Self Assessment readiness' });
  }
});

export default router;