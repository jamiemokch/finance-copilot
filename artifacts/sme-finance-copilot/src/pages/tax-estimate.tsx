import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, BookOpen, ChevronDown, ChevronUp, Loader2, ReceiptText, Settings2 } from 'lucide-react';
import { Card, Badge, Button } from '@/components/ui';
import { incomeTaxEstimateApi, type APIIncomeTaxEstimateResponse } from '@/lib/api';
import { useStore } from '@/lib/store';

const money = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);

const shortDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function TaxEstimate() {
  const { activeProfileId, profiles, transactions } = useStore();
  const activeProfile = profiles.find(profile => profile.id === activeProfileId);
  const [data, setData] = useState<APIIncomeTaxEstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const recordVersion = useMemo(
    () => transactions.map(record => `${record.id}:${record.date}:${record.amount}:${record.category}`).join('|'),
    [transactions],
  );

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    incomeTaxEstimateApi.get(activeProfileId)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the estimate.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeProfileId, activeProfile?.otherTaxableIncome, activeProfile?.taxYear, activeProfile?.accountingBasis, recordVersion]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your estimate…
      </div>
    );
  }

  if (error) {
    return (
      <Card className="mx-auto max-w-2xl p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
          <div>
            <h1 className="font-serif text-xl">We could not load your estimate</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const { estimate, profitLoss } = data;
  const hasProfit = profitLoss.profitLoss >= 0;
  const needsOtherIncome = estimate.missingInputs.some(input => input.startsWith('Other taxable income'));

  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-in fade-in duration-500">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl text-foreground">Estimated income tax</h1>
          <Badge variant="outline">Estimate only</Badge>
        </div>
        <p className="mt-2 text-lg text-muted-foreground">
          A simple view of {activeProfile?.name ?? 'your business'} for {data.taxYear}. This is not a filed return or a guaranteed liability.
        </p>
      </header>

      <Card className={`p-6 shadow-sm ${estimate.status === 'complete' ? 'border-primary/25' : 'border-amber-300'}`}>
        {estimate.status === 'complete' ? (
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Estimated income tax on current YTD income</p>
              <p className="mt-1 font-serif text-4xl text-foreground">{money(estimate.estimatedIncomeTax ?? 0)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Uses {data.taxYear} rates and your {estimate.accountingBasis === 'accrual' ? 'accrual' : 'cash'} basis profile context.
              </p>
            </div>
            <div className="rounded-lg bg-secondary/60 px-4 py-3 text-sm">
              <p className="text-muted-foreground">Taxable income used</p>
              <p className="mt-0.5 font-semibold">{money(estimate.taxableIncome ?? 0)}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <h2 className="font-serif text-xl">Estimate incomplete</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  We cannot calculate an amount yet because we still need: {estimate.missingInputs.join(' and ')}.
                </p>
              </div>
            </div>
            {needsOtherIncome && (
              <Link href="/settings">
                <Button variant="outline" className="cursor-pointer gap-2">
                  <Settings2 className="h-4 w-4" /> Add tax details
                </Button>
              </Link>
            )}
          </div>
        )}
      </Card>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <ReceiptText className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-serif text-2xl">Business profit input</h2>
            <p className="text-sm text-muted-foreground">
              Saved Financial Memory records from {shortDate(data.period.start)} to {shortDate(data.period.end)}.
            </p>
          </div>
        </div>
        <Card className="overflow-hidden shadow-sm">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Income</p>
              <p className="mt-2 font-serif text-2xl text-emerald-700">{money(profitLoss.totalIncome)}</p>
            </div>
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expenses</p>
              <p className="mt-2 font-serif text-2xl text-destructive">{money(profitLoss.totalExpenses)}</p>
            </div>
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Profit / loss</p>
              <p className={`mt-2 font-serif text-2xl ${hasProfit ? 'text-foreground' : 'text-destructive'}`}>
                {money(profitLoss.profitLoss)}
              </p>
            </div>
          </div>
          <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {profitLoss.recordCount} canonical ledger record{profitLoss.recordCount === 1 ? '' : 's'} • Tax calculation input: {money(profitLoss.taxableBusinessProfit)} after allowable expense treatment
          </div>
        </Card>
      </section>

      <section>
        <h2 className="font-serif text-2xl">Category breakdown</h2>
        <p className="mt-1 text-sm text-muted-foreground">Open a category to review the underlying Financial Memory records.</p>
        <Card className="mt-4 overflow-hidden shadow-sm">
          {data.categories.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No saved records fall within this tax-year-to-date period yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.categories.map(category => {
                const key = `${category.recordType}:${category.category}`;
                const expanded = expandedCategory === key;
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => setExpandedCategory(expanded ? null : key)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/30"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className={category.recordType === 'income' ? 'border-emerald-200 text-emerald-700' : ''}>
                          {category.recordType === 'income' ? 'Income' : 'Expense'}
                        </Badge>
                        <div>
                          <p className="font-medium">{category.category}</p>
                          <p className="text-xs text-muted-foreground">{category.records.length} ledger record{category.records.length === 1 ? '' : 's'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={category.recordType === 'income' ? 'font-semibold text-emerald-700' : 'font-semibold'}>
                          {money(category.amount)}
                        </span>
                        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>
                    {expanded && (
                      <div className="border-t border-border bg-secondary/20 px-5 py-3">
                        <div className="space-y-2">
                          {category.records.map(record => (
                            <Link key={record.id} href={`/memory/${record.id}`} className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 text-sm hover:ring-1 hover:ring-primary/30">
                              <span>
                                <span className="font-medium">{record.description}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{shortDate(record.date)}</span>
                              </span>
                              <span className="font-medium">{money(Math.abs(record.amount))}</span>
                            </Link>
                          ))}
                        </div>
                        <Link href="/memory" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          <BookOpen className="h-3.5 w-3.5" /> Open Financial Memory
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      <section>
        <h2 className="font-serif text-2xl">How this estimate is built</h2>
        <Card className="mt-4 p-5 shadow-sm">
          {estimate.status === 'complete' && (
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Business profit</p><p className="font-semibold">{money(estimate.businessProfitInput)}</p></div>
              <div><p className="text-xs text-muted-foreground">Other taxable income</p><p className="font-semibold">{money(estimate.otherTaxableIncome ?? 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">Personal Allowance used</p><p className="font-semibold">{money(estimate.personalAllowance ?? 0)}</p></div>
            </div>
          )}
          {estimate.bands.length > 0 && (
            <div className="mb-5 divide-y divide-border rounded-md border border-border">
              {estimate.bands.map(band => (
                <div key={band.label} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{band.label} ({band.rate}%) on {money(band.taxableAmount)}</span>
                  <span className="font-medium">{money(band.tax)}</span>
                </div>
              ))}
            </div>
          )}
          <ul className="space-y-2 text-sm text-muted-foreground">
            {estimate.assumptions.map(assumption => <li key={assumption} className="flex gap-2"><span className="text-primary">•</span><span>{assumption}</span></li>)}
          </ul>
        </Card>
      </section>
    </div>
  );
}