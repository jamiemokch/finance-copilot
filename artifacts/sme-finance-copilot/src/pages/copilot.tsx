import { Card, Button, Input, Badge } from '@/components/ui';
import { useState, useRef, useEffect } from 'react';
import { BrainCircuit, Send, User, Sparkles, AlertCircle } from 'lucide-react';

export default function Copilot() {
  const [messages, setMessages] = useState([
    { 
      role: 'system', 
      content: 'Hello Priya. I am your SME Finance Copilot. I have your full financial memory, current transactions, and tax status loaded. What would you like to know?' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = (preset?: string) => {
    const text = preset || input;
    if (!text.trim()) return;
    
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    if (!preset) setInput('');
    setIsTyping(true);

    setTimeout(() => {
      let response = "I don't have enough specific data to answer that accurately based on your current memory. Would you like to add this context to your memory?";
      
      const lower = text.toLowerCase();
      if (lower.includes('laptop') || lower.includes('equipment')) {
         response = "Based on your sole trader profile, you can claim the full cost of new equipment like a laptop under the Annual Investment Allowance (AIA). Since your memory shows you are VAT registered, you can also reclaim the 20% VAT on your next quarterly return.";
      } else if (lower.includes('tax') || lower.includes('owe') || lower.includes('liability')) {
         response = "Looking at your current logged transactions (profits of approx £24,000) and your rental property income (£12,000), you sit within the Basic Rate band. Your estimated combined income tax and NI liability for 23/24 is currently around £5,800. We still have 1 unresolved exception that could adjust this slightly.";
      } else if (lower.includes('home') || lower.includes('wfh')) {
         response = "I noticed in your Financial Memory that you work 4 days a week from home. You have two options: a flat rate of £26/month, or a proportion of your actual bills (gas, electricity, metered water). Given current energy prices, apportioning your actual bills will likely yield a higher deduction. Would you like me to create an Optimisation task for this?";
      }

      setMessages(prev => [...prev, { role: 'system', content: response }]);
      setIsTyping(false);
    }, 1200);
  };

  const suggestions = [
    "How much tax do I owe so far?",
    "Can I expense a new laptop?",
    "What's the best way to claim WFH expenses?"
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-in fade-in duration-500">
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-bold text-foreground">Copilot</h1>
        <p className="text-muted-foreground mt-1">Ask questions in plain English. I'll use your Financial Memory to give specific answers.</p>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 border-primary/20 shadow-sm overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-4 max-w-[80%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'system' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}>
                {msg.role === 'system' ? <BrainCircuit className="w-5 h-5" /> : <User className="w-5 h-5" />}
              </div>
              <div className={`p-4 rounded-2xl ${
                msg.role === 'user' 
                  ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                  : 'bg-secondary/50 text-foreground rounded-tl-sm border border-border'
              }`}>
                <p className="text-sm leading-relaxed">{msg.content}</p>
                {msg.role === 'system' && i > 0 && (
                  <div className="mt-3 flex gap-2">
                    <Badge variant="outline" className="text-[10px] bg-background/50 border-border/50 text-muted-foreground gap-1">
                      <Sparkles className="w-3 h-3" /> Grounded in Financial Memory
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex gap-4 max-w-[80%]">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <BrainCircuit className="w-5 h-5" />
              </div>
              <div className="p-4 rounded-2xl bg-secondary/50 rounded-tl-sm border border-border flex items-center gap-1.5">
                <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 bg-primary/80 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-border bg-card">
          <div className="flex flex-wrap gap-2 mb-4">
            {suggestions.map((s, i) => (
              <Badge 
                key={i} 
                variant="secondary" 
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors py-1.5 px-3"
                onClick={() => handleSend(s)}
              >
                {s}
              </Badge>
            ))}
          </div>
          <div className="flex gap-3">
            <Input 
              placeholder="Ask a financial question..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              className="flex-1 rounded-xl h-12"
            />
            <Button size="icon" className="h-12 w-12 rounded-xl shrink-0 cursor-pointer" onClick={() => handleSend()}>
              <Send className="w-5 h-5" />
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="w-3 h-3" />
            Tax rules apply to standard UK scenarios. Always review complex cases with a qualified accountant.
          </div>
        </div>
      </Card>
    </div>
  );
}
