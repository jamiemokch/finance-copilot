import { Card, Badge } from '@/components/ui';
import { useStore } from '@/lib/store';
import { BrainCircuit, AlertTriangle, Sparkles, CalendarCheck, TrendingUp, ShieldCheck, Upload } from 'lucide-react';
import { Link } from 'wouter';

export default function Dashboard() {
  const { memories, exceptions, optimisations, yearEndReadiness } = useStore();

  const unresolvedExceptions = exceptions.filter(e => e.status === 'unresolved').length;
  const newOptimisations = optimisations.filter(o => o.status === 'new').length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Welcome back, Priya</h1>
          <p className="text-muted-foreground mt-1">Here is the current state of your financial world.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-sm py-1 px-3 border-primary/20 bg-primary/5 text-primary">
            Complexity Score: Low-Medium
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/memory">
          <Card className="p-5 cursor-pointer hover:border-primary transition-colors group h-full flex flex-col">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">Financial Memory</p>
                <p className="text-2xl font-bold">{memories.length}</p>
              </div>
              <div className="p-2 bg-secondary rounded-lg group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <BrainCircuit className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-auto pt-4 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              Core context updated
            </p>
          </Card>
        </Link>

        <Link href="/optimisation">
          <Card className="p-5 cursor-pointer hover:border-primary transition-colors group h-full flex flex-col">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">Tax Opportunities</p>
                <p className="text-2xl font-bold">{newOptimisations}</p>
              </div>
              <div className="p-2 bg-amber-100 text-amber-700 rounded-lg group-hover:bg-amber-200 transition-colors">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-auto pt-4 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-amber-600" />
              ~£1,212 potential savings
            </p>
          </Card>
        </Link>

        <Link href="/exceptions">
          <Card className="p-5 cursor-pointer hover:border-primary transition-colors group h-full flex flex-col">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">Exceptions</p>
                <p className="text-2xl font-bold">{unresolvedExceptions}</p>
              </div>
              <div className="p-2 bg-red-100 text-red-700 rounded-lg group-hover:bg-red-200 transition-colors">
                <AlertTriangle className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-red-600 font-medium mt-auto pt-4">
              Require your review
            </p>
          </Card>
        </Link>

        <Link href="/year-end">
          <Card className="p-5 cursor-pointer hover:border-primary transition-colors group h-full flex flex-col">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">Year-End Readiness</p>
                <p className="text-2xl font-bold">65%</p>
              </div>
              <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg group-hover:bg-emerald-200 transition-colors">
                <CalendarCheck className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-auto pt-4">
              {yearEndReadiness.tasksRemaining} tasks remaining
            </p>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-serif font-semibold">Recent Copilot Activity</h2>
          <Card className="p-6 space-y-6">
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Upload className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Auto-categorised 14 new transactions</p>
                <p className="text-sm text-muted-foreground mt-1">Found 1 exception regarding an Apple Store purchase that requires your judgement.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-amber-700" />
              </div>
              <div>
                <p className="text-sm font-medium">Identified WFH allowance opportunity</p>
                <p className="text-sm text-muted-foreground mt-1">Based on your memory indicating 4 days/week working from home.</p>
                <Link href="/optimisation">
                  <span className="text-xs font-semibold text-primary mt-2 inline-block cursor-pointer hover:underline">Review Opportunity &rarr;</span>
                </Link>
              </div>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-semibold">Upcoming Deadlines</h2>
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center bg-secondary/30">
              <div>
                <div className="font-semibold text-sm">Self-Assessment</div>
                <div className="text-xs text-muted-foreground">Tax Year 23/24</div>
              </div>
              <div className="text-sm font-bold text-foreground">31 Jan 2025</div>
            </div>
            <div className="p-4 flex justify-between items-center">
              <div>
                <div className="font-semibold text-sm">VAT Q1</div>
                <div className="text-xs text-muted-foreground">Quarterly Return</div>
              </div>
              <div className="text-sm font-bold text-foreground">07 May 2024</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
