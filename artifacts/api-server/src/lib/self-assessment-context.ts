import {
  db,
  profilesTable,
  selfAssessmentSa100ContextsTable,
  type SelfAssessmentSa100Context,
} from '@workspace/db';
import { and, eq } from 'drizzle-orm';

export interface PublicSa100Context {
  taxYear: string;
  otherTaxableIncome: number | null;
  allSelfEmploymentsDisclosed: boolean | null;
  migrationConflict: boolean;
}

function asPublicContext(context: SelfAssessmentSa100Context): PublicSa100Context {
  return {
    taxYear: context.taxYear,
    otherTaxableIncome: context.otherTaxableIncome,
    allSelfEmploymentsDisclosed: context.allSelfEmploymentsDisclosed,
    migrationConflict: context.migrationConflict,
  };
}

export async function getOrMigrateSa100Context(
  userId: string,
  taxYear: string,
): Promise<PublicSa100Context | null> {
  return db.transaction(async (tx) => {
    let [context] = await tx.select().from(selfAssessmentSa100ContextsTable).where(
      and(
        eq(selfAssessmentSa100ContextsTable.userId, userId),
        eq(selfAssessmentSa100ContextsTable.taxYear, taxYear),
      ),
    );

    if (!context) {
      const legacyProfiles = await tx.select().from(profilesTable).where(
        and(eq(profilesTable.userId, userId), eq(profilesTable.taxYear, taxYear)),
      );
      const legacyValues = legacyProfiles
        .filter((profile) => (
          profile.otherTaxableIncome != null
          && profile.otherTaxableIncomeTaxYear === taxYear
        ))
        .map((profile) => profile.otherTaxableIncome as number);
      const distinctValues = [...new Set(legacyValues)];
      if (distinctValues.length === 0) return null;

      await tx.insert(selfAssessmentSa100ContextsTable).values({
        userId,
        taxYear,
        otherTaxableIncome: distinctValues.length === 1 ? distinctValues[0] : null,
        migrationConflict: distinctValues.length > 1,
      }).onConflictDoNothing();
      [context] = await tx.select().from(selfAssessmentSa100ContextsTable).where(
        and(
          eq(selfAssessmentSa100ContextsTable.userId, userId),
          eq(selfAssessmentSa100ContextsTable.taxYear, taxYear),
        ),
      );
    }

    if (!context) return null;
    // Cleanup stays retryable: any existing unambiguous context clears legacy
    // values inside the same transaction, including after an earlier partial run.
    if (!context.migrationConflict) {
      await tx.update(profilesTable)
        .set({ otherTaxableIncome: null, otherTaxableIncomeTaxYear: null })
        .where(and(eq(profilesTable.userId, userId), eq(profilesTable.taxYear, taxYear)));
    }
    return asPublicContext(context);
  });
}

export async function updateSa100Context(
  userId: string,
  taxYear: string,
  updates: Pick<PublicSa100Context, 'otherTaxableIncome' | 'allSelfEmploymentsDisclosed'>,
): Promise<PublicSa100Context> {
  return db.transaction(async (tx) => {
    const values = {
      userId,
      taxYear,
      otherTaxableIncome: updates.otherTaxableIncome,
      allSelfEmploymentsDisclosed: updates.allSelfEmploymentsDisclosed,
      migrationConflict: false,
      updatedAt: new Date(),
    };
    const [updated] = await tx.insert(selfAssessmentSa100ContextsTable).values(values)
      .onConflictDoUpdate({
        target: [selfAssessmentSa100ContextsTable.userId, selfAssessmentSa100ContextsTable.taxYear],
        set: values,
      })
      .returning();
    await tx.update(profilesTable)
      .set({ otherTaxableIncome: null, otherTaxableIncomeTaxYear: null })
      .where(and(eq(profilesTable.userId, userId), eq(profilesTable.taxYear, taxYear)));
    return asPublicContext(updated);
  });
}