import { Card, Badge, Button } from '@/components/ui';
import { useStore, TaxIdea } from '@/lib/store';
import { Lightbulb, TrendingUp, CheckCircle2, Clock, Calendar } from 'lucide-react';

export default function Tax() {
  const { taxIdeas, updateTaxIdeaStatus, activeProfileId, profiles } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeIdeas = taxIdeas.filter(i => i.profileId === activeProfileId);

  const handleStatus = (id: string, status: TaxIdea['status']) => {
    updateTaxIdeaStatus(id, status);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Tax ideas</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Proactive ways to optimise {activeProfile?.name}'s tax position before the year ends.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {activeIdeas.map(idea => (
          <Card key={idea.id} className="p-0 overflow-hidden shadow-sm border-border flex flex-col md:flex-row">
            <div className="p-6 flex-1 border-b md:border-b-0 md:border-r border-border">
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-xl font-medium text-foreground flex items-center gap-2">
                  {idea.title}
                </h2>
                {idea.status === 'new' && <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">New Idea</Badge>}
                {idea.status === 'saved' && <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">Saved</Badge>}
                {idea.status === 'actioned' && <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-200">Actioned</Badge>}
              </div>
              
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">{idea.description}</p>
              
              <div className="bg-secondary/30 rounded-lg p-4 text-sm space-y-4">
                {idea.assumptions.length > 0 && (
                  <div>
                    <span className="font-semibold block mb-1">What we assumed:</span>
                    <ul className="list-disc pl-4 text-muted-foreground space-y-1">
                      {idea.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                
                {idea.missingData && idea.missingData.length > 0 && (
                  <div>
                    <span className="font-semibold block mb-1">What we need from you:</span>
                    <ul className="list-disc pl-4 text-muted-foreground space-y-1">
                      {idea.missingData.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 md:w-64 bg-card shrink-0 flex flex-col justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Potential Impact</p>
                <p className="text-2xl font-serif text-emerald-700">{idea.impact}</p>
                
                {idea.deadlines && idea.deadlines.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Deadline</p>
                    <div className="flex items-start gap-2 text-sm text-foreground">
                      <Calendar className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <span>{idea.deadlines[0]}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-2">
                {idea.status === 'new' && (
                  <Button className="w-full cursor-pointer bg-primary" onClick={() => handleStatus(idea.id, 'saved')}>
                    <Clock className="w-4 h-4 mr-2" /> Save to review later
                  </Button>
                )}
                {idea.status !== 'actioned' && idea.status !== 'dismissed' && (
                  <Button variant="outline" className="w-full cursor-pointer hover:bg-emerald-50 hover:text-emerald-700" onClick={() => handleStatus(idea.id, 'actioned')}>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Mark as done
                  </Button>
                )}
                {idea.status === 'new' && (
                  <Button variant="ghost" className="w-full cursor-pointer text-muted-foreground text-sm" onClick={() => handleStatus(idea.id, 'dismissed')}>
                    Dismiss
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}

        {activeIdeas.length === 0 && (
          <div className="text-center py-16 text-muted-foreground bg-card rounded-xl border border-border shadow-sm">
            <Lightbulb className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground">No current tax ideas</h3>
            <p className="mt-1">We'll let you know if we spot any opportunities based on your data.</p>
          </div>
        )}
      </div>
    </div>
  );
}