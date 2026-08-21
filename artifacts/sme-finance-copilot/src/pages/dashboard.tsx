import { Card, Badge, Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import {
  WalletCards, Clock, CheckCircle2, ChevronRight, CheckSquare, Lightbulb,
  CalendarClock, Circle, ChevronDown, ChevronUp, AlertCircle, AlertTriangle, FileText,
  ArrowRight, TrendingUp, Banknote, X,
} from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';
import { cn } from '@/components/ui';

type ExpandedPanel = 'cash' | 'pl' | 'tax' | 'ar' | 'ap' | 'sa' | null;

export default function Dashboard() {
  const {
    positionItems, activeProfileId, profiles, inboxItems, businessIdeas,
    complianceItems, saChecklist, plBreakdown, taxCalculation, arEntries,
    apEntries, cashBreakdown, updateSAChecklistItem,
  } = useStore();

  const [expanded, setExpanded] = useState<ExpandedPanel>(null);

  const toggle = (panel: ExpandedPanel) =>
    setExpanded(prev => (prev === panel ? null : panel));

  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activePositionItems = positionItems.filter(i => i.profileId === activeProfileId);
  const activeInboxItems = inboxItems.filter(i => i.profileId === activeProfileId && i.status === 'pending');
  const activeIdeas = businessIdeas.filter(d => d.profileId === activeProfileId && d.status === 'new');
  const activeComplianceItems = complianceItems.filter(c => c.profileId === activeProfileId);
  const activeSAChecklist = saChecklist.filter(i => i.profileId === activeProfileId);

  const kpiMap = Object.fromEntries(
    activePositionItems.filter(i => i.type === 'kpi').map(i => [i.title, i])
  );

  const cashKpi = kpiMap['Available Cash'];
  const plKpi = kpiMap['YTD Profit/Loss'];
  const taxKpi = kpiMap['Estimated Tax'];
  const arKpi = kpiMap['Accounts Receivable'];
  const apKpi = kpiMap['Accounts Payable'];

  // Dashboard shows only "Do now" tier ideas with impact numbers
  const previewIdeas = activeIdeas.filter(i => i.priorityTier === 'do_now').slice(0, 3);
  const taxBalanceDue = 6900;   // canonical: IT £6,526 + NI − PoA paid
  const taxReserve = 3500;
  const taxReserveGap = taxBalanceDue - taxReserve;

  const urgentCompliance = activeComplianceItems
    .filter(c => c.status === 'due-soon' || c.status === 'overdue')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  const saTotal = activeSAChecklist.length;
  const saDone = activeSAChecklist.filter(i => i.status === 'done').length;
  const saProgressPct = saTotal > 0 ? Math.round((saDone / saTotal) * 100) : 0;
  const saMissing = activeSAChecklist.filter(i => i.status !== 'done').slice(0, 3);
  const saDeadline = activeComplianceItems.find(c => c.category === 'filing' && c.status !== 'done');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Cash reconciliation
  const totalCash = cashBreakdown.accounts.reduce((s, a) => s + a.balance, 0);
  const availableCash = totalCash - cashBreakdown.taxReserve - cashBreakdown.apDueWithin30Days;

  // P&L totals
  const totalRevenue = plBreakdown.revenues.reduce((s, r) => s + r.amount, 0);
  const confirmedExpenses = plBreakdown.confirmedExpenses.reduce((s, e) => s + e.amount, 0);
  const pendingExpenses = plBreakdown.pendingExpenses.reduce((s, e) => s + e.amount, 0);
  const confirmedProfit = totalRevenue - confirmedExpenses;

  // Panel header style helper
  const panelHeader = (label: string, value: string, panel: ExpandedPanel, isActive: boolean) => (
    <button
      onClick={() => toggle(panel)}
      className="w-full flex items-center justify-between px-4 py-3 bg-secondary/30 border-b border-border hover:bg-secondary/60 transition-colors cursor-pointer"
    >
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-serif text-lg text-foreground">{value}</span>
        {isActive ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </div>
    </button>
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">{greeting}.</h1>
          <p className="text-muted-foreground mt-1 text-lg">Here is where {activeProfile?.name} stands today.</p>
        </div>
        {activeInboxItems.length > 0 && (
          <Link href="/tasks">
            <Button variant="outline" className="gap-2 text-primary border-primary/20 bg-primary/5 cursor-pointer">
              <CheckSquare className="w-4 h-4" />
              {activeInboxItems.length} item{activeInboxItems.length !== 1 ? 's' : ''} need attention
            </Button>
          </Link>
        )}
      </div>

      {/* ─── Financial Position ────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-medium">Financial position</h2>
          <Link href="/position" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
            Full detail <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Click any figure for the breakdown.</p>

        {/* ── Cash (full width) ── */}
        {cashKpi && (
          <div className="mb-4 border border-border rounded-xl overflow-hidden shadow-sm bg-card">
            <button
              onClick={() => toggle('cash')}
              className="w-full p-5 text-left hover:bg-secondary/20 transition-colors cursor-pointer"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-sm text-muted-foreground font-medium flex items-center gap-1.5">
                    <Banknote className="w-4 h-4" /> Cash
                  </p>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-3xl font-serif text-foreground">£{availableCash.toLocaleString()} <span className="text-base font-sans text-muted-foreground">available</span></span>
                    <span className="text-sm text-muted-foreground">£{totalCash.toLocaleString()} total</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">−£{cashBreakdown.taxReserve.toLocaleString()} tax reserve</span>
                  <span className="bg-secondary px-2 py-0.5 rounded-full">−£{cashBreakdown.apDueWithin30Days} AP due</span>
                  {expanded === 'cash' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>
            </button>

            {expanded === 'cash' && (
              <div className="border-t border-border bg-secondary/10 p-5 space-y-5 animate-in slide-in-from-top-2 duration-200">
                {/* Reconciliation table */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Reconciliation</h4>
                  <div className="border border-border rounded-lg overflow-hidden text-sm">
                    <div className="divide-y divide-border">
                      <div className="flex justify-between items-center p-3 bg-background">
                        <div>
                          <p className="font-medium">Total business cash</p>
                          {cashBreakdown.accounts.map(a => (
                            <p key={a.name} className="text-xs text-muted-foreground">{a.name}: £{a.balance.toLocaleString()}</p>
                          ))}
                        </div>
                        <span className="font-semibold font-mono">£{totalCash.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-background">
                        <div>
                          <p className="font-medium text-amber-700">− Tax reserve (ringfenced)</p>
                          <p className="text-xs text-muted-foreground">Set aside toward £6,924 balance due Jan 2025</p>
                        </div>
                        <span className="font-semibold font-mono text-amber-700">−£{cashBreakdown.taxReserve.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-background">
                        <div>
                          <p className="font-medium text-muted-foreground">− AP committed (due ≤30 days)</p>
                          <p className="text-xs text-muted-foreground">Adobe £50 + WeWork £200 — not yet cleared</p>
                        </div>
                        <span className="font-semibold font-mono text-muted-foreground">−£{cashBreakdown.apDueWithin30Days}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-primary/5 border-t-2 border-primary/20">
                        <div>
                          <p className="font-semibold text-foreground">Available cash</p>
                          <p className="text-xs text-muted-foreground">AR (£3,400) excluded — not yet collected</p>
                        </div>
                        <span className="text-xl font-serif font-semibold text-foreground">£{availableCash.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Near-term flows */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Expected inflows</h4>
                    {cashBreakdown.nearTermInflows.map((inf, i) => (
                      <div key={i} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                        <div>
                          <p className="font-medium">{inf.label}</p>
                          <p className="text-xs text-muted-foreground">{new Date(inf.expectedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                        </div>
                        <span className="font-medium text-emerald-700">+£{inf.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Expected outflows</h4>
                    {cashBreakdown.nearTermOutflows.map((out, i) => (
                      <div key={i} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                        <div>
                          <p className="font-medium">{out.label}</p>
                          <p className="text-xs text-muted-foreground">{new Date(out.expectedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                        </div>
                        <span className="font-medium text-destructive">−£{out.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── YTD P&L + Estimated Tax (2-col) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          {/* YTD P&L */}
          {plKpi && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <button
                onClick={() => toggle('pl')}
                className="w-full p-5 text-left hover:bg-secondary/20 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium mb-1">YTD Profit / Loss</p>
                    <p className="text-3xl font-serif text-foreground">£{confirmedProfit.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-1">confirmed basis</p>
                  </div>
                  {expanded === 'pl' ? <ChevronUp className="w-4 h-4 text-muted-foreground mt-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground mt-1" />}
                </div>
              </button>
              {expanded === 'pl' && (
                <div className="border-t border-border bg-secondary/10 p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  {/* Revenue */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Revenue</h4>
                    <div className="border border-border rounded-lg overflow-hidden text-sm">
                      {plBreakdown.revenues.map((r, i) => (
                        <div key={i} className="flex justify-between items-center p-2.5 bg-background border-b border-border last:border-0">
                          <div>
                            <p className="font-medium">{r.label}</p>
                            <p className="text-xs text-muted-foreground">{r.basis}</p>
                          </div>
                          <span className="font-medium text-emerald-700 shrink-0 ml-2">£{r.amount.toLocaleString()}</span>
                        </div>
                      ))}
                      <div className="flex justify-between p-2.5 bg-secondary/30 font-semibold text-sm">
                        <span>Total Revenue</span><span>£{totalRevenue.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  {/* Confirmed expenses */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Confirmed Allowable Expenses</h4>
                    <div className="border border-border rounded-lg overflow-hidden text-sm">
                      {plBreakdown.confirmedExpenses.map((e, i) => (
                        <div key={i} className="flex justify-between items-center p-2.5 bg-background border-b border-border last:border-0">
                          <div>
                            <p className="font-medium">{e.label}</p>
                            <p className="text-xs text-muted-foreground">{e.category} · {e.basis}</p>
                          </div>
                          <span className="font-medium shrink-0 ml-2">£{e.amount.toLocaleString()}</span>
                        </div>
                      ))}
                      <div className="flex justify-between p-2.5 bg-secondary/30 font-semibold text-sm">
                        <span>Total Confirmed Expenses</span><span>£{confirmedExpenses.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  {/* Headline profit */}
                  <div className="border-2 border-primary/20 rounded-lg p-3 bg-primary/5 flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-sm">YTD Profit (confirmed)</p>
                      <p className="text-xs text-muted-foreground">£{totalRevenue.toLocaleString()} − £{confirmedExpenses.toLocaleString()}</p>
                    </div>
                    <span className="text-xl font-serif font-semibold">£{confirmedProfit.toLocaleString()}</span>
                  </div>
                  {/* Pending */}
                  {plBreakdown.pendingExpenses.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> Excluded — pending Inbox resolution
                      </p>
                      {plBreakdown.pendingExpenses.map((e, i) => (
                        <div key={i} className="flex justify-between text-amber-800 py-1 border-b border-amber-100 last:border-0">
                          <span>{e.label}</span>
                          <span>£{e.amount.toLocaleString()}</span>
                        </div>
                      ))}
                      <p className="text-xs text-amber-700 mt-2">
                        If both resolve as expenses: profit would be £{(confirmedProfit - pendingExpenses).toLocaleString()}.
                        Resolve them in <Link href="/tasks" className="underline font-medium">Tasks → Action Needed</Link>.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Estimated Tax */}
          {taxKpi && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <button
                onClick={() => toggle('tax')}
                className="w-full p-5 text-left hover:bg-secondary/20 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium mb-1">Estimated Tax</p>
                    <p className="text-3xl font-serif text-foreground">{taxKpi.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">balance due 31 Jan 2025</p>
                  </div>
                  {expanded === 'tax' ? <ChevronUp className="w-4 h-4 text-muted-foreground mt-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground mt-1" />}
                </div>
              </button>
              {expanded === 'tax' && (
                <div className="border-t border-border bg-secondary/10 p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  <div className="border border-border rounded-lg overflow-hidden text-sm">
                    {taxCalculation.lines.map((line, i) => (
                      <div key={i} className={cn("flex justify-between p-2.5 border-b border-border last:border-0", i === taxCalculation.lines.length - 1 ? "bg-primary/5 font-semibold" : "bg-background")}>
                        <div>
                          <p className={i === taxCalculation.lines.length - 1 ? "font-semibold" : ""}>{line.label}</p>
                          {line.note && <p className="text-xs text-muted-foreground">{line.note}</p>}
                        </div>
                        <span className="shrink-0 ml-3">{line.amount}</span>
                      </div>
                    ))}
                  </div>
                  {taxCalculation.unresolvedItems.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                      <p className="font-semibold mb-1 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Items that could change this figure</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {taxCalculation.unresolvedItems.map((u, i) => <li key={i}>{u}</li>)}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{taxCalculation.taxBasis}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── AR + AP (2-col) ── */}
        <div className="grid grid-cols-2 gap-4">
          {/* AR */}
          {arKpi && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <button
                onClick={() => toggle('ar')}
                className="w-full p-4 text-left hover:bg-secondary/20 transition-colors cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                  <WalletCards className="w-4 h-4" /> Accounts Receivable
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-serif text-foreground">{arKpi.value}</span>
                  {expanded === 'ar' ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>
              {expanded === 'ar' && (
                <div className="border-t border-border bg-secondary/10 p-4 space-y-2 animate-in slide-in-from-top-2 duration-200">
                  {arEntries.map((ar, i) => (
                    <div key={i} className="flex justify-between items-start text-sm p-2 bg-background rounded border border-border">
                      <div>
                        <p className="font-medium">{ar.customer} {ar.invoiceRef}</p>
                        <p className="text-xs text-muted-foreground">Due {new Date(ar.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                        {ar.isOverdue && <Badge variant="destructive" className="text-[10px] mt-0.5">Overdue {ar.daysOverdue}d</Badge>}
                      </div>
                      <span className="font-medium shrink-0 ml-2">£{ar.amount.toLocaleString()}</span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">AR excluded from Available Cash until collected.</p>
                </div>
              )}
            </div>
          )}

          {/* AP */}
          {apKpi && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <button
                onClick={() => toggle('ap')}
                className="w-full p-4 text-left hover:bg-secondary/20 transition-colors cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                  <WalletCards className="w-4 h-4" /> Accounts Payable
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-serif text-foreground">{apKpi.value}</span>
                  {expanded === 'ap' ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>
              {expanded === 'ap' && (
                <div className="border-t border-border bg-secondary/10 p-4 space-y-2 animate-in slide-in-from-top-2 duration-200">
                  {apEntries.map((ap, i) => (
                    <div key={i} className="flex justify-between items-start text-sm p-2 bg-background rounded border border-border">
                      <div>
                        <p className="font-medium">{ap.supplier}</p>
                        <p className="text-xs text-muted-foreground">{ap.description} · Due {new Date(ap.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                      </div>
                      <span className="font-medium shrink-0 ml-2">£{ap.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">Due AP deducted from Available Cash in the reconciliation above.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ─── SA Readiness (inline checklist) ──────────────────────────── */}
      {saTotal > 0 && (
        <section>
          <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
            <button
              onClick={() => toggle('sa')}
              className="w-full p-5 text-left hover:bg-secondary/20 transition-colors cursor-pointer"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CalendarClock className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">Self Assessment 23/24 readiness</span>
                    {saDeadline && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                        Due {new Date(saDeadline.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{saDone} of {saTotal} tasks ready</span>
                      <span className="font-medium text-foreground">{saProgressPct}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${saProgressPct === 100 ? 'bg-emerald-500' : saProgressPct >= 50 ? 'bg-primary' : 'bg-amber-500'}`}
                        style={{ width: `${saProgressPct}%` }}
                      />
                    </div>
                  </div>
                  {saMissing.length > 0 && expanded !== 'sa' && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {saMissing.map(item => (
                        <span key={item.id} className="text-xs text-muted-foreground flex items-center gap-1">
                          <Circle className="w-2.5 h-2.5 text-amber-500 shrink-0" /> {item.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-sm text-primary font-medium flex items-center gap-1 whitespace-nowrap">
                  {expanded === 'sa' ? (
                    <><ChevronUp className="w-4 h-4" /> Close checklist</>
                  ) : (
                    <><ChevronDown className="w-4 h-4" /> View checklist</>
                  )}
                </div>
              </div>
            </button>

            {expanded === 'sa' && (
              <div className="border-t border-border bg-secondary/10 p-5 animate-in slide-in-from-top-2 duration-200">
                {/* Checklist by category */}
                {(['data', 'inbox', 'filing', 'payment'] as const).map(cat => {
                  const catLabel: Record<string, string> = {
                    data: 'Data & Records', inbox: 'Inbox items', filing: 'Filing', payment: 'Payment',
                  };
                  const catItems = activeSAChecklist.filter(i => i.category === cat);
                  if (catItems.length === 0) return null;
                  return (
                    <div key={cat} className="mb-5 last:mb-0">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{catLabel[cat]}</h4>
                      <div className="space-y-2">
                        {catItems.map(item => (
                          <div
                            key={item.id}
                            className={cn(
                              "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                              item.status === 'done' ? "border-emerald-100 bg-emerald-50/50 opacity-70" : "border-border bg-background"
                            )}
                          >
                            <button
                              onClick={() => updateSAChecklistItem(item.id, item.status === 'done' ? 'pending' : 'done')}
                              className="mt-0.5 shrink-0 cursor-pointer"
                            >
                              {item.status === 'done'
                                ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                : <Circle className="w-5 h-5 text-muted-foreground hover:text-primary transition-colors" />
                              }
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className={cn("text-sm font-medium", item.status === 'done' && "line-through text-muted-foreground")}>
                                {item.label}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                            </div>
                            <Badge className={cn(
                              'text-[10px] shrink-0',
                              item.status === 'done' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            )}>
                              {item.status === 'done' ? 'Done' : 'Pending'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="pt-4 border-t border-border flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">
                    {saTotal - saDone} items remaining before return is ready.
                  </p>
                  <Link href="/tasks">
                    <Button variant="outline" size="sm" className="cursor-pointer gap-1.5 text-xs">
                      Manage in Tasks <ChevronRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Deadline + Business Ideas ─────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-medium">Upcoming deadline</h2>
            <Link href="/tasks" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
              Timeline <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {urgentCompliance ? (
            <Card className="p-5 flex items-start gap-4 shadow-sm">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${urgentCompliance.status === 'overdue' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                <Clock className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start gap-2 flex-wrap">
                  <h3 className="font-medium text-foreground">{urgentCompliance.title}</h3>
                  <Badge variant={urgentCompliance.status === 'overdue' ? 'destructive' : 'secondary'} className={urgentCompliance.status !== 'overdue' ? 'bg-amber-100 text-amber-800 border-amber-200 shrink-0' : 'shrink-0'}>
                    {new Date(urgentCompliance.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{urgentCompliance.description}</p>
                <Link href="/tasks">
                  <Button variant="ghost" className="px-0 h-auto py-2 text-primary font-medium cursor-pointer hover:bg-transparent mt-1 text-sm">
                    View details →
                  </Button>
                </Link>
              </div>
            </Card>
          ) : (
            <Card className="p-5 text-center text-muted-foreground bg-secondary/20 shadow-sm border-dashed">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
              <p className="text-sm">No urgent deadlines approaching.</p>
            </Card>
          )}
        </div>

        {/* Tax reserve gap — actionable card */}
        {taxReserveGap > 0 && (
          <Card className="p-4 border-l-4 border-l-amber-400 bg-amber-50 dark:bg-amber-900/20 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-amber-900 dark:text-amber-200">Tax reserve gap — £{taxReserveGap.toLocaleString()} shortfall</p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
                  Your January balance due is <strong>£{taxBalanceDue.toLocaleString()}</strong> but
                  your reserve is only <strong>£{taxReserve.toLocaleString()}</strong>.
                  You're <strong>£{taxReserveGap.toLocaleString()}</strong> short.
                  Once Axiom pays their overdue invoice (£2,400), move it straight into your tax pot — that covers the gap.
                </p>
                <div className="flex gap-3 mt-2.5 flex-wrap">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900 border border-amber-300 font-medium">
                    Available cash: £6,090
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900 border border-amber-300 font-medium">
                    AR overdue: £2,400 (Axiom)
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900 border border-amber-300 font-medium">
                    Deadline: 31 Jan 2025
                  </span>
                </div>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-medium">Act now</h2>
            <Link href="/business-ideas" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
              All ideas <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">Top-priority ideas grounded in your numbers</p>
          {previewIdeas.length > 0 ? (
            <div className="space-y-3">
              {previewIdeas.map(idea => (
                <Link key={idea.id} href="/business-ideas">
                  <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors flex items-start gap-3 shadow-sm bg-card group">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      <Lightbulb className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">Do now</span>
                        <h3 className="font-medium text-sm text-foreground truncate">{idea.title}</h3>
                      </div>
                      {idea.urgencyNote && (
                        <p className="text-xs text-amber-700 font-medium mt-0.5 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />{idea.urgencyNote}
                        </p>
                      )}
                      {/* Key impact */}
                      <div className="flex gap-2 mt-1.5 flex-wrap">
                        {idea.taxImpactRange && idea.taxImpactRange.max > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Tax +£{idea.taxImpactRange.min}–£{idea.taxImpactRange.max}
                          </span>
                        )}
                        {idea.cashImpactRange && idea.cashImpactRange.min > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Cash +£{idea.cashImpactRange.min.toLocaleString()}–£{idea.cashImpactRange.max.toLocaleString()}
                          </span>
                        )}
                        {idea.paybackRange?.minMonths === 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            Immediate
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="p-5 text-center text-muted-foreground bg-secondary/20 shadow-sm border-dashed">
              <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No priority ideas right now.</p>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
