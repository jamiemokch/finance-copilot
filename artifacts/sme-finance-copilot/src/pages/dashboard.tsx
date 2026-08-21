import { Card, Badge, Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import { WalletCards, Clock, CheckCircle2, ChevronRight, Inbox as InboxIcon, BrainCircuit } from 'lucide-react';
import { Link } from 'wouter';

export default function Dashboard() {
  const { positionItems, activeProfileId, profiles, inboxItems, decisionCards, complianceItems } = useStore();
  
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activePositionItems = positionItems.filter(i => i.profileId === activeProfileId);
  const activeInboxItems = inboxItems.filter(i => i.profileId === activeProfileId && i.status === 'pending');
  const activeDecisionCards = decisionCards.filter(d => d.profileId === activeProfileId);
  const activeComplianceItems = complianceItems.filter(c => c.profileId === activeProfileId);

  const mainKpis = activePositionItems.filter(i => 
    i.type === 'kpi' && ['Available Cash', 'YTD Profit/Loss', 'Estimated Tax'].includes(i.title)
  ).sort((a, b) => {
    const order = ['Available Cash', 'YTD Profit/Loss', 'Estimated Tax'];
    return order.indexOf(a.title) - order.indexOf(b.title);
  });

  const secondaryKpis = activePositionItems.filter(i => 
    i.type === 'kpi' && ['Accounts Receivable', 'Accounts Payable'].includes(i.title)
  );

  const urgentDecisions = activeDecisionCards.filter(d => d.status === 'new').slice(0, 2);

  const urgentCompliance = activeComplianceItems
    .filter(c => c.status === 'due-soon' || c.status === 'overdue')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">Good morning.</h1>
          <p className="text-muted-foreground mt-1 text-lg">Here is where {activeProfile?.name} stands today.</p>
        </div>
        <div className="flex gap-2">
          {activeInboxItems.length > 0 ? (
            <Link href="/inbox">
              <Button variant="outline" className="gap-2 text-primary border-primary/20 bg-primary/5 cursor-pointer">
                <InboxIcon className="w-4 h-4" /> {activeInboxItems.length} items to review
              </Button>
            </Link>
          ) : (
            <Badge variant="outline" className="text-sm py-1 px-3 border-emerald-200 bg-emerald-50 text-emerald-700 gap-2 font-normal">
              <CheckCircle2 className="w-4 h-4" /> All caught up
            </Badge>
          )}
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-medium">Financial position</h2>
          <Link href="/position" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
            View details <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {mainKpis.map(kpi => (
            <Link key={kpi.id} href="/position">
              <Card className="p-5 cursor-pointer hover:border-primary/50 transition-colors group h-full flex flex-col bg-card shadow-sm">
                <div className="space-y-1 mb-4">
                  <p className="text-sm text-muted-foreground font-medium">{kpi.title}</p>
                  <p className="text-3xl font-serif text-foreground">{kpi.value}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-auto">
                  {kpi.description}
                </p>
              </Card>
            </Link>
          ))}
        </div>
        
        <div className="grid grid-cols-2 gap-4 mt-4">
          {secondaryKpis.map(kpi => (
            <Link key={kpi.id} href="/position">
              <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors flex items-center justify-between bg-card shadow-sm">
                <span className="text-sm text-muted-foreground font-medium">{kpi.title}</span>
                <span className="text-lg font-serif text-foreground">{kpi.value}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-medium">Upcoming deadline</h2>
            <Link href="/compliance" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
              Timeline <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {urgentCompliance ? (
            <Card className="p-0 overflow-hidden shadow-sm">
              <div className="p-5 flex items-start gap-4 hover:bg-secondary/30 transition-colors">
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
                  <Link href="/compliance">
                    <Button variant="ghost" className="px-0 h-auto py-2 text-primary font-medium cursor-pointer hover:bg-transparent mt-2">
                      View details &rarr;
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-5 text-center text-muted-foreground bg-secondary/20 shadow-sm border-dashed">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
              <p>No urgent deadlines approaching.</p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-medium">Key decisions</h2>
            <Link href="/decisions" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline cursor-pointer">
              See all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          
          <div className="space-y-3">
            {urgentDecisions.map(decision => (
              <Link key={decision.id} href="/decisions">
                <Card className="p-4 cursor-pointer hover:border-primary/50 transition-colors flex items-start gap-3 shadow-sm bg-card group">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <BrainCircuit className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-medium text-sm text-foreground">{decision.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{decision.summary}</p>
                  </div>
                </Card>
              </Link>
            ))}
            {urgentDecisions.length === 0 && (
              <Card className="p-5 text-center text-muted-foreground bg-secondary/20 shadow-sm border-dashed">
                <p>No new decisions to review.</p>
              </Card>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
