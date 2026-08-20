import { Card, Button } from '@/components/ui';
import { User, Briefcase, CheckCircle2, Sparkles, Clock } from 'lucide-react';
import { useState } from 'react';

export default function Match() {
  const [selected, setSelected] = useState<string | null>(null);
  
  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-serif font-bold text-foreground">How would you like to file?</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Your Year-End Pack is ready. You can file it yourself, send it to your existing accountant, or get matched with an expert for bounded, high-value review.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        <Card 
          className={`p-6 cursor-pointer transition-all flex flex-col group ${selected === 'self' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
          onClick={() => setSelected('self')}
        >
          <div className="w-12 h-12 bg-secondary rounded-xl flex items-center justify-center mb-4 text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <User className="w-6 h-6" />
          </div>
          <h3 className="font-serif text-xl font-semibold">Self-Filing</h3>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            Use your Year-End Pack to manually enter data into the HMRC portal. Best for simple, straightforward returns.
          </p>
          <ul className="mt-auto space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Free</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Full control</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Generates PDF summary</li>
          </ul>
        </Card>

        <Card 
          className={`p-6 cursor-pointer transition-all flex flex-col group relative overflow-hidden ${selected === 'matched' ? 'border-primary ring-2 ring-primary shadow-md' : 'hover:border-primary shadow-sm'}`}
          onClick={() => setSelected('matched')}
        >
          <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-lg">
            Recommended
          </div>
          <div className="w-12 h-12 bg-primary text-primary-foreground rounded-xl flex items-center justify-center mb-4">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="font-serif text-xl font-semibold">Matched Expert Review</h3>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            A qualified accountant reviews your pack, resolves your final exceptions, and files for you. Includes a bounded query allowance.
          </p>
          <ul className="mt-auto space-y-2 text-sm text-muted-foreground mb-6">
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Pack-driven review (saves 40% time)</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" /> 3 complex queries included</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Accountant files on your behalf</li>
          </ul>
          <div className="pt-4 border-t border-border mt-auto">
            <div className="flex justify-between items-center font-semibold">
              <span>Estimated Quote</span>
              <span>£180 - £250</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Based on your Low-Medium complexity score.</p>
          </div>
        </Card>

        <Card 
          className={`p-6 cursor-pointer transition-all flex flex-col group ${selected === 'own' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
          onClick={() => setSelected('own')}
        >
          <div className="w-12 h-12 bg-secondary rounded-xl flex items-center justify-center mb-4 text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Briefcase className="w-6 h-6" />
          </div>
          <h3 className="font-serif text-xl font-semibold">Own Accountant</h3>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            Generate a secure link to your Year-End Pack to send to your existing accountant. 
          </p>
          <ul className="mt-auto space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Accountant View mode</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Secure digital handover</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Retain your existing relationship</li>
          </ul>
        </Card>
      </div>

      {selected === 'matched' && (
        <Card className="p-6 bg-primary/5 border-primary/20 animate-in slide-in-from-bottom-4">
          <div className="flex flex-col md:flex-row gap-6 items-center">
            <div className="flex-1 space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" /> How Bounded Review Works
              </h4>
              <p className="text-sm text-muted-foreground">
                Unlike a continuous monthly retainer, this is a distinct package. The accountant will review the structured Pack we've built, resolve any open Exceptions with you, and answer up to 3 complex queries. If you need ongoing advisory throughout the year, they can quote you separately.
              </p>
            </div>
            <Button size="lg" className="w-full md:w-auto shrink-0 cursor-pointer">
              Request Match
            </Button>
          </div>
        </Card>
      )}

      {selected === 'self' && (
        <div className="flex justify-center mt-8 animate-in fade-in">
          <Button size="lg" className="cursor-pointer">Continue to HMRC Checklist</Button>
        </div>
      )}

      {selected === 'own' && (
        <div className="flex justify-center mt-8 animate-in fade-in">
          <Button size="lg" className="cursor-pointer">Generate Secure Pack Link</Button>
        </div>
      )}
    </div>
  );
}
