import { Card, Badge, Button, Input, Label } from '@/components/ui';
import { useStore, AssumptionField, BusinessIdea, BusinessIdeaCategory, DecisionMemoryEntry } from '@/lib/store';
import { useState } from 'react';
import {
  Lightbulb, ChevronDown, ChevronUp, Users, TrendingUp, DollarSign,
  Settings2, Info, MessageSquare, Check, Save, Activity, ShoppingBag,
  Briefcase, AlertTriangle, ExternalLink, Minus, Plus, Brain, BookMarked
} from 'lucide-react';
import { cn } from '@/components/ui';

// ─── Decision Memory card ─────────────────────────────────────────────────────

function DecisionMemoryCard({ entry }: { entry: DecisionMemoryEntry }) {
  const { updateDecisionMemoryStatus, updateDecisionMemoryOutcome } = useStore();
  const [showOutcomeInput, setShowOutcomeInput] = useState(false);
  const [outcomeText, setOutcomeText] = useState('');
  const [actualPL, setActualPL] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [actualTax, setActualTax] = useState('');

  const statusConfig: Record<DecisionMemoryEntry['status'], { color: string; label: string }> = {
    committed:  { color: 'bg-blue-100 text-blue-800 border-blue-200',             label: 'Committed' },
    monitoring: { color: 'bg-amber-100 text-amber-800 border-amber-200',          label: 'Monitoring' },
    completed:  { color: 'bg-emerald-100 text-emerald-700 border-emerald-200',    label: 'Completed ✓' },
    abandoned:  { color: 'bg-secondary text-muted-foreground border-border',      label: 'Abandoned' },
  };

  const sc = statusConfig[entry.status];

  return (
    <Card className={cn("p-4 shadow-sm border", entry.status === 'abandoned' && "opacity-55")}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Left: info */}
        <div className="flex-1 space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sc.color}`}>
              {sc.label}
            </span>
            <Badge variant="outline" className="text-[10px] capitalize">{entry.ideaCategory}</Badge>
            <span className="text-xs text-muted-foreground">{entry.date}</span>
          </div>
          <h4 className="font-medium text-sm text-foreground">{entry.ideaTitle}</h4>
          <p className="text-sm text-foreground font-medium">{entry.userDecision}</p>
          {entry.userRationale && (
            <p className="text-xs text-muted-foreground italic">"{entry.userRationale}"</p>
          )}

          {/* Actual outcome — shown when recorded */}
          {entry.status === 'completed' && entry.actualOutcome && (
            <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-xs font-medium text-emerald-800 mb-0.5">Actual outcome:</p>
              <p className="text-xs text-emerald-700">{entry.actualOutcome}</p>
              <div className="flex gap-3 mt-1.5 flex-wrap">
                {entry.actualPLImpact !== undefined && (
                  <span className="text-xs text-emerald-700">P&L: {entry.actualPLImpact >= 0 ? '+' : ''}£{Math.abs(entry.actualPLImpact).toLocaleString()}</span>
                )}
                {entry.actualCashImpact !== undefined && (
                  <span className="text-xs text-emerald-700">Cash: {entry.actualCashImpact >= 0 ? '+' : ''}£{Math.abs(entry.actualCashImpact).toLocaleString()}</span>
                )}
                {entry.actualTaxImpact !== undefined && (
                  <span className="text-xs text-emerald-700">Tax: +£{Math.abs(entry.actualTaxImpact).toLocaleString()}</span>
                )}
              </div>
            </div>
          )}

          {/* Outcome input form */}
          {showOutcomeInput && (
            <div className="mt-2 space-y-2 p-3 bg-secondary/30 rounded-lg border border-border">
              <p className="text-xs font-medium text-foreground">Record actual outcome:</p>
              <textarea
                className="w-full text-xs border border-border rounded-md p-2 resize-none bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                rows={2}
                placeholder="What actually happened? (e.g. 'Paid £2,100 in January — saving confirmed')"
                value={outcomeText}
                onChange={e => setOutcomeText(e.target.value)}
              />
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Actual P&L (£)', val: actualPL, set: setActualPL },
                  { label: 'Actual Cash (£)', val: actualCash, set: setActualCash },
                  { label: 'Tax saving (£)', val: actualTax, set: setActualTax },
                ].map(f => (
                  <input
                    key={f.label}
                    type="number"
                    placeholder={f.label}
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                    className="text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="text-xs cursor-pointer"
                  onClick={() => {
                    if (outcomeText) {
                      updateDecisionMemoryOutcome(
                        entry.id, outcomeText,
                        actualPL ? parseFloat(actualPL) : undefined,
                        actualCash ? parseFloat(actualCash) : undefined,
                        actualTax ? parseFloat(actualTax) : undefined
                      );
                      setShowOutcomeInput(false);
                    }
                  }}
                >
                  Save outcome
                </Button>
                <Button size="sm" variant="outline" className="text-xs cursor-pointer" onClick={() => setShowOutcomeInput(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: expected impacts + status actions */}
        <div className="shrink-0 flex flex-col items-end gap-3">
          <div className="flex gap-3 text-xs">
            <div className="text-center min-w-[52px]">
              <p className="text-muted-foreground">P&L y1</p>
              <p className={`font-semibold ${entry.expectedPLImpact >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                {entry.expectedPLImpact >= 0 ? '+' : ''}£{Math.abs(entry.expectedPLImpact).toLocaleString()}
              </p>
            </div>
            {entry.expectedTaxImpact !== 0 && (
              <div className="text-center min-w-[52px]">
                <p className="text-muted-foreground">Tax saving</p>
                <p className="font-semibold text-emerald-700">+£{entry.expectedTaxImpact.toLocaleString()}</p>
              </div>
            )}
          </div>

          {entry.status !== 'abandoned' && entry.status !== 'completed' && (
            <div className="flex flex-col gap-1 items-end">
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-7 cursor-pointer"
                onClick={() => setShowOutcomeInput(true)}
              >
                Mark completed
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-[10px] h-7 text-muted-foreground cursor-pointer"
                onClick={() => updateDecisionMemoryStatus(entry.id, 'abandoned')}
              >
                Abandon
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Scenario compute engine ──────────────────────────────────────────────────

interface ScenarioMetrics {
  cashOneOff: number;
  cashOngoingYear1: number;
  plImpactYear1: number;
  taxImpact: number;
  paybackMonths: number | null;  // null = immediate/N/A
  benchmarkEffect: string;
  downsideNote: string;
  breakEvenNote?: string;
}

function computeScenario(ideaId: string, assumptions: AssumptionField[]): ScenarioMetrics {
  const v = (key: string) => assumptions.find(a => a.key === key)?.value ?? 0;

  if (ideaId === 'bi1') {
    const salary = v('salary');
    const growthPct = v('revenueGrowth');
    const recruitment = v('recruitmentCost');
    const currentRevenue = 39800; // canonical: YTD revenue £39,800
    const incrementalRevenue = Math.round(currentRevenue * growthPct / 100);
    const netOngoingYear1 = incrementalRevenue - salary;
    const taxSaving = Math.round(salary * 0.20);
    const payback = netOngoingYear1 > 0 ? Math.ceil((recruitment / (netOngoingYear1 / 12))) : null;
    const newRevenuePerHead = Math.round((currentRevenue + incrementalRevenue) / 2);
    return {
      cashOneOff: -recruitment,
      cashOngoingYear1: netOngoingYear1,
      plImpactYear1: netOngoingYear1,
      taxImpact: taxSaving,
      paybackMonths: payback,
      benchmarkEffect: `Revenue per employee: ~£${newRevenuePerHead.toLocaleString()}/yr (from £39,800 solo) vs peer median £65,000`,
      downsideNote: netOngoingYear1 < 0
        ? `If revenue grows by only ${growthPct}%, net annual shortfall is £${Math.abs(netOngoingYear1).toLocaleString()}. Ensure 6-month salary reserve (~£${Math.round(salary / 2).toLocaleString()}) before hiring.`
        : `Monitor monthly: if pipeline dries up, cash position deteriorates quickly. Keep 6-month reserve.`,
      breakEvenNote: payback === null
        ? `Break-even requires revenue growth above ${Math.round((salary / currentRevenue) * 100)}%`
        : undefined,
    };
  }

  if (ideaId === 'bi2') {
    const targetDays = v('targetDebtorDays');
    const discountPct = v('earlyPaymentDiscount');
    const currentDays = 34;
    const annualRevenue = 39800;
    const daysImproved = Math.max(0, currentDays - targetDays);
    const cashReleased = Math.round(annualRevenue * daysImproved / 365);
    const discountCost = Math.round(annualRevenue * discountPct / 100);
    return {
      cashOneOff: cashReleased,
      cashOngoingYear1: cashReleased - discountCost,
      plImpactYear1: -discountCost,
      taxImpact: 0,
      paybackMonths: 0,
      benchmarkEffect: `Debtor days: ~${currentDays}d → ~${targetDays}d (peer median: 28d${targetDays < 28 ? ' — above peer median' : ''})`,
      downsideNote: discountPct > 0
        ? `Early payment discount costs ~£${discountCost.toLocaleString()}/yr. Some clients may expect this permanently.`
        : 'Some clients may resist shorter payment terms. Start with new contracts only.',
    };
  }

  if (ideaId === 'bi3') {
    const price = v('purchasePrice');
    const taxSaving = Math.round(price * 0.20);
    return {
      cashOneOff: -price,
      cashOngoingYear1: 0,
      plImpactYear1: -taxSaving, // net after AIA: spend £price, save £taxSaving in tax, net cost = price - taxSaving
      taxImpact: taxSaving,
      paybackMonths: null,
      benchmarkEffect: 'Not directly benchmarked — quality and colour-accuracy improvement for design work',
      downsideNote: `If profits fall below the basic rate band, tax saving reduces. Verify your final profit estimate before purchasing.`,
    };
  }

  if (ideaId === 'bi4') {
    const days = Math.round(v('daysPerWeek'));
    // HMRC flat rates (2023/24): 25–50 hrs/month = £10, 51–100 = £18, 101+ = £26
    // Approximate: 4 days/wk ≈ 120+ hrs/month → £26; 3 days ≈ 90hrs → £18; 1–2 days ≈ 45hrs → £10
    const monthlyRate = days >= 4 ? 26 : days >= 3 ? 18 : 10;
    const annualAllowance = monthlyRate * 12;
    const taxSaving = Math.round(annualAllowance * 0.20);
    return {
      cashOneOff: 0,
      cashOngoingYear1: taxSaving,
      plImpactYear1: 0,
      taxImpact: taxSaving,
      paybackMonths: 0,
      benchmarkEffect: `HMRC flat rate: £${monthlyRate}/month → £${annualAllowance}/yr allowance → reduces taxable profit by £${annualAllowance}`,
      downsideNote: `Keep a working-from-home log. If you move to a rented office later, you cannot double-claim both WFH allowance and office rent.`,
    };
  }

  if (ideaId === 'bi5') {
    const budget = v('equipmentBudget');
    const taxSaving = Math.round(budget * 0.20);
    return {
      cashOneOff: -budget,
      cashOngoingYear1: 0,
      plImpactYear1: -taxSaving,
      taxImpact: taxSaving,
      paybackMonths: null,
      benchmarkEffect: 'Not benchmarked — operational efficiency gain. AIA applies up to £1m/yr.',
      downsideNote: `Must purchase before 5 April 2024. If you miss the deadline, AIA still applies next year but tax relief is delayed by one year.`,
    };
  }

  return { cashOneOff: 0, cashOngoingYear1: 0, plImpactYear1: 0, taxImpact: 0, paybackMonths: null, benchmarkEffect: '', downsideNote: '' };
}

// ─── Impact range helpers ────────────────────────────────────────────────────

function fmtRange(min: number, max: number, prefix = '£'): string {
  const fmt = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1000) return `${prefix}${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
    return `${prefix}${abs.toLocaleString()}`;
  };
  if (min === max) return `${min < 0 ? '−' : '+'}${fmt(min)}`;
  const sign = min >= 0 ? '+' : min < 0 && max <= 0 ? '−' : '±';
  if (min < 0 && max < 0) return `−${fmt(min)}–−${fmt(max)}`;
  if (min >= 0 && max >= 0) return `+${fmt(min)}–+${fmt(max)}`;
  return `${fmt(min)}–+${fmt(max)}`;
}

function ImpactPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>
      {label}: {value}
    </span>
  );
}

const TIER_CONFIG = {
  do_now:  { label: 'Do now',  color: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  consider:{ label: 'Consider',color: 'bg-amber-100 text-amber-800 border-amber-200',       dot: 'bg-amber-500'   },
  watch:   { label: 'Watch',   color: 'bg-secondary text-muted-foreground border-border',   dot: 'bg-muted-foreground' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORIES: { value: BusinessIdeaCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tax', label: 'Tax' },
  { value: 'cash', label: 'Cash' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'assets', label: 'Assets' },
  { value: 'growth', label: 'Growth' },
  { value: 'operations', label: 'Operations' },
  { value: 'pricing', label: 'Pricing' },
];

function getCategoryIcon(cat: string) {
  switch (cat) {
    case 'hiring': return <Users className="w-3.5 h-3.5" />;
    case 'tax': return <DollarSign className="w-3.5 h-3.5" />;
    case 'cash': return <TrendingUp className="w-3.5 h-3.5" />;
    case 'assets': return <ShoppingBag className="w-3.5 h-3.5" />;
    case 'growth': return <Activity className="w-3.5 h-3.5" />;
    case 'pricing': return <Briefcase className="w-3.5 h-3.5" />;
    default: return <Lightbulb className="w-3.5 h-3.5" />;
  }
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : n > 0 ? '+' : '';
  return `${sign}£${abs.toLocaleString()}`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'new': return <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">New</Badge>;
    case 'saved': return <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">Saved</Badge>;
    case 'actioned': return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Actioned</Badge>;
    case 'dismissed': return <Badge variant="outline">Dismissed</Badge>;
    default: return null;
  }
}

// ─── Assumption Editor ────────────────────────────────────────────────────────

function AssumptionEditor({ assumption, onChange }: {
  assumption: AssumptionField;
  onChange: (key: string, value: number) => void;
}) {
  const step = assumption.step;
  const decrement = () => onChange(assumption.key, Math.max(assumption.min, assumption.value - step));
  const increment = () => onChange(assumption.key, Math.min(assumption.max, assumption.value + step));

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <label className="text-sm text-muted-foreground flex-1 pr-4">{assumption.label}</label>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={decrement}
          disabled={assumption.value <= assumption.min}
          className="w-7 h-7 rounded-md border border-border bg-background flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-1 min-w-[80px] justify-center">
          {assumption.unit === '£' && <span className="text-sm font-medium text-muted-foreground">£</span>}
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {assumption.value.toLocaleString()}
          </span>
          {assumption.unit !== '£' && <span className="text-xs text-muted-foreground">{assumption.unit}</span>}
        </div>
        <button
          onClick={increment}
          disabled={assumption.value >= assumption.max}
          className="w-7 h-7 rounded-md border border-border bg-background flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Commit Decision Form ─────────────────────────────────────────────────────

function CommitForm({ idea, metrics, onCommit, onCancel }: {
  idea: BusinessIdea;
  metrics: ScenarioMetrics;
  onCommit: (decision: string, rationale: string) => void;
  onCancel: () => void;
}) {
  const [decision, setDecision] = useState('');
  const [rationale, setRationale] = useState('');

  return (
    <Card className="p-5 border-primary/20 bg-primary/5 space-y-4">
      <div className="flex items-center gap-2">
        <BookMarked className="w-4 h-4 text-primary" />
        <h4 className="font-semibold text-sm text-foreground">Record this decision to your Decision Memory</h4>
      </div>
      <div className="bg-background border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground text-sm">Expected impact (based on current assumptions)</p>
        <div className="grid grid-cols-3 gap-3 mt-2">
          <div>
            <span className="block text-muted-foreground">P&L Year 1</span>
            <span className={`font-semibold ${metrics.plImpactYear1 >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
              {formatMoney(metrics.plImpactYear1)}
            </span>
          </div>
          <div>
            <span className="block text-muted-foreground">Cash (one-off)</span>
            <span className={`font-semibold ${metrics.cashOneOff >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
              {formatMoney(metrics.cashOneOff)}
            </span>
          </div>
          <div>
            <span className="block text-muted-foreground">Tax saving</span>
            <span className="font-semibold text-emerald-700">
              {metrics.taxImpact > 0 ? `+£${metrics.taxImpact.toLocaleString()}` : '£0'}
            </span>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <Label className="text-xs font-medium">What you decided</Label>
          <Input
            placeholder={`e.g. Decided to ${idea.proposedAction.toLowerCase().split(' ').slice(0, 5).join(' ')}…`}
            className="mt-1 h-9 bg-background"
            value={decision}
            onChange={e => setDecision(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs font-medium">Your rationale</Label>
          <Input
            placeholder="e.g. Pipeline is full, cash reserves adequate"
            className="mt-1 h-9 bg-background"
            value={rationale}
            onChange={e => setRationale(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} className="cursor-pointer">Cancel</Button>
        <Button
          size="sm"
          className="cursor-pointer"
          disabled={!decision.trim()}
          onClick={() => onCommit(decision, rationale)}
        >
          <BookMarked className="w-3.5 h-3.5 mr-1.5" /> Save to Decision Memory
        </Button>
      </div>
    </Card>
  );
}

// ─── Idea Card ────────────────────────────────────────────────────────────────

function IdeaCard({ idea }: { idea: BusinessIdea }) {
  const { updateBusinessIdea, updateIdeaAssumption, commitDecision, setCopilotTrigger, decisionMemory, activeProfileId } = useStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [showBenchmarkDetail, setShowBenchmarkDetail] = useState(false);

  const metrics = computeScenario(idea.id, idea.editableAssumptions);

  const handleAssumptionChange = (key: string, value: number) => {
    updateIdeaAssumption(idea.id, key, value);
  };

  const handleCommit = (decision: string, rationale: string) => {
    commitDecision({
      profileId: activeProfileId,
      ideaId: idea.id,
      ideaTitle: idea.title,
      ideaCategory: idea.category,
      date: new Date().toISOString().split('T')[0],
      assumptionsSnapshot: [...idea.editableAssumptions],
      userDecision: decision,
      userRationale: rationale,
      expectedPLImpact: metrics.plImpactYear1,
      expectedCashImpact: metrics.cashOneOff,
      expectedTaxImpact: metrics.taxImpact,
      status: 'committed',
    });
    setIsCommitting(false);
  };

  const committedEntry = idea.committedDecisionId
    ? decisionMemory.find(d => d.id === idea.committedDecisionId)
    : undefined;

  return (
    <Card className="overflow-hidden shadow-sm border-border">
      {/* Summary row */}
      <div
        className={cn(
          "p-5 flex flex-col md:flex-row gap-4 items-start transition-colors",
          !isExpanded && "cursor-pointer hover:bg-secondary/20"
        )}
        onClick={() => !isExpanded && setIsExpanded(true)}
      >
        <div className="flex-1 space-y-2">
          {/* Tier + category + status row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Priority tier badge */}
            {(() => {
              const t = TIER_CONFIG[idea.priorityTier];
              return (
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${t.color}`}>
                  {t.label}
                </span>
              );
            })()}
            <Badge variant="outline" className="gap-1.5 capitalize bg-background text-xs">
              {getCategoryIcon(idea.category)} {idea.category}
            </Badge>
            {idea.triggerBenchmark && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Activity className="w-3 h-3" /> {idea.benchmarkGap}
              </span>
            )}
            <div className="ml-auto">{getStatusBadge(idea.status)}</div>
          </div>

          <h3 className="text-xl font-serif text-foreground">{idea.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{idea.summary}</p>

          {/* Quantified impact pills */}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {idea.taxImpactRange && idea.taxImpactRange.max > 0 && (
              <ImpactPill
                label="Tax saving"
                value={`+£${idea.taxImpactRange.min.toLocaleString()}–£${idea.taxImpactRange.max.toLocaleString()}`}
                color="bg-emerald-50 text-emerald-700 border-emerald-200"
              />
            )}
            {idea.cashImpactRange && (idea.cashImpactRange.max !== 0 || idea.cashImpactRange.min !== 0) && (() => {
              const { min, max } = idea.cashImpactRange;
              const pos = min >= 0;
              const label = pos ? `Cash released: +£${min.toLocaleString()}–£${max.toLocaleString()}` : `Cash cost: −£${Math.abs(max).toLocaleString()}–£${Math.abs(min).toLocaleString()}`;
              const color = pos ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-secondary text-muted-foreground border-border";
              return <ImpactPill label="" value={label} color={color} />;
            })()}
            {idea.paybackRange?.minMonths === 0 && (
              <ImpactPill label="Payback" value="immediate" color="bg-blue-50 text-blue-700 border-blue-200" />
            )}
            {idea.paybackRange?.minMonths !== null && idea.paybackRange?.minMonths !== undefined && idea.paybackRange.minMonths > 0 && (
              <ImpactPill
                label="Payback"
                value={idea.paybackRange.maxMonths ? `${idea.paybackRange.minMonths}–${idea.paybackRange.maxMonths}m` : `${idea.paybackRange.minMonths}m+`}
                color="bg-secondary text-muted-foreground border-border"
              />
            )}
            <span className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border',
              idea.confidence === 'high' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              idea.confidence === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-secondary text-muted-foreground border-border'
            )}>
              {idea.confidence} confidence
            </span>
          </div>

          {/* Urgency note for do_now / deadlines */}
          {(idea.urgencyNote || (idea.deadlines && idea.deadlines.length > 0)) && !committedEntry && (
            <p className="text-xs text-amber-700 flex items-center gap-1 font-medium pt-0.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {idea.urgencyNote ?? idea.deadlines?.[0]}
            </p>
          )}

          {committedEntry && (
            <div className="mt-2 p-3 bg-secondary/30 rounded-lg text-sm border border-border">
              <span className="font-semibold block mb-0.5 text-foreground">Decision recorded: {committedEntry.userDecision}</span>
              {committedEntry.userRationale && (
                <span className="text-muted-foreground italic">"{committedEntry.userRationale}"</span>
              )}
            </div>
          )}
        </div>
        {!isExpanded && (
          <Button variant="outline" onClick={(e) => { e.stopPropagation(); setIsExpanded(true); }} className="shrink-0 cursor-pointer">
            Explore <ChevronDown className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-border animate-in slide-in-from-top-2 duration-300">
          <div className="p-6 bg-secondary/10 space-y-8">

            {/* Current vs Proposed */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-background border border-border rounded-xl">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 block">Current Position</span>
                <p className="text-sm leading-relaxed">{idea.currentPosition}</p>
              </div>
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                <span className="text-xs uppercase tracking-wider text-primary font-semibold mb-2 block">Proposed Action</span>
                <p className="text-sm font-medium text-foreground leading-relaxed">{idea.proposedAction}</p>
              </div>
            </div>

            {/* Live Assumptions editor */}
            {idea.editableAssumptions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Settings2 className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold text-sm text-foreground">Adjust Assumptions — scenarios update live</h4>
                </div>
                <Card className="p-4 bg-background border-border shadow-none divide-y divide-border/50">
                  {idea.editableAssumptions.map(a => (
                    <AssumptionEditor key={a.key} assumption={a} onChange={handleAssumptionChange} />
                  ))}
                </Card>
              </div>
            )}

            {/* Computed Scenario */}
            <div>
              <h4 className="font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" /> Scenario — recalculated from your assumptions
              </h4>
              <div className="border border-border rounded-xl overflow-hidden bg-background shadow-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">P&L impact (Year 1)</p>
                    <p className={`text-xl font-serif ${metrics.plImpactYear1 >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                      {formatMoney(metrics.plImpactYear1)}
                    </p>
                  </div>
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Cash (one-off)</p>
                    <p className={`text-xl font-serif ${metrics.cashOneOff >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                      {formatMoney(metrics.cashOneOff)}
                    </p>
                  </div>
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Cash (ongoing/yr)</p>
                    <p className={`text-xl font-serif ${metrics.cashOngoingYear1 >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                      {metrics.cashOngoingYear1 !== 0 ? formatMoney(metrics.cashOngoingYear1) : '—'}
                    </p>
                  </div>
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Tax saving</p>
                    <p className="text-xl font-serif text-emerald-700">
                      {metrics.taxImpact > 0 ? `+£${metrics.taxImpact.toLocaleString()}` : '—'}
                    </p>
                  </div>
                </div>
                <div className="border-t border-border divide-y divide-border">
                  <div className="p-3 flex justify-between items-start text-sm">
                    <span className="text-muted-foreground">Payback / breakeven</span>
                    <span className="font-medium text-right max-w-[60%]">
                      {metrics.paybackMonths === null
                        ? 'Immediate (AIA / first billing cycle)'
                        : metrics.paybackMonths === 0
                        ? 'Immediate'
                        : `~${metrics.paybackMonths} months`}
                    </span>
                  </div>
                  <div className="p-3 flex justify-between items-start text-sm">
                    <span className="text-muted-foreground shrink-0">Benchmark effect</span>
                    <span className="text-right text-xs ml-4">{metrics.benchmarkEffect}</span>
                  </div>
                  <div className="p-3 bg-amber-50/60 flex items-start gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium text-amber-800 block mb-0.5">Downside case</span>
                      <span className="text-amber-700 text-xs">{metrics.downsideNote}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* What Must Be True + Source */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-border">
              <div>
                <h4 className="font-semibold text-sm text-foreground mb-2">What must be true</h4>
                <ul className="space-y-1.5">
                  {idea.whatMustBeTrue.map((w, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-3">
                <div>
                  <h4 className="font-semibold text-sm text-foreground mb-1.5">Source & confidence</h4>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{idea.source}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge
                      className={cn(
                        'text-xs',
                        idea.confidence === 'high' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                        idea.confidence === 'medium' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                        'bg-secondary text-muted-foreground'
                      )}
                    >
                      {idea.confidence} confidence
                    </Badge>
                  </div>
                </div>
                {idea.deadlines && idea.deadlines.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs font-medium text-destructive flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {idea.deadlines[0]}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Commit form */}
            {isCommitting && (
              <CommitForm
                idea={idea}
                metrics={metrics}
                onCommit={handleCommit}
                onCancel={() => setIsCommitting(false)}
              />
            )}

            {/* Action bar */}
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
              {!isCommitting && idea.status !== 'actioned' && (
                <Button
                  className="cursor-pointer"
                  onClick={() => setIsCommitting(true)}
                >
                  <Save className="w-4 h-4 mr-2" /> Record Decision
                </Button>
              )}
              <Button variant="outline" className="cursor-pointer" onClick={() => setCopilotTrigger(`Help me think through: ${idea.title}`)}>
                <MessageSquare className="w-4 h-4 mr-2" /> Discuss with Copilot
              </Button>
              {idea.status !== 'actioned' && !isCommitting && (
                <Button
                  variant="outline"
                  className="cursor-pointer hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                  onClick={() => updateBusinessIdea(idea.id, { status: 'actioned' })}
                >
                  <Check className="w-4 h-4 mr-2" /> Mark Actioned
                </Button>
              )}
              {idea.status === 'new' && !isCommitting && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => updateBusinessIdea(idea.id, { status: 'dismissed' })}
                >
                  Dismiss
                </Button>
              )}
              <div className="ml-auto">
                <Button variant="ghost" onClick={() => { setIsExpanded(false); setIsCommitting(false); }} className="cursor-pointer">
                  Collapse <ChevronUp className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>

          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Peer Benchmark Section ───────────────────────────────────────────────────

function PeerBenchmarkSection() {
  const { peerCategory, benchmarks, updatePeerCategory } = useStore();
  const [isEditing, setIsEditing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [editDraft, setEditDraft] = useState<typeof peerCategory | null>(null);

  if (!peerCategory) return null;

  const handleEditStart = () => {
    setEditDraft({ ...peerCategory });
    setIsEditing(true);
  };

  const handleSave = () => {
    if (editDraft) {
      updatePeerCategory({ ...editDraft, reviewedByUser: true });
    }
    setIsEditing(false);
    setEditDraft(null);
  };

  return (
    <Card className="overflow-hidden shadow-sm border-border">
      <div
        className="p-5 flex items-center justify-between cursor-pointer hover:bg-secondary/20 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-serif text-lg font-medium text-foreground">Peer Benchmarking</h2>
            <p className="text-xs text-muted-foreground">
              {peerCategory.sector} · {peerCategory.geography} · {peerCategory.sizeBand}
              {!peerCategory.reviewedByUser && ' · Classification not yet reviewed'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
            Illustrative sample data
          </Badge>
          {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {!isCollapsed && (
        <div className="border-t border-border p-5 space-y-6 animate-in slide-in-from-top-2 duration-200">

          {/* Peer classification */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Your Peer Classification</h3>
              <Button variant="ghost" size="sm" onClick={handleEditStart} className="h-7 text-xs cursor-pointer">
                <Settings2 className="w-3.5 h-3.5 mr-1" /> Edit classification
              </Button>
            </div>
            {isEditing && editDraft ? (
              <div className="space-y-3 p-4 bg-secondary/30 rounded-xl border border-border">
                <p className="text-xs text-muted-foreground">Adjust to refine which peer benchmarks apply to you. Changes apply to this session only.</p>
                {([
                  ['sector', 'Sector / Industry'],
                  ['geography', 'Geography'],
                  ['sizeBand', 'Size Band'],
                  ['customerType', 'Customer Type'],
                  ['revenueModel', 'Revenue Model'],
                ] as const).map(([field, label]) => (
                  <div key={field}>
                    <label className="text-xs font-medium block mb-1">{label}</label>
                    <input
                      className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      value={editDraft[field] as string}
                      onChange={e => setEditDraft(prev => prev ? { ...prev, [field]: e.target.value } : prev)}
                    />
                  </div>
                ))}
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} className="cursor-pointer">Cancel</Button>
                  <Button size="sm" onClick={handleSave} className="cursor-pointer">Save classification</Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                {[
                  ['Sector', peerCategory.sector],
                  ['Geography', peerCategory.geography],
                  ['Size', peerCategory.sizeBand],
                  ['Customers', peerCategory.customerType],
                  ['Revenue model', peerCategory.revenueModel],
                ].map(([label, value]) => (
                  <div key={label} className="bg-secondary/40 rounded-lg p-2.5">
                    <span className="text-muted-foreground text-xs block mb-0.5">{label}</span>
                    <span className="font-medium text-xs">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Benchmark cards */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Info className="w-4 h-4 text-amber-600" />
              <p className="text-xs text-amber-700 font-medium">
                All figures below are illustrative sample data — not live external research. Sources are cited for reference only. Live benchmark integration is a planned feature.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {benchmarks.map(b => (
                <div key={b.id} className="border border-border rounded-xl bg-background p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-sm leading-tight">{b.label}</span>
                    <Badge
                      className={cn(
                        'text-[10px] capitalize shrink-0 ml-2',
                        b.userStatus === 'above' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                        b.userStatus === 'below' ? 'bg-red-100 text-red-700 border-red-200' :
                        'bg-secondary text-muted-foreground'
                      )}
                    >
                      {b.userStatus === 'above' ? '↑ above peers' : b.userStatus === 'below' ? '↓ below peers' : 'inline'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <div>
                      <span className="text-2xl font-serif">{b.userCurrent}</span>
                      <span className="text-xs text-muted-foreground block">You (est.)</span>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-medium text-muted-foreground">{b.peerMedian}</span>
                      <span className="text-xs text-muted-foreground block">Peer median</span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-border/60 space-y-1">
                    <p className="text-[10px] text-muted-foreground">Range: {b.peerRange}</p>
                    <p className="text-[10px] text-muted-foreground" title={b.sourceFull}>
                      {b.source}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {b.dataPeriod} · {b.geography} · {b.peerDefinition}
                    </p>
                    <p className="text-[10px] text-amber-600">{b.freshness}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BusinessIdeas() {
  const { businessIdeas, activeProfileId, profiles, decisionMemory } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const [categoryFilter, setCategoryFilter] = useState<BusinessIdeaCategory | 'all'>('all');
  const [showDismissed, setShowDismissed] = useState(false);

  const profileIdeas = businessIdeas.filter(b => b.profileId === activeProfileId);
  const presentCategories = [...new Set(profileIdeas.map(b => b.category))];
  const availableFilters = CATEGORIES.filter(c => c.value === 'all' || presentCategories.includes(c.value as BusinessIdeaCategory));

  const filteredIdeas = profileIdeas.filter(b => {
    if (!showDismissed && b.status === 'dismissed') return false;
    if (categoryFilter !== 'all' && b.category !== categoryFilter) return false;
    return true;
  });

  const committedCount = decisionMemory.filter(d => d.profileId === activeProfileId).length;

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">Business Ideas</h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Data-driven opportunities for {activeProfile?.name} — adjust assumptions to see live impact.
          </p>
        </div>
        {committedCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2 border border-border">
            <BookMarked className="w-4 h-4 text-primary" />
            <span>{committedCount} decision{committedCount !== 1 ? 's' : ''} in memory</span>
          </div>
        )}
      </div>

      {/* Peer Benchmark */}
      <PeerBenchmarkSection />

      {/* Category filter */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {availableFilters.map(cat => (
              <button
                key={cat.value}
                onClick={() => setCategoryFilter(cat.value as BusinessIdeaCategory | 'all')}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer border",
                  categoryFilter === cat.value
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-secondary hover:text-foreground"
                )}
              >
                {cat.label}
                {cat.value !== 'all' && (
                  <span className="ml-1.5 text-xs opacity-60">
                    {profileIdeas.filter(b => b.category === cat.value && b.status !== 'dismissed').length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Ideas grouped by priority tier */}
        {filteredIdeas.filter(b => b.status !== 'dismissed').length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card rounded-xl border border-border shadow-sm">
            <Lightbulb className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground">
              {categoryFilter === 'all' ? 'No ideas in this profile yet.' : `No ${categoryFilter} ideas yet.`}
            </h3>
            <p className="mt-1">Ideas are generated from your Financial Memory and peer benchmarks.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {(['do_now', 'consider', 'watch'] as const).map(tier => {
              const tierIdeas = filteredIdeas.filter(b => b.priorityTier === tier && b.status !== 'dismissed');
              if (tierIdeas.length === 0) return null;
              const tc = TIER_CONFIG[tier];
              return (
                <div key={tier} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${tc.dot}`} />
                    <h3 className="font-semibold text-base text-foreground">{tc.label}</h3>
                    <span className="text-xs text-muted-foreground">
                      {tier === 'do_now' ? 'Act this week — time-sensitive or immediate wins' :
                       tier === 'consider' ? 'Evaluate when conditions are right' :
                       'Monitor — not ready to act yet'}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {tierIdeas.map(idea => <IdeaCard key={idea.id} idea={idea} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {profileIdeas.some(b => b.status === 'dismissed') && (
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="text-sm text-muted-foreground hover:text-foreground underline cursor-pointer"
          >
            {showDismissed ? 'Hide dismissed ideas' : 'Show dismissed ideas'}
          </button>
        )}
      </div>

      {/* Decision Memory ─ always visible */}
      <section className="space-y-5 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <BookMarked className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-serif font-medium text-foreground">Decision Memory</h2>
          {committedCount > 0 && (
            <Badge variant="outline" className="ml-1 text-[10px]">{committedCount} committed</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Decisions you've committed to — each has an expected outcome. Come back to record what actually happened and close the loop.
        </p>

        {/* Committed pipeline forecast */}
        {(() => {
          const live = decisionMemory.filter(d => d.profileId === activeProfileId && d.status !== 'abandoned');
          if (live.length === 0) return null;
          const totalPL   = live.reduce((s, d) => s + d.expectedPLImpact, 0);
          const totalTax  = live.reduce((s, d) => s + d.expectedTaxImpact, 0);
          const totalCash = live.reduce((s, d) => s + d.expectedCashImpact, 0);
          return (
            <Card className="p-4 bg-primary/5 border-primary/20 shadow-sm">
              <p className="text-xs font-semibold text-primary mb-3 uppercase tracking-wider">
                Committed pipeline — combined expected impact (year 1)
              </p>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'P&L', value: totalPL   },
                  { label: 'Cash', value: totalCash },
                  { label: 'Tax saving', value: totalTax },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-lg font-serif font-semibold ${value >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                      {value >= 0 ? '+' : ''}£{Math.abs(value).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          );
        })()}

        {committedCount === 0 ? (
          <Card className="p-6 text-center text-muted-foreground bg-secondary/20 border-dashed shadow-sm">
            <BookMarked className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No decisions saved yet.</p>
            <p className="text-xs mt-1 max-w-sm mx-auto">
              Explore an idea above, adjust assumptions, then click "Save to Decision Memory" when you decide what to do.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {decisionMemory
              .filter(d => d.profileId === activeProfileId)
              .map(entry => <DecisionMemoryCard key={entry.id} entry={entry} />)}
          </div>
        )}
      </section>
    </div>
  );
}
