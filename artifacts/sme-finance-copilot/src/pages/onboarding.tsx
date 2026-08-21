import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import {
  Briefcase, Building2, UserCircle, ChevronRight, ChevronLeft,
  Loader2, CheckCircle2, Upload,
} from 'lucide-react';
import { cn } from '@/components/ui';

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

type ProfileType = 'sole_trader' | 'landlord' | 'company';

/** Derive the SA filing deadline from a tax year string e.g. "2024/25" → "31 Jan 2026" */
function taxYearToDeadline(taxYear: string): string {
  const startYear = parseInt(taxYear.split('/')[0], 10);
  if (isNaN(startYear)) return '31 Jan 2026';
  return `31 Jan ${startYear + 2}`;
}

export default function Onboarding() {
  const { addProfile, setActiveProfileId } = useStore();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: '',
    type: 'sole_trader' as ProfileType,
    industry: 'other',
    taxYear: '2024/25',
    accountingBasis: 'cash' as 'cash' | 'accrual',
    vatRegistered: false,
  });

  const set = (key: keyof typeof form, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // ── Validation ──
  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Please enter your business name.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleStep1Next = () => {
    if (validateStep1()) setStep(2);
  };

  const handleStep2Next = () => setStep(3);

  // ── Submit ──
  const handleFinish = async () => {
    setLoading(true);
    try {
      const id = await addProfile({
        name: form.name.trim(),
        type: form.type,
        industry: form.industry,
        taxYear: form.taxYear,
        accountingBasis: form.accountingBasis,
        vatRegistered: form.vatRegistered,
      });
      setActiveProfileId(id);
      navigate('/ingest');
    } catch (err) {
      console.error('Onboarding submit failed:', err);
      setErrors({ submit: 'Could not create your profile — please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const typeOptions = [
    { value: 'sole_trader' as const, label: 'Sole Trader',     sub: 'Self-assessment, expenses, VAT', icon: Briefcase  },
    { value: 'landlord'    as const, label: 'Landlord',         sub: 'Rental income, property costs', icon: Building2  },
    { value: 'company'     as const, label: 'Limited Company',  sub: 'Corp tax, payroll',             icon: UserCircle },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

        {/* Progress dots */}
        <div className="flex items-center gap-3">
          {[1, 2, 3].map(s => (
            <div key={s} className={cn(
              'h-1.5 flex-1 rounded-full transition-all duration-300',
              s <= step ? 'bg-primary' : 'bg-secondary',
            )} />
          ))}
        </div>

        {/* ── Step 1: Business info ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <h1 className="text-3xl font-serif font-bold">Tell us about your business</h1>
              <p className="text-muted-foreground">
                We tailor AI categorisation and tax advice to your sector.
              </p>
            </div>

            {/* Business name */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Business name</label>
              <input
                type="text"
                placeholder="e.g. Alex Johnson Consulting"
                value={form.name}
                onChange={e => { set('name', e.target.value); setErrors({}); }}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20',
                  errors.name ? 'border-destructive ring-1 ring-destructive' : 'border-border',
                )}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            {/* Profile type */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Business structure</label>
              <div className="grid grid-cols-3 gap-3">
                {typeOptions.map(opt => {
                  const Icon = opt.icon;
                  const active = form.type === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => set('type', opt.value)}
                      className={cn(
                        'p-3 rounded-xl border-2 flex flex-col items-center gap-2 text-center transition-all cursor-pointer',
                        active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40',
                      )}
                    >
                      <div className={cn('p-2 rounded-full', active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-xs">{opt.label}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.sub}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Industry */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Industry</label>
              <select
                className="w-full text-sm p-2.5 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={form.industry}
                onChange={e => set('industry', e.target.value)}
              >
                {INDUSTRIES.map(ind => (
                  <option key={ind.value} value={ind.value}>{ind.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Improves AI accuracy for your sector's allowable expenses.</p>
            </div>

            <Button className="w-full cursor-pointer gap-2" onClick={handleStep1Next}>
              Next — Tax preferences <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* ── Step 2: Tax setup ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <h1 className="text-3xl font-serif font-bold">Tax preferences</h1>
              <p className="text-muted-foreground">These help us calculate your SA deadline and estimate tax correctly.</p>
            </div>

            {/* Tax year */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Tax year</label>
              <div className="grid grid-cols-3 gap-3">
                {(['2023/24', '2024/25', '2025/26'] as const).map(yr => (
                  <button
                    key={yr}
                    onClick={() => set('taxYear', yr)}
                    className={cn(
                      'p-3 rounded-xl border-2 text-sm font-medium text-center transition-all cursor-pointer',
                      form.taxYear === yr
                        ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                        : 'border-border hover:border-primary/40 text-foreground',
                    )}
                  >
                    {yr}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                SA filing deadline for {form.taxYear}: <strong>{taxYearToDeadline(form.taxYear)}</strong>.
                UK tax year runs 6 Apr – 5 Apr.
              </p>
            </div>

            {/* Accounting basis */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">How do you record income?</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'cash',    label: 'Cash basis',    sub: 'Record when money arrives or leaves (most sole traders)' },
                  { value: 'accrual', label: 'Accrual basis', sub: 'Record when invoiced or incurred' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => set('accountingBasis', opt.value)}
                    className={cn(
                      'p-4 rounded-xl border-2 text-left transition-all cursor-pointer',
                      form.accountingBasis === opt.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-primary/40',
                    )}
                  >
                    <p className="font-semibold text-sm">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-tight">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* VAT */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Are you VAT registered?</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: true,  label: 'Yes — VAT registered' },
                  { value: false, label: 'No — not yet registered' },
                ].map(opt => (
                  <button
                    key={String(opt.value)}
                    onClick={() => set('vatRegistered', opt.value)}
                    className={cn(
                      'p-3 rounded-xl border-2 text-sm font-medium text-center transition-all cursor-pointer',
                      form.vatRegistered === opt.value
                        ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                        : 'border-border hover:border-primary/40 text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">VAT threshold is £90,000 rolling 12-month turnover (2024/25).</p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 cursor-pointer gap-2" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <Button className="flex-1 cursor-pointer gap-2" onClick={handleStep2Next}>
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Confirmation ── */}
        {step === 3 && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-serif font-bold">
                You're all set{form.name ? `, ${form.name.split(' ')[0]}` : ''}!
              </h1>
              <p className="text-muted-foreground text-lg">
                Let's add your first record to build your financial picture.
              </p>
            </div>

            {/* Summary card */}
            <div className="bg-secondary/30 border border-border rounded-xl p-5 text-left space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your profile</h3>
              {[
                { label: 'Business',  value: form.name },
                { label: 'Type',      value: form.type.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') },
                { label: 'Industry',  value: INDUSTRIES.find(i => i.value === form.industry)?.label ?? form.industry },
                { label: 'Tax year',  value: form.taxYear },
                { label: 'SA deadline', value: taxYearToDeadline(form.taxYear) },
                { label: 'Accounting', value: form.accountingBasis === 'cash' ? 'Cash basis' : 'Accrual basis' },
                { label: 'VAT',       value: form.vatRegistered ? 'Registered' : 'Not registered' },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium">{row.value}</span>
                </div>
              ))}
            </div>

            {errors.submit && (
              <p className="text-sm text-destructive">{errors.submit}</p>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="cursor-pointer gap-2" onClick={() => setStep(2)} disabled={loading}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <Button className="flex-1 cursor-pointer gap-2" onClick={handleFinish} disabled={loading}>
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                  : <><Upload className="w-4 h-4" /> Add your first record</>
                }
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
