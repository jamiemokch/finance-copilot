import { Card, Button, Badge } from '@/components/ui';
import { useStore } from '@/lib/store';
import {
  Briefcase, Building2, UserCircle, Check, ShieldCheck,
  RotateCcw, Database, Save, Loader2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const INDUSTRIES = [
  { value: 'freelance_tech',        label: 'Technology / Freelance Tech' },
  { value: 'freelance_creative',    label: 'Creative / Design / Media' },
  { value: 'consulting',            label: 'Consulting / Advisory' },
  { value: 'retail',                label: 'Retail / eCommerce' },
  { value: 'hospitality',           label: 'Hospitality / Food & Drink' },
  { value: 'construction',          label: 'Construction / Trades' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'property',              label: 'Property / Landlord' },
  { value: 'other',                 label: 'Other' },
];

const TAX_YEARS = ['2023/24', '2024/25', '2025/26'];

function currentUkTaxYearDates() {
  const now = new Date();
  const year = now.getFullYear();
  const hasStarted = now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6);
  const startYear = hasStarted ? year : year - 1;
  return {
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  };
}

export default function Settings() {
  const {
    profiles, activeProfileId, setActiveProfileId,
    updateProfile, resetDemoData, loadSampleData,
  } = useStore();

  const activeProfile = profiles.find(p => p.id === activeProfileId);

  const [industry, setIndustry] = useState(
    (activeProfile as Record<string, unknown>)?.industry as string ?? 'other'
  );
  const [vatRegistered, setVatRegistered] = useState(
    (activeProfile as Record<string, unknown>)?.vatRegistered as boolean ?? false
  );
  const [taxYear, setTaxYear] = useState(
    (activeProfile as Record<string, unknown>)?.taxYear as string ?? '2024/25'
  );
  const [accountingBasis, setAccountingBasis] = useState(
    (activeProfile as Record<string, unknown>)?.accountingBasis as string ?? 'cash'
  );
  const [openingPositionStatus, setOpeningPositionStatus] = useState(
    activeProfile?.openingPositionStatus ?? 'not_started'
  );
  const [openingBalance, setOpeningBalance] = useState(
    activeProfile?.openingBalance == null ? '' : String(activeProfile.openingBalance)
  );
  const [openingDetails, setOpeningDetails] = useState(activeProfile?.openingDetails ?? '');
  const defaultCoverage = currentUkTaxYearDates();
  const [coverageStartDate, setCoverageStartDate] = useState(activeProfile?.coverageStartDate ?? defaultCoverage.start);
  const [coverageEndDate, setCoverageEndDate] = useState(activeProfile?.coverageEndDate ?? defaultCoverage.end);

  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState<'sample' | 'reset' | null>(null);

  useEffect(() => {
    const coverage = currentUkTaxYearDates();
    setIndustry(activeProfile?.industry ?? 'other');
    setVatRegistered(activeProfile?.vatRegistered ?? false);
    setTaxYear(activeProfile?.taxYear ?? '2024/25');
    setAccountingBasis(activeProfile?.accountingBasis ?? 'cash');
    setOpeningPositionStatus(activeProfile?.openingPositionStatus ?? 'not_started');
    setOpeningBalance(activeProfile?.openingBalance == null ? '' : String(activeProfile.openingBalance));
    setOpeningDetails(activeProfile?.openingDetails ?? '');
    setCoverageStartDate(activeProfile?.coverageStartDate ?? coverage.start);
    setCoverageEndDate(activeProfile?.coverageEndDate ?? coverage.end);
    setSaveError(null);
  }, [activeProfileId]);

  const getTypeIcon = (type: string) => {
    if (type === 'company') return <Building2 className="w-5 h-5 text-purple-500" />;
    if (type === 'landlord') return <Building2 className="w-5 h-5 text-blue-500" />;
    return <Briefcase className="w-5 h-5 text-amber-600" />;
  };

  const getTypeName = (type: string) =>
    type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const handleSave = async () => {
    if (!activeProfileId) return;
    const parsedOpeningBalance = openingBalance.trim() === '' ? null : Number(openingBalance);
    if (parsedOpeningBalance !== null && !Number.isFinite(parsedOpeningBalance)) {
      setSaveError('Opening balance must be a valid number.');
      return;
    }
    if ((coverageStartDate && !coverageEndDate) || (!coverageStartDate && coverageEndDate)) {
      setSaveError('Add both coverage dates, or leave both for later.');
      return;
    }
    if (coverageStartDate && coverageEndDate && coverageStartDate > coverageEndDate) {
      setSaveError('Coverage end date must be on or after the start date.');
      return;
    }
    if (openingPositionStatus === 'complete' && parsedOpeningBalance === null && !openingDetails.trim()) {
      setSaveError('Add an opening balance or a short detail before marking this complete.');
      return;
    }

    setSaveError(null);
    setSaving(true);
    try {
      // updateProfile persists to API and updates the store's profiles array in one step,
      // so derived values (tax deadline, SA year label, etc.) reflect the new values immediately.
      await updateProfile(activeProfileId, {
        industry,
        vatRegistered,
        taxYear,
        accountingBasis,
        openingPositionStatus,
        openingBalance: parsedOpeningBalance,
        openingDetails: openingDetails.trim() || null,
        coverageStartDate: coverageStartDate || null,
        coverageEndDate: coverageEndDate || null,
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (err) {
      console.error('Settings save failed:', err);
      setSaveError('Could not save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadSample = async () => {
    setDemoLoading('sample');
    try {
      await loadSampleData();
    } catch (err) {
      console.error('Load sample failed:', err);
    } finally {
      setDemoLoading(null);
    }
  };

  const handleReset = async () => {
    if (!confirm('This will delete all records and re-create the demo dataset. Are you sure?')) return;
    setDemoLoading('reset');
    try {
      await resetDemoData();
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setDemoLoading(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Manage your profile context and data.
        </p>
      </div>

      {/* ── Profile switcher ── */}
      <section>
        <h2 className="text-xl font-serif mb-4">Your Profiles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {profiles.map(profile => (
            <Card
              key={profile.id}
              className={`p-5 cursor-pointer transition-all border-2 ${activeProfileId === profile.id ? 'border-primary shadow-md bg-primary/5' : 'border-transparent hover:border-border shadow-sm'}`}
              onClick={() => setActiveProfileId(profile.id)}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-background rounded-full border border-border shadow-sm">
                    {getTypeIcon(profile.type)}
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{profile.name}</h3>
                    <p className="text-xs text-muted-foreground">{getTypeName(profile.type)}</p>
                  </div>
                </div>
                {activeProfileId === profile.id && <Check className="w-5 h-5 text-primary" />}
              </div>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          Financial data stays separated per profile. To create a new profile, sign out and sign back in.
        </p>
      </section>

      {/* ── About your business ── */}
      {activeProfile && (
        <section>
          <h2 className="text-xl font-serif mb-4">About your business</h2>
          <Card className="p-6 shadow-sm space-y-5">
            {/* Industry */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Industry</label>
              <select
                className="w-full text-sm p-2.5 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={industry}
                onChange={e => setIndustry(e.target.value)}
              >
                {INDUSTRIES.map(ind => (
                  <option key={ind.value} value={ind.value}>{ind.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Used to improve AI categorisation accuracy.</p>
            </div>

            {/* Tax year */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Tax year</label>
              <div className="flex gap-3">
                {TAX_YEARS.map(yr => (
                  <button
                    key={yr}
                    onClick={() => setTaxYear(yr)}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all cursor-pointer ${
                      taxYear === yr ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </div>

            {/* Accounting basis */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Accounting basis</label>
              <div className="flex gap-3">
                {[
                  { value: 'cash',    label: 'Cash basis' },
                  { value: 'accrual', label: 'Accrual basis' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setAccountingBasis(opt.value)}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all cursor-pointer ${
                      accountingBasis === opt.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* VAT registered */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">VAT registered?</label>
              <div className="flex gap-3">
                {[
                  { value: true,  label: 'Yes — VAT registered' },
                  { value: false, label: 'No' },
                ].map(opt => (
                  <button
                    key={String(opt.value)}
                    onClick={() => setVatRegistered(opt.value)}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all cursor-pointer ${
                      vatRegistered === opt.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="cursor-pointer gap-2"
              >
                {saving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : saveOk
                    ? <><Check className="w-4 h-4" /> Saved!</>
                    : <><Save className="w-4 h-4" /> Save changes</>
                }
              </Button>
            </div>
          </Card>
        </section>
      )}

      {/* ── Opening position & activity coverage ── */}
      {activeProfile && (
        <section>
          <h2 className="text-xl font-serif mb-1">Opening position &amp; activity coverage</h2>
          <p className="text-muted-foreground text-sm mb-4">
            Record the period your current-year records cover. Opening details are optional and can be completed later.
          </p>
          <Card className="p-6 shadow-sm space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">Business activity covered by these records</label>
              <p className="text-xs text-muted-foreground mb-3">
                Confirm the period for the current UK tax year. You can edit this whenever your records change.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Coverage start date</span>
                  <input
                    type="date"
                    value={coverageStartDate}
                    onChange={event => setCoverageStartDate(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Coverage end date</span>
                  <input
                    type="date"
                    value={coverageEndDate}
                    onChange={event => setCoverageEndDate(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <label className="text-sm font-medium block mb-2">Opening position</label>
              <p className="text-xs text-muted-foreground mb-3">
                This is optional context for the start of the covered period. It does not change your saved records.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Setup status</span>
                  <select
                    value={openingPositionStatus}
                    onChange={event => setOpeningPositionStatus(event.target.value as 'not_started' | 'skipped' | 'complete')}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="not_started">Not set up yet</option>
                    <option value="skipped">I’ll add this later</option>
                    <option value="complete">Opening details added</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Opening balance (optional)</span>
                  <input
                    inputMode="decimal"
                    type="number"
                    step="0.01"
                    value={openingBalance}
                    onChange={event => setOpeningBalance(event.target.value)}
                    placeholder="0.00"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
              </div>
              <label className="block mt-4 space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Opening details (optional)</span>
                <textarea
                  value={openingDetails}
                  onChange={event => setOpeningDetails(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="For example, money held for the business at the start of this period."
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>

            {saveError && (
              <p className="text-sm text-destructive" role="alert">{saveError}</p>
            )}

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="cursor-pointer gap-2">
                {saving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : saveOk
                    ? <><Check className="w-4 h-4" /> Saved!</>
                    : <><Save className="w-4 h-4" /> Save setup</>
                }
              </Button>
            </div>
          </Card>
        </section>
      )}

      {/* ── Demo data ── */}
      <section>
        <h2 className="text-xl font-serif mb-1">Demo data</h2>
        <p className="text-muted-foreground text-sm mb-4">
          Use these controls to explore the product with realistic UK sole-trader data.
        </p>
        <Card className="p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <h3 className="font-medium text-sm">Load sample transactions</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Adds a year's worth of demo income and expenses to your current profile.
              </p>
            </div>
            <Button
              variant="outline"
              className="cursor-pointer gap-2 shrink-0"
              onClick={handleLoadSample}
              disabled={demoLoading !== null}
            >
              {demoLoading === 'sample'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                : <><Database className="w-4 h-4" /> Load sample data</>
              }
            </Button>
          </div>

          <div className="border-t border-border" />

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <h3 className="font-medium text-sm text-destructive">Reset all data</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Deletes all records and re-seeds the demo dataset from scratch.
              </p>
            </div>
            <Button
              variant="destructive"
              className="cursor-pointer gap-2 shrink-0"
              onClick={handleReset}
              disabled={demoLoading !== null}
            >
              {demoLoading === 'reset'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Resetting…</>
                : <><RotateCcw className="w-4 h-4" /> Reset all data</>
              }
            </Button>
          </div>
        </Card>
      </section>

      {/* ── Alpha notice ── */}
      <div className="text-xs text-muted-foreground bg-secondary/30 border border-border rounded-lg p-4 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Alpha-lite</p>
          <p className="mt-0.5">Not connected to HMRC, bank feeds, or any external data provider. All AI analysis runs on data you provide.</p>
        </div>
      </div>
    </div>
  );
}
