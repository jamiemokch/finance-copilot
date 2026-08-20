import { Card, Button, Badge } from '@/components/ui';
import { useStore } from '@/lib/store';
import { CalendarCheck, CheckCircle2, Circle, ArrowRight, FileText, Download, Briefcase, Eye } from 'lucide-react';

export default function YearEnd() {
  const { yearEndReadiness, inboxItems, activeProfileId, profiles, yearEndPackGenerated, setYearEndPackGenerated } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeInboxItems = inboxItems.filter(i => i.profileId === activeProfileId && i.status === 'pending');

  const totalTasks = 8;
  const tasksRemaining = activeInboxItems.length + 2; // Mocking remaining tasks
  const completedTasks = totalTasks - tasksRemaining;
  const progressPercent = Math.round((completedTasks / totalTasks) * 100);

  const canBuildPack = activeInboxItems.length === 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Year-End</h1>
        <p className="text-muted-foreground mt-1 text-lg max-w-2xl">
          Get {activeProfile?.name} ready for the tax deadline. We compile everything into one pack for filing.
        </p>
      </div>

      {!yearEndPackGenerated ? (
        <>
          <Card className="p-8 border-border bg-card shadow-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="space-y-2">
                <h2 className="text-xl font-medium">Self-Assessment 23/24 Readiness</h2>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <CalendarCheck className="w-4 h-4" /> Due: {yearEndReadiness.deadline}
                </p>
              </div>
              <div className="w-full md:w-72 space-y-2">
                <div className="flex justify-between text-sm font-medium">
                  <span>Progress</span>
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
              <h3 className="font-serif text-xl font-medium">Things to do</h3>
              <Card className="p-0 overflow-hidden shadow-sm">
                <div className="divide-y divide-border">
                  <div className={`p-4 flex gap-4 transition-colors ${activeInboxItems.length > 0 ? 'hover:bg-secondary/30' : 'opacity-50'}`}>
                    {activeInboxItems.length > 0 ? <Circle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />}
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">Clear Inbox ({activeInboxItems.length})</h4>
                      <p className="text-sm text-muted-foreground mt-1">Resolve pending questions about your transactions.</p>
                    </div>
                  </div>
                  <div className="p-4 flex gap-4 hover:bg-secondary/30 transition-colors">
                    <Circle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">Upload missing evidence</h4>
                      <p className="text-sm text-muted-foreground mt-1">We noticed a few large transactions without receipts.</p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div className="space-y-4">
              <h3 className="font-serif text-xl font-medium">Completed</h3>
              <Card className="p-0 overflow-hidden shadow-sm bg-card/50">
                <div className="divide-y divide-border opacity-80">
                  <div className="p-4 flex gap-4">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-sm">Verify Personal Details</h4>
                      <p className="text-sm text-muted-foreground mt-1">Checked against HMRC records.</p>
                    </div>
                  </div>
                  <div className="p-4 flex gap-4">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-sm">Bank Reconciliation</h4>
                      <p className="text-sm text-muted-foreground mt-1">All synced accounts balance perfectly.</p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="mt-8 p-8 bg-card border border-border rounded-xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm text-center md:text-left">
            <div>
              <h3 className="font-serif text-xl font-medium">Ready to compile?</h3>
              <p className="text-muted-foreground mt-1 max-w-md">
                Once you are happy with the numbers, we will generate a locked Year-End Pack that you can send to an accountant or use to file directly.
              </p>
            </div>
            <Button 
              size="lg" 
              className="w-full md:w-auto cursor-pointer gap-2 h-14 px-8 text-base shadow-md"
              disabled={!canBuildPack}
              onClick={() => setYearEndPackGenerated(true)}
            >
              {canBuildPack ? 'Build Year-End Pack' : 'Complete tasks to unlock'}
            </Button>
          </div>
        </>
      ) : (
        <div className="animate-in fade-in zoom-in-95 duration-500 space-y-6">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-6 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-medium text-lg">Year-End Pack Generated</h3>
                <p className="text-sm opacity-80">Compiled on {new Date().toLocaleDateString('en-GB')}. Locked for review.</p>
              </div>
            </div>
            <Button variant="outline" className="bg-background cursor-pointer whitespace-nowrap" onClick={() => setYearEndPackGenerated(false)}>
              Unlock & Edit
            </Button>
          </div>

          <Card className="p-8 shadow-sm">
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-border">
              <h2 className="text-2xl font-serif flex items-center gap-3">
                <Briefcase className="w-6 h-6 text-primary" /> Pack Preview
              </h2>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2 cursor-pointer">
                  <Eye className="w-4 h-4" /> Accountant Review Mode
                </Button>
                <Button className="gap-2 cursor-pointer bg-primary">
                  <Download className="w-4 h-4" /> Download ZIP
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Summary</h3>
                <dl className="space-y-4 text-sm">
                  <div className="flex justify-between border-b border-border pb-2">
                    <dt className="text-muted-foreground">Entity</dt>
                    <dd className="font-medium">{activeProfile?.name}</dd>
                  </div>
                  <div className="flex justify-between border-b border-border pb-2">
                    <dt className="text-muted-foreground">Period</dt>
                    <dd className="font-medium">06 Apr 2023 - 05 Apr 2024</dd>
                  </div>
                  <div className="flex justify-between border-b border-border pb-2">
                    <dt className="text-muted-foreground">Total Income</dt>
                    <dd className="font-medium">£42,000</dd>
                  </div>
                  <div className="flex justify-between border-b border-border pb-2">
                    <dt className="text-muted-foreground">Allowable Expenses</dt>
                    <dd className="font-medium">£17,500</dd>
                  </div>
                </dl>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Contents</h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center gap-3 p-2 rounded hover:bg-secondary/50">
                    <FileText className="w-4 h-4 text-primary" />
                    <span>General Ledger (CSV)</span>
                  </li>
                  <li className="flex items-center gap-3 p-2 rounded hover:bg-secondary/50">
                    <FileText className="w-4 h-4 text-primary" />
                    <span>Profit & Loss Statement (PDF)</span>
                  </li>
                  <li className="flex items-center gap-3 p-2 rounded hover:bg-secondary/50">
                    <FileText className="w-4 h-4 text-primary" />
                    <span>Evidence Archive (42 receipts)</span>
                  </li>
                  <li className="flex items-center gap-3 p-2 rounded hover:bg-secondary/50">
                    <FileText className="w-4 h-4 text-primary" />
                    <span>Assumptions & AI Reasoning Log</span>
                  </li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}