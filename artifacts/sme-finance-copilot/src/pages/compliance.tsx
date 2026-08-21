import { Badge } from '@/components/ui';
import { useStore, ComplianceItem } from '@/lib/store';
import { Clock, Calendar, CheckCircle2, AlertCircle, FileText, CheckSquare, User, Bot, Briefcase } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/components/ui';

export default function Compliance() {
  const { complianceItems, activeProfileId, profiles } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeItems = complianceItems.filter(i => i.profileId === activeProfileId);

  // Sort by due date ascending
  const sortedItems = [...activeItems].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getStatusConfig = (status: ComplianceItem['status']): { color: string; bg: string; border: string; icon: ReactNode } => {
    switch(status) {
      case 'overdue': return { color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/20', icon: <AlertCircle className="w-5 h-5 text-destructive" /> };
      case 'due-soon': return { color: 'text-amber-600', bg: 'bg-amber-100', border: 'border-amber-200', icon: <Clock className="w-5 h-5 text-amber-600" /> };
      case 'upcoming': return { color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20', icon: <Calendar className="w-5 h-5 text-primary" /> };
      case 'done': return { color: 'text-muted-foreground', bg: 'bg-secondary', border: 'border-border', icon: <CheckCircle2 className="w-5 h-5 text-muted-foreground" /> };
    }
  };

  const getDaysDiff = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    const diffTime = target.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const formatDaysLabel = (days: number, status: string) => {
    if (status === 'done') return 'Completed';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `In ${days} days`;
  };

  const getPartyIcon = (party: string) => {
    if (party === 'client') return <User className="w-3 h-3 mr-1" />;
    if (party === 'platform') return <Bot className="w-3 h-3 mr-1" />;
    return <Briefcase className="w-3 h-3 mr-1" />;
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Compliance Timeline</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Upcoming obligations for {activeProfile?.name}. 
        </p>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-800 text-xs rounded-md border border-amber-200 shadow-sm">
          <AlertCircle className="w-3.5 h-3.5" />
          Obligations shown are illustrative. Actual obligations depend on real tax registrations.
        </div>
      </div>

      <div className="relative pl-4 md:pl-8">
        {/* Timeline track line */}
        <div className="absolute top-0 bottom-0 left-[27px] md:left-[43px] w-px bg-border -z-10" />

        <div className="space-y-8">
          {sortedItems.map(item => {
            const config = getStatusConfig(item.status);
            const isExpanded = expandedId === item.id;
            const daysDiff = getDaysDiff(item.dueDate);

            return (
              <div key={item.id} className={cn("relative group transition-opacity", item.status === 'done' && "opacity-60 hover:opacity-100")}>
                {/* Timeline node */}
                <div className={cn(
                  "absolute -left-4 md:-left-2 w-7 h-7 md:w-8 md:h-8 rounded-full border-4 border-background flex items-center justify-center shrink-0 shadow-sm z-10",
                  config.bg
                )}>
                  <div className={cn("w-2 h-2 rounded-full", config.bg.replace('/10', '').replace('-100', '-500'))} />
                </div>

                <div 
                  className={cn(
                    "ml-8 md:ml-12 border rounded-xl overflow-hidden bg-card shadow-sm transition-all cursor-pointer",
                    config.border,
                    isExpanded ? "ring-1 ring-primary/20" : "hover:border-primary/40"
                  )}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg", config.bg)}>
                          {config.icon}
                        </div>
                        <div>
                          <h3 className="font-medium text-lg text-foreground">{item.title}</h3>
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                      
                      <div className="text-left sm:text-right flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center">
                        <span className="text-xl font-serif text-foreground">
                          {new Date(item.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        <span className={cn("text-xs font-medium uppercase tracking-wider mt-1", config.color)}>
                          {formatDaysLabel(daysDiff, item.status)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-4">
                      <Badge variant="outline" className="capitalize text-xs font-normal">
                        Category: {item.category}
                      </Badge>
                      <Badge variant="secondary" className="capitalize text-xs font-normal">
                        Period: {item.periodCovered}
                      </Badge>
                      <Badge variant="outline" className="capitalize text-xs font-normal flex items-center bg-background">
                        {getPartyIcon(item.responsibleParty)}
                        Action: {item.responsibleParty}
                      </Badge>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-border bg-secondary/10 p-5 space-y-6 animate-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        
                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <CheckSquare className="w-4 h-4 text-primary" /> Actions Required
                          </h4>
                          {item.actionsRequired.length > 0 ? (
                            <ul className="space-y-2">
                              {item.actionsRequired.map((action: string, idx: number) => (
                                <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                                  <span>{action}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No specific actions listed.</p>
                          )}
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary" /> Documents Required
                          </h4>
                          {item.documentsRequired.length > 0 ? (
                            <ul className="space-y-2">
                              {item.documentsRequired.map((doc: string, idx: number) => (
                                <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                                  <span>{doc}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No specific documents required.</p>
                          )}
                        </div>

                      </div>

                      {item.status !== 'done' && (
                        <div className="pt-4 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          Recommended preparation start: {item.preparationLeadDays} days before deadline 
                          ({new Date(new Date(item.dueDate).getTime() - item.preparationLeadDays * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      <p className="text-center text-sm text-muted-foreground pt-8">
        Reminders are generated from this timeline and surface on your Dashboard based on urgency.
      </p>
    </div>
  );
}
