import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  EyeOff,
  Download,
  Loader2,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, Card, Input, Textarea } from '@/components/ui';
import {
  selfAssessmentApi,
  type APISelfAssessmentReadinessResponse,
  type SelfAssessmentFilingPack,
} from '@/lib/api';
import { useStore } from '@/lib/store';
import type { SelfAssessmentReadinessConcept } from '@workspace/api-client-react';

const money = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);

type ConfirmationChoice = '' | 'yes' | 'no';

function toChoice(value: boolean | null | undefined): ConfirmationChoice {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}

function fromChoice(value: ConfirmationChoice): boolean | null {
  return value === '' ? null : value === 'yes';
}

function displayConceptValue(concept: SelfAssessmentReadinessConcept) {
  if (concept.value == null || concept.value === '') return 'Not added';
  if (typeof concept.value === 'boolean') return concept.value ? 'Confirmed' : 'Not confirmed';
  if (typeof concept.value === 'number') {
    return concept.id === 'return.data_coverage'
      ? `${concept.value} saved record${concept.value === 1 ? '' : 's'}`
      : money(concept.value);
  }
  return String(concept.value);
}

function ReadinessGroup({
  title,
  description,
  concepts,
  tone,
}: {
  title: string;
  description: string;
  concepts: SelfAssessmentReadinessConcept[];
  tone: 'complete' | 'derived' | 'missing' | 'confirmation';
}) {
  const styles = {
    complete: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20',
    derived: 'border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20',
    missing: 'border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20',
    confirmation: 'border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20',
  };
  const labels = {
    complete: 'success' as const,
    derived: 'outline' as const,
    missing: 'warning' as const,
    confirmation: 'secondary' as const,
  };

  return (
    <Card className={`overflow-hidden border ${styles[tone]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-current/10 px-5 py-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant={labels[tone]}>{concepts.length}</Badge>
      </div>
      {concepts.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">Nothing in this section right now.</p>
      ) : (
        <div className="divide-y divide-border/70">
          {concepts.map((concept) => (
            <div key={concept.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{concept.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{concept.section} · {concept.source}</p>
                </div>
                <p className="font-medium text-foreground">{displayConceptValue(concept)}</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{concept.explanation}</p>
              {tone === 'derived' && (
                <Link href="/memory" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <Database className="h-3.5 w-3.5" /> Review Financial Memory
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function SelfAssessmentReadiness() {
  const { activeProfileId, profiles } = useStore();
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const [data, setData] = useState<APISelfAssessmentReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'identity' | 'sa100' | 'sa103s' | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [filingPack, setFilingPack] = useState<SelfAssessmentFilingPack | null>(null);
  const [buildingPack, setBuildingPack] = useState(false);

  const [utr, setUtr] = useState('');
  const [nationalInsuranceNumber, setNationalInsuranceNumber] = useState('');
  const [otherTaxableIncome, setOtherTaxableIncome] = useState('');
  const [allSelfEmploymentsDisclosed, setAllSelfEmploymentsDisclosed] = useState<ConfirmationChoice>('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [selfEmploymentStartDate, setSelfEmploymentStartDate] = useState('');
  const [accountingPeriodEndDate, setAccountingPeriodEndDate] = useState('');
  const [accountingPeriodConfirmed, setAccountingPeriodConfirmed] = useState(false);
  const [recordsCompleteConfirmed, setRecordsCompleteConfirmed] = useState(false);
  const [derivedFiguresReviewed, setDerivedFiguresReviewed] = useState(false);

  const hydrate = useCallback((response: APISelfAssessmentReadinessResponse) => {
    setData(response);
    setOtherTaxableIncome(response.sa100Context.otherTaxableIncome == null ? '' : String(response.sa100Context.otherTaxableIncome));
    setAllSelfEmploymentsDisclosed(toChoice(response.sa100Context.allSelfEmploymentsDisclosed));
    setBusinessDescription(response.sa103sContext?.businessDescription ?? '');
    setSelfEmploymentStartDate(response.sa103sContext?.selfEmploymentStartDate ?? '');
    setAccountingPeriodEndDate(response.sa103sContext?.accountingPeriodEndDate ?? '');
    setAccountingPeriodConfirmed(response.sa103sContext?.accountingPeriodConfirmed === true);
    setRecordsCompleteConfirmed(response.sa103sContext?.recordsCompleteConfirmed === true);
    setDerivedFiguresReviewed(response.sa103sContext?.derivedFiguresReviewed === true);
  }, []);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    setLoading(true);
    setError(null);
    try {
      hydrate(await selfAssessmentApi.getReadiness(activeProfileId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load return readiness.');
    } finally {
      setLoading(false);
    }
  }, [activeProfileId, hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveIdentity = async () => {
    if (!utr.trim() && !nationalInsuranceNumber.trim()) {
      setError('Enter a UTR or National Insurance number to save protected identity details.');
      return;
    }
    setSaving('identity');
    setError(null);
    try {
      await selfAssessmentApi.updateIdentity({
        ...(utr.trim() ? { utr: utr.trim() } : {}),
        ...(nationalInsuranceNumber.trim() ? { nationalInsuranceNumber: nationalInsuranceNumber.trim() } : {}),
      });
      setUtr('');
      setNationalInsuranceNumber('');
      await load();
      setSaveMessage('Protected identity details saved. Raw values are not shown again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save protected identity details.');
    } finally {
      setSaving(null);
    }
  };

  const saveSa100 = async () => {
    if (!activeProfile) return;
    const parsedIncome = otherTaxableIncome.trim() === '' ? null : Number(otherTaxableIncome);
    if (parsedIncome !== null && (!Number.isFinite(parsedIncome) || parsedIncome < 0)) {
      setError('Other taxable income must be £0 or more.');
      return;
    }
    setSaving('sa100');
    setError(null);
    try {
      await selfAssessmentApi.updateSa100Context(activeProfile.taxYear ?? '2024/25', {
        otherTaxableIncome: parsedIncome,
        allSelfEmploymentsDisclosed: fromChoice(allSelfEmploymentsDisclosed),
      });
      await load();
      setSaveMessage('Whole-return context saved for this tax year.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save return context.');
    } finally {
      setSaving(null);
    }
  };

  const saveSa103s = async () => {
    if (!activeProfileId) return;
    setSaving('sa103s');
    setError(null);
    try {
      await selfAssessmentApi.updateSa103sContext(activeProfileId, {
        selfEmploymentStartDate: selfEmploymentStartDate || null,
        businessDescription: businessDescription.trim() || null,
        accountingPeriodEndDate: accountingPeriodEndDate || null,
        accountingPeriodConfirmed,
        recordsCompleteConfirmed,
        derivedFiguresReviewed,
      });
      await load();
      setSaveMessage('Business return context saved for this tax year.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save business return context.');
    } finally {
      setSaving(null);
    }
  };

  const buildPack = async () => {
    if (!activeProfileId) return;
    setBuildingPack(true);
    setError(null);
    try {
      setFilingPack(await selfAssessmentApi.getFilingPack(activeProfileId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the filing workpaper.');
    } finally {
      setBuildingPack(false);
    }
  };

  const downloadPack = () => {
    if (!filingPack || !activeProfile || filingPack.recordCount === 0) return;
    const blob = new Blob([JSON.stringify(filingPack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeProfile.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${filingPack.taxYear.replace('/', '-')}-sa103s-workpaper.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return <div className="flex min-h-[320px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading tax return readiness…</div>;
  }

  if (!activeProfile || !data) {
    return (
      <Card className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-muted-foreground">{error ?? 'Choose a business profile to review tax return readiness.'}</p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-3xl text-foreground">Tax return readiness</h1>
            <Badge variant="outline">{data.readiness.taxYear}</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-lg text-muted-foreground">
            Prepare the information behind your Self Assessment return. This is readiness only — it does not submit or file anything with HMRC.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>Refresh</Button>
      </header>

      {(error || saveMessage) && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          {error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <p>{error ?? saveMessage}</p>
        </div>
      )}

      <Card className="border-primary/20 bg-primary/5 p-5">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h2 className="font-medium text-foreground">One return, separate business sections</h2>
            <p className="mt-1 text-sm text-muted-foreground">{data.readiness.returnStructure.note}</p>
          </div>
        </div>
      </Card>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <EyeOff className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <h2 className="font-serif text-xl">Protected identity details</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your UTR and NI number are stored once for you, not for this business or tax year. They are masked after saving.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">UTR {data.identity.utrMasked && <span className="font-normal text-muted-foreground">({data.identity.utrMasked})</span>}</span>
              <Input value={utr} onChange={(event) => setUtr(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="10-digit UTR" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">National Insurance number {data.identity.nationalInsuranceNumberMasked && <span className="font-normal text-muted-foreground">({data.identity.nationalInsuranceNumberMasked})</span>}</span>
              <Input value={nationalInsuranceNumber} onChange={(event) => setNationalInsuranceNumber(event.target.value)} autoComplete="off" placeholder="e.g. QQ 12 34 56 C" />
            </label>
            <div className="flex justify-end">
              <Button onClick={() => void saveIdentity()} disabled={saving === 'identity'}>{saving === 'identity' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save protected details</Button>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-serif text-xl">Whole-return context</h2>
          <p className="mt-1 text-sm text-muted-foreground">These answers belong to you and {data.readiness.taxYear}, even if you later add another business section.</p>
          <div className="mt-5 grid gap-4">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Other taxable income</span>
              <span className="block text-xs text-muted-foreground">Include non-business taxable income. Enter £0 only if you have confirmed there is none.</span>
              <Input type="number" min="0" step="0.01" value={otherTaxableIncome} onChange={(event) => setOtherTaxableIncome(event.target.value)} placeholder="Leave blank if unknown" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">All self-employments represented or disclosed?</span>
              <select value={allSelfEmploymentsDisclosed} onChange={(event) => setAllSelfEmploymentsDisclosed(event.target.value as ConfirmationChoice)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Choose later</option>
                <option value="yes">Yes, all are represented or disclosed</option>
                <option value="no">No, another self-employment needs attention</option>
              </select>
            </label>
            <div className="flex justify-end">
              <Button onClick={() => void saveSa100()} disabled={saving === 'sa100'}>{saving === 'sa100' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save return context</Button>
            </div>
          </div>
        </Card>
      </section>

      <Card className="p-6">
        <h2 className="font-serif text-xl">Business section · {activeProfile.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">These answers apply only to this business for {data.readiness.taxYear}.</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-sm font-medium">Business description</span>
            <Textarea value={businessDescription} onChange={(event) => setBusinessDescription(event.target.value)} placeholder="What this business does" />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Self-employment start date</span>
            <Input type="date" value={selfEmploymentStartDate} onChange={(event) => setSelfEmploymentStartDate(event.target.value)} />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Accounting-period end date</span>
            <Input type="date" value={accountingPeriodEndDate} onChange={(event) => setAccountingPeriodEndDate(event.target.value)} />
          </label>
          <div className="space-y-3 md:col-span-2">
            {[
              ['accounting', accountingPeriodConfirmed, setAccountingPeriodConfirmed, 'I confirm this business’s accounting period.'],
              ['records', recordsCompleteConfirmed, setRecordsCompleteConfirmed, 'I confirm this business’s records are complete for the return period.'],
              ['figures', derivedFiguresReviewed, setDerivedFiguresReviewed, 'I have reviewed the turnover, allowable expenses, and profit derived from Financial Memory.'],
            ].map(([key, checked, setChecked, label]) => (
              <label key={key as string} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={checked as boolean} onChange={(event) => (setChecked as (value: boolean) => void)(event.target.checked)} />
                <span>{label as string}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => void saveSa103s()} disabled={saving === 'sa103s'}>{saving === 'sa103s' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save business section</Button>
        </div>
      </Card>

      <section className="grid gap-6 lg:grid-cols-2">
        <ReadinessGroup title="Completed information" description="Saved information and confirmations ready to use." concepts={data.readiness.groups.complete} tone="complete" />
        <ReadinessGroup title="Derived from your records" description="Calculated from Financial Memory; review before filing." concepts={data.readiness.groups.derived} tone="derived" />
        <ReadinessGroup title="Missing information" description="Required details that still need an answer." concepts={data.readiness.groups.missing} tone="missing" />
        <ReadinessGroup title="Needs your confirmation" description="Important statements we cannot safely infer." concepts={data.readiness.groups.needsConfirmation} tone="confirmation" />
      </section>

      <Card className="p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h2 className="font-serif text-xl">Your tax filing workpaper</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">One read-only check maps every saved record to its SA103S box, compares actual expenses with the trading allowance, and shows anything that still blocks filing.</p>
          </div>
          <Button onClick={() => void buildPack()} disabled={buildingPack}>
            {buildingPack ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Check and build
          </Button>
        </div>
        {filingPack && (
          <div className="mt-5 space-y-5">
            {filingPack.recordCount === 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <p className="font-medium">No confirmed records are available for {filingPack.taxYear}.</p>
                <p className="mt-1">Do not confirm the £0 figures. Add or recover your records first; this page cannot create financial data.</p>
              </div>
            )}
            <div className={`rounded-lg border p-4 ${filingPack.filingReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
              <p className="font-medium">{filingPack.filingReady ? 'Ready for final human filing review' : `${filingPack.blockers.length} item${filingPack.blockers.length === 1 ? '' : 's'} to resolve`}</p>
              <p className="mt-1 text-sm text-muted-foreground">{filingPack.disclaimer}</p>
              {filingPack.blockers.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{filingPack.blockers.map((blocker, index) => <li key={`${blocker.code}-${blocker.recordId ?? index}`}>{blocker.message}</li>)}</ul>}
            </div>
            {filingPack.recordCount > 0 && <div className="grid gap-4 md:grid-cols-2">
              <Card className="p-4">
                <p className="text-sm font-medium">Tax optimisation check</p>
                <p className="mt-2 text-sm text-muted-foreground">{filingPack.decision.explanation}</p>
                <p className="mt-2 text-xs text-amber-700">{filingPack.decision.warning}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-medium">SA103S figures</p>
                <p className="mt-2 text-sm">Box 20 expenses: {money(filingPack.calculated.box20TotalAllowableExpenses)}</p>
                <p className="text-sm">Box 21 profit: {money(filingPack.calculated.box21NetProfit)}</p>
                <p className="text-sm">Box 22 loss: {money(filingPack.calculated.box22NetLoss)}</p>
              </Card>
            </div>}
            <div className="flex justify-end">
              <Button variant="outline" onClick={downloadPack} disabled={filingPack.recordCount === 0}><Download className="mr-2 h-4 w-4" />Download traceable workpaper</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}