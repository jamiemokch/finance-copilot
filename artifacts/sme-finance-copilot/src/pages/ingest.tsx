import { Badge, Button, Card, Input, Label, Select } from '@/components/ui';
import { GuidedSpreadsheetAudit } from '@/components/guided-spreadsheet-audit';
import { GuidedSpreadsheetReview, ImportChecklist, SpreadsheetServerIssues, confirmationBlockersForReview, unresolvedReviewSheets, type GuidedSpreadsheetServerIssue, type SheetResolution } from '@/components/guided-spreadsheet-review';
import {
  ApiError, bankImportsApi, evidenceApi, transactionsApi,
  type APIEvidenceItem, type BankCsvMapping, type BankImportBatch, type BankImportRow, type FinancialAccount, type SpreadsheetImportError, type SpreadsheetReviewAnalysis,
} from '@/lib/api';
import { useStore, type EvidenceItem } from '@/lib/store';
import { useEffect, useRef, useState } from 'react';
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

function FilePicker({ accept, onPick, label = 'Choose file', disabled = false }: { accept: string; onPick: (file: File) => void; label?: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return <>
    <input ref={ref} type="file" disabled={disabled} accept={accept} className="hidden" onChange={e => {
      const file = e.target.files?.[0]; if (file) onPick(file); e.target.value = '';
    }} />
    <Button disabled={disabled} onClick={() => ref.current?.click()} className="gap-2 cursor-pointer"><UploadCloud className="w-4 h-4" />{label}</Button>
  </>;
}

function TierBadge({ tier }: { tier?: number }) {
  if (!tier) return null;
  const config = tier === 1 ? { Icon: Receipt, text: 'Receipt' } : tier === 2 ? { Icon: Landmark, text: 'Bank' } :
    tier === 3 ? { Icon: FileSpreadsheet, text: 'Spreadsheet' } : { Icon: Pencil, text: 'Manual' };
  const Icon = config.Icon;
  return <Badge variant="outline" className="text-[10px] py-0 gap-1"><Icon className="w-3 h-3" />Tier {tier} · {config.text}</Badge>;
}

type DocumentDraft = {
  date: string;
  description: string;
  amount: string;
  category: string;
  taxTreatment: string;
  allowablePercentage: string;
};

function draftFromCandidate(candidate: Record<string, unknown> | null | undefined, filename: string): DocumentDraft {
  const read = (key: string) => typeof candidate?.[key] === 'string' || typeof candidate?.[key] === 'number'
    ? String(candidate[key]) : '';
  const amount = read('amount');
  const treatment = read('taxTreatment');
  return {
    date: read('date') || new Date().toISOString().slice(0, 10),
    description: read('description') || filename,
    amount,
    category: read('accountingCategory') || read('category') || 'other',
    taxTreatment: treatment === 'income' ? 'income' : treatment === 'non_deductible' ? 'non_deductible' : 'deductible',
    allowablePercentage: read('allowablePercentage') || (treatment === 'non_deductible' ? '0' : '100'),
  };
}

function DocumentFlow({ profileId, refresh, onBack, resumeEvidence }: { profileId: string; refresh: () => Promise<void>; onBack: () => void; resumeEvidence: EvidenceItem | null }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const registeredEvidenceId = useRef<string | null>(resumeEvidence?.id ?? null);
  const [reviewEvidence, setReviewEvidence] = useState<APIEvidenceItem | null>(null);
  const [draft, setDraft] = useState<DocumentDraft>(() => draftFromCandidate(resumeEvidence?.extractedData, resumeEvidence?.filename ?? 'document'));
  const [confirming, setConfirming] = useState(false);
  const financialIdempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    if (
      resumeEvidence?.workflowVersion === 2
      && (resumeEvidence.reviewState === 'review_required' || resumeEvidence.reviewState === 'reviewed')
      && resumeEvidence.documentLifecycle === 'active'
    ) {
      setReviewEvidence(resumeEvidence as APIEvidenceItem);
      setDraft(draftFromCandidate(resumeEvidence.extractedData, resumeEvidence.filename));
      setStatus('done');
      setMessage('Review the extracted details. This document has not created a financial record.');
    }
  }, [resumeEvidence?.id]);
  const readyForReview = (item: APIEvidenceItem) => {
    setReviewEvidence(item);
    setDraft(draftFromCandidate(item.extractedData as Record<string, unknown> | null | undefined, item.filename));
    setStatus('done');
    setMessage('Extraction is ready to review. Nothing has been added to Financial Memory.');
  };
  const processExisting = async () => {
    if (!registeredEvidenceId.current) return;
    setStatus('working'); setMessage('Finishing your saved document upload…');
    try {
      const processed = await evidenceApi.process(profileId, registeredEvidenceId.current);
      await refresh();
      if (processed.workflowVersion === 2) readyForReview(processed);
      else { setStatus('done'); setMessage(processed.status === 'needs_review' ? 'Sent to Inbox for a quick decision.' : 'Added to your records.'); }
    } catch { setStatus('error'); setMessage('We could not finish that upload yet. You can retry it safely or start a new upload.'); }
  };
  const upload = async (file: File) => {
    setStatus('working'); setMessage('Reading your document and checking the transaction…');
    try {
      if (!registeredEvidenceId.current) {
        const { objectPath } = await evidenceApi.uploadDirect(profileId, file);
        const item = await evidenceApi.register(profileId, { filename: file.name, objectPath, mimeType: file.type || 'application/octet-stream', category: 'receipt', evidenceType: 'document' });
        registeredEvidenceId.current = item.id;
      }
      const processed = await evidenceApi.process(profileId, registeredEvidenceId.current);
      await refresh();
      if (processed.workflowVersion === 2) readyForReview(processed);
      else { setStatus('done'); setMessage(processed.status === 'needs_review' ? 'Sent to Inbox for a quick decision.' : 'Added to your records.'); }
    } catch { setStatus('error'); setMessage('We could not process that document. Choose the file again to retry safely.'); }
  };
  return <Card className="p-6 shadow-sm space-y-5">
    <button onClick={onBack} className="text-sm text-primary flex gap-1 items-center cursor-pointer"><ChevronLeft className="w-4 h-4" />All ways to add records</button>
    <div><h2 className="text-xl font-serif">Add a receipt or invoice</h2><p className="text-sm text-muted-foreground mt-1">Upload an original document. We’ll suggest details for your review, but never add a financial record without your explicit confirmation.</p></div>
    {status === 'working' ? <div className="py-8 text-center text-primary"><Loader2 className="w-7 h-7 animate-spin mx-auto mb-3" />{message}</div> :
       status === 'done' && !reviewEvidence ? <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 flex gap-2"><CheckCircle2 className="w-5 h-5 shrink-0" />{message}</div> :
       resumeEvidence ? <div className="rounded-xl border border-primary/20 bg-primary/5 p-7 text-center space-y-3"><Receipt className="w-9 h-9 text-primary mx-auto" /><p className="font-medium">Saved upload: {resumeEvidence.filename}</p><p className="text-sm text-muted-foreground">The file is still here, so you can finish it without choosing it again.</p><Button onClick={processExisting} className="cursor-pointer">Resume upload</Button></div> :
        !reviewEvidence && <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-3"><Receipt className="w-9 h-9 text-primary mx-auto" /><p className="font-medium">Receipt, invoice, or statement</p><p className="text-xs text-muted-foreground">PDF, JPG, PNG, HEIC</p><FilePicker accept=".pdf,.jpg,.jpeg,.png,.heic" onPick={upload} /></div>}
     {reviewEvidence && <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/[.03] p-5">
       <div><h3 className="font-serif text-lg">Review document details</h3><p className="text-sm text-muted-foreground mt-1">{message} Editing or saving this review does not affect tax, profit, or Financial Memory.</p></div>
       <div className="grid gap-3 sm:grid-cols-2">
         <label className="space-y-1"><Label>Date</Label><Input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label>
         <label className="space-y-1"><Label>Amount (£)</Label><Input type="number" value={draft.amount} placeholder="Enter amount if known" onChange={e => setDraft({ ...draft, amount: e.target.value })} /></label>
         <label className="space-y-1 sm:col-span-2"><Label>Description</Label><Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
         <label className="space-y-1"><Label>Category</Label><Input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
         <label className="space-y-1"><Label>Tax treatment</Label><Select value={draft.taxTreatment} onChange={e => setDraft({ ...draft, taxTreatment: e.target.value })}><option value="deductible">Deductible expense</option><option value="non_deductible">Non-deductible expense</option><option value="income">Business income</option></Select></label>
         {draft.taxTreatment === 'deductible' && <label className="space-y-1"><Label>Business use (%)</Label><Input type="number" min="0" max="100" value={draft.allowablePercentage} onChange={e => setDraft({ ...draft, allowablePercentage: e.target.value })} /></label>}
       </div>
       <div className="flex flex-wrap gap-2">
         <Button variant="outline" disabled={confirming} onClick={() => void evidenceApi.review(profileId, reviewEvidence.id, { category: draft.category, extractedData: { ...draft, amount: Number(draft.amount || 0), allowablePercentage: Number(draft.allowablePercentage || 0) } }).then(async item => { setReviewEvidence(item); await refresh(); setMessage('Review saved. This is still supporting evidence only.'); }).catch(() => setMessage('We could not save these review details yet.'))}>Save review only</Button>
         <Button disabled={confirming || !draft.description.trim() || !Number(draft.amount)} onClick={() => void (async () => {
           setConfirming(true);
           try {
             await evidenceApi.review(profileId, reviewEvidence.id, { category: draft.category, extractedData: { ...draft, amount: Number(draft.amount), allowablePercentage: Number(draft.allowablePercentage || 0) } });
             await evidenceApi.confirmTransaction(profileId, reviewEvidence.id, {
               idempotencyKey: financialIdempotencyKey.current ?? (financialIdempotencyKey.current = crypto.randomUUID()),
               date: draft.date, description: draft.description.trim(), amount: Number(draft.amount), category: draft.category,
               taxTreatment: draft.taxTreatment, allowablePercentage: Number(draft.allowablePercentage || 0),
             });
             financialIdempotencyKey.current = null; await refresh(); setReviewEvidence(null); setMessage('Financial record confirmed and added to Financial Memory.'); setStatus('done');
           } catch { setMessage('We could not confirm the financial record. Your reviewed document is still saved.'); }
           finally { setConfirming(false); }
         })()}>{confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Confirm financial record</Button>
       </div>
     </div>}
    {status === 'error' && <p className="text-sm text-destructive">{message}</p>}
  </Card>;
}

type BankRole = 'date' | 'amount' | 'description' | 'debit' | 'credit' | 'reference' | 'balance' | 'none';

function BankImportFlow({ profileId, refresh, onBack }: { profileId: string; refresh: () => Promise<void>; onBack: () => void }) {
  const [stage, setStage] = useState<'setup' | 'uploading' | 'mapping' | 'preview' | 'committing' | 'done' | 'error'>('setup');
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [batch, setBatch] = useState<BankImportBatch | null>(null);
  const [rows, setRows] = useState<BankImportRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<BankCsvMapping>({ headerRow: 0, columns: { date: 0, description: 1, amount: 2 }, dateFormat: 'dmy', decimalConvention: 'dot' });
  const [savedBatches, setSavedBatches] = useState<BankImportBatch[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSaved = async () => {
    const [loadedAccounts, batches] = await Promise.all([bankImportsApi.accounts(profileId), bankImportsApi.list(profileId)]);
    setAccounts(loadedAccounts);
    setAccountId(current => current || loadedAccounts[0]?.id || '');
    setSavedBatches(batches.filter(item => ['mapping_required', 'preview_ready', 'failed'].includes(item.status)));
  };
  useEffect(() => { void loadSaved().catch(() => setMessage('We could not load saved bank imports.')); }, [profileId]);
  useEffect(() => {
    setStage('setup'); setBatch(null); setRows([]); setHeaders([]); setExamples([]); setMessage('');
  }, [profileId]);

  const accountForUpload = async () => {
    if (accountId) return accountId;
    if (!accountName.trim()) throw new Error('Add the account name before choosing a CSV.');
    const account = await bankImportsApi.createAccount(profileId, { displayName: accountName.trim() });
    setAccounts(current => [account, ...current]);
    setAccountId(account.id);
    return account.id;
  };
  const chooseFile = async (file: File) => {
    setBusy(true); setStage('uploading'); setMessage('');
    try {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Bank imports accept CSV files only.');
      const selectedAccountId = await accountForUpload();
      const { objectPath } = await evidenceApi.uploadDirect(profileId, file);
      const result = await bankImportsApi.register(profileId, { filename: file.name, objectPath, accountId: selectedAccountId });
      setBatch(result.batch); setRows(result.rows);
      setHeaders(result.proposal.headers); setExamples(result.proposal.examples);
      setMapping(result.proposal.mapping);
      if (result.proposal.decimalConvention === 'ambiguous') {
        setMessage('This export has an ambiguous decimal convention. Please confirm it below before previewing.');
      }
      setStage(result.batch.status === 'preview_ready' ? 'preview' : result.batch.status === 'committed' ? 'done' : 'mapping');
      await loadSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'We could not read this bank CSV.');
      setStage('error');
    } finally { setBusy(false); }
  };
  const resume = async (saved: BankImportBatch) => {
    setBusy(true); setMessage('');
    try {
      const loaded = await bankImportsApi.get(profileId, saved.id);
      setBatch(loaded.batch); setRows(loaded.rows);
      if (loaded.batch.confirmedMapping) setMapping(loaded.batch.confirmedMapping);
      if (loaded.proposal) {
        setHeaders(loaded.proposal.headers); setExamples(loaded.proposal.examples); setMapping(loaded.proposal.mapping);
      }
      setStage(loaded.batch.status === 'preview_ready' || loaded.batch.status === 'failed' ? 'preview' : 'mapping');
      if (loaded.batch.status === 'failed') setMessage(loaded.batch.lastError ?? 'This saved import can be reviewed and safely retried.');
    } catch { setMessage('We could not resume that bank import.'); setStage('error'); }
    finally { setBusy(false); }
  };
  const discard = async (id: string) => {
    setBusy(true);
    try { await bankImportsApi.discard(profileId, id); await loadSaved(); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'We could not discard that bank import.'); }
    finally { setBusy(false); }
  };
  const setRole = (column: number, role: BankRole) => {
    const columns = { ...mapping.columns };
    (Object.keys(columns) as Array<keyof typeof columns>).forEach(key => { if (columns[key] === column) delete columns[key]; });
    if (role !== 'none') (columns as Record<string, number>)[role] = column;
    setMapping({ ...mapping, columns });
  };
  const roleFor = (column: number): BankRole =>
    (Object.entries(mapping.columns).find(([, index]) => index === column)?.[0] as BankRole) ?? 'none';
  const buildPreview = async () => {
    if (!batch) return;
    setBusy(true); setMessage('');
    try {
      const result = await bankImportsApi.preview(profileId, batch.id, mapping);
      setBatch(result.batch); setRows(result.rows); setStage('preview'); await loadSaved();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'We could not validate this mapping.'); }
    finally { setBusy(false); }
  };
  const setSelected = async (row: BankImportRow, selectedForCommit: boolean) => {
    if (!batch) return;
    setRows(current => current.map(item => item.id === row.id ? { ...item, selectedForCommit } : item));
    try {
      const result = await bankImportsApi.updateSelections(profileId, batch.id, [{ rowId: row.id, selectedForCommit }]);
      setBatch(result.batch); setRows(result.rows);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'We could not update this selection.');
      setRows(current => current.map(item => item.id === row.id ? row : item));
    }
  };
  const commit = async () => {
    if (!batch) return;
    setBusy(true); setStage('committing'); setMessage('');
    try {
      const result = await bankImportsApi.commit(profileId, batch.id, batch.previewVersion);
      setBatch(result.batch); setRows(result.rows); await refresh(); await loadSaved(); setStage('done');
    } catch (err) {
      try {
        const refreshed = await bankImportsApi.preview(profileId, batch.id, mapping);
        setBatch(refreshed.batch); setRows(refreshed.rows);
        setMessage('The saved preview was refreshed because a matching movement was imported elsewhere. Review any duplicate choices before trying again.');
      } catch {
        setMessage(err instanceof Error ? err.message : 'The bank import stopped before completing. Your preview is still saved.');
      }
      setStage('preview');
    } finally { setBusy(false); }
  };
  const columnCount = Math.max(headers.length, ...examples.map(row => row.length), 0);
  const actionableRows = rows.filter(row => row.validationStatus === 'valid' && row.duplicateStatus !== 'already_imported');
  const needsDecision = rows.filter(row => row.duplicateStatus === 'possible_duplicate');

  return <Card className="p-6 shadow-sm space-y-5">
    <button onClick={onBack} className="text-sm text-primary flex gap-1 items-center cursor-pointer"><ChevronLeft className="w-4 h-4" />All ways to add records</button>
    <div><h2 className="text-xl font-serif">Import a bank CSV</h2><p className="text-sm text-muted-foreground mt-1">Bank movements are added as unreviewed records. They do not affect tax or profit until you classify them.</p></div>
    {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</div>}
    {stage === 'setup' && <div className="space-y-5">
      {savedBatches.length > 0 && <div className="rounded-xl border border-border p-4 space-y-3"><div><p className="font-medium">Saved bank imports</p><p className="text-xs text-muted-foreground">Resume or discard the saved preview before starting again.</p></div>{savedBatches.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div><p className="text-sm font-medium">{item.filename}</p><p className="text-xs text-muted-foreground">{item.status === 'preview_ready' ? `${item.selectedRows} rows selected for import` : item.status === 'failed' ? 'Commit stopped — safely resume' : 'Mapping still needed'}</p></div><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void resume(item)}>Resume</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void discard(item.id)}>Discard</Button></div></div>)}</div>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1"><Label>Financial account</Label><Select value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">Add a new account below</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.displayName}{account.lastFour ? ` ··${account.lastFour}` : ''}</option>)}</Select></label>{!accountId && <label className="space-y-1"><Label>New account name</Label><Input value={accountName} placeholder="e.g. Starling business current account" onChange={event => setAccountName(event.target.value)} /></label>}</div>
      <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-3"><Landmark className="w-9 h-9 text-primary mx-auto" /><p className="font-medium">Choose a bank CSV export</p><p className="text-xs text-muted-foreground">CSV only · up to 5 MB · no live bank connection</p><FilePicker accept=".csv,text/csv" onPick={chooseFile} label="Choose bank CSV" /></div>
    </div>}
    {stage === 'uploading' && <div className="py-10 text-center text-primary"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />Checking the CSV format and saved import history…</div>}
    {stage === 'mapping' && <div className="space-y-4">
      <div className="bg-primary/5 border border-primary/15 rounded-lg p-3 text-sm"><strong>Confirm the columns and formats.</strong> Your mapping is only a preview; nothing has entered Financial Memory yet.</div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><Label>Date format</Label><Select value={mapping.dateFormat} onChange={event => setMapping({ ...mapping, dateFormat: event.target.value as BankCsvMapping['dateFormat'] })}><option value="dmy">Day / month / year (31/01/2026)</option><option value="ymd">Year / month / day (2026-01-31)</option></Select></label><label className="space-y-1"><Label>Decimal convention</Label><Select value={mapping.decimalConvention} onChange={event => setMapping({ ...mapping, decimalConvention: event.target.value as BankCsvMapping['decimalConvention'] })}><option value="dot">Dot decimal (1,234.56)</option><option value="comma">Comma decimal (1.234,56)</option></Select></label></div>
      <div className="overflow-x-auto border border-border rounded-lg"><table className="w-full text-sm"><thead className="bg-secondary/50"><tr>{Array.from({ length: columnCount }, (_, col) => <th key={col} className="p-2 min-w-36 text-left"><span className="block text-xs mb-1 truncate">{headers[col] || `Column ${col + 1}`}</span><Select value={roleFor(col)} onChange={event => setRole(col, event.target.value as BankRole)} className="text-xs"><option value="none">Ignore</option><option value="date">Date</option><option value="amount">Signed amount</option><option value="debit">Debit</option><option value="credit">Credit</option><option value="description">Description</option><option value="reference">Reference</option><option value="balance">Balance (audit only)</option></Select></th>)}</tr></thead><tbody>{examples.slice(0, 5).map((row, index) => <tr key={index} className="border-t border-border">{Array.from({ length: columnCount }, (_, col) => <td key={col} className="p-2 max-w-48 truncate">{row[col] || '—'}</td>)}</tr>)}</tbody></table></div>
      <div className="flex justify-end"><Button disabled={busy} onClick={() => void buildPreview()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Review validated preview</Button></div>
    </div>}
    {stage === 'preview' && batch && <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm"><div className="rounded-lg bg-secondary p-3"><strong>{batch.validRows}</strong><br /><span className="text-xs text-muted-foreground">valid rows</span></div><div className="rounded-lg bg-secondary p-3"><strong>{batch.invalidRows}</strong><br /><span className="text-xs text-muted-foreground">invalid</span></div><div className="rounded-lg bg-secondary p-3"><strong>{batch.duplicateRows}</strong><br /><span className="text-xs text-muted-foreground">already imported</span></div><div className="rounded-lg bg-secondary p-3"><strong>{batch.outOfScopeRows}</strong><br /><span className="text-xs text-muted-foreground">outside tax year</span></div></div>
      <p className="text-sm"><strong>{batch.selectedRows}</strong> valid movement{batch.selectedRows === 1 ? '' : 's'} selected. Balances are kept as audit context only and are never added to your figures.</p>
      {needsDecision.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm space-y-2"><strong>Possible duplicates need your decision.</strong><p>These rows have no stable reference, so we will not silently include them. Check each one you want to import.</p>{needsDecision.map(row => <label key={row.id} className="flex items-start gap-2 rounded bg-white/70 p-2"><input type="checkbox" checked={row.selectedForCommit} disabled={busy} onChange={event => void setSelected(row, event.target.checked)} /><span>{row.date} · {row.description} · £{Math.abs(row.amount ?? 0).toFixed(2)}</span></label>)}</div>}
      {(rows.some(row => row.validationStatus !== 'valid') || batch.duplicateRows > 0) && <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer">See rows not being imported</summary><div className="mt-2 space-y-2">{rows.filter(row => row.validationStatus !== 'valid' || row.duplicateStatus === 'already_imported').slice(0, 30).map(row => <p key={row.id}><strong>Row {row.sourceRowNumber}:</strong> {row.validationErrors.join(' ') || 'Already imported.'}</p>)}</div></details>}
      <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={busy} onClick={() => setStage('mapping')}>Change mapping</Button><Button disabled={busy || actionableRows.length === 0} onClick={() => void commit()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import {batch.selectedRows} selected movement{batch.selectedRows === 1 ? '' : 's'}</Button></div>
    </div>}
    {stage === 'committing' && <div className="py-10 text-center text-primary"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />Committing your selected movements safely…</div>}
    {stage === 'done' && batch && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><div className="flex gap-2"><CheckCircle2 className="w-5 h-5 shrink-0" /><div><p className="font-semibold">Bank import complete</p><p className="text-sm mt-1">{batch.committedRows} movement{batch.committedRows === 1 ? '' : 's'} added to Financial Memory as unreviewed. Classify them before relying on tax or profit figures.</p></div></div></div>}
    {stage === 'error' && <Button variant="outline" onClick={() => setStage('setup')}>Back to bank import</Button>}
  </Card>;
}

type ReviewMapping = { headerRow: number; columns: Record<string, number | undefined>; dateFormat?: string | null; currency?: string };

function BatchFlow({ kind, profileId, refresh, onBack, resumeEvidence }: { kind: 'ledger'; profileId: string; refresh: () => Promise<void>; onBack: () => void; resumeEvidence: EvidenceItem | null }) {
  const [stage, setStage] = useState<'pick' | 'inspecting' | 'review' | 'confirming' | 'done' | 'error'>(resumeEvidence ? 'inspecting' : 'pick');
  const [evidenceId, setEvidenceId] = useState(resumeEvidence?.id ?? '');
  const [filename, setFilename] = useState(resumeEvidence?.filename ?? '');
  const [analysis, setAnalysis] = useState<SpreadsheetReviewAnalysis | null>(null);
  const [aiStatus, setAiStatus] = useState<{ status: string; reason?: string | null } | null>(null);
  const [sheetMappings, setSheetMappings] = useState<Record<string, ReviewMapping>>({});
  const [selectedSheetIds, setSelectedSheetIds] = useState<string[]>([]);
  const [sheetRoleOverrides, setSheetRoleOverrides] = useState<Record<string, 'transactional' | 'non_transactional' | 'mixed' | 'unknown'>>({});
  const [sheetResolutions, setSheetResolutions] = useState<Record<string, SheetResolution>>({});
  const [activeSheetId, setActiveSheetId] = useState('');
  const [editingSheetId, setEditingSheetId] = useState('');
  const [checkingSheetId, setCheckingSheetId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [saveFailure, setSaveFailure] = useState('');
  const [reviewSaveIssues, setReviewSaveIssues] = useState<GuidedSpreadsheetServerIssue[]>([]);
  const [filingScope, setFilingScope] = useState<string[]>([]);
  const [acknowledgeUnresolved, setAcknowledgeUnresolved] = useState(false);
  const [preTradingStartMode, setPreTradingStartMode] = useState<'retain' | 'exclude'>('exclude');
  const [outsideScopeMode, setOutsideScopeMode] = useState<'retain' | 'exclude'>('exclude');
  const [reviewRevision, setReviewRevision] = useState('');
  const [semanticPlanIdentity, setSemanticPlanIdentity] = useState('');
  const [summary, setSummary] = useState<{ dispositionCounts: Record<string, number>; importedRows: number; taxYears: string[] } | null>(null);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState<SpreadsheetImportError | null>(null);
  const [replacingWorkbook, setReplacingWorkbook] = useState(false);
  const resumed = useRef(false);

  const applyInspection = (detected: Awaited<ReturnType<typeof evidenceApi.detectSchema>>) => {
    const nextAnalysis = detected.analysis ?? null;
    setAnalysis(nextAnalysis);
    setAiStatus(detected.aiStatus ?? null);
    setImportError(detected.lastImportError ?? null);
    const suggestedMappings = Object.fromEntries((nextAnalysis?.sheets ?? []).map((sheet) => [
      sheet.sheetId,
      { headerRow: sheet.mapping.headerRow ?? 0, columns: { ...sheet.mapping.columns }, dateFormat: null, currency: 'GBP' },
    ])) as Record<string, ReviewMapping>;
    const draft = detected.reviewDraft;
    const persistedMappings = draft?.sheetMappings as Record<string, ReviewMapping> | undefined;
    setSheetMappings(persistedMappings && Object.keys(persistedMappings).length ? persistedMappings : suggestedMappings);
    setSheetRoleOverrides(draft?.sheetRoleOverrides ?? {});
    setSheetResolutions(draft?.sheetResolutions ?? {});
    const selectable = (nextAnalysis?.sheets ?? []).filter((sheet) => sheet.selected).map((sheet) => sheet.sheetId);
    const restoredSelected = draft?.selectedSheetIds?.filter((sheetId) => (nextAnalysis?.sheets ?? []).some((sheet) => sheet.sheetId === sheetId)) ?? selectable;
    setSelectedSheetIds(restoredSelected);
    setActiveSheetId(restoredSelected[0] ?? selectable[0] ?? nextAnalysis?.sheets[0]?.sheetId ?? '');
    setFilingScope(draft?.filingScope?.filter((year) => (nextAnalysis?.taxYears ?? []).includes(year)) ?? nextAnalysis?.taxYears ?? []);
    setPreTradingStartMode(draft?.preTradingStartMode ?? 'exclude');
    setOutsideScopeMode(draft?.outsideScopeMode ?? 'exclude');
    setAcknowledgeUnresolved(Boolean(draft?.excludedRowRefs?.length));
    setReviewRevision(draft?.mappingRevision ?? '');
    setSemanticPlanIdentity(draft?.semanticPlanIdentity ?? '');
  };
  const inspect = async (id: string) => {
    setStage('inspecting'); setError('');
    try {
      const detected = await evidenceApi.detectSchema(profileId, id);
      setEvidenceId(id); applyInspection(detected); setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not inspect this spreadsheet.'); setStage('error');
    }
  };
  useEffect(() => {
    if (resumeEvidence && !resumed.current) {
      resumed.current = true;
      void inspect(resumeEvidence.id);
    }
  }, [resumeEvidence?.id]);
  const chooseFile = async (file: File, replacement = false) => {
    if (savingReview) {
      setSaveFailure('Please wait while your latest review choice is saved.');
      return;
    }
    // A new workbook must always begin in the simple guided view. Do not leave
    // an earlier workbook's full inventory mounted or expanded.
    setAdvancedOpen(false);
    setEditingSheetId('');
    setCheckingSheetId('');
    setActiveSheetId('');
    setSaveFailure('');
    setFilename(file.name); setStage('inspecting'); setError(''); setImportError(null);
    try {
      const { objectPath } = await evidenceApi.uploadDirect(profileId, file);
      const evidence = replacement && evidenceId
        ? await evidenceApi.replaceSpreadsheet(profileId, evidenceId, {
          filename: file.name, objectPath, mimeType: file.type || 'application/octet-stream',
        })
        : await evidenceApi.register(profileId, {
          filename: file.name, objectPath, mimeType: file.type || 'application/octet-stream', category: 'other', evidenceType: 'ledger',
        });
      setReplacingWorkbook(false);
      await inspect(evidence.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not read that file. Please use a CSV or Excel file and try again.'); setStage('error');
    }
  };
  const activeSheet = analysis?.sheets.find((sheet) => sheet.sheetId === activeSheetId) ?? null;
  const activeMapping = activeSheetId ? sheetMappings[activeSheetId] : undefined;
  const unresolvedRows = (analysis?.sheets ?? []).filter((sheet) => selectedSheetIds.includes(sheet.sheetId))
    .flatMap((sheet) => sheet.rows.filter((row) => row.primaryDisposition === 'invalid').map((row) => ({ sheetId: sheet.sheetId, rowNumber: row.sourceRow })));
  const saveReviewDraft = async (overrides: Partial<{
    sheetMappings: Record<string, ReviewMapping>;
    selectedSheetIds: string[];
    sheetRoleOverrides: Record<string, 'transactional' | 'non_transactional' | 'mixed' | 'unknown'>;
    sheetResolutions: Record<string, SheetResolution>;
    filingScope: string[];
    acknowledgeUnresolved: boolean;
    preTradingStartMode: 'retain' | 'exclude';
    outsideScopeMode: 'retain' | 'exclude';
  }> = {}) => {
    if (!evidenceId) return;
    const nextMappings = overrides.sheetMappings ?? sheetMappings;
    const nextSelected = overrides.selectedSheetIds ?? selectedSheetIds;
    const nextScope = overrides.filingScope ?? filingScope;
    const shouldExcludeUnresolved = overrides.acknowledgeUnresolved ?? acknowledgeUnresolved;
    const selectedMappings = Object.fromEntries(nextSelected
      .filter((sheetId) => Boolean(nextMappings[sheetId]))
      .map((sheetId) => [sheetId, nextMappings[sheetId]!]));
    await evidenceApi.saveSpreadsheetReview(profileId, evidenceId, {
      selectedSheetIds: nextSelected, sheetMappings: selectedMappings, sheetRoleOverrides: overrides.sheetRoleOverrides ?? sheetRoleOverrides, filingScope: nextScope,
      sheetResolutions: overrides.sheetResolutions ?? sheetResolutions,
      excludedRowRefs: shouldExcludeUnresolved ? unresolvedRows : [],
      preTradingStartMode: overrides.preTradingStartMode ?? preTradingStartMode,
      outsideScopeMode: overrides.outsideScopeMode ?? outsideScopeMode,
    });
  };
  const persistReviewDecision = async (overrides: Parameters<typeof saveReviewDraft>[0] = {}) => {
    setSavingReview(true);
    setSaveFailure('');
    setReviewSaveIssues([]);
    try {
      const saved = await saveReviewDraft(overrides);
      setAnalysis(saved.analysis);
      setFilingScope(saved.reviewDraft?.filingScope ?? []);
      setAcknowledgeUnresolved(Boolean(saved.reviewDraft?.excludedRowRefs?.length));
      setReviewRevision(saved.reviewDraft?.mappingRevision ?? '');
      setSemanticPlanIdentity(saved.reviewDraft?.semanticPlanIdentity ?? '');
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'We could not save that choice. Please try again.';
      const issues = (err instanceof ApiError ? err.details?.issues ?? [] : []).map((issue) => ({
        ...issue,
        worksheet: issue.worksheet ?? analysis?.sheets.find((sheet) => sheet.sheetId === issue.sheetId)?.displayName,
      }));
      setReviewSaveIssues(issues);
      setSaveFailure(issues[0]?.message ?? message);
      throw err;
    } finally {
      setSavingReview(false);
    }
  };
  const setRole = async (column: number, role: ColumnRole) => {
    if (!activeSheetId || !activeMapping) return;
    const columns = { ...activeMapping.columns };
    Object.keys(columns).forEach((key) => { if (columns[key] === column) delete columns[key]; });
    if (role !== 'none') columns[role] = column;
    const nextMappings = { ...sheetMappings, [activeSheetId]: { ...activeMapping, columns } };
    setSheetMappings(nextMappings);
    try {
      await persistReviewDecision({ sheetMappings: nextMappings });
    } catch {
      setSheetMappings(sheetMappings);
    }
  };
  const roleFor = (column: number): ColumnRole => {
    const role = Object.entries(activeMapping?.columns ?? {}).find(([, value]) => value === column)?.[0];
    return ['date', 'amount', 'description', 'category', 'debit', 'credit', 'balance'].includes(role ?? '') ? role as ColumnRole : 'none';
  };
  const toggleSheet = async (sheetId: string, checked: boolean) => {
    const nextSelected = checked ? [...new Set([...selectedSheetIds, sheetId])] : selectedSheetIds.filter((id) => id !== sheetId);
    setSelectedSheetIds(nextSelected);
    try {
      await persistReviewDecision({ selectedSheetIds: nextSelected });
    } catch {
      setSelectedSheetIds(selectedSheetIds);
    }
  };
  const setSheetRole = async (sheetId: string, role: 'transactional' | 'non_transactional' | 'mixed' | 'unknown') => {
    const nextOverrides = { ...sheetRoleOverrides, [sheetId]: role };
    setSheetRoleOverrides(nextOverrides);
    try {
      await persistReviewDecision({ sheetRoleOverrides: nextOverrides });
    } catch {
      setSheetRoleOverrides(sheetRoleOverrides);
    }
  };
  const resolveSheetQuestion = async (sheet: NonNullable<SpreadsheetReviewAnalysis>['sheets'][number], resolution: SheetResolution) => {
    const previousSelected = selectedSheetIds;
    const previousOverrides = sheetRoleOverrides;
    const previousResolutions = sheetResolutions;
    const include = resolution === 'include_income' || resolution === 'include_expense';
    const nextSelected = include
      ? [...new Set([...selectedSheetIds, sheet.sheetId])]
      : selectedSheetIds.filter((sheetId) => sheetId !== sheet.sheetId);
    const nextOverrides = {
      ...sheetRoleOverrides,
      [sheet.sheetId]: include ? 'transactional' as const : 'non_transactional' as const,
    };
    const nextResolutions = { ...sheetResolutions, [sheet.sheetId]: resolution };
    setSelectedSheetIds(nextSelected);
    setSheetRoleOverrides(nextOverrides);
    setSheetResolutions(nextResolutions);
    try {
      await persistReviewDecision({
        selectedSheetIds: nextSelected,
        sheetRoleOverrides: nextOverrides,
        sheetResolutions: nextResolutions,
      });
    } catch {
      setSelectedSheetIds(previousSelected);
      setSheetRoleOverrides(previousOverrides);
      setSheetResolutions(previousResolutions);
    }
  };
  const toggleScope = async (taxYear: string, checked: boolean) => {
    const nextScope = checked ? [...new Set([...filingScope, taxYear])].sort() : filingScope.filter((year) => year !== taxYear);
    setFilingScope(nextScope);
    try {
      await persistReviewDecision({ filingScope: nextScope });
    } catch {
      setFilingScope(filingScope);
    }
  };
  const confirm = async () => {
    if (!evidenceId || !analysis || savingReview) return;
    setStage('confirming'); setError(''); setImportError(null);
    try {
      const saved = await persistReviewDecision();
      const selectedMappings = Object.fromEntries(selectedSheetIds
        .filter((sheetId) => Boolean(sheetMappings[sheetId]))
        .map((sheetId) => [sheetId, sheetMappings[sheetId]!]));
      const result = await evidenceApi.confirmSpreadsheet(profileId, evidenceId, {
        confirmation: true,
        reviewRevision: saved?.reviewDraft?.mappingRevision ?? reviewRevision,
        semanticPlanIdentity: saved?.reviewDraft?.semanticPlanIdentity ?? semanticPlanIdentity,
        selectedSheetIds, sheetMappings: selectedMappings, sheetRoleOverrides, sheetResolutions, filingScope,
        excludedRowRefs: acknowledgeUnresolved ? unresolvedRows : [],
        preTradingStartMode, outsideScopeMode,
      });
      setSummary(result); await refresh(); setStage('done');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The spreadsheet could not be confirmed.';
       const details = err instanceof ApiError ? err.details : undefined;
      setImportError({
        code: details?.code === 'source_row_conflict' ? 'source_row_conflict' : 'spreadsheet_import_failed',
        message,
        ...(details?.conflict ? { conflict: details.conflict } : {}),
         ...(details?.issues ? { issues: details.issues } : {}),
        ...(details?.rolledBack ? { rolledBack: true } : {}),
      });
       const firstIssueSheet = details?.issues?.find((issue) => issue.sheetId)?.sheetId;
       if (firstIssueSheet) {
         window.setTimeout(() => document.getElementById(`sheet-issue-${firstIssueSheet}`)?.focus(), 0);
       }
      setError(message); setStage('review');
    }
  };
  const reanalyse = async () => {
    if (!evidenceId || savingReview) return;
    try {
      await persistReviewDecision();
      await inspect(evidenceId);
    } catch {
      // persistReviewDecision surfaces the recoverable error in the review.
    }
  };
  const updateUnresolvedAcknowledgement = async (checked: boolean) => {
    setAcknowledgeUnresolved(checked);
    try {
      await persistReviewDecision({ acknowledgeUnresolved: checked });
    } catch {
      setAcknowledgeUnresolved(acknowledgeUnresolved);
    }
  };
  const updatePreTradingStartMode = async (value: 'retain' | 'exclude') => {
    setPreTradingStartMode(value);
    try {
      await persistReviewDecision({ preTradingStartMode: value });
    } catch {
      setPreTradingStartMode(preTradingStartMode);
    }
  };
  const updateOutsideScopeMode = async (value: 'retain' | 'exclude') => {
    setOutsideScopeMode(value);
    try {
      await persistReviewDecision({ outsideScopeMode: value });
    } catch {
      setOutsideScopeMode(outsideScopeMode);
    }
  };
  const leaveReview = () => {
    if (savingReview) {
      setSaveFailure('Please wait while your latest review choice is saved.');
      return;
    }
    onBack();
  };
  const columnCount = activeSheet?.dimensions.columns ?? 0;
  const importableSheets = (analysis?.sheets ?? []).filter((sheet) => sheet.selected || selectedSheetIds.includes(sheet.sheetId));
  const questions = unresolvedReviewSheets(analysis?.sheets ?? [], sheetResolutions);
  const validCoverageDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  const hasCoverage = validCoverageDate(analysis?.coverage.startDate ?? null) && validCoverageDate(analysis?.coverage.endDate ?? null);
  const confirmationBlockers = confirmationBlockersForReview({
    unresolvedSheetNames: questions.map((sheet) => sheet.displayName),
    selectedSheetCount: selectedSheetIds.length,
    taxYearCount: filingScope.length,
    incompleteRowCount: unresolvedRows.length,
    incompleteRowsAcknowledged: acknowledgeUnresolved,
  });
  const canConfirm = confirmationBlockers.length === 0;
  return <Card className="p-6 shadow-sm space-y-5">
    <button disabled={savingReview} onClick={leaveReview} className="text-sm text-primary flex gap-1 items-center cursor-pointer disabled:opacity-50"><ChevronLeft className="w-4 h-4" />All ways to add records</button>
    <div><h2 className="text-xl font-serif">Review a spreadsheet or CSV</h2><p className="text-sm text-muted-foreground mt-1">We check every sheet first. Suggestions are only a guide; nothing reaches Financial Memory until you confirm what to bring in.</p></div>
    {stage === 'pick' && <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-3"><FileSpreadsheet className="w-9 h-9 text-primary mx-auto" /><p className="font-medium">Choose a CSV or Excel workbook</p><p className="text-xs text-muted-foreground">We will check every worksheet and show only the records that are likely to be money in or out.</p><FilePicker accept=".csv,.xlsx,.xls" onPick={chooseFile} label="Upload a file" /></div>}
    {stage === 'inspecting' && <div className="py-10 text-center text-primary"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />Inspecting every sheet and preparing review-safe suggestions for {filename || 'your upload'}…</div>}
    {stage === 'review' && analysis && <div className="space-y-5">
       {importError && <div role="alert" className={cn(
        "rounded-xl border p-4 space-y-3 text-sm",
        importError.code === 'source_row_conflict'
          ? "border-amber-300 bg-amber-50 text-amber-950"
          : "border-red-200 bg-red-50 text-red-900",
      )}>
        <div className="flex gap-2"><AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /><div className="space-y-1">
           <p className="font-semibold">{importError.code === 'source_row_conflict' ? 'We stopped before adding a possible duplicate' : 'We found something that needs your decision'}</p>
           {importError.conflict && <p className="font-medium">“{importError.conflict.worksheet}”, row {importError.conflict.rowNumber} is already recorded. No records from this attempt were added.</p>}
           {!importError.conflict && <p>Use the specific question below to decide what to do next. No records from this attempt were added.</p>}
        </div></div>
         <SpreadsheetServerIssues issues={importError.issues ?? []} onShowSheet={(sheetId) => {
           const issueCard = document.getElementById(`sheet-issue-${sheetId}`);
           if (issueCard) {
             issueCard.focus();
             return;
           }
           setCheckingSheetId(sheetId);
           setActiveSheetId(sheetId);
           setEditingSheetId(sheetId);
         }} />
        <div className="flex flex-wrap gap-2">
           <Button size="sm" disabled={replacingWorkbook || !canConfirm} onClick={() => void confirm()}>Try again after reviewing</Button>
          <Button size="sm" variant="outline" disabled={replacingWorkbook || savingReview} onClick={() => setReplacingWorkbook(true)}>Replace workbook</Button>
        </div>
        {replacingWorkbook && <div className="rounded-lg border border-current/20 bg-white/60 p-3 space-y-2">
          <p className="font-medium">Choose a corrected CSV or Excel workbook</p>
          <p className="text-xs">The failed import keeps its identity, so an existing source row cannot be imported twice.</p>
          <FilePicker disabled={savingReview} accept=".csv,.xlsx,.xls" onPick={(file) => void chooseFile(file, true)} label="Choose replacement workbook" />
        </div>}
      </div>}
      {saveFailure && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 space-y-2"><p><strong>Your last choice was not saved.</strong> {saveFailure} Try again before leaving this review.</p><SpreadsheetServerIssues issues={reviewSaveIssues} onShowSheet={(sheetId) => { setActiveSheetId(sheetId); setEditingSheetId(sheetId); }} /></div>}
      <div className={cn("rounded-lg border p-3 text-sm", aiStatus?.status === 'success' ? "border-primary/20 bg-primary/5" : "border-amber-200 bg-amber-50 text-amber-900")}>
        <strong>{aiStatus?.status === 'success'
          ? 'We understood the workbook and prepared a review summary.'
          : 'Automatic understanding is incomplete.'}</strong>{' '}
        {aiStatus?.status === 'success'
          ? 'Check the summary below before you confirm.'
          : 'Nothing can be imported automatically. If you want to continue, choose one specific sheet in Advanced audit details and tell us its date, money, and description columns.'}
      </div>
       <GuidedSpreadsheetReview
         sheets={analysis.sheets}
         selectedSheetIds={selectedSheetIds}
         resolutions={sheetResolutions}
         saving={savingReview}
         checkingSheetId={checkingSheetId}
         onCheckingSheet={setCheckingSheetId}
         onResolve={(sheet, resolution) => void resolveSheetQuestion(sheet, resolution)}
         onCorrect={(sheetId) => { setActiveSheetId(sheetId); setEditingSheetId(sheetId); }}
       />
       {editingSheetId && activeSheet && activeMapping && <div className="space-y-3 rounded-xl border border-primary/30 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">Choose the named columns for {activeSheet.displayName}</p><p className="text-xs text-muted-foreground">Use this only when the choices above do not match what you see in the preview.</p></div><Button size="sm" variant="outline" disabled={savingReview} onClick={() => setEditingSheetId('')}>Done</Button></div><div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm"><thead className="bg-secondary/50"><tr>{Array.from({ length: columnCount }, (_, column) => <th key={column} className="p-2 min-w-36 text-left"><span className="block text-xs mb-1">Column {column + 1}</span><Select disabled={savingReview} value={roleFor(column)} onChange={(event) => void setRole(column, event.target.value as ColumnRole)} className="text-xs"><option value="none">Do not use</option><option value="date">Date</option><option value="amount">One money amount</option><option value="debit">Money out</option><option value="credit">Money in</option><option value="description">What it was for</option><option value="category">Type of item</option><option value="balance">Balance only — do not add</option></Select></th>)}</tr></thead><tbody>{activeSheet.previewRows.slice(0, 6).map((row) => <tr key={row.rowNumber} className="border-t">{Array.from({ length: columnCount }, (_, column) => <td key={column} className="p-2 max-w-48 truncate">{row.values[column] || '—'}</td>)}</tr>)}</tbody></table></div></div>}
       <div className="grid gap-4 md:grid-cols-2"><div className="rounded-xl border p-4 space-y-2"><p className="font-medium">Date range found</p><p className="text-sm">{hasCoverage ? `${analysis.coverage.startDate} to ${analysis.coverage.endDate}` : 'We need a usable date column before we can show a date range.'}</p><p className="text-xs text-muted-foreground">This is based only on valid dates we could read.</p></div><div className="rounded-xl border p-4 space-y-2"><p className="font-medium">{analysis.taxYears.length === 1 ? 'Tax year found' : 'Which tax year should these records support?'}</p>{analysis.taxYears.length === 1 ? <p className="text-sm">{analysis.taxYears[0]} <span className="text-muted-foreground">— based on the dates in the spreadsheet</span></p> : analysis.taxYears.length ? analysis.taxYears.map((year) => <label key={year} className="flex gap-2 text-sm"><input type="checkbox" checked={filingScope.includes(year)} onChange={(event) => void toggleScope(year, event.target.checked)} />{year}</label>) : <p className="text-sm text-amber-800">We could not find enough usable dates. Answer the sheet questions above, then check again.</p>}</div></div>
      <GuidedSpreadsheetAudit
        advancedOpen={advancedOpen}
        sheets={analysis.sheets}
        aiDetail={aiStatus?.reason}
        selectedSheetIds={selectedSheetIds}
        sheetRoleOverrides={sheetRoleOverrides}
        saving={savingReview}
        onToggle={setAdvancedOpen}
        onToggleSheet={(sheetId, checked) => void toggleSheet(sheetId, checked)}
        onSetRole={(sheetId, role) => void setSheetRole(sheetId, role)}
        onCorrectSheet={(sheetId) => { setActiveSheetId(sheetId); setEditingSheetId(sheetId); }}
      />
       {(unresolvedRows.length > 0 || (analysis.dispositionCounts.pre_trading_start ?? 0) > 0) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm text-amber-950">{unresolvedRows.length > 0 && <label className="flex gap-2 items-start"><input disabled={savingReview} type="checkbox" checked={acknowledgeUnresolved} onChange={(event) => void updateUnresolvedAcknowledgement(event.target.checked)} /><span>Leave out {unresolvedRows.length} row{unresolvedRows.length === 1 ? '' : 's'} with incomplete date, money, or description details. You can also use the named-column choices above to fix the sheet instead.</span></label>}{(analysis.dispositionCounts.pre_trading_start ?? 0) > 0 && <label className="space-y-1 block">Records from before you started trading<select disabled={savingReview} className="ml-2 border rounded px-2 py-1" value={preTradingStartMode} onChange={(event) => void updatePreTradingStartMode(event.target.value as 'retain' | 'exclude')}><option value="exclude">Leave out for now</option><option value="retain">Keep as historical records</option></select></label>}</div>}
       <div className="rounded-xl border p-4 text-sm"><label className="block">For records outside the tax years you chose<select disabled={savingReview} className="ml-2 border rounded px-2 py-1" value={outsideScopeMode} onChange={(event) => void updateOutsideScopeMode(event.target.value as 'retain' | 'exclude')}><option value="exclude">Leave out for now</option><option value="retain">Keep outside the chosen tax years</option></select></label></div>
       <ImportChecklist
         selectedSheets={importableSheets}
         leftOutCount={analysis.sheets.length - importableSheets.length}
         taxYears={filingScope}
         unresolved={confirmationBlockers}
       />
       <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={savingReview} onClick={() => void reanalyse()}>Check again for suggestions</Button><div className="space-y-1 text-right"><Button disabled={!canConfirm || savingReview} onClick={() => void confirm()}><CheckCircle2 className="mr-2 h-4 w-4" />Confirm and import</Button>{!canConfirm && <p className="max-w-md text-xs text-amber-800">Answer the items in “Before we add anything” to continue.</p>}</div></div>
    </div>}
    {stage === 'confirming' && <div className="py-10 text-center text-primary"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />Bringing in your confirmed records…</div>}
    {stage === 'done' && summary && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><div className="flex gap-2"><CheckCircle2 className="w-5 h-5 shrink-0" /><div><p className="font-semibold">Spreadsheet records imported</p><p className="text-sm mt-1">{summary.importedRows} movement{summary.importedRows === 1 ? '' : 's'} added as unclassified records. They do not affect tax or profit until you classify them.</p><p className="text-xs mt-2">Tax years: {summary.taxYears.join(', ') || 'none'}</p></div></div></div>}
    {stage === 'error' && <div className="text-sm text-destructive flex flex-wrap items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}<Button size="sm" variant="outline" onClick={() => evidenceId ? void inspect(evidenceId) : setStage('pick')}>Try again</Button></div>}
  </Card>;
}

function LegacyBatchFlow({ kind, profileId, refresh, onBack, resumeEvidence }: { kind: 'ledger'; profileId: string; refresh: () => Promise<void>; onBack: () => void; resumeEvidence: EvidenceItem | null }) {
  const [stage, setStage] = useState<'pick' | 'detecting' | 'mapping' | 'importing' | 'done' | 'error'>(resumeEvidence ? 'detecting' : 'pick');
  const [evidenceId, setEvidenceId] = useState(resumeEvidence?.id ?? '');
  const [filename, setFilename] = useState(resumeEvidence?.filename ?? '');
  const [preview, setPreview] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ headerRow: 0, columns: {} });
  const [summary, setSummary] = useState<{ processedRows: number; autoPostedRows: number; inboxRows: number; skippedRows: number } | null>(null);
  const [error, setError] = useState('');
  const resumed = useRef(false);
  const loadExisting = async () => {
    if (!resumeEvidence) return;
    setStage('detecting'); setError('');
    try {
      const detected = await evidenceApi.detectSchema(profileId, resumeEvidence.id);
      setEvidenceId(resumeEvidence.id);
      setPreview(detected.previewRows);
      const proposed = (resumeEvidence.mappingSchema ?? detected.mappingSchema) as Mapping;
      setMapping({ headerRow: proposed.headerRow ?? 0, columns: proposed.columns ?? {}, dateFormat: proposed.dateFormat ?? null, currency: proposed.currency ?? 'GBP' });
      setStage('mapping');
    } catch { setError('We could not reopen that file. Please try again or start a new upload.'); setStage('error'); }
  };
  useEffect(() => {
    if (resumeEvidence && !resumed.current) {
      resumed.current = true;
      void loadExisting();
    }
  }, [resumeEvidence?.id]);
  const chooseFile = async (file: File) => {
    setStage('detecting'); setFilename(file.name);
    try {
      let reusableEvidenceId = evidenceId;
      if (!reusableEvidenceId) {
        const { objectPath } = await evidenceApi.uploadDirect(profileId, file);
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
    setError('This retired import path is unavailable. Use the reviewed spreadsheet flow above.');
    setStage('error');
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
     {stage === 'error' && <div className="text-sm text-destructive flex flex-wrap items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}{evidenceId && (resumeEvidence ? <Button size="sm" variant="outline" onClick={loadExisting}>Retry resume</Button> : <Button size="sm" variant="outline" onClick={importBatch}>Retry import</Button>)}</div>}
  </Card>;
}

function ManualFlow({ onBack }: { onBack: () => void }) {
  const { addTransaction } = useStore();
  const [item, setItem] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', description: '', category: 'General', allowablePercentage: '100' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const submit = async () => {
    if (saveInFlight.current) return;
    const amount = Number(item.amount);
    const allowablePercentage = Number(item.allowablePercentage);
    if (!item.description.trim() || !amount) { setError('Add a description and a non-zero amount.'); return; }
    if (amount < 0 && (!Number.isFinite(allowablePercentage) || allowablePercentage < 0 || allowablePercentage > 100)) { setError('Business use must be between 0% and 100%.'); return; }
    saveInFlight.current = true; setSaving(true); setError('');
    try { await addTransaction({ ...item, amount, description: item.description.trim(), allowablePercentage: amount < 0 ? allowablePercentage : 100, source: 'manual' }, idempotencyKey.current ?? (idempotencyKey.current = crypto.randomUUID())); setSaved(true); idempotencyKey.current = null; setItem({ ...item, amount: '', description: '' }); }
    catch { setError('We could not save that transaction. Please try again.'); }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  return <Card className="p-6 shadow-sm space-y-5"><button onClick={onBack} className="text-sm text-primary flex gap-1 items-center cursor-pointer"><ChevronLeft className="w-4 h-4" />All ways to add records</button><div><h2 className="text-xl font-serif">Quick entry</h2><p className="text-sm text-muted-foreground mt-1">Add one transaction. Use a minus amount for money going out.</p></div>
    {saved && <div className="p-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">Added to your records. Your figures have refreshed.</div>}
    {error && <div className="p-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg">{error}</div>}
    <div className="grid sm:grid-cols-2 gap-4"><div className="space-y-1"><Label>Date</Label><Input type="date" value={item.date} onChange={e => setItem({ ...item, date: e.target.value })} /></div><div className="space-y-1"><Label>Amount (£)</Label><Input type="number" placeholder="-50.00" value={item.amount} onChange={e => setItem({ ...item, amount: e.target.value })} /></div><div className="sm:col-span-2 space-y-1"><Label>Description</Label><Input value={item.description} placeholder="e.g. Client lunch" onChange={e => setItem({ ...item, description: e.target.value })} /></div><div className="space-y-1"><Label>Accounting category (optional)</Label><Select value={item.category} onChange={e => setItem({ ...item, category: e.target.value })}><option>General</option><option>Travel</option><option>Office</option><option>Sales</option><option>Entertainment</option></Select></div>{Number(item.amount) < 0 && <div className="space-y-1"><Label>Business use (%)</Label><Input type="number" min="0" max="100" value={item.allowablePercentage} onChange={e => setItem({ ...item, allowablePercentage: e.target.value })} /><p className="text-xs text-muted-foreground">Use 50% when only half of an expense is for the business.</p></div>}<div className="flex items-end"><Button disabled={saving} onClick={submit} className="w-full cursor-pointer">{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}Add transaction</Button></div></div>
  </Card>;
}

export default function AddRecords() {
  const { evidenceItems, inboxItems, activeProfileId, transactions, refreshData } = useStore();
  const [intake, setIntake] = useState<Intake>(null);
  const [resumeEvidence, setResumeEvidence] = useState<EvidenceItem | null>(null);
  const [unmatchedEvidenceIds, setUnmatchedEvidenceIds] = useState<Set<string> | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState('');
  const [showResumePanel, setShowResumePanel] = useState(true);
  const [attachTo, setAttachTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string; date: string; amount: string; description: string; category: string;
    source: string; accountingClassification: string; allowablePercentage: string;
  } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [attachError, setAttachError] = useState('');
  const attachInFlight = useRef(false);
  const pending = inboxItems.filter(i => i.status === 'pending').length;
  useEffect(() => {
    let cancelled = false;
    setUnmatchedEvidenceIds(null);
    if (!activeProfileId) return () => { cancelled = true; };
    evidenceApi.unmatched(activeProfileId)
      .then(items => {
        if (!cancelled) setUnmatchedEvidenceIds(new Set(items.map(item => item.id)));
      })
      .catch(() => {
        // Never show a confirmed document as awaiting review if the
        // server's authoritative active-link check is temporarily unavailable.
        if (!cancelled) setUnmatchedEvidenceIds(new Set());
      });
    return () => { cancelled = true; };
  }, [activeProfileId, evidenceItems]);
  const resumableEvidence = evidenceItems.filter(item =>
    (item.evidenceType === 'document' && item.documentLifecycle === 'active' && item.reviewState !== 'confirmed' &&
      (item.status === 'received' || item.status === 'processing' || item.status === 'error')) ||
    ((item.evidenceType === 'bank_csv' || item.evidenceType === 'ledger') && item.importStatus !== 'done'),
  );
  const reviewReadyEvidence = evidenceItems.filter(item =>
    item.evidenceType === 'document' && item.workflowVersion === 2 &&
    item.documentLifecycle === 'active' && unmatchedEvidenceIds?.has(item.id) &&
    (item.reviewState === 'review_required' || item.reviewState === 'reviewed'),
  );
  const startNewUpload = () => { setResumeEvidence(null); setIntake(null); setResumeError(''); setShowResumePanel(false); };
  const resumeUpload = (item: EvidenceItem) => {
    setResumeError('');
    setResumeEvidence(item);
    setIntake(item.evidenceType === 'document' ? 'document' : item.evidenceType === 'bank_csv' ? 'bank' : 'ledger');
  };
  const discardUpload = async (item: EvidenceItem) => {
    setDiscardingId(item.id); setResumeError('');
    try {
      await evidenceApi.discard(activeProfileId, item.id);
      await refreshData();
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'We could not discard that upload.');
    } finally { setDiscardingId(null); }
  };
  const attachReceipt = async (file: File) => {
    if (!attachTo || attachInFlight.current) return;
    attachInFlight.current = true; setAttaching(true); setAttachError('');
    try { const { objectPath } = await evidenceApi.uploadDirect(activeProfileId, file); const evidence = await evidenceApi.register(activeProfileId, { filename: file.name, objectPath, mimeType: file.type || 'application/octet-stream', category: 'receipt', evidenceType: 'document' }); await transactionsApi.attachEvidence(activeProfileId, attachTo, evidence.id); await refreshData(); setAttachTo(null); }
    catch { setAttachError('We could not attach that receipt. Please try again.'); }
    finally { attachInFlight.current = false; setAttaching(false); }
  };
  const saveEdit = async () => {
    if (!editing || !editing.description.trim() || !Number(editing.amount)) return;
    setSavingEdit(true);
    try {
      const amount = Number(editing.amount);
      await transactionsApi.update(activeProfileId, editing.id, {
        date: editing.date,
        amount,
        description: editing.description.trim(),
        category: editing.category,
        ...(editing.source === 'manual' ? { allowablePercentage: Number(editing.allowablePercentage) } : {}),
        ...(editing.source === 'bank_csv'
          ? { accountingClassification: editing.accountingClassification as 'income' | 'expense' | 'transfer' | 'owner_funds' | 'drawings' | 'loan' | 'tax_payment' | 'unknown' }
          : { taxTreatment: amount > 0 ? 'income' : 'deductible' }),
      });
      await refreshData();
      setEditing(null);
    } finally {
      setSavingEdit(false);
    }
  };
  const deleteRecord = async (id: string) => {
    if (!window.confirm('Remove this record from active Financial Memory? Imported records are audit-voided rather than erased.')) return;
    await transactionsApi.remove(activeProfileId, id);
    await refreshData();
  };
  return <div className="space-y-7 animate-in fade-in duration-500 max-w-5xl mx-auto pb-12">
    <div><h1 className="text-3xl font-serif">Add Records</h1><p className="text-muted-foreground mt-1 text-lg">Bring in the records that keep your financial picture current and defensible.</p></div>
    {pending > 0 && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800"><strong>{pending} item{pending !== 1 ? 's' : ''} need a decision.</strong> <Link href="/tasks" className="underline">Review them in Tasks</Link>.</div>}
    {resumableEvidence.length > 0 && !intake && showResumePanel && <Card className="border-primary/20 bg-primary/[.03] p-5 space-y-4">
      <div><h2 className="font-serif text-xl">Finish an upload</h2><p className="text-sm text-muted-foreground mt-1">We saved the unfinished upload so you can resume it after reopening the app.</p></div>
      <div className="space-y-3">{resumableEvidence.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-0"><p className="font-medium text-sm truncate">{item.filename}</p><p className="text-xs text-muted-foreground">{item.evidenceType === 'document' ? 'Receipt or invoice' : item.evidenceType === 'bank_csv' ? 'Bank export' : 'Spreadsheet or CSV'} · {item.importStatus === 'processing' || item.status === 'processing' ? 'Processing' : 'Needs finishing'}</p></div>
        <div className="flex gap-2"><Button size="sm" onClick={() => resumeUpload(item)} className="cursor-pointer">Resume</Button><Button size="sm" variant="outline" disabled={discardingId === item.id} onClick={() => void discardUpload(item)} className="cursor-pointer">{discardingId === item.id ? 'Discarding…' : 'Discard'}</Button></div>
      </div>)}</div>
      {resumeError && <p className="text-sm text-destructive">{resumeError}</p>}
      <Button variant="ghost" size="sm" onClick={startNewUpload} className="cursor-pointer">Start a new upload</Button>
    </Card>}
    {reviewReadyEvidence.length > 0 && !intake && <Card className="border-amber-200 bg-amber-50/50 p-5 space-y-3">
      <div><h2 className="font-serif text-xl">Documents ready for your review</h2><p className="text-sm text-muted-foreground mt-1">These are supporting documents only. Confirm a financial record only when the details are correct.</p></div>
      {reviewReadyEvidence.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-card p-3">
        <div><p className="font-medium text-sm">{item.filename}</p><p className="text-xs text-muted-foreground">{item.reviewState === 'reviewed' ? 'Review saved — financial record not yet confirmed' : 'Extraction ready for review'}</p></div>
        <Button size="sm" onClick={() => resumeUpload(item)}>Review document</Button>
      </div>)}
    </Card>}
    {!intake ? <><div className="grid sm:grid-cols-2 gap-4">{INTAKES.map(option => { const Icon = option.icon; return <button key={option.id} onClick={() => setIntake(option.id)} className="text-left border border-border rounded-xl p-5 bg-card hover:border-primary/40 hover:bg-primary/[.02] transition-all cursor-pointer"><div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4"><Icon className="w-5 h-5" /></div><h2 className="font-serif text-lg">{option.title}</h2><p className="text-sm text-muted-foreground mt-1">{option.text}</p><p className="text-xs text-primary mt-3">{option.note} →</p></button>; })}</div>
      <section><h2 className="text-xl font-serif mb-3">Recent records</h2><Card className="divide-y divide-border overflow-hidden">{transactions.length ? transactions.slice(0, 12).map(t => <div key={t.id} className="p-4 flex justify-between gap-4"><div className="min-w-0"><p className="font-medium text-sm truncate">{t.description}</p><div className="flex gap-2 items-center mt-1"><span className="text-xs text-muted-foreground">{new Date(t.date).toLocaleDateString('en-GB')} · {t.category}</span><TierBadge tier={t.evidenceTier} />{t.source === 'bank_csv' && (t.accountingClassification ?? 'unknown') === 'unknown' && <Badge variant="outline" className="text-[10px] py-0">Needs classification</Badge>}{(t.evidenceTier === 3 || t.evidenceTier === 4) && <button onClick={() => setAttachTo(t.id)} className="text-xs text-primary hover:underline">Attach receipt +</button>}{(t.source === 'manual' || t.source === 'bank_csv') && <><button onClick={() => setEditing({ id: t.id, date: t.date, amount: String(t.amount), description: t.description, category: t.category, source: t.source, accountingClassification: t.accountingClassification ?? 'unknown', allowablePercentage: String(t.allowablePercentage ?? 100) })} className="text-xs text-primary hover:underline">{t.source === 'bank_csv' ? 'Review' : 'Edit'}</button><button onClick={() => void deleteRecord(t.id)} className="text-xs text-destructive hover:underline">{t.source === 'bank_csv' ? 'Remove' : 'Delete'}</button></>}</div></div><div className="flex items-center gap-3"><span className={cn('font-semibold text-sm shrink-0', t.amount > 0 && 'text-emerald-600')}>{t.amount > 0 ? '+' : '−'}£{Math.abs(t.amount).toFixed(2)}</span>{(t.source === 'manual' || t.source === 'bank_csv') && <Pencil className="w-4 h-4 text-muted-foreground" />}</div></div>) : <div className="p-10 text-center text-muted-foreground"><Database className="w-8 h-8 mx-auto mb-2 opacity-30" />No records yet — choose a way to add your first one.</div>}</Card></section></> :
       intake === 'document' ? <DocumentFlow profileId={activeProfileId} refresh={refreshData} resumeEvidence={resumeEvidence} onBack={() => { setIntake(null); setResumeEvidence(null); }} /> :
      intake === 'manual' ? <ManualFlow onBack={() => setIntake(null)} /> :
        intake === 'bank' ? <BankImportFlow profileId={activeProfileId} refresh={refreshData} onBack={() => { setIntake(null); setResumeEvidence(null); }} /> :
        <BatchFlow kind="ledger" profileId={activeProfileId} refresh={refreshData} resumeEvidence={resumeEvidence} onBack={() => { setIntake(null); setResumeEvidence(null); }} />}
    {attachTo && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"><Card className="p-6 w-full max-w-md space-y-4"><h2 className="font-serif text-xl">Attach a receipt</h2><p className="text-sm text-muted-foreground">Adding an original receipt upgrades this record’s evidence quality.</p>{attaching ? <Loader2 className="animate-spin text-primary mx-auto" /> : <FilePicker accept=".pdf,.jpg,.jpeg,.png,.heic" onPick={attachReceipt} label="Choose receipt" />}{attachError && <p className="text-sm text-destructive">{attachError}</p>}<Button variant="outline" className="w-full" onClick={() => setAttachTo(null)}>Cancel</Button></Card></div>}
    {editing && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"><Card className="w-full max-w-lg space-y-4 p-6"><div><h2 className="font-serif text-xl">{editing.source === 'bank_csv' ? 'Review imported movement' : 'Edit manual record'}</h2><p className="mt-1 text-sm text-muted-foreground">{editing.source === 'bank_csv' ? 'Choose how this movement should affect your accounts. Transfers and owner movements remain outside profit and tax.' : 'Updating this record refreshes Financial Memory and tax figures.'}</p></div><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1"><span className="text-sm">Date</span><Input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></label><label className="space-y-1"><span className="text-sm">Amount (£)</span><Input type="number" value={editing.amount} onChange={e => setEditing({ ...editing, amount: e.target.value })} /></label><label className="space-y-1 sm:col-span-2"><span className="text-sm">Description</span><Input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>{editing.source === 'bank_csv' && <label className="space-y-1 sm:col-span-2"><span className="text-sm">Accounting classification</span><Select value={editing.accountingClassification} onChange={e => setEditing({ ...editing, accountingClassification: e.target.value })}><option value="unknown">Keep unreviewed</option><option value="income">Business income</option><option value="expense">Business expense</option><option value="transfer">Transfer between accounts</option><option value="owner_funds">Owner funds introduced</option><option value="drawings">Owner drawings</option><option value="loan">Loan movement</option><option value="tax_payment">Tax payment</option></Select></label>}<label className="space-y-1"><span className="text-sm">Category</span><Input value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} /></label>{editing.source === 'manual' && Number(editing.amount) < 0 && <label className="space-y-1"><span className="text-sm">Business use (%)</span><Input type="number" min="0" max="100" value={editing.allowablePercentage} onChange={e => setEditing({ ...editing, allowablePercentage: e.target.value })} /></label>}</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={savingEdit} onClick={() => void saveEdit()}>{savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}Save changes</Button></div></Card></div>}
  </div>;
}