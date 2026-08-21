import { Card, Badge, Button } from '@/components/ui';
import { useStore, PositionItem, PLRevenue, PLExpense, TaxLine, AREntry, APEntry, CashAccount, CashFlow } from '@/lib/store';
import { useState } from 'react';
import { ShieldCheck, HelpCircle, AlertCircle, ChevronDown, ChevronUp, Upload, FileText, ArrowRight, BookMarked, TrendingUp } from 'lucide-react';
import { Link } from 'wouter';

export default function Position() {
  const { positionItems, activeProfileId, profiles, plBreakdown, taxCalculation, arEntries, apEntries, cashBreakdown, decisionMemory } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeItems = positionItems.filter(i => i.profileId === activeProfileId);
  const activeDecisionMemory = decisionMemory.filter(d => d.profileId === activeProfileId && d.status === 'committed');

  const kpis = activeItems.filter(i => i.type === 'kpi');
  const facts = activeItems.filter(i => i.type === 'fact');

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getConfidenceIcon = (confidence: string) => {
    if (confidence === 'high') return <ShieldCheck className="w-4 h-4 text-emerald-600" />;
    if (confidence === 'medium') return <HelpCircle className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-red-500" />;
  };

  const renderDrilldown = (item: PositionItem) => {
    if (item.title === 'YTD Profit/Loss' && plBreakdown) {
      const totalRev = plBreakdown.revenues.reduce((acc, curr) => acc + curr.amount, 0);
      const totalConfirmed = plBreakdown.confirmedExpenses.reduce((acc, curr) => acc + curr.amount, 0);
      const totalPending = plBreakdown.pendingExpenses.reduce((acc, curr) => acc + curr.amount, 0);
      const confirmedProfit = totalRev - totalConfirmed;
      return (
        <div className="space-y-6">
          <div>
            <h4 className="font-semibold text-sm mb-3">Revenues</h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="text-left font-medium p-3">Label</th>
                    <th className="text-left font-medium p-3">Basis / Evidence</th>
                    <th className="text-right font-medium p-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plBreakdown.revenues.map((rev: PLRevenue, i: number) => (
                    <tr key={i} className="bg-background">
                      <td className="p-3">{rev.label}</td>
                      <td className="p-3 text-muted-foreground text-xs">
                        <div>{rev.basis}</div>
                        {rev.evidenceRef && <div className="text-primary/70 mt-0.5">↳ {rev.evidenceRef}</div>}
                      </td>
                      <td className="p-3 text-right font-medium text-emerald-700">£{rev.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/20">
                    <td colSpan={2} className="p-3 font-semibold text-right">Total Revenue</td>
                    <td className="p-3 font-semibold text-right">£{totalRev.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Confirmed Allowable Expenses</h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="text-left font-medium p-3">Category / Label</th>
                    <th className="text-left font-medium p-3">Basis / Evidence</th>
                    <th className="text-right font-medium p-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plBreakdown.confirmedExpenses.map((exp: PLExpense, i: number) => (
                    <tr key={i} className="bg-background">
                      <td className="p-3">
                        <div className="font-medium">{exp.label}</div>
                        <div className="text-muted-foreground text-xs">{exp.category}</div>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        <div>{exp.basis}</div>
                        {exp.evidenceRef && <div className="text-primary/70 mt-0.5">↳ {exp.evidenceRef}</div>}
                      </td>
                      <td className="p-3 text-right font-medium">£{exp.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/20">
                    <td colSpan={2} className="p-3 font-semibold text-right">Total Confirmed Expenses</td>
                    <td className="p-3 font-semibold text-right">£{totalConfirmed.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          {/* Headline profit */}
          <div className="border-2 border-primary/20 rounded-lg p-4 bg-primary/5 flex justify-between items-center">
            <div>
              <p className="font-semibold">YTD Profit (confirmed basis)</p>
              <p className="text-xs text-muted-foreground">£{totalRev.toLocaleString()} revenue − £{totalConfirmed.toLocaleString()} confirmed expenses</p>
            </div>
            <span className="text-2xl font-serif font-semibold">£{confirmedProfit.toLocaleString()}</span>
          </div>
          {/* Pending items */}
          {plBreakdown.pendingExpenses.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-3 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Excluded — pending Inbox resolution
              </p>
              <div className="space-y-2">
                {plBreakdown.pendingExpenses.map((exp: PLExpense, i: number) => (
                  <div key={i} className="flex justify-between text-sm text-amber-800 py-1 border-b border-amber-100 last:border-0">
                    <div>
                      <p className="font-medium">{exp.label}</p>
                      <p className="text-xs opacity-70">{exp.basis}</p>
                    </div>
                    <span className="font-medium">£{exp.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-700 mt-3">
                If both resolve as expenses: profit would be £{(confirmedProfit - totalPending).toLocaleString()}.
              </p>
            </div>
          )}
        </div>
      );
    }

    if (item.title === 'Estimated Tax' && taxCalculation) {
      return (
        <div className="space-y-6">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {taxCalculation.lines.map((line: TaxLine, i: number) => (
                  <tr key={i} className="bg-background">
                    <td className="p-3">
                      <div className="font-medium">{line.label}</div>
                      {line.note && <div className="text-muted-foreground text-xs mt-1">{line.note}</div>}
                    </td>
                    <td className="p-3 text-right font-medium">{line.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-sm bg-secondary/30 p-4 rounded-lg">
            <span className="font-semibold block mb-2">Basis: {taxCalculation.taxBasis}</span>
            {taxCalculation.unresolvedItems.length > 0 && (
              <div className="mt-4">
                <span className="font-semibold text-amber-700 flex items-center gap-1 mb-2">
                  <AlertCircle className="w-4 h-4" /> Unresolved Items (affecting this estimate)
                </span>
                <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                  {taxCalculation.unresolvedItems.map((ui: string, i: number) => <li key={i}>{ui}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (item.title === 'Accounts Receivable' && arEntries.length > 0) {
      return (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left font-medium p-3">Customer & Invoice</th>
                <th className="text-left font-medium p-3">Due Date</th>
                <th className="text-right font-medium p-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {arEntries.map((ar: AREntry, i: number) => (
                <tr key={i} className="bg-background">
                  <td className="p-3">
                    <div className="font-medium">{ar.customer}</div>
                    <div className="text-muted-foreground text-xs">{ar.invoiceRef}</div>
                  </td>
                  <td className="p-3">
                    {new Date(ar.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {ar.isOverdue && (
                      <Badge variant="destructive" className="ml-2 py-0 h-5 text-[10px]">
                        Overdue ({ar.daysOverdue}d)
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-right font-medium">£{ar.amount.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="bg-secondary/20">
                <td colSpan={2} className="p-3 font-semibold text-right">Total</td>
                <td className="p-3 font-semibold text-right">£{arEntries.reduce((s, a) => s + a.amount, 0).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    }

    if (item.title === 'Accounts Payable' && apEntries.length > 0) {
      return (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left font-medium p-3">Supplier & Detail</th>
                <th className="text-left font-medium p-3">Due Date</th>
                <th className="text-right font-medium p-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {apEntries.map((ap: APEntry, i: number) => (
                <tr key={i} className="bg-background">
                  <td className="p-3">
                    <div className="font-medium">{ap.supplier}</div>
                    <div className="text-muted-foreground text-xs">{ap.description}</div>
                  </td>
                  <td className="p-3">
                    {new Date(ap.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {ap.isOverdue && (
                      <Badge variant="destructive" className="ml-2 py-0 h-5 text-[10px]">Overdue</Badge>
                    )}
                  </td>
                  <td className="p-3 text-right font-medium">£{ap.amount.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="bg-secondary/20">
                <td colSpan={2} className="p-3 font-semibold text-right">Total</td>
                <td className="p-3 font-semibold text-right">£{apEntries.reduce((s, a) => s + a.amount, 0).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    }

    if (item.title === 'Available Cash' && cashBreakdown) {
      const netAvailable = cashBreakdown.accounts.reduce((sum: number, a: CashAccount) => sum + a.balance, 0) - cashBreakdown.taxReserve;
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4 bg-background shadow-sm border-border">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Accounts</h4>
              <div className="space-y-2">
                {cashBreakdown.accounts.map((acc: CashAccount, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{acc.name} <Badge variant="secondary" className="ml-2 font-normal text-[10px]">{acc.type}</Badge></span>
                    <span className="font-medium">£{acc.balance.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-4 bg-background shadow-sm border-border">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Ringfenced</h4>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-amber-700">Estimated Tax Reserve</span>
                <span className="font-medium text-amber-700">-£{cashBreakdown.taxReserve.toLocaleString()}</span>
              </div>
              <div className="pt-3 border-t border-border flex justify-between font-semibold mt-auto">
                <span>Net Available Cash</span>
                <span>£{netAvailable.toLocaleString()}</span>
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-emerald-500" /> Near-term Inflows
              </h4>
              <div className="space-y-2">
                {cashBreakdown.nearTermInflows.map((inf: CashFlow, i: number) => (
                  <div key={i} className="flex justify-between text-sm bg-secondary/30 p-2.5 rounded">
                    <div>
                      <div className="font-medium">{inf.label}</div>
                      <div className="text-xs text-muted-foreground">{new Date(inf.expectedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                    </div>
                    <div className="font-medium text-emerald-700">+£{inf.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-destructive" /> Near-term Outflows
              </h4>
              <div className="space-y-2">
                {cashBreakdown.nearTermOutflows.map((out: CashFlow, i: number) => (
                  <div key={i} className="flex justify-between text-sm bg-secondary/30 p-2.5 rounded">
                    <div>
                      <div className="font-medium">{out.label}</div>
                      <div className="text-xs text-muted-foreground">{new Date(out.expectedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                    </div>
                    <div className="font-medium text-destructive">-£{out.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderItem = (item: PositionItem) => {
    const isExpanded = expandedId === item.id;
    return (
      <Card key={item.id} className="overflow-hidden transition-all duration-300 shadow-sm">
        <div
          className="p-5 cursor-pointer hover:bg-secondary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          onClick={() => toggleExpand(item.id)}
        >
          <div className="flex-1">
            <h3 className="font-medium text-lg text-foreground">{item.title}</h3>
            <p className="text-sm text-muted-foreground">{item.description}</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-2xl font-serif text-foreground">{item.value}</p>
              <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground mt-1">
                {getConfidenceIcon(item.confidence)}
                <span className="capitalize">{item.confidence} confidence</span>
              </div>
            </div>
            <div className="text-muted-foreground">
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-border bg-secondary/10 p-5 space-y-8 animate-in slide-in-from-top-2 duration-200">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-4">Detailed Breakdown</h4>
              {renderDrilldown(item)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-border/50">
              {item.assumptions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">Assumptions & Risks</h4>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {item.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> If these assumptions are wrong, the figure will change.
                  </p>
                </div>
              )}
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Supporting Evidence</h4>
                {item.documents.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {item.documents.map((doc, i) => (
                      <Badge key={i} variant="secondary" className="font-normal gap-1.5 py-1 text-sm bg-background border border-border">
                        <FileText className="w-3.5 h-3.5 text-primary" /> {doc}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No formal evidence linked yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    );
  };

  // Forecast adjustments from committed decisions
  const forecastPLDelta = activeDecisionMemory.reduce((s, d) => s + d.expectedPLImpact, 0);
  const forecastCashDelta = activeDecisionMemory.reduce((s, d) => s + d.expectedCashImpact, 0);
  const forecastTaxDelta = activeDecisionMemory.reduce((s, d) => s + d.expectedTaxImpact, 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">Financial Position</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-lg">
            The current state of {activeProfile?.name}. Click any figure to see exactly how it was calculated.
          </p>
        </div>
        <Link href="/ingest">
          <Button variant="default" className="gap-2 cursor-pointer shrink-0">
            <Upload className="w-4 h-4" /> Upload records
          </Button>
        </Link>
      </div>

      {/* Actuals */}
      {kpis.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-xl font-serif text-primary border-b border-border pb-2">Headline figures</h2>
          <div className="space-y-3">{kpis.map(renderItem)}</div>
        </div>
      ) : (
        <Card className="p-10 text-center text-muted-foreground border-dashed">
          <p>No financial data for this profile yet.</p>
        </Card>
      )}

      {facts.length > 0 && (
        <div className="space-y-4 pt-4">
          <h2 className="text-xl font-serif text-primary border-b border-border pb-2">Background facts</h2>
          <div className="space-y-3">{facts.map(renderItem)}</div>
        </div>
      )}

      {/* Decision Impact — forecast if committed decisions are actioned */}
      {activeDecisionMemory.length > 0 && (
        <div className="space-y-4 pt-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <BookMarked className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-serif text-primary">Decision Impact Forecast</h2>
          </div>
          <div className="bg-secondary/30 rounded-xl border border-border p-4 text-sm text-muted-foreground flex items-start gap-2">
            <TrendingUp className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p>
              Projected impact if your {activeDecisionMemory.length} committed decision{activeDecisionMemory.length !== 1 ? 's' : ''} are actioned — shown separately from actuals.
              These are forward-looking estimates based on your stated assumptions at time of commitment.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'P&L impact (Year 1)', value: forecastPLDelta, prefix: forecastPLDelta >= 0 ? '+' : '' },
              { label: 'Cash impact (one-off)', value: forecastCashDelta, prefix: forecastCashDelta >= 0 ? '+' : '' },
              { label: 'Tax saving', value: forecastTaxDelta, prefix: '+' },
            ].map(({ label, value, prefix }) => (
              <Card key={label} className="p-4 shadow-sm bg-card">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className={`text-xl font-serif ${value >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                  {prefix}£{Math.abs(value).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Projected, not actual</p>
              </Card>
            ))}
          </div>
          <div className="space-y-3">
            {activeDecisionMemory.map(entry => (
              <Card key={entry.id} className="p-4 shadow-sm border-border">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="outline" className="text-[10px] capitalize">{entry.ideaCategory}</Badge>
                      <span className="text-xs text-muted-foreground">Committed {entry.date}</span>
                    </div>
                    <p className="font-medium text-sm">{entry.ideaTitle}</p>
                    <p className="text-sm text-foreground">{entry.userDecision}</p>
                  </div>
                  <div className="flex gap-4 text-xs shrink-0">
                    <div className="text-center">
                      <p className="text-muted-foreground">P&L yr 1</p>
                      <p className={`font-semibold ${entry.expectedPLImpact >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                        {entry.expectedPLImpact >= 0 ? '+' : ''}£{Math.abs(entry.expectedPLImpact).toLocaleString()}
                      </p>
                    </div>
                    {entry.expectedTaxImpact !== 0 && (
                      <div className="text-center">
                        <p className="text-muted-foreground">Tax saved</p>
                        <p className="font-semibold text-emerald-700">+£{entry.expectedTaxImpact.toLocaleString()}</p>
                      </div>
                    )}
                    {entry.expectedCashImpact !== 0 && (
                      <div className="text-center">
                        <p className="text-muted-foreground">Cash (one-off)</p>
                        <p className={`font-semibold ${entry.expectedCashImpact >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                          {entry.expectedCashImpact >= 0 ? '+' : ''}£{Math.abs(entry.expectedCashImpact).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center pt-2">
            To manage these decisions, go to{' '}
            <Link href="/business-ideas" className="text-primary hover:underline">Business Ideas</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
