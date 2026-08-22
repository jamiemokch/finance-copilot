import { Card, Badge, Button } from '@/components/ui';
import { useStore, ComplianceItem, InboxItem, SAChecklistItem } from '@/lib/store';
import { bankImportsApi, reconciliationApi } from '@/lib/api';
import {
  Clock, Calendar, CheckCircle2, AlertCircle, FileText, CheckSquare,
  User, Bot, Briefcase, Circle, CalendarClock, MessageSquare, Download,
  Eye, ChevronDown, ChevronUp, RefreshCw, ShieldCheck, ArrowRight, ListChecks
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui';

type TabId = 'todo' | 'reconciliation' | 'timeline';

// ─── Compliance Timeline Tab ──────────────────────────────────────────────────

function ComplianceTab() {
  const { complianceItems, activeProfileId, profiles } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeItems = complianceItems.filter(i => i.profileId === activeProfileId);
  const sortedItems = [...activeItems].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getStatusConfig = (status: ComplianceItem['status']): { color: string; bg: string; border: string; icon: ReactNode } => {
    switch (status) {
      case 'overdue': return { color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/20', icon: <AlertCircle className="w-5 h-5 text-destructive" /> };
      case 'due-soon': return { color: 'text-amber-600', bg: 'bg-amber-100', border: 'border-amber-200', icon: <Clock className="w-5 h-5 text-amber-600" /> };
      case 'upcoming': return { color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20', icon: <Calendar className="w-5 h-5 text-primary" /> };
      case 'done': return { color: 'text-muted-foreground', bg: 'bg-secondary', border: 'border-border', icon: <CheckCircle2 className="w-5 h-5 text-muted-foreground" /> };
    }
  };

  const getDaysDiff = (dateStr: string) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const formatDaysLabel = (days: number, status: string) => {
    if (status === 'done') return 'Completed';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `In ${days} days`;
  };

  const getPartyIcon = (party: string) => {
    if (party === 'client') return <User className="w-3 h-3 mr-1" />;
    if (party === 'platform') return <Bot className="w-3 h-3 mr-1" />;
    return <Briefcase className="w-3 h-3 mr-1" />;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Obligations shown are illustrative for {activeProfile?.name}. Actual filing requirements depend on your real registrations and accounting periods.
      </div>

      <div className="relative pl-4 md:pl-8">
        <div className="absolute top-0 bottom-0 left-[27px] md:left-[43px] w-px bg-border -z-10" />
        <div className="space-y-8">
          {sortedItems.map(item => {
            const config = getStatusConfig(item.status);
            const isExpanded = expandedId === item.id;
            const daysDiff = getDaysDiff(item.dueDate);

            return (
              <div key={item.id} className={cn("relative group transition-opacity", item.status === 'done' && "opacity-60 hover:opacity-100")}>
                <div className={cn("absolute -left-4 md:-left-2 w-7 h-7 md:w-8 md:h-8 rounded-full border-4 border-background flex items-center justify-center shrink-0 shadow-sm z-10", config.bg)}>
                  <div className={cn("w-2 h-2 rounded-full", config.bg.replace('/10', '').replace('-100', '-500'))} />
                </div>
                <div
                  className={cn("ml-8 md:ml-12 border rounded-xl overflow-hidden bg-card shadow-sm transition-all cursor-pointer", config.border, isExpanded ? "ring-1 ring-primary/20" : "hover:border-primary/40")}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg", config.bg)}>{config.icon}</div>
                        <div>
                          <h3 className="font-medium text-lg text-foreground">{item.title}</h3>
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center">
                        <span className="text-xl font-serif text-foreground">
                          {new Date(item.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        <span className={cn("text-xs font-medium uppercase tracking-wider mt-1", config.color)}>
                          {formatDaysLabel(daysDiff, item.status)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4">
                      <Badge variant="outline" className="capitalize text-xs font-normal">Category: {item.category}</Badge>
                      <Badge variant="secondary" className="capitalize text-xs font-normal">Period: {item.periodCovered}</Badge>
                      <Badge variant="outline" className="capitalize text-xs font-normal flex items-center bg-background">
                        {getPartyIcon(item.responsibleParty)} Action: {item.responsibleParty}
                      </Badge>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border bg-secondary/10 p-5 space-y-6 animate-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <CheckSquare className="w-4 h-4 text-primary" /> Actions Required
                          </h4>
                          {item.actionsRequired.length > 0 ? (
                            <ul className="space-y-2">
                              {item.actionsRequired.map((action: string, idx: number) => (
                                <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                                  {action}
                                </li>
                              ))}
                            </ul>
                          ) : <p className="text-sm text-muted-foreground italic">No specific actions listed.</p>}
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary" /> Documents Required
                          </h4>
                          {item.documentsRequired.length > 0 ? (
                            <ul className="space-y-2">
                              {item.documentsRequired.map((doc: string, idx: number) => (
                                <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                                  {doc}
                                </li>
                              ))}
                            </ul>
                          ) : <p className="text-sm text-muted-foreground italic">No specific documents required.</p>}
                        </div>
                      </div>
                      {item.status !== 'done' && (
                        <div className="pt-4 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          Recommended preparation start: {item.preparationLeadDays} days before deadline
                          ({new Date(new Date(item.dueDate).getTime() - item.preparationLeadDays * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground pt-4">
        Reminders surface on your Dashboard based on urgency and preparation lead time.
      </p>
    </div>
  );
}

// ─── Inbox Tab ────────────────────────────────────────────────────────────────

function InboxTab() {
  const { inboxItems, evidenceItems, resolveInboxItem, resolveInboxBatch, activeProfileId, profiles, setCopilotTrigger } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeItems = inboxItems.filter(i => i.profileId === activeProfileId);
  const pendingItems = activeItems.filter(i => i.status === 'pending');
  const resolvedItems = activeItems.filter(i => i.status === 'resolved');
  const [subTab, setSubTab] = useState<'pending' | 'resolved'>('pending');
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [collapsedBatches, setCollapsedBatches] = useState<Record<string, boolean>>({});
  const [resolvingBatchId, setResolvingBatchId] = useState<string | null>(null);

  const handleOptionSelect = (itemId: string, optionLabel: string, hasSubOptions: boolean) => {
    if (!hasSubOptions) {
      setSelectedOptions(prev => ({ ...prev, [itemId]: optionLabel }));
    } else {
      setSelectedOptions(prev => {
        const next = { ...prev };
        delete next[`${itemId}_sub`];
        return { ...next, [itemId]: optionLabel };
      });
    }
  };

  const handleSubOptionSelect = (itemId: string, subLabel: string) => {
    setSelectedOptions(prev => ({ ...prev, [`${itemId}_sub`]: subLabel }));
  };

  const handleResolve = (item: InboxItem) => {
    const primary = selectedOptions[item.id];
    const sub = selectedOptions[`${item.id}_sub`];
    // Include sub-option text so the store gets the full classification context
    const answer = sub ? `${primary} — ${sub}` : primary;
    if (answer) resolveInboxItem(item.id, answer);
  };

  const isResolvable = (item: InboxItem) => {
    const opt = selectedOptions[item.id];
    if (!opt) return false;
    const selectedOpt = item.options.find(o => o.label === opt);
    if (selectedOpt?.subOptions && !selectedOptions[`${item.id}_sub`]) return false;
    return true;
  };
  const currentItems = [...(subTab === 'pending' ? pendingItems : resolvedItems)].sort((a, b) => {
    if (!a.evidenceId && !b.evidenceId) return 0;
    if (!a.evidenceId) return 1;
    if (!b.evidenceId) return -1;
    return a.evidenceId.localeCompare(b.evidenceId);
  });
  const batchItems = (evidenceId: string) => pendingItems.filter(item => item.evidenceId === evidenceId);
  const batchName = (evidenceId: string) => evidenceItems.find(item => item.id === evidenceId)?.filename ?? 'Imported file';
  const resolveBatchAsExpenses = async (evidenceId: string) => {
    const ids = batchItems(evidenceId).map(item => item.id);
    if (ids.length === 0 || resolvingBatchId) return;
    setResolvingBatchId(evidenceId);
    try {
      await resolveInboxBatch(ids, 'Fully deductible business expense');
    } finally {
      setResolvingBatchId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Bot className="w-4 h-4 text-primary shrink-0" />
        These items need your input to keep {activeProfile?.name}'s records accurate — resolving them may also affect your estimated tax figure.
      </div>

      <div className="flex gap-2 border-b border-border pb-px">
        {[
          { id: 'pending', label: `Needs attention (${pendingItems.length})` },
          { id: 'resolved', label: `Resolved (${resolvedItems.length})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id as 'pending' | 'resolved')}
            className={cn(
              "px-4 py-2 font-medium text-sm transition-colors border-b-2 cursor-pointer",
              subTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {subTab === 'pending' && pendingItems.length === 0 && resolvedItems.length > 0 && (
          <div className="text-center py-14 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
            <h3 className="text-lg font-semibold text-emerald-800">All items resolved!</h3>
            <p className="text-emerald-700 mt-1 max-w-sm mx-auto text-sm">
              Your financial figures have been updated. Ready to see the impact?
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="/dashboard"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors cursor-pointer"
              >
                View updated Home →
              </a>
              <a
                href="/position"
                className="inline-flex items-center gap-2 bg-background border border-emerald-300 text-emerald-800 px-5 py-2.5 rounded-lg font-medium text-sm hover:bg-emerald-50 transition-colors cursor-pointer"
              >
                View updated Finances →
              </a>
            </div>
          </div>
        )}
        {subTab === 'pending' && pendingItems.length === 0 && resolvedItems.length === 0 && (
          <div className="text-center py-16 bg-card rounded-xl border border-border shadow-sm">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-500 opacity-80" />
            <h3 className="text-lg font-medium">You're all caught up!</h3>
            <p className="text-muted-foreground mt-1">No items require your attention right now.</p>
          </div>
        )}
        {subTab === 'resolved' && resolvedItems.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">No resolved items yet.</div>
        )}

        {currentItems.map((item, index) => {
          const isBatchStart = subTab === 'pending' && !!item.evidenceId && !currentItems.slice(0, index).some(previous => previous.evidenceId === item.evidenceId);
          const batch = item.evidenceId ? batchItems(item.evidenceId) : [];
          if (item.evidenceId && collapsedBatches[item.evidenceId]) {
            return isBatchStart ? (
              <button key={`batch-${item.evidenceId}`} onClick={() => setCollapsedBatches(prev => ({ ...prev, [item.evidenceId!]: false }))} className="w-full text-left bg-secondary/40 border border-border rounded-xl p-4 flex justify-between cursor-pointer">
                <span className="text-sm font-medium">Imported batch · {batchName(item.evidenceId)} ({batch.length} items)</span><ChevronDown className="w-4 h-4" />
              </button>
            ) : null;
          }
          return <div key={item.id} className="space-y-3">
          {isBatchStart && <div className="bg-secondary/40 border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <button onClick={() => setCollapsedBatches(prev => ({ ...prev, [item.evidenceId!]: true }))} className="text-left flex items-center gap-2 cursor-pointer"><FileText className="w-4 h-4 text-primary" /><span className="text-sm font-medium">Imported batch · {batchName(item.evidenceId!)} ({batch.length} items)</span><ChevronUp className="w-4 h-4" /></button>
            {batch.every(batchItem => (batchItem.amount ?? 0) < 0)
              ? <Button size="sm" variant="outline" className="cursor-pointer" disabled={resolvingBatchId === item.evidenceId} onClick={() => void resolveBatchAsExpenses(item.evidenceId!)}>{resolvingBatchId === item.evidenceId ? 'Resolving…' : 'Resolve all as business expenses'}</Button>
              : <span className="text-xs text-muted-foreground">This batch includes money in and out — review each row.</span>}
          </div>}
          <Card className="overflow-hidden shadow-sm">
            <div className="p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      {new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {item.amount !== undefined && (
                      <Badge variant="secondary" className="font-mono text-xs bg-accent text-accent-foreground">
                        £{item.amount.toFixed(2)}
                      </Badge>
                    )}
                  </div>
                  <h3 className="text-lg font-medium">{item.description}</h3>
                </div>
                {item.status === 'resolved' && (
                  <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolved
                  </Badge>
                )}
              </div>

              <div className="bg-secondary/30 rounded-xl p-4 mb-5 text-sm flex gap-3">
                <Bot className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <p className="leading-relaxed text-foreground">{item.aiReasoning}</p>
              </div>

              {item.status === 'pending' ? (
                <div className="space-y-4">
                  <p className="text-sm font-medium">How should we handle this?</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {item.options.map((opt, idx) => {
                      const isSelected = selectedOptions[item.id] === opt.label;
                      return (
                        <div key={idx} className="flex flex-col gap-2">
                          <button
                            onClick={() => handleOptionSelect(item.id, opt.label, !!opt.subOptions)}
                            className={cn(
                              "p-3 rounded-lg border text-left text-sm transition-all cursor-pointer",
                              isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:bg-secondary/50'
                            )}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-medium">{opt.label}</span>
                              {opt.isSuggested && (
                                <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary uppercase">Suggested</Badge>
                              )}
                            </div>
                          </button>
                          {isSelected && opt.subOptions && (
                            <div className="ml-4 pl-4 border-l-2 border-primary/20 space-y-2 py-2 animate-in slide-in-from-top-2 duration-200">
                              <p className="text-xs text-muted-foreground font-medium">Treatment choice:</p>
                              {opt.subOptions.map((sub, sIdx) => {
                                const isSubSelected = selectedOptions[`${item.id}_sub`] === sub.label;
                                return (
                                  <button
                                    key={sIdx}
                                    onClick={() => handleSubOptionSelect(item.id, sub.label)}
                                    className={cn(
                                      "w-full p-2.5 rounded-md border text-left text-sm transition-all cursor-pointer",
                                      isSubSelected ? 'border-primary bg-primary/10 font-medium' : 'border-border bg-card hover:bg-secondary/30 text-muted-foreground'
                                    )}
                                  >
                                    <div className="flex justify-between items-center">
                                      <span>{sub.label}</span>
                                      {sub.isSuggested && (
                                        <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Standard</Badge>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="pt-3 flex justify-end gap-3">
                    <Button
                      variant="outline"
                      className="cursor-pointer bg-background"
                      onClick={() => setCopilotTrigger(`Help me resolve: ${item.description}`)}
                    >
                      <MessageSquare className="w-4 h-4 mr-2" /> Discuss in Copilot
                    </Button>
                    <Button
                      className="cursor-pointer"
                      onClick={() => handleResolve(item)}
                      disabled={!isResolvable(item)}
                    >
                      Confirm resolution
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="bg-background border border-border rounded-lg p-4 text-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Your decision</p>
                  <p className="font-medium">{item.customAnswer}</p>
                </div>
              )}
            </div>
          </Card>
          </div>;
        })}
      </div>
    </div>
  );
}

// ─── M10 Reconciliation Tab ───────────────────────────────────────────────────

function formatObservedFacts(facts: Record<string, unknown>) {
  const entries = Object.entries(facts).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  ).slice(0, 6);
  return entries.map(([key, value]) => `${key.replaceAll(/([A-Z])/g, ' $1')}: ${String(value)}`);
}

function ReconciliationTab() {
  const {
    activeProfileId, reconciliationExceptions, reconciliationWorkflowTasks,
    reconciliationCoverageChecks, evidenceItems, refreshData, refreshReconciliation,
  } = useStore();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<Array<{ id: string; displayName: string }>>([]);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageForm, setCoverageForm] = useState({ accountId: '', periodStart: '', periodEnd: '', closingBalance: '' });

  useEffect(() => {
    let cancelled = false;
    setAccounts([]);
    setCoverageForm({ accountId: '', periodStart: '', periodEnd: '', closingBalance: '' });
    if (!activeProfileId) return () => { cancelled = true; };
    bankImportsApi.accounts(activeProfileId)
      .then(items => {
        if (!cancelled) {
          setAccounts(items.map(item => ({ id: item.id, displayName: item.displayName })));
        }
      })
      .catch(() => { if (!cancelled) setError('We could not load Financial Accounts for a coverage declaration.'); });
    return () => { cancelled = true; };
  }, [activeProfileId]);

  const openExceptions = reconciliationExceptions.filter(item => item.status === 'open' || item.status === 'resolving');
  const resolvedExceptions = reconciliationExceptions.filter(item => !['open', 'resolving'].includes(item.status));

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await refreshReconciliation();
    } catch {
      setError('We could not refresh the reconciliation review. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const resolve = async (
    exception: typeof reconciliationExceptions[number],
    action: Parameters<typeof reconciliationApi.resolve>[2]['action'],
    extra: Record<string, unknown> = {},
  ) => {
    if (!activeProfileId) return;
    const profileId = activeProfileId;
    setWorkingId(exception.id);
    setError('');
    try {
      await reconciliationApi.resolve(profileId, exception.id, {
        action,
        expectedRevision: exception.sourceRevision,
        idempotencyKey: crypto.randomUUID(),
        ...extra,
      } as Parameters<typeof reconciliationApi.resolve>[2]);
      if (activeProfileId === profileId) await refreshData();
    } catch (err) {
      if (activeProfileId === profileId) {
        setError(err instanceof Error ? err.message : 'We could not save that reconciliation action.');
      }
    } finally {
      if (activeProfileId === profileId) setWorkingId(null);
    }
  };

  const createCoverageCheck = async () => {
    if (!activeProfileId || !coverageForm.accountId || !coverageForm.periodStart || !coverageForm.periodEnd) {
      setError('Choose a Financial Account and a complete coverage period.');
      return;
    }
    const profileId = activeProfileId;
    setWorkingId('coverage');
    setError('');
    try {
      await reconciliationApi.createCoverageCheck(profileId, {
        accountId: coverageForm.accountId,
        periodStart: coverageForm.periodStart,
        periodEnd: coverageForm.periodEnd,
        completeExpectedCoverage: true,
        statementClosingBalance: coverageForm.closingBalance === '' ? null : Number(coverageForm.closingBalance),
      });
      if (activeProfileId === profileId) {
        setShowCoverage(false);
        await refreshData();
      }
    } catch (err) {
      if (activeProfileId === profileId) setError(err instanceof Error ? err.message : 'We could not create the coverage check.');
    } finally {
      if (activeProfileId === profileId) setWorkingId(null);
    }
  };

  const severityClass = (severity: string) => ({
    high: 'bg-red-100 text-red-800 border-red-200',
    critical: 'bg-red-100 text-red-800 border-red-200',
    medium: 'bg-amber-100 text-amber-800 border-amber-200',
    low: 'bg-slate-100 text-slate-700 border-slate-200',
  }[severity] ?? 'bg-secondary text-muted-foreground');

  return (
    <div className="space-y-6">
      <Card className="p-5 border-primary/20 bg-primary/[0.03]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex gap-3">
            <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="font-serif text-xl">Reconciliation review</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                These are fact-based review items. Refreshing, acknowledging, or dismissing them does not change Financial Memory, tax, cash, or P&amp;L.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw className={cn('w-4 h-4 mr-2', refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing…' : 'Refresh facts'}
          </Button>
        </div>
      </Card>

      {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">{error}</div>}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" />Declared coverage checks</h3>
            <p className="text-sm text-muted-foreground mt-1">No-activity is checked only after you declare this account and period complete. A typed closing balance is never compared to transaction sums or dashboard cash.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowCoverage(value => !value)}>
            {showCoverage ? 'Cancel' : 'Declare coverage'}
          </Button>
        </div>
        {showCoverage && (
          <div className="mt-5 grid gap-3 md:grid-cols-4 border-t border-border pt-5">
            <label className="text-sm font-medium">Financial Account
              <select className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={coverageForm.accountId} onChange={event => setCoverageForm(value => ({ ...value, accountId: event.target.value }))}>
                <option value="">Choose account</option>
                {accounts.map(account => <option key={account.id} value={account.id}>{account.displayName}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Period start
              <input type="date" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={coverageForm.periodStart} onChange={event => setCoverageForm(value => ({ ...value, periodStart: event.target.value }))} />
            </label>
            <label className="text-sm font-medium">Period end
              <input type="date" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={coverageForm.periodEnd} onChange={event => setCoverageForm(value => ({ ...value, periodEnd: event.target.value }))} />
            </label>
            <label className="text-sm font-medium">Closing balance (optional)
              <input type="number" step="0.01" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={coverageForm.closingBalance} onChange={event => setCoverageForm(value => ({ ...value, closingBalance: event.target.value }))} />
            </label>
            <div className="md:col-span-4 flex justify-end">
              <Button disabled={workingId === 'coverage'} onClick={() => void createCoverageCheck()}>{workingId === 'coverage' ? 'Saving…' : 'Declare complete coverage'}</Button>
            </div>
          </div>
        )}
        {reconciliationCoverageChecks.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
            {reconciliationCoverageChecks.map(check => <p key={check.id}>{check.periodStart} to {check.periodEnd} · {check.state} · {check.completeExpectedCoverage ? 'complete coverage declared' : 'not declared complete'}</p>)}
          </div>
        )}
      </Card>

      {reconciliationWorkflowTasks.length > 0 && (
        <Card className="overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="font-medium">Saved bank-import work</h3>
            <p className="text-sm text-muted-foreground mt-1">These remain bank CSV staging tasks in Add Records; they are not canonical reconciliation exceptions.</p>
          </div>
          <div className="divide-y divide-border">
            {reconciliationWorkflowTasks.map(task => <div key={task.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-medium text-sm">{task.title}</p><p className="text-xs text-muted-foreground mt-1">Staging status: {task.status.replaceAll('_', ' ')}</p></div>
              <a href={task.href} className="inline-flex items-center text-sm text-primary hover:underline">Open Add Records <ArrowRight className="w-4 h-4 ml-1" /></a>
            </div>)}
          </div>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-serif text-xl">Needs review</h3><Badge variant="outline">{openExceptions.length}</Badge></div>
        {openExceptions.length === 0 ? (
          <Card className="p-8 text-center"><CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto mb-3" /><p className="font-medium">No open reconciliation exceptions</p><p className="text-sm text-muted-foreground mt-1">Any saved bank-import work is listed separately above.</p></Card>
        ) : openExceptions.map(exception => {
          const facts = formatObservedFacts(exception.observedFacts);
          const sourceLink = exception.sourceKind === 'canonical_transaction' ? `/memory/${exception.sourceId}` : null;
          const isMissingSupport = exception.ruleKey === 'missing_required_support';
          const isClassification = exception.ruleKey === 'unclassified_bank_transaction';
          const isCoverage = exception.sourceKind === 'coverage_check';
          return <Card key={exception.id} className="p-5 space-y-4">
            <div className="flex flex-wrap gap-2 items-start justify-between">
              <div><h4 className="font-medium">{exception.exceptionType.replaceAll('_', ' ')}</h4><p className="text-sm text-muted-foreground mt-1">Rule: {exception.ruleKey.replaceAll('_', ' ')}</p></div>
              <Badge className={cn('capitalize', severityClass(exception.severity))}>{exception.severity}</Badge>
            </div>
            <div className="rounded-lg bg-secondary/40 p-3 text-sm text-muted-foreground space-y-1">
              {facts.length ? facts.map(fact => <p key={fact}>{fact}</p>) : <p>Observed facts are available for this item.</p>}
            </div>
            <p className="text-xs text-muted-foreground">No financial impact is applied until you explicitly confirm a specific source change.</p>
            <div className="flex flex-wrap gap-2 justify-between items-center">
              <div className="flex flex-wrap gap-2">
                {sourceLink && <a href={sourceLink} className="inline-flex items-center text-sm text-primary hover:underline">View Financial Memory <ArrowRight className="w-4 h-4 ml-1" /></a>}
                {isClassification && <Button size="sm" disabled={workingId === exception.id} onClick={() => {
                  if (window.confirm('Classify this exact bank movement as an expense? This will update only this Financial Memory record.')) {
                    void resolve(exception, 'classify_transaction', { fields: { accountingClassification: 'expense', category: 'expense', taxTreatment: 'deductible' } });
                  }
                }}>{workingId === exception.id ? 'Saving…' : 'Classify as expense'}</Button>}
                {isMissingSupport && <Button size="sm" variant="outline" disabled={workingId === exception.id} onClick={() => void resolve(exception, 'set_support_expectation', { expectationState: 'not_required', reason: 'Confirmed by user during reconciliation review' })}>Mark support not required</Button>}
                {isMissingSupport && evidenceItems.filter(item => item.documentLifecycle === 'active').length > 0 && <Button size="sm" variant="outline" disabled={workingId === exception.id} onClick={() => {
                  const evidence = evidenceItems.find(item => item.documentLifecycle === 'active');
                  if (evidence && window.confirm(`Attach "${evidence.filename}" as supporting evidence?`)) void resolve(exception, 'attach_evidence', { evidenceId: evidence.id });
                }}>Attach an owned document</Button>}
                {isCoverage && <Button size="sm" variant="outline" disabled={workingId === exception.id} onClick={() => void resolve(exception, 'confirm_coverage', { coverageCheckId: exception.sourceId, reason: 'Reviewed declared coverage check' })}>Confirm review</Button>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={workingId === exception.id} onClick={() => void resolve(exception, 'acknowledge', { reason: 'Reviewed without a financial change' })}>Acknowledge</Button>
                <Button size="sm" variant="ghost" disabled={workingId === exception.id} onClick={() => {
                  if (window.confirm('Dismiss this exact observed-facts revision? Changed source facts will create a new review item.')) void resolve(exception, 'dismiss', { reason: 'Dismissed for this observed-facts revision' });
                }}>Dismiss</Button>
              </div>
            </div>
          </Card>;
        })}
      </div>

      {resolvedExceptions.length > 0 && <p className="text-xs text-muted-foreground text-center">{resolvedExceptions.length} resolved, dismissed, or superseded current revision{resolvedExceptions.length === 1 ? '' : 's'} retained in audit history.</p>}
    </div>
  );
}

// ─── Year-End Tab ─────────────────────────────────────────────────────────────

function YearEndTab() {
  const { saChecklist, updateSAChecklistItem, inboxItems, evidenceItems, activeProfileId, yearEndPackGenerated, setYearEndPackGenerated, profiles, complianceItems, plBreakdown } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);

  // ── Tax-year derived helpers ────────────────────────────────────────────────
  const taxYear = (activeProfile as Record<string, unknown>)?.taxYear as string | undefined ?? '2024/25';
  const saYearLabel = taxYear.slice(2); // '2024/25' → '24/25'
  const startYear = parseInt(taxYear.split('/')[0], 10);
  const taxPeriod = `6 Apr ${startYear} – 5 Apr ${startYear + 1}`; // '6 Apr 2024 – 5 Apr 2025'

  const profileEvidenceItems = evidenceItems.filter(e => e.profileId === activeProfileId);
  const activeChecklist = saChecklist.filter(i => i.profileId === activeProfileId);
  const activeInbox = inboxItems.filter(i => i.profileId === activeProfileId && i.status === 'pending');
  const saDeadline = complianceItems.find(c => c.profileId === activeProfileId && c.category === 'filing' && c.status !== 'done');

  const total = activeChecklist.length;
  const done = activeChecklist.filter(i => i.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const canBuildPack = activeInbox.length === 0 && done >= total - 1;

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'data': return 'Data & records';
      case 'inbox': return 'Inbox';
      case 'filing': return 'Filing';
      case 'payment': return 'Payment';
      default: return cat;
    }
  };

  return (
    <div className="space-y-8">
      {/* Readiness overview */}
      <Card className="p-6 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-medium">Self-Assessment {saYearLabel} Readiness</h2>
            </div>
            {saDeadline && (
              <p className="text-sm text-muted-foreground">
                Filing deadline: <span className="font-medium text-foreground">
                  {new Date(saDeadline.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </p>
            )}
          </div>
          <div className="w-full md:w-64 space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span>{done} of {total} tasks ready</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full bg-secondary h-3 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-primary' : 'bg-amber-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Checklist by category */}
      {(['data', 'inbox', 'filing', 'payment'] as const).map(cat => {
        const catItems = activeChecklist.filter(i => i.category === cat);
        if (catItems.length === 0) return null;
        return (
          <div key={cat} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{getCategoryLabel(cat)}</h3>
            <div className="space-y-2">
              {catItems.map(item => (
                <Card key={item.id} className={cn("p-4 shadow-sm border-border transition-colors", item.status === 'done' && "opacity-70")}>
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => updateSAChecklistItem(item.id, item.status === 'done' ? 'pending' : 'done')}
                      className="mt-0.5 shrink-0 cursor-pointer"
                    >
                      {item.status === 'done'
                        ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        : <Circle className="w-5 h-5 text-muted-foreground hover:text-primary transition-colors" />
                      }
                    </button>
                    <div className="flex-1">
                      <p className={cn("font-medium text-sm", item.status === 'done' && "line-through text-muted-foreground")}>
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                    </div>
                    <Badge
                      className={cn(
                        'text-[10px] shrink-0',
                        item.status === 'done' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                        item.status === 'blocked' ? 'bg-red-100 text-red-700 border-red-200' :
                        'bg-amber-100 text-amber-800 border-amber-200'
                      )}
                    >
                      {item.status === 'done' ? 'Done' : item.status === 'blocked' ? 'Blocked' : 'Pending'}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {/* Year-End Pack */}
      {!yearEndPackGenerated ? (
        <Card className="p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
          <div>
            <h3 className="font-serif text-xl font-medium">Ready to compile your Year-End Pack?</h3>
            <p className="text-muted-foreground mt-1 max-w-md text-sm">
              Once all tasks are ready, we generate a locked pack you can send to an accountant or use to file directly.
            </p>
            {!canBuildPack && (
              <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {activeInbox.length > 0 ? `Resolve ${activeInbox.length} Inbox item${activeInbox.length !== 1 ? 's' : ''} first.` : 'Complete remaining checklist tasks to unlock.'}
              </p>
            )}
          </div>
          <Button
            size="lg"
            className="w-full md:w-auto cursor-pointer gap-2 h-12 px-8 shadow-md"
            disabled={!canBuildPack}
            onClick={() => setYearEndPackGenerated(true)}
          >
            {canBuildPack ? 'Build Year-End Pack' : 'Complete tasks to unlock'}
          </Button>
        </Card>
      ) : (
        <div className="space-y-5 animate-in fade-in zoom-in-95 duration-500">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-5 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-medium">Year-End Pack Generated</h3>
                <p className="text-sm opacity-80">Compiled {new Date().toLocaleDateString('en-GB')} · Locked for review</p>
              </div>
            </div>
            <Button variant="outline" className="bg-background cursor-pointer whitespace-nowrap" onClick={() => setYearEndPackGenerated(false)}>
              Unlock & Edit
            </Button>
          </div>
          <Card className="p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-border">
              <h2 className="text-xl font-serif flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-primary" /> Pack Preview
              </h2>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 text-sm opacity-50 cursor-not-allowed" disabled title="Coming soon">
                  <Eye className="w-4 h-4" /> Accountant Review
                </Button>
                <Button className="gap-2 text-sm bg-primary opacity-50 cursor-not-allowed" disabled title="Coming soon">
                  <Download className="w-4 h-4" /> Download ZIP
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Summary</h3>
                <dl className="space-y-3 text-sm">
                  {[
                    ['Entity', activeProfile?.name ?? '—'],
                    ['Period', taxPeriod],
                    ['Total Income', `£${plBreakdown.revenues.reduce((s, r) => s + r.amount, 0).toLocaleString()}`],
                    ['Allowable Expenses', `£${plBreakdown.confirmedExpenses.reduce((s, e) => s + e.amount, 0).toLocaleString()}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-border pb-2">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Contents</h3>
                <ul className="space-y-2 text-sm">
                  {[
                    'General Ledger (CSV)',
                    'Profit & Loss Statement (PDF)',
                    `Records Archive (${profileEvidenceItems.length} file${profileEvidenceItems.length !== 1 ? 's' : ''})`,
                    'Assumptions & AI Reasoning Log',
                  ].map(f => (
                    <li key={f} className="flex items-center gap-3 p-2 rounded hover:bg-secondary/50">
                      <FileText className="w-4 h-4 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Tasks() {
  const { inboxItems, activeProfileId, complianceItems, reconciliationExceptions } = useStore();
  const pendingInbox = inboxItems.filter(i => i.profileId === activeProfileId && i.status === 'pending').length;
  const urgentDeadlines = complianceItems.filter(c => c.profileId === activeProfileId && (c.status === 'due-soon' || c.status === 'overdue')).length;
  const pendingReconciliation = reconciliationExceptions.filter(item => item.status === 'open' || item.status === 'resolving').length;

  const [activeTab, setActiveTab] = useState<TabId>('todo');

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'todo',     label: 'To Do',     count: pendingInbox + urgentDeadlines },
    { id: 'reconciliation', label: 'Reconciliation', count: pendingReconciliation },
    { id: 'timeline', label: 'Timeline' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Tasks & Timeline</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Everything you need to action, file, and stay compliant — in one place.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-px">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 font-medium text-sm transition-colors border-b-2 cursor-pointer",
              activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-xs font-semibold",
                activeTab === tab.id ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'
              )}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'todo' && <InboxTab />}
      {activeTab === 'reconciliation' && <ReconciliationTab />}
      {activeTab === 'timeline' && (
        <div className="space-y-10">
          <ComplianceTab />
          {/* Year-end pack — merged into Timeline as a bottom section */}
          <div>
            <div className="flex items-center gap-2 mb-6 pt-6 border-t border-border">
              <h2 className="text-xl font-serif font-medium text-foreground">Year-End Pack</h2>
              <Badge variant="outline" className="text-[10px]">Merged into Timeline</Badge>
            </div>
            <YearEndTab />
          </div>
        </div>
      )}
    </div>
  );
}
