import { Card, Badge, Button, Select } from '@/components/ui';
import { useStore, InboxItem } from '@/lib/store';
import { AlertTriangle, CheckCircle2, MessageSquare, ShieldAlert, Bot } from 'lucide-react';
import { useState } from 'react';

export default function Inbox() {
  const { inboxItems, resolveInboxItem, activeProfileId, profiles } = useStore();
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeItems = inboxItems.filter(i => i.profileId === activeProfileId);
  
  const pendingItems = activeItems.filter(i => i.status === 'pending');
  const resolvedItems = activeItems.filter(i => i.status === 'resolved');

  const [activeTab, setActiveTab] = useState<'pending' | 'resolved'>('pending');
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  const handleResolve = (item: InboxItem) => {
    let answer = customAnswers[item.id] || selectedOptions[item.id];
    if (answer) {
      resolveInboxItem(item.id, answer);
    }
  };

  const handleOptionSelect = (itemId: string, optionLabel: string, hasSubOptions: boolean) => {
    if (!hasSubOptions) {
      setSelectedOptions(prev => ({ ...prev, [itemId]: optionLabel }));
    } else {
      // Clear specific selection if parent changed
      setSelectedOptions(prev => {
        const next = { ...prev };
        delete next[`${itemId}_sub`];
        return { ...next, [itemId]: optionLabel };
      });
    }
  };

  const handleSubOptionSelect = (itemId: string, subOptionLabel: string) => {
    setSelectedOptions(prev => ({ ...prev, [`${itemId}_sub`]: subOptionLabel }));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Inbox</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          We need your guidance on a few things to keep {activeProfile?.name} up to date.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border pb-px">
        <button 
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${activeTab === 'pending' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Requires attention ({pendingItems.length})
        </button>
        <button 
          onClick={() => setActiveTab('resolved')}
          className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${activeTab === 'resolved' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Resolved ({resolvedItems.length})
        </button>
      </div>

      <div className="space-y-6">
        {activeTab === 'pending' && pendingItems.length === 0 && (
          <div className="text-center py-16 bg-card rounded-xl border border-border shadow-sm">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-500 opacity-80" />
            <h3 className="text-lg font-medium">You're all caught up!</h3>
            <p className="text-muted-foreground mt-1">No items require your attention right now.</p>
          </div>
        )}

        {activeTab === 'resolved' && resolvedItems.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No resolved items yet.
          </div>
        )}

        {(activeTab === 'pending' ? pendingItems : resolvedItems).map(item => (
          <Card key={item.id} className="overflow-hidden shadow-sm">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      {new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {item.amount && (
                      <Badge variant="secondary" className="font-mono text-xs bg-accent text-accent-foreground">
                        £{item.amount.toFixed(2)}
                      </Badge>
                    )}
                  </div>
                  <h3 className="text-xl font-medium">{item.description}</h3>
                </div>
                {item.status === 'resolved' && (
                  <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolved
                  </Badge>
                )}
              </div>

              <div className="bg-secondary/30 rounded-xl p-4 mb-6 text-sm flex gap-3 text-foreground">
                <Bot className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <p className="leading-relaxed">{item.aiReasoning}</p>
              </div>

              {item.status === 'pending' ? (
                <div className="space-y-4">
                  <p className="text-sm font-medium mb-2">How should we handle this?</p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {item.options.map((opt, idx) => {
                      const isSelected = selectedOptions[item.id] === opt.label;
                      return (
                        <div key={idx} className="flex flex-col gap-2">
                          <button
                            onClick={() => handleOptionSelect(item.id, opt.label, !!opt.subOptions)}
                            className={`p-3 rounded-lg border text-left text-sm transition-all cursor-pointer ${
                              isSelected 
                                ? 'border-primary bg-primary/5 ring-1 ring-primary' 
                                : 'border-border bg-card hover:bg-secondary/50'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-medium">{opt.label}</span>
                              {opt.isSuggested && (
                                <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary uppercase">Suggested</Badge>
                              )}
                            </div>
                          </button>

                          {isSelected && opt.subOptions && (
                            <div className="ml-4 pl-4 border-l-2 border-primary/20 space-y-2 py-2 animate-in slide-in-from-top-2 duration-200">
                              <p className="text-xs text-muted-foreground font-medium">Treatment choice:</p>
                              {opt.subOptions.map((sub, sIdx) => {
                                const isSubSelected = selectedOptions[`${item.id}_sub`] === sub.label;
                                return (
                                  <button
                                    key={sIdx}
                                    onClick={() => handleSubOptionSelect(item.id, sub.label)}
                                    className={`w-full p-2.5 rounded-md border text-left text-sm transition-all cursor-pointer ${
                                      isSubSelected
                                        ? 'border-primary bg-primary/10 font-medium'
                                        : 'border-border bg-card hover:bg-secondary/30 text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    <div className="flex justify-between items-center">
                                      <span>{sub.label}</span>
                                      {sub.isSuggested && (
                                        <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Standard</Badge>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-4 flex justify-end gap-3">
                    <Button variant="outline" className="cursor-pointer bg-background">
                      <MessageSquare className="w-4 h-4 mr-2" /> Discuss in Copilot
                    </Button>
                    <Button 
                      className="cursor-pointer" 
                      onClick={() => handleResolve(item)}
                      disabled={!selectedOptions[item.id] || (item.options.find(o => o.label === selectedOptions[item.id])?.subOptions && !selectedOptions[`${item.id}_sub`])}
                    >
                      Confirm resolution
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="bg-background border border-border rounded-lg p-4 text-sm">
                  <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Your decision</p>
                  <p className="font-medium">{item.customAnswer}</p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}