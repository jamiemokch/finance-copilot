import { Badge, Button, Card, Input, Label, Select } from '@/components/ui';
import { evidenceApi, transactionsApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useRef, useState } from 'react';
import {
  Banknote, CheckCircle2, ChevronLeft, Database, FileSpreadsheet, FileText,
  Loader2, Pencil, Plus, Receipt, UploadCloud, AlertCircle, Landmark,
} from 'lucide-react';
import { cn } from '@/components/ui';
import { Link } from 'wouter';

type Intake = 'document' | 'bank' | 'ledger' | 'manual' | null;
type ColumnRole = 'date' | 'amount' | 'description' | 'category' | 'debit' | 'credit' | 'balance' | 'none';
type Mapping = { headerRow: number; columns: Partial<Record<Exclude<ColumnRole, 'none'>, number>>; dateFormat?: string | null; currency?: string };

const INTAKES = [
  { id: 'document' as const, title: 'Receipt or invoice', text: 'A receipt, invoice, or other original document.', icon: Receipt, note: 'Best for proof of a specific transaction' },
  { id: 'bank' as const, title: 'Bank export', text: 'A CSV from Starling, Monzo, Barclays or another bank.', icon: Landmark, note: 'Official bank-supported record' },
  { id: 'ledger' as const, title: 'Spreadsheet or CSV', text: 'Your own ledger, cashbook, or exported spreadsheet.', icon: FileSpreadsheet, note: 'Useful for existing records' },
  { id: 'manual' as const, title: 'Quick entry', text: 'Type one transaction in now.', icon: Pencil, note: 'For cash or out-of-pocket items' },
];

function FilePicker({ accept, onPick, label = 'Choose file' }: { accept: string; onPick: (file: File) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return <>
    <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => {
      const file = e.target.files?.[0]; if (file) onPick(file); e.target.value = '';
    }} />
    <Button onClick={() => ref.current?.click()} className="gap-2 cursor-pointer"><UploadCloud className="w-4 h-4" />{label}</Button>
  </>;
}

function TierBadge({ tier }: { tier?: number }) {
  if (!tier) return null;
  const config = tier === 1 ? { Icon: Receipt, text: 'Receipt' } : tier === 2 ? { Icon: Landmark, text: 'Bank' } :
    tier === 3 ? { Icon: FileSpreadsheet, text: 'Spreadsheet' } : { Icon: Pencil, text: 'Manual' };
  const Icon = config.Icon;
  return <Badge variant="outline" className="text-[10px] py-0 gap-1"><Icon className="w-3 h-3" />Tier {tier} · {config.text}</Badge>;
}

