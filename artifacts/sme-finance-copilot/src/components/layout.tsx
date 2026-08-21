import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard, WalletCards, Lightbulb, Settings,
  Menu, X, Bot, CheckSquare, UploadCloud, User, MessageSquare,
  RotateCcw,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from './ui';
import { Button, Input } from '@/components/ui';
import { Card } from '@/components/ui';
import { useStore } from '@/lib/store';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { inboxItems, activeProfileId, businessIdeas, profiles, setActiveProfileId, resetDemoData } = useStore();
  const pendingInbox = inboxItems.filter(i => i.status === 'pending' && i.profileId === activeProfileId).length;
  const newIdeas = businessIdeas.filter(d => d.status === 'new' && d.profileId === activeProfileId).length;

  // Auto-cancel reset confirmation after 4 seconds
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const handleReset = () => {
    if (confirmReset) {
      resetDemoData();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
    }
  };

  const navItems = [
    { href: '/ingest',         label: 'Evidence',         icon: UploadCloud, sublabel: 'start here' },
    { href: '/dashboard',      label: 'Home',             icon: LayoutDashboard },
    { href: '/position',       label: 'Finances',         icon: WalletCards },
    { href: '/business-ideas', label: 'Business Ideas',   icon: Lightbulb, count: newIdeas },
    { href: '/tasks',          label: 'Tasks & Timeline', icon: CheckSquare, count: pendingInbox },
    // Copilot removed from primary nav — use the floating button (always visible, bottom-right)
  ];

  const getIsActive = (href: string) => {
    if (href === '/ingest') return ['/ingest', '/evidence'].includes(location);
    if (href === '/business-ideas') return ['/business-ideas', '/decisions', '/tax', '/optimisation'].includes(location);
    if (href === '/tasks') return ['/tasks', '/compliance', '/inbox', '/year-end', '/exceptions'].includes(location);
    if (href === '/position') return ['/position', '/memory'].includes(location);
    return location === href;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-2 font-serif text-lg text-primary font-semibold">
          <Bot className="w-5 h-5" />
          <span>Finance Companion</span>
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 -mr-2 cursor-pointer">
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col transition-transform duration-300 md:static md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="px-5 py-4 hidden md:flex items-center gap-3 font-serif text-xl text-primary font-semibold border-b border-border">
          <Bot className="w-6 h-6 shrink-0" />
          <span className="leading-tight">Finance<br /><span className="text-base font-sans font-semibold">Companion</span></span>
        </div>

        {/* ── Profile switcher ─────────────────────────────────────── */}
        <div className="mx-3 mt-3 mb-1 p-3 bg-secondary/40 border border-border rounded-xl">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Active profile
          </p>
          <div className="space-y-1">
            {profiles.map(p => (
              <button
                key={p.id}
                onClick={() => { setActiveProfileId(p.id); setSidebarOpen(false); }}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors cursor-pointer",
                  p.id === activeProfileId
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <div className="min-w-0">
                    <p className="truncate leading-tight text-sm">{p.name}</p>
                    <p className={cn(
                      "text-[10px] capitalize leading-tight",
                      p.id === activeProfileId ? "opacity-70" : "opacity-50"
                    )}>
                      {p.type.replace('_', ' ')}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Nav ─────────────────────────────────────────────────── */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = getIsActive(item.href);
            const isEvidence = item.href === '/ingest';
            return (
              <div key={item.href}>
                {isEvidence && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 pt-2 pb-1">
                    Input
                  </p>
                )}
                {item.href === '/dashboard' && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 pt-3 pb-1">
                    Output
                  </p>
                )}
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                  onClick={() => setSidebarOpen(false)}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                    {'sublabel' in item && item.sublabel && !active && (
                      <span className="text-[10px] font-normal opacity-60">{item.sublabel}</span>
                    )}
                  </div>
                  {item.count !== undefined && item.count > 0 && (
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-semibold",
                      active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-accent text-accent-foreground"
                    )}>
                      {item.count}
                    </span>
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Settings + Copilot hint */}
        <div className="p-3 border-t border-border space-y-1">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
              location === '/settings'
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={() => setSidebarOpen(false)}
          >
            <Settings className="w-4 h-4" />
            Profile & Settings
          </Link>
          <p className="text-[10px] text-muted-foreground px-3 py-1 flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3 opacity-50" />
            Copilot available bottom-right
          </p>
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 relative">
          {/* Prototype banner with Reset button */}
          <div className="mb-6 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3 shadow-sm">
            <span className="font-medium text-center flex-1">
              Prototype — fictional sample data · Copilot responses are mocked · Progress saves in your browser
            </span>
            <button
              onClick={handleReset}
              className={cn(
                "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-all cursor-pointer shrink-0 whitespace-nowrap",
                confirmReset
                  ? "bg-red-100 border-red-300 text-red-700 hover:bg-red-200"
                  : "bg-amber-100/80 border-amber-300 text-amber-800 hover:bg-amber-200"
              )}
            >
              <RotateCcw className="w-3 h-3" />
              {confirmReset ? 'Confirm reset?' : 'Reset demo'}
            </button>
          </div>
          {children}
        </div>

        {/* Floating Copilot Launcher */}
        <FloatingCopilot />
      </main>
    </div>
  );
}

function FloatingCopilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { role: 'system', content: "Hi! I have your financial context ready. Ask me about your tax, cash, invoices, or what to action next. (This is a simulated demo — responses are pre-scripted.)" }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { copilotTrigger, setCopilotTrigger, positionItems, inboxItems, activeProfileId, plBreakdown, cashBreakdown } = useStore();

  useEffect(() => {
    if (copilotTrigger) {
      setIsOpen(true);
      setInput(copilotTrigger);
      setCopilotTrigger(null);
    }
  }, [copilotTrigger, setCopilotTrigger]);

  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, isOpen, input]);

  // Context-aware mock responses that reference live financial state
  const getMockResponse = (q: string): string => {
    const lower = q.toLowerCase();
    const taxKpi    = positionItems.find(p => p.id === 'kpi2');
    const plKpi     = positionItems.find(p => p.id === 'kpi1');
    const cashKpi   = positionItems.find(p => p.id === 'kpi5');
    const arKpi     = positionItems.find(p => p.id === 'kpi3');
    const taxDue    = taxKpi?.rawValue ?? 6900;
    const profit    = plKpi?.rawValue ?? 35000;
    const totalRev  = plBreakdown.revenues.reduce((s, r) => s + r.amount, 0);
    const totalCash = cashBreakdown.accounts.reduce((s, a) => s + a.balance, 0);
    const avail     = totalCash - cashBreakdown.taxReserve - cashBreakdown.apDueWithin30Days;
    const gap       = Math.max(0, taxDue - cashBreakdown.taxReserve);
    const pending   = inboxItems.filter(i => i.status === 'pending' && i.profileId === activeProfileId);

    if (lower.includes('tax') || lower.includes('owe') || lower.includes('bill') || lower.includes('january') || lower.includes('hmrc')) {
      return `Your estimated tax balance due 31 Jan 2025 is ${taxKpi?.value ?? '£6,900'} — trading profit ${plKpi?.value ?? '£35,000'} + property income £10,200 − personal allowance £12,570 = £${(profit + 10200 - 12570).toLocaleString()} taxable at basic rate (20%).\n\nYour tax reserve is £${cashBreakdown.taxReserve.toLocaleString()}${gap > 0 ? ` — gap of £${gap.toLocaleString()} to plug before January` : ' — reserve covers the balance due ✓'}. ${pending.length > 0 ? `Resolving ${pending.length} pending Inbox item${pending.length !== 1 ? 's' : ''} could reduce your bill further.` : ''}`;
    }

    if (lower.includes('cash') || lower.includes('available') || lower.includes('money') || lower.includes('afford')) {
      return `Available cash: £${avail.toLocaleString()} (Starling £${totalCash.toLocaleString()} − tax reserve £${cashBreakdown.taxReserve.toLocaleString()} − AP £${cashBreakdown.apDueWithin30Days.toLocaleString()} = £${avail.toLocaleString()}).\n\n${arKpi ? `AR outstanding: ${arKpi.value} — Axiom invoice #1042 (£2,400) is 7 days overdue. Chasing that is the fastest cash move available.` : ''}`;
    }

    if (lower.includes('profit') || lower.includes('revenue') || lower.includes('income') || lower.includes('p&l') || lower.includes('earnings')) {
      const expTotal = plBreakdown.confirmedExpenses.reduce((s, e) => s + e.amount, 0);
      const pending_ = plBreakdown.pendingExpenses.reduce((s, e) => s + e.amount, 0);
      return `YTD profit (confirmed): ${plKpi?.value ?? '£35,000'}. Revenue £${totalRev.toLocaleString()} across: design fees £31,200, Axiom retainer £7,200, licensing £1,400. Confirmed expenses: £${expTotal.toLocaleString()}.\n\n${pending_ > 0 ? `${plBreakdown.pendingExpenses.length} pending Inbox item${plBreakdown.pendingExpenses.length !== 1 ? 's' : ''} (£${pending_.toLocaleString()}) excluded until classified — resolving them as expenses would reduce profit to £${(profit - pending_).toLocaleString()}.` : 'All Inbox items resolved — profit figure is final.'}`;
    }

    if (lower.includes('inbox') || lower.includes('apple') || lower.includes('meeting room') || lower.includes('resolve') || lower.includes('classify')) {
      if (pending.length === 0) {
        return `Great — all Inbox items are resolved! Your financial figures are now finalised. Head to Business Ideas to see updated tax-saving opportunities, or check your SA Readiness progress on the Home screen.`;
      }
      return `You have ${pending.length} pending Inbox item${pending.length !== 1 ? 's' : ''} in Tasks → To Do.\n\nThe Apple Store charge (£1,249) likely qualifies as a business asset via AIA — if so, fully deductible and saves ~£250 in tax. The meeting room (£150) is allowable if purely room hire. Both together: up to £382 saving. Go to Tasks → To Do to resolve them — it only takes 2 clicks per item.`;
    }

    if (lower.includes('idea') || lower.includes('action') || lower.includes('next') || lower.includes('do') || lower.includes('suggest')) {
      return `Your top "Do now" opportunities:\n\n1. Chase Axiom invoice #1042 — £2,400 overdue 7 days. Cash impact: £1,500–£2,200 this month.\n2. Buy a qualifying asset before 5 April — AIA saves 20% of purchase price in tax.\n3. Claim WFH allowance in your SA return — free £24–£62 saving, deadline 31 Jan 2025.\n\nGo to Business Ideas to adjust assumptions and record your decision.`;
    }

    if (lower.includes('ar') || lower.includes('invoice') || lower.includes('axiom') || lower.includes('studio nine') || lower.includes('overdue')) {
      return `AR outstanding: £${arKpi?.rawValue?.toLocaleString() ?? '3,400'} across 2 invoices.\n\n• Axiom Agency #1042 — £2,400 (7 days overdue) — chase today.\n• Studio Nine #1043 — £1,000 (due 5 Apr) — on track.\n\nOnce Axiom pays, earmark that £2,400 toward your January tax bill (gap: £${gap.toLocaleString()}).`;
    }

    if (lower.includes('sa') || lower.includes('self assessment') || lower.includes('filing') || lower.includes('return') || lower.includes('readiness')) {
      return `Self-Assessment 23/24 deadline: 31 January 2025. Key steps remaining: resolve Inbox items, upload missing receipts, confirm Q3 rental statement, complete SA100 + SA103 forms.\n\nCheck your readiness progress on the Home screen — it tracks all 8 steps with live status.`;
    }

    return `Demo response — in a live Copilot I'd read your full Financial Memory: P&L ${plKpi?.value ?? '£35,000'}, tax ${taxKpi?.value ?? '£6,900'} balance due (gap £${gap.toLocaleString()}), cash £${avail.toLocaleString()} available, AR £${arKpi?.value ?? '£3,400'}. I'd give a sourced, conservative answer with the calculation basis shown.\n\nTry asking: "How much tax do I owe?", "What should I action next?", or "How much cash do I have?"`;
  };

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'system',
        content: getMockResponse(userMsg),
      }]);
      setIsTyping(false);
    }, 900);
  };

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {isOpen && (
          <Card className="w-[340px] h-[480px] mb-4 shadow-xl border-border flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className="bg-primary text-primary-foreground p-3 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Bot className="w-4 h-4" /> Copilot
                <span className="text-[10px] opacity-60 font-normal">(demo)</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-primary-foreground/80 hover:text-primary-foreground cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background text-sm">
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex flex-col max-w-[90%]", msg.role === 'user' ? "ml-auto items-end" : "items-start")}>
                  {msg.role === 'system' && (
                    <span className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                      <Bot className="w-3 h-3" /> Simulated response
                    </span>
                  )}
                  <div className={cn(
                    "p-2.5 rounded-xl leading-relaxed whitespace-pre-line",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-secondary text-secondary-foreground rounded-bl-sm"
                  )}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex max-w-[85%]">
                  <div className="p-2.5 rounded-xl bg-secondary text-secondary-foreground rounded-bl-sm flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="p-3 border-t border-border bg-card shrink-0">
              <form
                onSubmit={e => { e.preventDefault(); handleSend(); }}
                className="flex gap-2"
              >
                <Input
                  placeholder="e.g. How much tax do I owe?"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button type="submit" size="sm" className="h-9 px-3 cursor-pointer">Send</Button>
              </form>
            </div>
          </Card>
        )}

        <Button
          onClick={() => setIsOpen(!isOpen)}
          size="icon"
          className="h-14 w-14 rounded-full shadow-lg cursor-pointer bg-primary hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95"
        >
          {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        </Button>
      </div>
    </>
  );
}
