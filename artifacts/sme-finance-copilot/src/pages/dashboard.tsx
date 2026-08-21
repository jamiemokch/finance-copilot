import { Card, Badge, Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import { WalletCards, Clock, CheckCircle2, ChevronRight, CheckSquare, Lightbulb, CalendarClock, Circle } from 'lucide-react';
import { Link } from 'wouter';

export default function Dashboard() {
  const { positionItems, activeProfileId, profiles, inboxItems, businessIdeas, complianceItems, saChecklist } = useStore();
  
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activePositionItems = positionItems.filter(i => i.profileId === activeProfileId);
  const activeInboxItems = inboxItems.filter(i => i.profileId === activeProfileId && i.status === 'pending');
  const activeIdeas = businessIdeas.filter(d => d.profileId === activeProfileId && d.status === 'new');
  const activeComplianceItems = complianceItems.filter(c => c.profileId === activeProfileId);
  const activeSAChecklist = saChecklist.filter(i => i.profileId === activeProfileId);

  const mainKpis = activePositionItems.filter(i => 
    i.type === 'kpi' && ['Available Cash', 'YTD Profit/Loss', 'Estimated Tax'].includes(i.title)
  ).sort((a, b) => {
    const order = ['Available Cash', 'YTD Profit/Loss', 'Estimated Tax'];
    return order.indexOf(a.title) - order.indexOf(b.title);
  });

  const secondaryKpis = activePositionItems.filter(i => 
    i.type === 'kpi' && ['Accounts Receivable', 'Accounts Payable'].includes(i.title)
  );

  const previewIdeas = activeIdeas.slice(0, 2);

  const urgentCompliance = activeComplianceItems
    .filter(c => c.status === 'due-soon' || c.status === 'overdue')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  // SA Readiness
  const saTotal = activeSAChecklist.length;
  const saDone = activeSAChecklist.filter(i => i.status === 'done').length;
  const saProgressPct = saTotal > 0 ? Math.round((saDone / saTotal) * 100) : 0;
  const saMissing = activeSAChecklist.filter(i => i.status === 'pending').slice(0, 3);
  const saDeadline = activeComplianceItems.find(c => c.category === 'filing' && c.status !== 'done');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

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
              <CheckSquare className="w-4 h-4" /> {activeInboxItems.length} item{activeInboxItems.length !== 1 ? 's' : ''} need attention
            </Button>
          </Link>
        )}
      </div>

      {/* Financial Position — primary KPIs */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-medium">Financial position</h2>
          <Link href="/position" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
            View details <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        {mainKpis.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {mainKpis.map(kpi => (
                <Link key={kpi.id} href="/position">
                  <Card className="p-5 cursor-pointer hover:border-primary/50 transition-colors group h-full flex flex-col bg-card shadow-sm">
                    <p className="text-sm text-muted-foreground font-medium mb-1">{kpi.title}</p>
                    <p className="text-3xl font-serif text-foreground">{kpi.value}</p>
                    <p className="text-xs text-muted-foreground mt-auto pt-3">{kpi.description}</p>
                  </Card>
                </Link>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              {secondaryKpis.map(kpi => (
                <Link key={kpi.id} href="/position">
                  <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors flex items-center justify-between bg-card shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                      <WalletCards className="w-4 h-4" /> {kpi.title}
                    </div>
                    <span className="text-lg font-serif text-foreground">{kpi.value}</span>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <Card className="p-8 text-center text-muted-foreground border-dashed">
            <WalletCards className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p>No financial data for this profile yet.</p>
          </Card>
        )}
      </section>

      {/* SA Readiness card — compact but prominent */}
      {saTotal > 0 && (
        <section>
          <Link href="/tasks">
            <Card className="p-5 cursor-pointer hover:border-primary/50 transition-colors border-border shadow-sm group">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">Self Assessment 23/24 readiness</span>
                    {saDeadline && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200 text-xs ml-auto">
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
                  {saMissing.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {saMissing.map(item => (
                        <span key={item.id} className="text-xs text-muted-foreground flex items-center gap-1">
                          <Circle className="w-2.5 h-2.5 text-amber-500 shrink-0" /> {item.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-sm text-primary font-medium flex items-center gap-1 group-hover:underline whitespace-nowrap">
                  View checklist <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </Card>
          </Link>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Upcoming Deadline */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-medium">Upcoming deadline</h2>
            <Link href="/tasks" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
              Timeline <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {urgentCompliance ? (
            <Card className="p-0 overflow-hidden shadow-sm">
              <div className="p-5 flex items-start gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${urgentCompliance.status === 'overdue' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h3 className="font-medium text-foreground">{urgentCompliance.title}</h3>
                    <Badge variant={urgentCompliance.status === 'overdue' ? 'destructive' : 'secondary'} className={urgentCompliance.status !== 'overdue' ? 'bg-amber-100 text-amber-800 border-amber-200' : ''}>
                      {new Date(urgentCompliance.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{urgentCompliance.description}</p>
                  <Link href="/tasks">
                    <Button variant="ghost" className="px-0 h-auto py-2 text-primary font-medium cursor-pointer hover:bg-transparent mt-1">
                      View details →
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-5 text-center text-muted-foreground bg-secondary/20 shadow-sm border-dashed">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
              <p className="text-sm">No urgent deadlines approaching.</p>
            </Card>
          )}
        </div>

        {/* Business Ideas preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-medium">Business ideas</h2>
            <Link href="/business-ideas" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
              See all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {previewIdeas.length > 0 ? (
            <div className="space-y-3">
              {previewIdeas.map(idea => (
                <Link key={idea.id} href="/business-ideas">
                  <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors flex items-start gap-3 shadow-sm bg-card group">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <Lightbulb className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-medium text-sm text-foreground truncate">{idea.title}</h3>
                        <Badge variant="outline" className="text-[10px] capitalize shrink-0">{idea.category}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{idea.summary}</p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="p-5 text-center text-muted-foreground bg-secondary/20 shadow-sm border-dashed">
              <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No new ideas to review.</p>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
