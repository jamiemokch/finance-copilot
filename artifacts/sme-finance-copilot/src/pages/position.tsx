import { Card, Badge, Button } from '@/components/ui';
import { useStore, PositionItem } from '@/lib/store';
import { useState } from 'react';
import { ShieldCheck, HelpCircle, AlertCircle, ChevronDown, ChevronUp, Upload, FileText } from 'lucide-react';
import { Link } from 'wouter';

export default function Position() {
  const { positionItems, activeProfileId, profiles } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeItems = positionItems.filter(i => i.profileId === activeProfileId);

  const kpis = activeItems.filter(i => i.type === 'kpi');
  const facts = activeItems.filter(i => i.type === 'fact');

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getConfidenceIcon = (confidence: string) => {
    if (confidence === 'high') return <ShieldCheck className="w-4 h-4 text-emerald-600" />;
    if (confidence === 'medium') return <HelpCircle className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-red-500" />;
  };

  const renderItem = (item: PositionItem) => {
    const isExpanded = expandedId === item.id;

    return (
      <Card key={item.id} className="overflow-hidden transition-all duration-300 shadow-sm">
        <div 
          className="p-5 cursor-pointer hover:bg-secondary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          onClick={() => toggleExpand(item.id)}
        >
          <div className="flex-1">
            <h3 className="font-medium text-lg text-foreground">{item.title}</h3>
            <p className="text-sm text-muted-foreground">{item.description}</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-2xl font-serif text-foreground">{item.value}</p>
              <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground mt-1">
                {getConfidenceIcon(item.confidence)}
                <span className="capitalize">{item.confidence} confidence</span>
              </div>
            </div>
            <div className="text-muted-foreground">
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-border bg-secondary/10 p-5 space-y-6 animate-in slide-in-from-top-2 duration-200">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">How we arrived at this figure</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.basis}</p>
            </div>

            {item.assumptions.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Assumptions & Risks</h4>
                <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                  {item.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  If these assumptions are wrong, the figure will change.
                </p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Supporting Evidence</h4>
              {item.documents.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {item.documents.map((doc, i) => (
                    <Badge key={i} variant="secondary" className="font-normal gap-1.5 py-1 text-sm bg-background border border-border">
                      <FileText className="w-3.5 h-3.5 text-primary" /> {doc}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No formal evidence linked yet.</p>
              )}
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">Financial position</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-lg">
            The current state of {activeProfile?.name}. Click any number to see exactly how it was calculated and what evidence supports it.
          </p>
        </div>
        <Link href="/ingest">
          <Button variant="default" className="gap-2 cursor-pointer shrink-0">
            <Upload className="w-4 h-4" /> Upload records
          </Button>
        </Link>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-serif text-primary border-b border-border pb-2">Headline figures</h2>
        <div className="space-y-3">
          {kpis.map(renderItem)}
        </div>
      </div>

      {facts.length > 0 && (
        <div className="space-y-4 pt-4">
          <h2 className="text-xl font-serif text-primary border-b border-border pb-2">Background facts</h2>
          <div className="space-y-3">
            {facts.map(renderItem)}
          </div>
        </div>
      )}
    </div>
  );
}