import { Card, Badge, Button, Select } from '@/components/ui';
import { useStore, ExceptionItem } from '@/lib/store';
import { AlertTriangle, CheckCircle2, MessageSquare, ShieldAlert } from 'lucide-react';

export default function Exceptions() {
  const { exceptions, updateExceptionStatus } = useStore();

  const handleStatusChange = (id: string, status: ExceptionItem['status']) => {
    updateExceptionStatus(id, status);
  };

  const getTypeLabel = (type: ExceptionItem['type']) => {
    switch (type) {
      case 'ambiguity': return 'Ambiguous Entry';
      case 'missing_info': return 'Missing Evidence';
      case 'judgement': return 'Requires Judgement';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Exception Register</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Instead of sending everything to an accountant or blocking your flow, we capture ambiguity, missing information, and judgement calls here for later review.
        </p>
      </div>

      <div className="flex gap-4 mb-6">
        <Badge variant="destructive" className="px-3 py-1.5 text-sm">
          {exceptions.filter(e => e.status === 'unresolved').length} Unresolved
        </Badge>
        <Badge variant="secondary" className="px-3 py-1.5 text-sm">
          {exceptions.filter(e => e.status === 'resolved').length} Resolved
        </Badge>
      </div>

      <div className="space-y-4">
        {exceptions.map(exc => (
          <Card key={exc.id} className={`p-0 overflow-hidden border-l-4 transition-all ${
            exc.status === 'unresolved' ? 'border-l-red-500' : 'border-l-emerald-500 opacity-70'
          }`}>
            <div className="p-6">
              <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs uppercase tracking-wider">
                      {getTypeLabel(exc.type)}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-medium">
                      {new Date(exc.date).toLocaleDateString('en-GB')}
                    </span>
                  </div>
                  <p className={`text-lg font-medium ${exc.status === 'resolved' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {exc.description}
                  </p>
                  {exc.amount && (
                    <p className="font-semibold text-primary">Transaction Value: £{exc.amount.toFixed(2)}</p>
                  )}
                </div>

                <div className="w-full md:w-auto shrink-0 flex flex-col sm:flex-row gap-2">
                  {exc.status === 'unresolved' ? (
                    <>
                      <Button variant="outline" className="cursor-pointer bg-background" onClick={() => handleStatusChange(exc.id, 'dismissed')}>
                        Dismiss
                      </Button>
                      <Button className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white border-transparent" onClick={() => handleStatusChange(exc.id, 'resolved')}>
                        <CheckCircle2 className="w-4 h-4 mr-2" /> Mark Resolved
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" className="cursor-pointer" onClick={() => handleStatusChange(exc.id, 'unresolved')}>
                      Reopen Exception
                    </Button>
                  )}
                </div>
              </div>

              {exc.status === 'unresolved' && (
                <div className="mt-6 pt-4 border-t border-border flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 bg-secondary/30 rounded-lg p-3 flex gap-3 items-start border border-border/50">
                    <BrainCircuitIcon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Copilot Suggestion</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {exc.type === 'ambiguity' && "Review the receipt to determine if this was a software subscription (expense) or a physical device purchase (capital asset)."}
                        {exc.type === 'missing_info' && "You can request this statement directly from your letting agent portal."}
                        {exc.type === 'judgement' && "HMRC rules generally disallow client entertainment. If this was exclusively room hire for a business meeting, it can be claimed."}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" className="shrink-0 cursor-pointer h-auto py-3">
                    <MessageSquare className="w-4 h-4 mr-2" /> Discuss in Copilot
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}

        {exceptions.length === 0 && (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
            <ShieldAlert className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>Your exception register is clear.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline icon component since we forgot to import BrainCircuit at the top
function BrainCircuitIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M9 13a4.5 4.5 0 0 0 3-4" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M12 13h4" />
      <path d="M12 18h6a2 2 0 0 1 2 2v1" />
      <path d="M12 8h8" />
      <path d="M16 8V5a2 2 0 0 1 2-2" />
      <circle cx="16" cy="13" r=".5" />
      <circle cx="18" cy="3" r=".5" />
      <circle cx="20" cy="21" r=".5" />
      <circle cx="20" cy="8" r=".5" />
    </svg>
  );
}
