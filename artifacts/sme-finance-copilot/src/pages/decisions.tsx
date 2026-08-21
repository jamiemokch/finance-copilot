import { Card, Badge, Button, Input, Label } from '@/components/ui';
import { useStore, DecisionCard } from '@/lib/store';
import { useState } from 'react';
import { BrainCircuit, ChevronDown, ChevronUp, Users, Target, Activity, Settings2, Info, MessageSquare, Check, Save } from 'lucide-react';
import { cn } from '@/components/ui';

export default function Decisions() {
  const { peerCategory, benchmarks, decisionCards, activeProfileId, profiles, updateDecisionCard, setCopilotTrigger } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);

  const [expandedDecisions, setExpandedDecisions] = useState<Record<string, boolean>>({});
  const [editingCategory, setEditingCategory] = useState(false);
  const [editingAssumptions, setEditingAssumptions] = useState<Record<string, boolean>>({});
  const [savingDecision, setSavingDecision] = useState<Record<string, boolean>>({});
  const [saveForms, setSaveForms] = useState<Record<string, { decision: string, rationale: string }>>({});

  const toggleExpand = (id: string) => {
    setExpandedDecisions(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const activeDecisions = decisionCards.filter(d => d.profileId === activeProfileId);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new': return <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30">New</Badge>;
      case 'saved': return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Saved</Badge>;
      case 'actioned': return <Badge variant="success">Actioned</Badge>;
      case 'dismissed': return <Badge variant="outline">Dismissed</Badge>;
      default: return null;
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch(cat) {
      case 'hiring': return <Users className="w-4 h-4" />;
      case 'asset': return <Target className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  const handleDiscuss = (card: DecisionCard) => {
    setCopilotTrigger(`Help me think through: ${card.title}`);
  };

  const handleSaveSubmit = (id: string) => {
    const form = saveForms[id] || { decision: '', rationale: '' };
    updateDecisionCard(id, { 
      status: 'saved', 
      savedDecision: form.decision, 
      savedRationale: form.rationale 
    });
    setSavingDecision(prev => ({ ...prev, [id]: false }));
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Business Decisions</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Data-driven scenarios for {activeProfile?.name} based on your financial position and peer benchmarks.
        </p>
      </div>

      {/* SECTION A: Peer Benchmark */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-serif font-medium text-foreground">Your Peer Category</h2>
          <Button variant="outline" size="sm" onClick={() => setEditingCategory(!editingCategory)} className="cursor-pointer">
            <Settings2 className="w-4 h-4 mr-2" /> Adjust category
          </Button>
        </div>

        {peerCategory && (
          <Card className="p-6 bg-card border-border shadow-sm">
            {editingCategory ? (
              <div className="p-4 bg-secondary/30 rounded-lg text-sm text-center">
                <p className="text-muted-foreground mb-4">In a full version, you could edit your sector, size, and geography here to refine the benchmarking data.</p>
                <Button size="sm" onClick={() => setEditingCategory(false)} className="cursor-pointer">Done</Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-1">Sector</span>
                  <span className="font-medium">{peerCategory.sector}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-1">Geography</span>
                  <span className="font-medium">{peerCategory.geography}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-1">Size</span>
                  <span className="font-medium">{peerCategory.sizeBand}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-1">Customer</span>
                  <span className="font-medium">{peerCategory.customerType}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-1">Revenue</span>
                  <span className="font-medium">{peerCategory.revenueModel}</span>
                </div>
              </div>
            )}
            
            <div className="mt-8 pt-6 border-t border-border">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Sample benchmark data</span>
                <span className="text-xs text-muted-foreground ml-auto">Live market research is a future capability</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {benchmarks.map(b => (
                  <div key={b.id} className="p-4 rounded-xl border border-border bg-background flex flex-col">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium text-sm">{b.label}</span>
                      <Badge variant={b.userStatus === 'above' ? 'success' : b.userStatus === 'below' ? 'destructive' : 'secondary'} className="text-[10px] capitalize">
                        {b.userStatus} peers
                      </Badge>
                    </div>
                    
                    <div className="mt-auto space-y-3">
                      <div className="flex justify-between items-baseline">
                        <div>
                          <span className="text-2xl font-serif">{b.userCurrent}</span>
                          <span className="text-xs text-muted-foreground block">You</span>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-medium text-muted-foreground">{b.peerMedian}</span>
                          <span className="text-xs text-muted-foreground block">Peer Median</span>
                        </div>
                      </div>
                      
                      <div className="pt-2 border-t border-border/50">
                        <p className="text-[10px] text-muted-foreground line-clamp-2" title={b.source}>{b.source}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </section>

      {/* SECTION B: Decision Cards */}
      <section className="space-y-4">
        <h2 className="text-xl font-serif font-medium text-foreground">Strategic Opportunities</h2>
        
        <div className="space-y-6">
          {activeDecisions.map(card => {
            const isExpanded = expandedDecisions[card.id];
            const isEditingAssumptions = editingAssumptions[card.id];
            const isSaving = savingDecision[card.id];

            return (
              <Card key={card.id} className="overflow-hidden shadow-sm border-border">
                {/* Header Summary */}
                <div 
                  className={cn("p-6 flex flex-col md:flex-row gap-6 items-start transition-colors", !isExpanded && "cursor-pointer hover:bg-secondary/20")}
                  onClick={() => !isExpanded && toggleExpand(card.id)}
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="gap-1 capitalize bg-background">
                        {getCategoryIcon(card.category)} {card.category}
                      </Badge>
                      {card.triggerBenchmark && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Activity className="w-3 h-3" /> Triggered by {card.triggerBenchmark}
                        </span>
                      )}
                      <div className="ml-auto">
                        {getStatusBadge(card.status)}
                      </div>
                    </div>
                    
                    <h3 className="text-2xl font-serif text-foreground">{card.title}</h3>
                    <p className="text-muted-foreground leading-relaxed max-w-3xl">{card.summary}</p>
                    
                    {card.status === 'saved' && card.savedDecision && (
                      <div className="mt-4 p-3 bg-secondary/30 rounded-lg text-sm border border-border">
                        <span className="font-semibold block mb-1 text-foreground">Your Decision: {card.savedDecision}</span>
                        <span className="text-muted-foreground italic">"{card.savedRationale}"</span>
                      </div>
                    )}
                  </div>
                  
                  {!isExpanded && (
                    <Button variant="outline" onClick={(e) => { e.stopPropagation(); toggleExpand(card.id); }} className="shrink-0 cursor-pointer">
                      See Scenarios <ChevronDown className="w-4 h-4 ml-2" />
                    </Button>
                  )}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-border animate-in slide-in-from-top-2 duration-300">
                    <div className="p-6 bg-secondary/10 space-y-8">
                      
                      {/* Current vs Proposed */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-background border border-border rounded-xl">
                          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 block">Current Position</span>
                          <p className="text-sm font-medium">{card.currentPosition}</p>
                        </div>
                        <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                          <span className="text-xs uppercase tracking-wider text-primary font-semibold mb-2 block">Proposed Action</span>
                          <p className="text-sm font-medium text-foreground">{card.proposedAction}</p>
                        </div>
                      </div>

                      {/* Scenarios */}
                      <div>
                        <h4 className="font-semibold mb-4 text-foreground flex items-center gap-2">
                          Financial Impact Scenarios
                        </h4>
                        <div className="grid gap-6">
                          {card.scenarios.map((scenario, idx) => (
                            <div key={idx} className="border border-border rounded-xl overflow-hidden bg-background shadow-sm">
                              <div className="bg-secondary/50 p-3 border-b border-border">
                                <h5 className="font-medium text-sm">{scenario.label}</h5>
                              </div>
                              <div className="p-0">
                                <table className="w-full text-sm">
                                  <tbody className="divide-y divide-border">
                                    <tr>
                                      <td className="p-3 w-1/3 text-muted-foreground">Cash Impact (One-off)</td>
                                      <td className="p-3 font-medium">{scenario.cashImpactOneOff}</td>
                                    </tr>
                                    <tr>
                                      <td className="p-3 w-1/3 text-muted-foreground">Cash Impact (Ongoing)</td>
                                      <td className="p-3 font-medium">{scenario.cashImpactOngoing}</td>
                                    </tr>
                                    <tr>
                                      <td className="p-3 w-1/3 text-muted-foreground">Tax Impact</td>
                                      <td className="p-3 font-medium text-emerald-700">{scenario.taxImpact}</td>
                                    </tr>
                                    <tr>
                                      <td className="p-3 w-1/3 text-muted-foreground">Benchmark Effect</td>
                                      <td className="p-3 font-medium">{scenario.benchmarkEffect}</td>
                                    </tr>
                                    <tr className="bg-amber-50/30">
                                      <td className="p-3 w-1/3 text-amber-700 font-medium">Downside Risk</td>
                                      <td className="p-3 text-amber-800 text-xs">{scenario.downsideCase}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Assumptions & Requirements */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-border">
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-semibold text-sm text-foreground">AI Assumptions</h4>
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditingAssumptions(prev => ({...prev, [card.id]: !prev[card.id]}))}>
                              Adjust
                            </Button>
                          </div>
                          
                          {isEditingAssumptions ? (
                            <div className="p-3 bg-background border border-border rounded-lg space-y-3">
                              <p className="text-xs text-muted-foreground">Editing scenarios is mocked in this prototype.</p>
                              <Button size="sm" className="w-full" onClick={() => setEditingAssumptions(prev => ({...prev, [card.id]: false}))}>Done</Button>
                            </div>
                          ) : (
                            <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                              {card.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                          )}
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-foreground mb-3">What Must Be True</h4>
                          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                            {card.whatMustBeTrue.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="flex flex-wrap items-center gap-3 pt-6 border-t border-border">
                        <Button 
                          className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                          onClick={() => setSavingDecision(prev => ({ ...prev, [card.id]: true }))}
                          disabled={card.status === 'actioned' || isSaving}
                        >
                          <Save className="w-4 h-4 mr-2" /> Record Decision
                        </Button>
                        
                        <Button variant="outline" className="cursor-pointer" onClick={() => handleDiscuss(card)}>
                          <MessageSquare className="w-4 h-4 mr-2" /> Discuss with Copilot
                        </Button>

                        {card.status !== 'actioned' && (
                          <Button variant="outline" className="cursor-pointer hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200" onClick={() => updateDecisionCard(card.id, { status: 'actioned' })}>
                            <Check className="w-4 h-4 mr-2" /> Mark Actioned
                          </Button>
                        )}
                        
                        <div className="ml-auto">
                          <Button variant="ghost" onClick={() => toggleExpand(card.id)} className="cursor-pointer">
                            Collapse <ChevronUp className="w-4 h-4 ml-2" />
                          </Button>
                        </div>
                      </div>

                      {/* Save Form */}
                      {isSaving && (
                        <Card className="p-4 border-primary/20 bg-primary/5 mt-4">
                          <h4 className="font-medium text-sm mb-3">Save this decision to your Financial Memory</h4>
                          <div className="space-y-3">
                            <div>
                              <Label className="text-xs">Decision</Label>
                              <Input 
                                placeholder="e.g. Decided to hire a VA for 10hrs/week" 
                                className="h-9 mt-1 bg-background"
                                value={saveForms[card.id]?.decision || ''}
                                onChange={e => setSaveForms(prev => ({ ...prev, [card.id]: { ...prev[card.id], decision: e.target.value } }))}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Rationale</Label>
                              <Input 
                                placeholder="e.g. Need capacity for new retainer client" 
                                className="h-9 mt-1 bg-background"
                                value={saveForms[card.id]?.rationale || ''}
                                onChange={e => setSaveForms(prev => ({ ...prev, [card.id]: { ...prev[card.id], rationale: e.target.value } }))}
                              />
                            </div>
                            <div className="flex gap-2 justify-end pt-2">
                              <Button variant="ghost" size="sm" onClick={() => setSavingDecision(prev => ({ ...prev, [card.id]: false }))}>Cancel</Button>
                              <Button size="sm" onClick={() => handleSaveSubmit(card.id)} disabled={!saveForms[card.id]?.decision}>Save to Memory</Button>
                            </div>
                          </div>
                        </Card>
                      )}

                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
