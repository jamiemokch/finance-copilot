import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, 
  BrainCircuit, 
  Upload, 
  MessageSquare, 
  Sparkles, 
  AlertTriangle, 
  CalendarCheck,
  Briefcase,
  Settings,
  Menu,
  X
} from 'lucide-react';
import { useState } from 'react';
import { cn } from './ui';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/memory', label: 'Financial Memory', icon: BrainCircuit },
    { href: '/ingest', label: 'Ingest Data', icon: Upload },
    { href: '/copilot', label: 'Copilot', icon: MessageSquare },
    { href: '/optimisation', label: 'Optimisation', icon: Sparkles },
    { href: '/exceptions', label: 'Exceptions', icon: AlertTriangle },
    { href: '/year-end', label: 'Year-End', icon: CalendarCheck },
    { href: '/pack', label: 'Year-End Pack', icon: Briefcase },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-2 font-serif text-lg text-primary font-semibold">
          <BrainCircuit className="w-5 h-5" />
          <span>SME Copilot</span>
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 -mr-2">
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col transition-transform duration-300 md:static md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 hidden md:flex items-center gap-3 font-serif text-xl text-primary font-semibold">
          <BrainCircuit className="w-6 h-6" />
          <span>SME Copilot</span>
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
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                  active 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className="w-4 h-4" />
                {item.label}
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
                ? "bg-primary text-primary-foreground" 
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={() => setSidebarOpen(false)}
          >
            <Settings className="w-4 h-4" />
            Settings
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
      <main className="flex-1 flex flex-col min-w-0">
        <div className="bg-amber-100/50 text-amber-900 border-b border-amber-200 px-4 py-2 text-xs font-medium text-center flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Prototype Mode: This app uses fictional sample data and is not connected to HMRC or a bank.
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