function DocumentFlow({ profileId, refresh, onBack }: { profileId: string; refresh: () => Promise<void>; onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const registeredEvidenceId = useRef<string | null>(null);
  const upload = async (file: File) => {
    setStatus('working'); setMessage('Reading your document and checking the transaction…');
    try {
      if (!registeredEvidenceId.current) {
        const { objectPath } = await evidenceApi.uploadDirect(file);
        const item = await evidenceApi.register(profileId, { filename: file.name, objectPath, mimeType: file.type || 'application/octet-stream', category: 'receipt', evidenceType: 'document' });
        registeredEvidenceId.current = item.id;
      }
      const processed = await evidenceApi.process(profileId, registeredEvidenceId.current);
      await refresh();
      setStatus('done'); setMessage(processed.status === 'needs_review' ? 'Sent to Inbox for a quick decision.' : 'Added to your records.');
    } catch { setStatus('error'); setMessage('We could not process that document. Choose the file again to retry safely.'); }
  };
  return <Card className="p-6 shadow-sm space-y-5">
    <button onClick={onBack} className="text-sm text-primary flex gap-1 items-center cursor-pointer"><ChevronLeft className="w-4 h-4" />All ways to add records</button>
    <div><h2 className="text-xl font-serif">Add a receipt or invoice</h2><p className="text-sm text-muted-foreground mt-1">Upload an original document. We’ll extract the transaction and ask only if anything is unclear.</p></div>
    {status === 'working' ? <div className="py-8 text-center text-primary"><Loader2 className="w-7 h-7 animate-spin mx-auto mb-3" />{message}</div> :
      status === 'done' ? <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 flex gap-2"><CheckCircle2 className="w-5 h-5 shrink-0" />{message}</div> :
      <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-3"><Receipt className="w-9 h-9 text-primary mx-auto" /><p className="font-medium">Receipt, invoice, or statement</p><p className="text-xs text-muted-foreground">PDF, JPG, PNG, HEIC</p><FilePicker accept=".pdf,.jpg,.jpeg,.png,.heic" onPick={upload} /></div>}
    {status === 'error' && <p className="text-sm text-destructive">{message}</p>}
  </Card>;
}

function BatchFlow({ kind, profileId, refresh, onBack }: { kind: 'bank' | 'ledger'; profileId: string; refresh: () => Promise<void>; onBack: () => void }) {
  const [stage, setStage] = useState<'pick' | 'detecting' | 'mapping' | 'importing' | 'done' | 'error'>('pick');
  const [evidenceId, setEvidenceId] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ headerRow: 0, columns: {} });
  const [summary, setSummary] = useState<{ processedRows: number; autoPostedRows: number; inboxRows: number; skippedRows: number } | null>(null);
  const [error, setError] = useState('');
  const chooseFile = async (file: File) => {
    setStage('detecting'); setFilename(file.name);
    try {
      let reusableEvidenceId = evidenceId;
      if (!reusableEvidenceId) {
        const { objectPath } = await evidenceApi.uploadDirect(file);
        const evidence = await evidenceApi.register(profileId, { filename: file.name, objectPath, mimeType: file.type || 'text/csv', category: kind === 'bank' ? 'bank_statement' : 'other', evidenceType: kind === 'bank' ? 'bank_csv' : 'ledger' });
        reusableEvidenceId = evidence.id;
      }
      const detected = await evidenceApi.detectSchema(profileId, reusableEvidenceId);
      setEvidenceId(reusableEvidenceId);
      setPreview(detected.previewRows);
      const proposed = detected.mappingSchema as Mapping;
      setMapping({ headerRow: proposed.headerRow ?? 0, columns: proposed.columns ?? {}, dateFormat: proposed.dateFormat ?? null, currency: proposed.currency ?? 'GBP' });
      setStage('mapping');
    } catch { setError('We could not read that file. Please use a CSV or Excel file and try again.'); setStage('error'); }
  };
  const setRole = (column: number, role: ColumnRole) => setMapping(prev => {
    const columns = { ...prev.columns };
    Object.keys(columns).forEach(key => { if (columns[key as keyof typeof columns] === column) delete columns[key as keyof typeof columns]; });
    if (role !== 'none') columns[role] = column;
    return { ...prev, columns };
  });
  const importBatch = async () => {
    setStage('importing');
    try {
      const result = await evidenceApi.processBatch(profileId, evidenceId, mapping, kind === 'bank');
      setSummary(result); await refresh(); setStage('done');
    } catch (err) { setError(err instanceof Error ? err.message : 'Import failed.'); setStage('error'); }
  };
  const columnCount = Math.max(0, ...preview.map(row => row.length));
  const roleFor = (column: number): ColumnRole => (Object.entries(mapping.columns).find(([, value]) => value === column)?.[0] as ColumnRole) ?? 'none';
  const total = summary?.processedRows ?? 0;
  return <Card className="p-6 shadow-sm space-y-5">
    <button onClick={onBack} className="text-sm text-primary flex gap-1 items-center cursor-pointer"><ChevronLeft className="w-4 h-4" />All ways to add records</button>
    <div><h2 className="text-xl font-serif">{kind === 'bank' ? 'Import a bank export' : 'Import a spreadsheet or CSV'}</h2><p className="text-sm text-muted-foreground mt-1">{kind === 'bank' ? 'We’ll recognise the columns in your official bank export.' : 'We’ll suggest how each column in your ledger should be used.'}</p></div>
    {stage === 'pick' && <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-3"><FileSpreadsheet className="w-9 h-9 text-primary mx-auto" /><p className="font-medium">Choose your {kind === 'bank' ? 'bank CSV' : 'CSV or Excel file'}</p><FilePicker accept=".csv,.xlsx,.xls" onPick={chooseFile} label="Choose file" /></div>}
    {stage === 'detecting' && <div className="py-10 text-center text-primary"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />AI is detecting the columns in {filename}…</div>}
    {stage === 'mapping' && <div className="space-y-4">
      <div className="bg-primary/5 border border-primary/15 rounded-lg p-3 text-sm"><strong>Check the columns.</strong> We’ve suggested a mapping. Change any heading below, then import.</div>
      <div className="overflow-x-auto border border-border rounded-lg"><table className="w-full text-sm"><thead className="bg-secondary/50"><tr>{Array.from({ length: columnCount }, (_, col) => <th key={col} className="p-2 min-w-36 text-left"><Select value={roleFor(col)} onChange={e => setRole(col, e.target.value as ColumnRole)} className="text-xs"><option value="none">Ignore column</option><option value="date">Date</option><option value="amount">Amount</option><option value="description">Description</option><option value="category">Category</option><option value="debit">Debit</option><option value="credit">Credit</option><option value="balance">Balance</option></Select></th>)}</tr></thead><tbody>{preview.slice(0, 5).map((row, i) => <tr key={i} className="border-t border-border">{Array.from({ length: columnCount }, (_, col) => <td key={col} className="p-2 max-w-48 truncate">{row[col] || '—'}</td>)}</tr>)}</tbody></table></div>
      <div className="flex justify-between items-center"><span className="text-xs text-muted-foreground">Preview of the first 5 rows</span><Button onClick={importBatch} className="cursor-pointer">Looks right — import</Button></div>
    </div>}
    {stage === 'importing' && <div className="py-8 space-y-3"><div className="flex justify-between text-sm"><span>Importing {filename}</span><span>Processing rows…</span></div><div className="h-3 rounded-full bg-secondary overflow-hidden"><div className="h-full w-2/3 bg-primary animate-pulse rounded-full" /></div><p className="text-xs text-muted-foreground text-center">Your financial position will refresh when this is complete.</p></div>}
    {stage === 'done' && summary && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex gap-2 text-emerald-800"><CheckCircle2 className="w-5 h-5" /><div><p className="font-semibold">Import complete</p><p className="text-sm mt-1">{summary.autoPostedRows} added, {summary.inboxRows} sent to review{summary.skippedRows ? `, ${summary.skippedRows} skipped` : ''}.</p></div></div><div className="mt-4 h-2 bg-emerald-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 w-full" /></div><p className="text-xs text-emerald-700 mt-2">{total} of {total + summary.skippedRows} rows processed</p></div>}
    {stage === 'error' && <div className="text-sm text-destructive flex flex-wrap items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}{evidenceId && <Button size="sm" variant="outline" onClick={importBatch}>Retry import</Button>}</div>}
  </Card>;
}

function ManualFlow({ onBack }: { onBack: () => void }) {
  const { addTransaction } = useStore();
  const [item, setItem] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', description: '', category: 'General' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const submit = async () => {
    if (saveInFlight.current) return;
    const amount = Number(item.amount); if (!item.description.trim() || !amount) { setError('Add a description and a non-zero amount.'); return; }
    saveInFlight.current = true; setSaving(true); setError('');
    try { await addTransaction({ ...item, amount, description: item.description.trim(), source: 'manual' }, idempotencyKey.current ?? (idempotencyKey.current = crypto.randomUUID())); setSaved(true); idempotencyKey.current = null; setItem({ ...item, amount: '', description: '' }); }
    catch { setError('We could not save that transaction. Please try again.'); }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  return <Card className="p-6 shadow-sm space-y-5"><button onClick={onBack} className="text-sm text-primary flex gap-1 items-center cursor-pointer"><ChevronLeft className="w-4 h-4" />All ways to add records</button><div><h2 className="text-xl font-serif">Quick entry</h2><p className="text-sm text-muted-foreground mt-1">Add one transaction. Use a minus amount for money going out.</p></div>
    {saved && <div className="p-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">Added to your records. Your figures have refreshed.</div>}
    {error && <div className="p-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg">{error}</div>}
    <div className="grid sm:grid-cols-2 gap-4"><div className="space-y-1"><Label>Date</Label><Input type="date" value={item.date} onChange={e => setItem({ ...item, date: e.target.value })} /></div><div className="space-y-1"><Label>Amount (£)</Label><Input type="number" placeholder="-50.00" value={item.amount} onChange={e => setItem({ ...item, amount: e.target.value })} /></div><div className="sm:col-span-2 space-y-1"><Label>Description</Label><Input value={item.description} placeholder="e.g. Client lunch" onChange={e => setItem({ ...item, description: e.target.value })} /></div><div className="space-y-1"><Label>Accounting category (optional)</Label><Select value={item.category} onChange={e => setItem({ ...item, category: e.target.value })}><option>General</option><option>Travel</option><option>Office</option><option>Sales</option><option>Entertainment</option></Select></div><div className="flex items-end"><Button disabled={saving} onClick={submit} className="w-full cursor-pointer">{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}Add transaction</Button></div></div>
  </Card>;
}

export default function AddRecords() {
  const { evidenceItems, inboxItems, activeProfileId, transactions, refreshData } = useStore();
  const [intake, setIntake] = useState<Intake>(null);
  const [attachTo, setAttachTo] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState('');
  const attachInFlight = useRef(false);
  const pending = inboxItems.filter(i => i.status === 'pending').length;
  const attachReceipt = async (file: File) => {
    if (!attachTo || attachInFlight.current) return;
    attachInFlight.current = true; setAttaching(true); setAttachError('');
    try { const { objectPath } = await evidenceApi.uploadDirect(file); const evidence = await evidenceApi.register(activeProfileId, { filename: file.name, objectPath, mimeType: file.type || 'application/octet-stream', category: 'receipt', evidenceType: 'document' }); await transactionsApi.attachEvidence(activeProfileId, attachTo, evidence.id); await refreshData(); setAttachTo(null); }
    catch { setAttachError('We could not attach that receipt. Please try again.'); }
    finally { attachInFlight.current = false; setAttaching(false); }
  };
  return <div className="space-y-7 animate-in fade-in duration-500 max-w-5xl mx-auto pb-12">
    <div><h1 className="text-3xl font-serif">Add Records</h1><p className="text-muted-foreground mt-1 text-lg">Bring in the records that keep your financial picture current and defensible.</p></div>
    {pending > 0 && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800"><strong>{pending} item{pending !== 1 ? 's' : ''} need a decision.</strong> <Link href="/tasks" className="underline">Review them in Tasks</Link>.</div>}
    {!intake ? <><div className="grid sm:grid-cols-2 gap-4">{INTAKES.map(option => { const Icon = option.icon; return <button key={option.id} onClick={() => setIntake(option.id)} className="text-left border border-border rounded-xl p-5 bg-card hover:border-primary/40 hover:bg-primary/[.02] transition-all cursor-pointer"><div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4"><Icon className="w-5 h-5" /></div><h2 className="font-serif text-lg">{option.title}</h2><p className="text-sm text-muted-foreground mt-1">{option.text}</p><p className="text-xs text-primary mt-3">{option.note} →</p></button>; })}</div>
      <section><h2 className="text-xl font-serif mb-3">Recent records</h2><Card className="divide-y divide-border overflow-hidden">{transactions.length ? transactions.slice(0, 12).map(t => <div key={t.id} className="p-4 flex justify-between gap-4"><div className="min-w-0"><p className="font-medium text-sm truncate">{t.description}</p><div className="flex gap-2 items-center mt-1"><span className="text-xs text-muted-foreground">{new Date(t.date).toLocaleDateString('en-GB')} · {t.category}</span><TierBadge tier={t.evidenceTier} />{(t.evidenceTier === 3 || t.evidenceTier === 4) && <button onClick={() => setAttachTo(t.id)} className="text-xs text-primary hover:underline">Attach receipt +</button>}</div></div><span className={cn('font-semibold text-sm shrink-0', t.amount > 0 && 'text-emerald-600')}>{t.amount > 0 ? '+' : '−'}£{Math.abs(t.amount).toFixed(2)}</span></div>) : <div className="p-10 text-center text-muted-foreground"><Database className="w-8 h-8 mx-auto mb-2 opacity-30" />No records yet — choose a way to add your first one.</div>}</Card></section></> :
      intake === 'document' ? <DocumentFlow profileId={activeProfileId} refresh={refreshData} onBack={() => setIntake(null)} /> :
      intake === 'manual' ? <ManualFlow onBack={() => setIntake(null)} /> :
      <BatchFlow kind={intake} profileId={activeProfileId} refresh={refreshData} onBack={() => setIntake(null)} />}
    {attachTo && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"><Card className="p-6 w-full max-w-md space-y-4"><h2 className="font-serif text-xl">Attach a receipt</h2><p className="text-sm text-muted-foreground">Adding an original receipt upgrades this record’s evidence quality.</p>{attaching ? <Loader2 className="animate-spin text-primary mx-auto" /> : <FilePicker accept=".pdf,.jpg,.jpeg,.png,.heic" onPick={attachReceipt} label="Choose receipt" />}{attachError && <p className="text-sm text-destructive">{attachError}</p>}<Button variant="outline" className="w-full" onClick={() => setAttachTo(null)}>Cancel</Button></Card></div>}
  </div>;
}