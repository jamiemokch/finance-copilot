import { Badge, Button, Card } from '@/components/ui';
import { evidenceApi, transactionsApi, type APIEvidenceItem, type APITransaction } from '@/lib/api';
import { useStore, type TransactionItem } from '@/lib/store';
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, FileText, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';

function money(amount: number) {
  return `${amount >= 0 ? '+' : '−'}£${Math.abs(amount).toFixed(2)}`;
}

function readableCategory(category: string) {
  return category.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function readableSource(source: string) {
  if (source === 'manual') return 'Manual entry';
  return source.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatDate(value?: string) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed);
}

function formatTimestamp(value?: string) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function recordType(record: Pick<TransactionItem, 'amount' | 'recordType'>) {
  if (record.recordType === 'income' || record.recordType === 'expense') {
    return record.recordType;
  }
  return 'unreviewed';
}

function RecordBadge({ type }: { type: 'income' | 'expense' | 'unreviewed' }) {
  if (type === 'unreviewed') {
    return <Badge variant="outline">Needs classification</Badge>;
  }
  return <Badge variant={type === 'income' ? 'success' : 'warning'}>{type === 'income' ? 'Income' : 'Expense'}</Badge>;
}

export default function FinancialMemory() {
  const [location, navigate] = useLocation();
  const { activeProfileId, transactions, refreshData } = useStore();
  const entryId = useMemo(() => {
    const match = location.match(/^\/memory\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location]);
  const [entry, setEntry] = useState<APITransaction | null>(null);
  const [loading, setLoading] = useState(Boolean(entryId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [unmatchedEvidence, setUnmatchedEvidence] = useState<APIEvidenceItem[]>([]);

  useEffect(() => {
    if (entryId) return;
    setError('');
    setRefreshing(true);
    refreshData().catch(() => setError('We could not refresh your financial records. Please try again.'))
      .finally(() => setRefreshing(false));
  }, [entryId, refreshData]);

  useEffect(() => {
    if (!entryId || !activeProfileId) {
      setEntry(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    transactionsApi.get(activeProfileId, entryId)
      .then(result => { if (!cancelled) setEntry(result); })
      .catch(() => {
        if (!cancelled) {
          setEntry(null);
          setError('This record is unavailable to this business profile.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeProfileId, entryId]);

  useEffect(() => {
    if (!activeProfileId || entryId) { setUnmatchedEvidence([]); return; }
    let cancelled = false;
    evidenceApi.unmatched(activeProfileId)
      .then(items => { if (!cancelled) setUnmatchedEvidence(items); })
      .catch(() => { if (!cancelled) setUnmatchedEvidence([]); });
    return () => { cancelled = true; };
  }, [activeProfileId, entryId, refreshing]);

  // Bank CSV movements are durable Financial Memory records immediately, but
  // remain visibly unreviewed until a person assigns their accounting meaning.
  const records = transactions;

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await refreshData();
      const items = await evidenceApi.unmatched(activeProfileId);
      setUnmatchedEvidence(items);
    } catch {
      setError('We could not refresh your financial records. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  if (entryId) {
    if (loading) {
      return <div className="max-w-3xl mx-auto"><Card className="p-8 text-sm text-muted-foreground">Loading financial record…</Card></div>;
    }
    if (!entry) {
      return <div className="max-w-3xl mx-auto space-y-4"><Button variant="outline" onClick={() => navigate('/memory')}><ArrowLeft className="w-4 h-4 mr-2" />Back to Financial Memory</Button><Card className="p-8"><h1 className="font-serif text-2xl">Record unavailable</h1><p className="text-muted-foreground mt-2">{error || 'This record could not be found.'}</p></Card></div>;
    }

    const type = recordType(entry);
    return <div className="max-w-3xl mx-auto space-y-5">
      <Button variant="outline" onClick={() => navigate('/memory')}><ArrowLeft className="w-4 h-4 mr-2" />Back to Financial Memory</Button>
      <div>
        <p className="text-sm font-medium text-primary">Financial Memory</p>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-1"><h1 className="font-serif text-3xl">{entry.description}</h1><span className={`text-2xl font-semibold ${type === 'income' ? 'text-emerald-700' : type === 'expense' ? 'text-amber-700' : 'text-slate-700'}`}>{money(entry.amount)}</span></div>
      </div>
      <Card className="p-6 space-y-6">
        <div className="flex items-center gap-3"><RecordBadge type={type} /><span className="text-sm text-muted-foreground">{formatDate(entry.date)}</span></div>
        <dl className="grid gap-5 sm:grid-cols-2 text-sm">
          <div><dt className="text-muted-foreground">Category</dt><dd className="font-medium mt-1">{readableCategory(entry.category)}</dd></div>
          <div><dt className="text-muted-foreground">How it was added</dt><dd className="font-medium mt-1">{readableSource(entry.source)}</dd></div>
          <div><dt className="text-muted-foreground">Recorded</dt><dd className="font-medium mt-1">{formatTimestamp(entry.createdAt)}</dd></div>
          <div><dt className="text-muted-foreground">Last updated</dt><dd className="font-medium mt-1">{formatTimestamp(entry.updatedAt ?? entry.createdAt)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">Note</dt><dd className="font-medium mt-1">{entry.note?.trim() || 'No note added.'}</dd></div>
        </dl>
      </Card>
      <p className="text-xs text-muted-foreground">This is a durable record in your business’s Financial Memory.</p>
    </div>;
  }

  return <div className="max-w-4xl mx-auto space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-medium text-primary">Financial Memory</p><h1 className="font-serif text-3xl mt-1">Your financial records</h1><p className="text-muted-foreground mt-2">A lasting record of the movements, income, and expenses saved to this business profile.</p></div>
      <Button variant="outline" disabled={refreshing} onClick={refresh}><RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? 'Refreshing…' : 'Refresh records'}</Button>
    </div>
    {error && <Card className="p-4 text-sm text-destructive">{error}</Card>}
    <Card className="divide-y divide-border overflow-hidden">
      {records.length ? records.map(record => {
        const type = recordType(record);
        return <Link key={record.id} href={`/memory/${record.id}`} className="block p-4 hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><RecordBadge type={type} /><span className="text-xs text-muted-foreground inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{formatDate(record.date)}</span></div><p className="font-medium mt-2 truncate">{record.description}</p><p className="text-sm text-muted-foreground mt-1">{readableCategory(record.category)}{record.note ? ` · ${record.note}` : ''}</p></div>
            <div className="flex shrink-0 items-center gap-3"><span className={`font-semibold ${type === 'income' ? 'text-emerald-700' : type === 'expense' ? 'text-amber-700' : 'text-slate-700'}`}>{money(record.amount)}</span><ChevronRight className="w-5 h-5 text-muted-foreground" /></div>
          </div>
        </Link>;
      }) : <div className="p-10 text-center"><Clock3 className="w-6 h-6 text-muted-foreground mx-auto mb-3" /><h2 className="font-medium">No financial records yet</h2><p className="text-sm text-muted-foreground mt-1">Add your first income or expense to start your Financial Memory.</p><Button className="mt-4" onClick={() => navigate('/ingest')}>Add a record</Button></div>}
    </Card>
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4"><h2 className="font-serif text-xl">Supporting documents awaiting a financial link</h2><p className="mt-1 text-sm text-muted-foreground">These files are safely stored as evidence, but they do not change income, expenses, profit, tax, or Financial Memory until you explicitly confirm or link a transaction.</p></div>
      {unmatchedEvidence.length ? <div className="divide-y divide-border">{unmatchedEvidence.map(document => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex min-w-0 gap-3"><FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><p className="truncate font-medium">{document.filename}</p><p className="mt-1 text-xs text-muted-foreground">{document.reviewState === 'reviewed' ? 'Review saved — not posted' : document.reviewState === 'review_required' ? 'Ready to review — not posted' : 'Waiting for extraction'} · Uploaded {formatTimestamp(document.uploadedAt)}</p></div></div><Button size="sm" variant="outline" onClick={() => navigate('/ingest')}>Review document</Button></div>)}</div> : <div className="p-5 text-sm text-muted-foreground">No unmatched supporting documents for this profile.</div>}
    </Card>
    <p className="text-xs text-muted-foreground">{records.length} saved record{records.length === 1 ? '' : 's'} for this business profile.</p>
  </div>;
}