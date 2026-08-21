import { Card, Badge, Button, Input, Label, Select } from '@/components/ui';
import { useStore, EvidenceCategory, EvidenceStatus } from '@/lib/store';
import { useState } from 'react';
import {
  UploadCloud, CheckCircle2, FileText, Plus, Database, Loader2,
  ArrowRight, Building2, Receipt, FileClock, FileSignature, FolderOpen,
  AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/components/ui';
import { Link } from 'wouter';

// ─── Product flow diagram ──────────────────────────────────────────────────────

const FLOW_STEPS = [
  { icon: UploadCloud, label: 'Evidence', sub: 'Bank CSV, invoices, receipts, prior return', active: true },
  { icon: Database, label: 'AI extracts & categorises', sub: 'Matches transactions, flags unknowns' },
  { icon: AlertCircle, label: 'Inbox', sub: 'You resolve ambiguous items', href: '/tasks' },
  { icon: FileText, label: 'Financial Records', sub: 'Clean P&L, AR, AP, Cash', href: '/position' },
  { icon: Building2, label: 'Dashboard', sub: 'Live position & readiness', href: '/dashboard' },
  { icon: CheckCircle2, label: 'Business Ideas', sub: 'Decisions grounded in your numbers', href: '/business-ideas' },
];

function FlowDiagram() {
  return (
    <div className="bg-secondary/20 border border-border rounded-xl p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">How evidence flows through the product</p>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-wrap">
        {FLOW_STEPS.map((step, i) => {
          const Icon = step.icon;
          const content = (
            <div className={cn(
              "flex flex-col items-center text-center px-3 py-2 rounded-lg min-w-[90px]",
              step.active ? "bg-primary text-primary-foreground shadow-sm" : "bg-background border border-border hover:border-primary/40 transition-colors"
            )}>
              <Icon className={cn("w-5 h-5 mb-1", step.active ? "text-primary-foreground" : "text-primary")} />
              <span className={cn("text-xs font-semibold leading-tight", step.active ? "text-primary-foreground" : "text-foreground")}>{step.label}</span>
              <span className={cn("text-[10px] leading-tight mt-0.5", step.active ? "text-primary-foreground/70" : "text-muted-foreground")}>{step.sub}</span>
            </div>
          );
          return (
            <div key={i} className="flex items-center gap-2">
              {step.href ? (
                <Link href={step.href} className="cursor-pointer">{content}</Link>
              ) : content}
              {i < FLOW_STEPS.length - 1 && (
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Evidence category config ─────────────────────────────────────────────────

interface CategoryConfig {
  id: EvidenceCategory;
  label: string;
  icon: typeof UploadCloud;
  description: string;
  accepts: string;
  examples: string;
}

const CATEGORIES: CategoryConfig[] = [
  { id: 'bank_statement', label: 'Bank Statements / CSV', icon: Building2, description: 'Export from Starling, Monzo, Barclays, HSBC, etc.', accepts: '.csv, .pdf, .qif, .ofx', examples: 'Starling export, Monzo CSV, Barclays statement PDF' },
  { id: 'invoice_sent', label: 'Invoices Sent', icon: FileText, description: 'Your sales invoices — we extract amount, date, client', accepts: '.pdf, .jpg, .png', examples: 'Invoice #1042, retainer agreement, project quote' },
  { id: 'receipt', label: 'Receipts & Expense Proofs', icon: Receipt, description: 'Purchase receipts for allowable expenses', accepts: '.pdf, .jpg, .png, .heic', examples: 'Adobe subscription, WeWork, travel tickets' },
  { id: 'prior_return', label: 'Prior Tax Return', icon: FileClock, description: 'Last year\'s Self-Assessment return — used for PoA context', accepts: '.pdf', examples: 'SA302, tax calculation summary' },
  { id: 'contract', label: 'Contracts & Agreements', icon: FileSignature, description: 'Client or supplier contracts — helps verify recurring income/costs', accepts: '.pdf, .docx', examples: 'Retainer agreement, service contract, lease' },
  { id: 'other', label: 'Other Documents', icon: FolderOpen, description: 'Anything else relevant — we\'ll classify it', accepts: 'Any file type', examples: 'Insurance certificates, HMRC correspondence, letting agent statement' },
];

const STATUS_CONFIG: Record<EvidenceStatus, { label: string; className: string }> = {
  received: { label: 'Received', className: 'bg-blue-100 text-blue-700' },
  processing: { label: 'Processing…', className: 'bg-yellow-100 text-yellow-700' },
  categorised: { label: 'Categorised', className: 'bg-emerald-100 text-emerald-700' },
  needs_review: { label: 'Needs review', className: 'bg-amber-100 text-amber-800' },
};

const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  bank_statement: 'Bank statement',
  invoice_sent: 'Invoice',
  receipt: 'Receipt',
  prior_return: 'Prior return',
  contract: 'Contract',
  other: 'Other',
};

// ─── Upload simulation ─────────────────────────────────────────────────────────

function UploadCard({ config, onUploaded }: { config: CategoryConfig; onUploaded: (cat: EvidenceCategory) => void }) {
  const [state, setState] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const Icon = config.icon;

  const simulate = () => {
    setState('uploading');
    setTimeout(() => {
      setState('done');
      onUploaded(config.id);
      setTimeout(() => setState('idle'), 3000);
    }, 1800);
  };

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-xl p-5 flex flex-col items-center text-center gap-3 transition-all",
        isDragging ? "border-primary bg-primary/5 scale-[1.02]" : "border-border hover:border-primary/40",
        state === 'done' && "border-emerald-400 bg-emerald-50"
      )}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={e => { e.preventDefault(); setIsDragging(false); simulate(); }}
    >
      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", state === 'done' ? "bg-emerald-100" : "bg-primary/10")}>
        {state === 'uploading' ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> :
         state === 'done' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> :
         <Icon className="w-5 h-5 text-primary" />}
      </div>
      <div>
        <p className="font-medium text-sm text-foreground">{config.label}</p>
        <p className="text-xs text-muted-foreground">{config.description}</p>
        <p className="text-[10px] text-muted-foreground mt-1 italic">Accepts: {config.accepts}</p>
      </div>
      <Button
        size="sm"
        variant={state === 'done' ? 'outline' : 'default'}
        className="w-full cursor-pointer text-xs"
        disabled={state === 'uploading'}
        onClick={simulate}
      >
        {state === 'uploading' ? 'Extracting…' : state === 'done' ? '✓ Uploaded — upload another?' : 'Choose file or drag here'}
      </Button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Evidence() {
  const { evidenceItems, addEvidenceItem, transactions, addTransaction } = useStore();
  const [showManual, setShowManual] = useState(false);
  const [manualItem, setManualItem] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    category: 'General',
  });

  const handleUploaded = (cat: EvidenceCategory) => {
    const demoNames: Record<EvidenceCategory, string> = {
      bank_statement: 'bank-export.csv',
      invoice_sent: 'invoice-new.pdf',
      receipt: 'receipt-scan.jpg',
      prior_return: 'sa302-prior-year.pdf',
      contract: 'client-contract.pdf',
      other: 'document.pdf',
    };
    addEvidenceItem({
      profileId: 'p2',
      category: cat,
      filename: demoNames[cat],
      uploadedAt: new Date().toISOString().split('T')[0],
      status: 'processing',
    });
    // Simulate AI processing -> categorised
    setTimeout(() => {
      addTransaction({
        date: new Date().toISOString().split('T')[0],
        description: `[From upload] ${demoNames[cat]}`,
        amount: cat === 'invoice_sent' ? 1200 : -85,
        category: cat === 'invoice_sent' ? 'Sales' : 'Expenses',
        source: 'receipt',
      });
    }, 2000);
  };

  const handleAddManual = () => {
    if (manualItem.description && manualItem.amount) {
      addTransaction({
        date: manualItem.date,
        description: manualItem.description,
        amount: parseFloat(manualItem.amount),
        category: manualItem.category,
        source: 'manual',
      });
      setManualItem({ ...manualItem, description: '', amount: '' });
    }
  };

  const needsReview = evidenceItems.filter(e => e.status === 'needs_review').length;
  const categorised = evidenceItems.filter(e => e.status === 'categorised').length;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif text-foreground">Evidence</h1>
        <p className="text-muted-foreground mt-1 text-lg max-w-2xl">
          This is where everything starts. Upload your financial evidence and the system extracts, categorises, and feeds it into your financial records.
        </p>
      </div>

      {/* Flow diagram */}
      <FlowDiagram />

      {/* Status bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Files uploaded', value: evidenceItems.length, color: 'text-foreground' },
          { label: 'Categorised', value: categorised, color: 'text-emerald-700' },
          { label: 'Need your review', value: needsReview, color: needsReview > 0 ? 'text-amber-700' : 'text-muted-foreground' },
        ].map(s => (
          <Card key={s.label} className="p-4 text-center shadow-sm">
            <p className={cn("text-2xl font-serif font-semibold", s.color)}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      {needsReview > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <strong>{needsReview} file{needsReview !== 1 ? 's' : ''} need your review</strong> — uploaded but not yet fully classified.
            Resolve in <Link href="/tasks" className="underline font-medium">Tasks → Action Needed</Link>.
          </div>
        </div>
      )}

      {/* Upload grid */}
      <div>
        <h2 className="text-xl font-serif font-medium mb-2">Upload evidence</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Choose the right category so the AI applies the correct tax rules. Prototype: clicking any card simulates an upload.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CATEGORIES.map(cat => (
            <UploadCard key={cat.id} config={cat} onUploaded={handleUploaded} />
          ))}
        </div>
      </div>

      {/* Manual entry */}
      <div>
        <button
          onClick={() => setShowManual(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-primary cursor-pointer hover:underline"
        >
          {showManual ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Manual entry — for cash expenses or out-of-pocket items
        </button>
        {showManual && (
          <Card className="mt-3 p-5 shadow-sm animate-in slide-in-from-top-2 duration-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={manualItem.date} onChange={e => setManualItem({ ...manualItem, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Amount (£, negative = expense)</Label>
                <Input type="number" placeholder="-50.00" value={manualItem.amount} onChange={e => setManualItem({ ...manualItem, amount: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Description</Label>
                <Input placeholder="e.g. Client Dinner at Dishoom" value={manualItem.description} onChange={e => setManualItem({ ...manualItem, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={manualItem.category} onChange={e => setManualItem({ ...manualItem, category: e.target.value })}>
                  <option value="Sales">Sales (Income)</option>
                  <option value="Travel">Travel</option>
                  <option value="Office">Office & Software</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="General">General Expense</option>
                </Select>
              </div>
              <div className="flex items-end">
                <Button className="w-full cursor-pointer" onClick={handleAddManual}>Add Transaction</Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Evidence log */}
      <div>
        <h2 className="text-xl font-serif font-medium mb-4">Evidence log</h2>
        <Card className="overflow-hidden shadow-sm">
          <div className="divide-y divide-border">
            {evidenceItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>No evidence uploaded yet.</p>
              </div>
            ) : evidenceItems.map(ev => {
              const statusCfg = STATUS_CONFIG[ev.status];
              const catLabel = CATEGORY_LABELS[ev.category];
              return (
                <div key={ev.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{ev.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {catLabel} · Uploaded {ev.uploadedAt}
                        {ev.extractedLines !== undefined && ` · ${ev.extractedLines} lines extracted`}
                        {ev.linkedInboxItemId && <span className="ml-1 text-amber-600">→ Inbox item</span>}
                      </p>
                    </div>
                  </div>
                  <Badge className={cn('text-[10px] shrink-0', statusCfg.className)}>
                    {statusCfg.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Recent transactions */}
      <div>
        <h2 className="text-xl font-serif font-medium mb-4">Transaction log</h2>
        <Card className="overflow-hidden shadow-sm">
          <div className="divide-y divide-border">
            {transactions.slice(0, 8).map(t => (
              <div key={t.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
                    {t.source === 'bank' ? <Database className="w-4 h-4" /> : t.source === 'manual' ? <Plus className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(t.date).toLocaleDateString('en-GB')} · {t.source}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={cn("font-semibold text-sm", t.amount > 0 ? 'text-emerald-600' : 'text-foreground')}>
                    {t.amount > 0 ? '+' : ''}£{Math.abs(t.amount).toFixed(2)}
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">{t.category}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
