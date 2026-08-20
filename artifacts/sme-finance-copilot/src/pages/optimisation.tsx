import { Card, Badge, Button } from '@/components/ui';
import { useStore, OptimisationItem } from '@/lib/store';
import { Sparkles, TrendingUp, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';

export default function Optimisation() {
  const { optimisations, updateOptimisationStatus } = useStore();

  const handleStatus = (id: string, status: OptimisationItem['status']) => {
    updateOptimisationStatus(id, status);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Proactive Tax Optimisation</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Based on your sample profile and Financial Memory, here are proactive steps to optimise your position. We never state uncertain tax treatments as facts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {optimisations.map(opt => (
          <Card key={opt.id} className={`p-6 border-l-4 ${
            opt.status === 'new' ? 'border-l-amber-500' : 
            opt.status === 'saved' ? 'border-l-primary' : 
            opt.status === 'actioned' ? 'border-l-emerald-500' : 'border-l-muted opacity-60'
          }`}>
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-serif font-bold text-foreground flex items-center gap-2">
                      {opt.title}
                      {opt.status === 'new' && <Badge variant="warning" className="ml-2">New Opportunity</Badge>}
                      {opt.status === 'saved' && <Badge variant="default" className="ml-2 bg-primary">Saved for Review</Badge>}
                      {opt.status === 'actioned' && <Badge variant="success" className="ml-2">Actioned</Badge>}
                    </h2>
                    <p className="text-muted-foreground mt-2">{opt.description}</p>
                  </div>
                </div>

                <div className="bg-secondary/40 p-4 rounded-xl space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-muted-foreground" />
                    Key Assumptions & Limitations
                  </h4>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                    {opt.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                    <li>This assumes your marginal rate remains at 20%.</li>
                  </ul>
                </div>
              </div>

              <div className="w-full md:w-64 shrink-0 flex flex-col gap-4">
                <Card className="p-4 bg-background border-border text-center shadow-none">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Potential Impact</p>
                  <p className="text-2xl font-bold text-emerald-600">~£{opt.impact}</p>
                  <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                    <TrendingUp className="w-3 h-3" />
                    Confidence: {opt.confidence}
                  </div>
                </Card>

                {opt.status !== 'actioned' && opt.status !== 'dismissed' && (
                  <div className="space-y-2">
                    {opt.status === 'new' && (
                      <Button className="w-full cursor-pointer bg-primary" onClick={() => handleStatus(opt.id, 'saved')}>
                        <Clock className="w-4 h-4 mr-2" /> Save for Year-End
                      </Button>
                    )}
                    <Button variant="outline" className="w-full cursor-pointer text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200" onClick={() => handleStatus(opt.id, 'actioned')}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Mark as Actioned
                    </Button>
                    {opt.status === 'new' && (
                      <Button variant="ghost" className="w-full cursor-pointer text-muted-foreground" onClick={() => handleStatus(opt.id, 'dismissed')}>
                        <XCircle className="w-4 h-4 mr-2" /> Dismiss
                      </Button>
                    )}
                  </div>
                )}
                
                {opt.status === 'dismissed' && (
                  <Button variant="outline" className="w-full cursor-pointer" onClick={() => handleStatus(opt.id, 'new')}>
                    Restore Opportunity
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}

        {optimisations.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>No new optimisations found.</p>
            <p className="text-sm">We'll notify you if we spot tax saving opportunities based on your data.</p>
          </div>
        )}
      </div>
    </div>
  );
}
