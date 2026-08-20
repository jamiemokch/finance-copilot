import { Card, Badge, Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import { FileText, Download, ShieldCheck, AlertTriangle, ArrowRight, Eye, User } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';

export default function Pack() {
  const { memories, transactions, exceptions } = useStore();
  const [reviewMode, setReviewMode] = useState<'owner' | 'accountant'>('owner');

  const unresolvedExceptions = exceptions.filter(e => e.status === 'unresolved').length;
  
  const totalIncome = transactions.filter(t => t.amount > 0).reduce((acc, t) => acc + t.amount, 0);
  const totalExpenses = Math.abs(transactions.filter(t => t.amount < 0).reduce((acc, t) => acc + t.amount, 0));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Standardised Year-End Pack</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            A comprehensive, filing-ready package that combines your financial data, contextual memory, and evidence.
          </p>
        </div>
        
        <div className="flex bg-secondary p-1 rounded-lg">
          <button 
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${reviewMode === 'owner' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setReviewMode('owner')}
          >
            Owner View
          </button>
          <button 
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${reviewMode === 'accountant' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setReviewMode('accountant')}
          >
            <User className="w-4 h-4" /> Accountant Review View
          </button>
        </div>
      </div>

      {reviewMode === 'accountant' && (
        <div className="bg-primary/10 border border-primary/20 text-primary-foreground px-4 py-3 rounded-lg flex items-center gap-3 text-sm text-primary">
          <Eye className="w-5 h-5 shrink-0" />
          <p>
            <strong>Accountant Preview:</strong> This view highlights unverified claims, structural context, and exceptions directly to an external reviewer, reducing back-and-forth emails.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-serif font-semibold border-b border-border pb-2">Business & Financial Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Trading Status</p>
                <p className="font-medium">Sole Trader (VAT Reg)</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Period</p>
                <p className="font-medium">06 Apr 2023 - 05 Apr 2024</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Logged Income</p>
                <p className="font-semibold text-lg">£{(totalIncome + 42000).toLocaleString()}</p>
                {reviewMode === 'accountant' && <p className="text-[10px] text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Pending bank reconciliation</p>}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Allowable Expenses</p>
                <p className="font-semibold text-lg">£{(totalExpenses + 14500).toLocaleString()}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-serif font-semibold border-b border-border pb-2">Financial Memory Context</h2>
            <p className="text-sm text-muted-foreground">Contextual facts verified by the user to inform tax treatment.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {memories.map(m => (
                <div key={m.id} className="bg-secondary/40 p-3 rounded-lg border border-border/50">
                  <p className="text-xs text-muted-foreground font-medium">{m.title}</p>
                  <p className="text-sm font-semibold mt-1">{m.value}</p>
                  {reviewMode === 'accountant' && (
                    <div className="mt-2 flex items-center gap-1 text-[10px]">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" /> Source: {m.source}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
            <h3 className="font-serif text-lg font-semibold flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" /> Outstanding Items
            </h3>
            <div className="mt-4 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">Unresolved Exceptions</span>
                <Badge variant="destructive">{unresolvedExceptions}</Badge>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">Missing Evidence</span>
                <Badge variant="secondary">2 items</Badge>
              </div>
            </div>
            {reviewMode === 'owner' && (
              <Button variant="outline" className="w-full mt-6 bg-background cursor-pointer text-red-700 border-red-200 hover:bg-red-100">
                Resolve Before Export
              </Button>
            )}
          </Card>

          <Card className="p-6 space-y-4">
            <h3 className="font-serif text-lg font-semibold">Export & Share</h3>
            <p className="text-sm text-muted-foreground">Download the full pack containing ledgers, summaries, and digital evidence zip.</p>
            
            <Button className="w-full cursor-pointer gap-2" size="lg">
              <Download className="w-4 h-4" /> Download Full Pack (ZIP)
            </Button>
            
            <div className="pt-4 border-t border-border">
              <p className="text-sm font-medium mb-3">Need a professional review?</p>
              <Link href="/match" className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80 h-10 px-4 w-full cursor-pointer gap-2">
                Find an Accountant <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
