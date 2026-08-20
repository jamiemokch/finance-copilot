import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, 
  WalletCards, 
  Inbox as InboxIcon, 
  MessageSquare, 
  Lightbulb, 
  CalendarCheck,
  Settings,
  Menu,
  X,
  Bot
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from './ui';
import { Button, Card, Badge, Input } from '@/components/ui';
import { useStore } from '@/lib/store';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { inboxItems, activeProfileId } = useStore();
  const activeInboxCount = inboxItems.filter(i => i.status === 'pending' && i.profileId === activeProfileId).length;

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/position', label: 'Financial position', icon: WalletCards },
    { href: '/inbox', label: 'Inbox', icon: InboxIcon, count: activeInboxCount },
    { href: '/copilot', label: 'Copilot', icon: MessageSquare },
    { href: '/tax', label: 'Tax ideas', icon: Lightbulb },
    { href: '/year-end', label: 'Year-End', icon: CalendarCheck },
  ];

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
        <div className="p-6 hidden md:flex items-center gap-3 font-serif text-xl text-primary font-semibold">
          <Bot className="w-6 h-6" />
          <span>Finance Companion</span>
        </div>

        <nav className="flex-1 px-4 py-4 md:py-0 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link 
                key={item.href} 
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
                  {item.label}
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
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
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
    { role: 'system', content: 'Hi! I am your finance companion. I have your full context. How can I help?' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, isOpen]);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'system', content: "I'm a prototype companion, but I've saved that question to your history. In a real scenario, I'd give you a conservative, well-researched answer based on your exact financial position." }]);
      setIsTyping(false);
    }, 1000);
  };

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {isOpen && (
          <Card className="w-[340px] h-[450px] mb-4 shadow-xl border-border flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className="bg-primary text-primary-foreground p-3 flex justify-between items-center">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Bot className="w-4 h-4" /> Ask Copilot
              </div>
              <button onClick={() => setIsOpen(false)} className="text-primary-foreground/80 hover:text-primary-foreground cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background text-sm">
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex max-w-[85%]", msg.role === 'user' ? "ml-auto" : "")}>
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
            
            <div className="p-3 border-t border-border bg-card">
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