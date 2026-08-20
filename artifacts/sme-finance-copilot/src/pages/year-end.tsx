import { Card, Button, Badge } from '@/components/ui';
import { useStore } from '@/lib/store';
import { Link } from 'wouter';
import { CalendarCheck, CheckCircle2, Circle, ArrowRight, FileText, Download } from 'lucide-react';

export default function YearEnd() {
  const { yearEndReadiness, exceptions } = useStore();
  const unresolvedExceptions = exceptions.filter(e => e.status === 'unresolved').length;

  // Mock progress calculation
  const totalTasks = 8;
  const completedTasks = totalTasks - yearEndReadiness.tasksRemaining;
  const progressPercent = Math.round((completedTasks / totalTasks) * 100);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Year-End Readiness</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Track your progress towards a complete tax year. No surprises, no rushed document hunting in January.
        </p>
      </div>

      <Card className="p-8 border-primary/20 bg-primary/5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <h2 className="text-xl font-serif font-semibold">Self-Assessment 23/24</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CalendarCheck className="w-4 h-4" /> Deadline: {yearEndReadiness.deadline}
            </p>
          </div>
          <div className="w-full md:w-64 space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span>Overall Readiness</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full bg-secondary h-3 rounded-full overflow-hidden">
              <div 
                className="bg-primary h-full rounded-full transition-all duration-1000 ease-out" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h3 className="font-serif text-xl font-semibold">Action Required</h3>
          
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-border">
              <div className="p-4 flex gap-4 hover:bg-secondary/30 transition-colors">
                <Circle className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="flex-1">
                  <h4 className="font-medium text-sm">Resolve {unresolvedExceptions} Exceptions</h4>
                  <p className="text-xs text-muted-foreground mt-1">Clear ambiguity in your transaction register.</p>
                </div>
                <Link href="/exceptions" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 px-3 cursor-pointer">
                  Review
                </Link>
              </div>
              
              <div className="p-4 flex gap-4 hover:bg-secondary/30 transition-colors">
                <Circle className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="flex-1">
                  <h4 className="font-medium text-sm">Upload missing evidence ({yearEndReadiness.evidenceMissing})</h4>
                  <p className="text-xs text-muted-foreground mt-1">Q3 Rental Statement, P60 form.</p>
                </div>
                <Link href="/ingest" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 px-3 cursor-pointer">
                  Upload
                </Link>
              </div>

              <div className="p-4 flex gap-4 hover:bg-secondary/30 transition-colors">
                <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <h4 className="font-medium text-sm">Finalise Optimsation Actions</h4>
                  <p className="text-xs text-muted-foreground mt-1">Review saved tax opportunities before generating pack.</p>
                </div>
                <Link href="/optimisation" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 px-3 cursor-pointer">
                  Review
                </Link>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <h3 className="font-serif text-xl font-semibold">Completed Steps</h3>
          
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-border opacity-70">
              <div className="p-4 flex gap-4 bg-secondary/10">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="font-medium text-sm">Verify Personal Details</h4>
                  <p className="text-xs text-muted-foreground mt-1">Confirmed via Financial Memory on 12/03/24</p>
                </div>
              </div>
              <div className="p-4 flex gap-4 bg-secondary/10">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="font-medium text-sm">Reconcile Bank Feeds</h4>
                  <p className="text-xs text-muted-foreground mt-1">All connected accounts balanced</p>
                </div>
              </div>
              <div className="p-4 flex gap-4 bg-secondary/10">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="font-medium text-sm">Categorise Business Expenses</h4>
                  <p className="text-xs text-muted-foreground mt-1">98% of expenses categorised</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-8 p-6 bg-card border border-border rounded-xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold">Standardised Year-End Pack</h3>
            <p className="text-sm text-muted-foreground">Ready to generate a consolidated pack for filing or accountant review.</p>
          </div>
        </div>
        <Link href="/pack" className="inline-flex items-center justify-center whitespace-nowrap rounded-xl text-base font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-12 px-8 w-full md:w-auto cursor-pointer gap-2">
          View Year-End Pack <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
