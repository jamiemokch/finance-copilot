import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard, WalletCards, Lightbulb, Settings,
  Menu, X, Bot, CheckSquare, UploadCloud, User, MessageSquare,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from './ui';
import { Button, Input } from '@/components/ui';
import { Card } from '@/components/ui';
import { useStore } from '@/lib/store';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { inboxItems, activeProfileId, businessIdeas, profiles, setActiveProfileId } = useStore();
  const pendingInbox = inboxItems.filter(i => i.status === 'pending' && i.profileId === activeProfileId).length;
  const newIdeas = businessIdeas.filter(d => d.status === 'new' && d.profileId === activeProfileId).length;

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
          <div className="mb-6 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-center justify-center font-medium shadow-sm">
            Prototype — fictional sample data. Copilot responses are mocked.
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
    { role: 'system', content: 'Hi! I have your financial context ready. What would you like to know?' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { copilotTrigger, setCopilotTrigger } = useStore();

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

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'system',
        content: "Demo response — a live Copilot would read your Financial Memory (P&L £35,000, tax £6,900 balance due, cash £6,090 available, AR £3,400, tax reserve gap £3,400) plus your Decision Memory, then give a sourced, conservative answer with the calculation basis shown.",
      }]);
      setIsTyping(false);
    }, 1000);
  };

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {isOpen && (
          <Card className="w-[340px] h-[460px] mb-4 shadow-xl border-border flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className="bg-primary text-primary-foreground p-3 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Bot className="w-4 h-4" /> Copilot
              </div>
              <button onClick={() => setIsOpen(false)} className="text-primary-foreground/80 hover:text-primary-foreground cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background text-sm">
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex flex-col max-w-[85%]", msg.role === 'user' ? "ml-auto items-end" : "items-start")}>
                  {msg.role === 'system' && (
                    <span className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                      <Bot className="w-3 h-3" /> Demo response
                    </span>
                  )}
                  <div className={cn(
                    "p-2.5 rounded-xl leading-relaxed",
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
                  placeholder="Ask a question..."
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
