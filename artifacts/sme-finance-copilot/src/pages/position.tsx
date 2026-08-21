import { Card, Badge, Button } from '@/components/ui';
import { useStore, PositionItem, PLRevenue, PLExpense, TaxLine, AREntry, APEntry, CashAccount, CashFlow } from '@/lib/store';
import { useState } from 'react';
import { ShieldCheck, HelpCircle, AlertCircle, ChevronDown, ChevronUp, Upload, FileText, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';

export default function Position() {
  const { positionItems, activeProfileId, profiles, plBreakdown, taxCalculation, arEntries, apEntries, cashBreakdown } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeItems = positionItems.filter(i => i.profileId === activeProfileId);

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
      const totalExp = plBreakdown.expenses.reduce((acc, curr) => acc + curr.amount, 0);
      return (
        <div className="space-y-6">
          <div>
            <h4 className="font-semibold text-sm mb-3">Revenues</h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="text-left font-medium p-3">Label</th>
                    <th className="text-left font-medium p-3">Basis</th>
                    <th className="text-right font-medium p-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plBreakdown.revenues.map((rev: PLRevenue, i: number) => (
                    <tr key={i} className="bg-background">
                      <td className="p-3">{rev.label}</td>
                      <td className="p-3 text-muted-foreground text-xs">{rev.basis}</td>
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
            <h4 className="font-semibold text-sm mb-3">Expenses</h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="text-left font-medium p-3">Category / Label</th>
                    <th className="text-left font-medium p-3">Basis</th>
                    <th className="text-right font-medium p-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plBreakdown.expenses.map((exp: PLExpense, i: number) => (
                    <tr key={i} className="bg-background">
                      <td className="p-3">
                        <div className="font-medium">{exp.category}</div>
                        <div className="text-muted-foreground text-xs">{exp.label}</div>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">{exp.basis}</td>
                      <td className="p-3 text-right font-medium text-destructive">£{exp.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/20">
                    <td colSpan={2} className="p-3 font-semibold text-right">Total Expenses</td>
                    <td className="p-3 font-semibold text-right">£{totalExp.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
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
                  <AlertCircle className="w-4 h-4" /> Unresolved Items
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
                    {new Date(ar.dueDate).toLocaleDateString()}
                    {ar.isOverdue && (
                      <Badge variant="destructive" className="ml-2 py-0 h-5 text-[10px]">
                        Overdue ({ar.daysOverdue}d)
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-right font-medium">£{ar.amount.toLocaleString()}</td>
                </tr>
              ))}
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
                    {new Date(ap.dueDate).toLocaleDateString()}
                    {ap.isOverdue && (
                      <Badge variant="destructive" className="ml-2 py-0 h-5 text-[10px]">
                        Overdue
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-right font-medium">£{ap.amount.toLocaleString()}</td>
                </tr>
              ))}
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
                <span className="text-amber-700 flex items-center gap-1">Estimated Tax Reserve</span>
                <span className="font-medium text-amber-700">-£{cashBreakdown.taxReserve.toLocaleString()}</span>
              </div>
              <div className="pt-3 border-t border-border flex justify-between font-semibold mt-auto">
                <span>Net Available Cash</span>
                <span>£{netAvailable.toLocaleString()}</span>
              </div>
            </Card>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2"><ArrowRight className="w-4 h-4 text-emerald-500" /> Near-term Inflows</h4>
              <div className="space-y-2">
                {cashBreakdown.nearTermInflows.map((inf: CashFlow, i: number) => (
                  <div key={i} className="flex justify-between text-sm bg-secondary/30 p-2 rounded">
                    <div>
                      <div className="font-medium">{inf.label}</div>
                      <div className="text-xs text-muted-foreground">{new Date(inf.expectedDate).toLocaleDateString()}</div>
                    </div>
                    <div className="font-medium text-emerald-700">+£{inf.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2"><ArrowRight className="w-4 h-4 text-destructive" /> Near-term Outflows</h4>
              <div className="space-y-2">
                {cashBreakdown.nearTermOutflows.map((out: CashFlow, i: number) => (
                  <div key={i} className="flex justify-between text-sm bg-secondary/30 p-2 rounded">
                    <div>
                      <div className="font-medium">{out.label}</div>
                      <div className="text-xs text-muted-foreground">{new Date(out.expectedDate).toLocaleDateString()}</div>
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
                    {item.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    If these assumptions are wrong, the figure will change.
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">Financial position</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-lg">
            The current state of {activeProfile?.name}. Click any number to see exactly how it was calculated.
          </p>
        </div>
        <Link href="/ingest">
          <Button variant="default" className="gap-2 cursor-pointer shrink-0">
            <Upload className="w-4 h-4" /> Upload records
          </Button>
        </Link>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-serif text-primary border-b border-border pb-2">Headline figures</h2>
        <div className="space-y-3">
          {kpis.map(renderItem)}
        </div>
      </div>

      {facts.length > 0 && (
        <div className="space-y-4 pt-4">
          <h2 className="text-xl font-serif text-primary border-b border-border pb-2">Background facts</h2>
          <div className="space-y-3">
            {facts.map(renderItem)}
          </div>
        </div>
      )}
    </div>
  );
}
