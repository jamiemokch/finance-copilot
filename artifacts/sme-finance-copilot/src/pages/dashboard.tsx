import { Card, Badge, Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import { WalletCards, Clock, CheckCircle2, ChevronRight, Inbox as InboxIcon } from 'lucide-react';
import { Link } from 'wouter';

export default function Dashboard() {
  const { positionItems, activeProfileId, profiles, inboxItems } = useStore();
  
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activePositionItems = positionItems.filter(i => i.profileId === activeProfileId);
  const activeInboxItems = inboxItems.filter(i => i.profileId === activeProfileId && i.status === 'pending');

  const mainKpis = activePositionItems.filter(i => i.type === 'kpi').slice(0, 4);

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-medium">Upcoming deadlines</h2>
          <Card className="p-0 overflow-hidden shadow-sm">
            <div className="divide-y divide-border">
              <div className="p-5 flex items-start gap-4 hover:bg-secondary/30 transition-colors">
                <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h3 className="font-medium text-foreground">Self-Assessment Tax Return</h3>
                    <span className="text-sm font-medium text-foreground bg-secondary px-2 py-1 rounded-md">31 Jan</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">For the 23/24 tax year. You have 3 tasks remaining to build your pack.</p>
                  <Link href="/year-end">
                    <Button variant="ghost" className="px-0 h-auto py-2 text-primary font-medium cursor-pointer hover:bg-transparent">
                      View Year-End checklist &rarr;
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="p-5 flex items-start gap-4 hover:bg-secondary/30 transition-colors opacity-70">
                <div className="w-10 h-10 rounded-full bg-secondary text-muted-foreground flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h3 className="font-medium text-foreground">VAT Quarter 1</h3>
                    <span className="text-sm font-medium text-muted-foreground bg-secondary px-2 py-1 rounded-md">07 May</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Quarterly return.</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-serif font-medium">Quick actions</h2>
          <Card className="p-5 shadow-sm space-y-3">
            <Link href="/position">
              <Button variant="outline" className="w-full justify-start h-12 text-base font-normal cursor-pointer bg-background hover:bg-secondary/50">
                <WalletCards className="w-5 h-5 mr-3 text-primary" /> View basis for financial position
              </Button>
            </Link>
            <Link href="/inbox">
              <Button variant="outline" className="w-full justify-start h-12 text-base font-normal cursor-pointer bg-background hover:bg-secondary/50">
                <InboxIcon className="w-5 h-5 mr-3 text-primary" /> Review {activeInboxItems.length} pending inbox items
              </Button>
            </Link>
            <Link href="/tax">
              <Button variant="outline" className="w-full justify-start h-12 text-base font-normal cursor-pointer bg-background hover:bg-secondary/50">
                <Clock className="w-5 h-5 mr-3 text-primary" /> Explore proactive tax ideas
              </Button>
            </Link>
          </Card>
        </div>
      </section>
    </div>
  );
}