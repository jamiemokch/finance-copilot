import { Button, Card, Input, Label, Select } from '@/components/ui';
import { useStore, type TransactionItem } from '@/lib/store';
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';

type RecordType = 'income' | 'expense';
type FormValues = {
  date: string;
  recordType: RecordType;
  description: string;
  amount: string;
  category: string;
  note: string;
};

const categories: Record<RecordType, { value: string; label: string }[]> = {
  income: [
    { value: 'sales', label: 'Sales or services' },
    { value: 'other_income', label: 'Other business income' },
  ],
  expense: [
    { value: 'travel', label: 'Travel and mileage' },
    { value: 'office_software', label: 'Office, phone and software' },
    { value: 'materials', label: 'Materials and stock' },
    { value: 'professional_fees', label: 'Professional fees and insurance' },
    { value: 'marketing', label: 'Advertising and marketing' },
    { value: 'equipment', label: 'Equipment and tools' },
    { value: 'other_expense', label: 'Other business expense' },
  ],
};

function currentTaxYear() {
  const today = new Date();
  const startYear = today.getUTCMonth() > 3 || (today.getUTCMonth() === 3 && today.getUTCDate() >= 6)
    ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return { label: `${startYear}/${String(startYear + 1).slice(-2)}`, start: `${startYear}-04-06`, end: `${startYear + 1}-04-05` };
}

function emptyForm(): FormValues {
  const taxYear = currentTaxYear();
  return { date: new Date().toISOString().slice(0, 10), recordType: 'expense', description: '', amount: '', category: 'travel', note: '' };
}

function toForm(record: TransactionItem): FormValues {
  const recordType: RecordType = record.recordType ?? (record.amount >= 0 ? 'income' : 'expense');
  return {
    date: record.date,
    recordType,
    description: record.description,
    amount: Math.abs(record.amount).toFixed(2),
    category: record.category,
    note: record.note ?? '',
  };
}

export default function AddRecords() {
  const { activeProfileId, transactions, addTransaction, updateTransaction, deleteTransaction } = useStore();
  const taxYear = useMemo(currentTaxYear, []);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const records = transactions.filter(record => record.source === 'manual');

  const chooseType = (recordType: RecordType) => {
    setForm(current => ({ ...current, recordType, category: categories[recordType][0].value }));
  };
  const change = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setForm(current => ({ ...current, [key]: value }));
  const reset = () => {
    setForm(emptyForm());
    setEditingId(null);
    setStatus('idle');
    setMessage('');
  };
  const submit = async () => {
    const amount = Number(form.amount);
    if (!activeProfileId) { setStatus('error'); setMessage('Your business profile is still loading. Please try again.'); return; }
    if (!form.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setStatus('error'); setMessage('Enter a description and an amount greater than £0.'); return;
    }
    if (form.date < taxYear.start || form.date > taxYear.end) {
      setStatus('error'); setMessage(`Choose a date in the current ${taxYear.label} tax year.`); return;
    }
    setStatus('saving'); setMessage('');
    const values = { ...form, description: form.description.trim(), amount, note: form.note.trim() || undefined };
    try {
      if (editingId) {
        await updateTransaction(editingId, values);
        setMessage('Record updated and your list has refreshed.');
      } else {
        await addTransaction(values);
        setMessage('Record saved and added to your list.');
      }
      setStatus('success');
      setForm(emptyForm());
      setEditingId(null);
    } catch {
      setStatus('error');
      setMessage('We could not save this record. Please try again.');
    }
  };
  const edit = (record: TransactionItem) => {
    setForm(toForm(record));
    setEditingId(record.id);
    setStatus('idle');
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const remove = async (record: TransactionItem) => {
    if (!window.confirm(`Delete “${record.description}”? This cannot be undone.`)) return;
    try {
      await deleteTransaction(record.id);
      if (editingId === record.id) reset();
    } catch {
      setStatus('error');
      setMessage('We could not delete this record. Please try again.');
    }
  };

  return <div className="max-w-4xl mx-auto space-y-7 pb-12">
    <div>
      <h1 className="text-3xl font-serif">Add Records</h1>
      <p className="text-muted-foreground mt-1">Add your income and expenses for the current UK tax year ({taxYear.label}).</p>
    </div>

    <Card className="p-6 shadow-sm space-y-5">
      <div><h2 className="text-xl font-serif">{editingId ? 'Edit record' : 'Add a record'}</h2><p className="text-sm text-muted-foreground mt-1">Use a positive amount. We’ll record it as income or an expense based on your choice.</p></div>
      {status === 'success' && <div className="rounded-lg p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex gap-2"><CheckCircle2 className="w-5 h-5 shrink-0" />{message}</div>}
      {status === 'error' && <div className="rounded-lg p-3 bg-red-50 border border-red-200 text-red-800 text-sm">{message}</div>}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 space-y-2"><Label>Record type</Label><div className="flex gap-2"><Button type="button" variant={form.recordType === 'income' ? 'default' : 'outline'} onClick={() => chooseType('income')}>Income</Button><Button type="button" variant={form.recordType === 'expense' ? 'default' : 'outline'} onClick={() => chooseType('expense')}>Expense</Button></div></div>
        <div className="space-y-1"><Label>Date</Label><Input type="date" min={taxYear.start} max={taxYear.end} value={form.date} onChange={event => change('date', event.target.value)} /></div>
        <div className="space-y-1"><Label>Amount (£)</Label><Input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={event => change('amount', event.target.value)} /></div>
        <div className="sm:col-span-2 space-y-1"><Label>Description</Label><Input value={form.description} placeholder={form.recordType === 'income' ? 'e.g. Website design work' : 'e.g. Train to client meeting'} onChange={event => change('description', event.target.value)} /></div>
        <div className="space-y-1"><Label>Category</Label><Select value={form.category} onChange={event => change('category', event.target.value)}>{categories[form.recordType].map(category => <option key={category.value} value={category.value}>{category.label}</option>)}</Select></div>
        <div className="space-y-1"><Label>Note <span className="text-muted-foreground">(optional)</span></Label><Input value={form.note} placeholder="Anything useful to remember" onChange={event => change('note', event.target.value)} /></div>
      </div>
      <div className="flex flex-wrap gap-3"><Button disabled={status === 'saving'} onClick={submit} className="cursor-pointer">{editingId ? <Pencil className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}{status === 'saving' ? 'Saving…' : editingId ? 'Save changes' : 'Save record'}</Button>{editingId && <Button variant="outline" onClick={reset}>Cancel edit</Button>}</div>
    </Card>

    <section>
      <div className="flex items-end justify-between gap-4 mb-3"><div><h2 className="text-xl font-serif">Your records</h2><p className="text-sm text-muted-foreground">Saved to your business profile and available after you sign in again.</p></div><div className="flex items-center gap-3"><Link href="/memory" className="text-sm text-primary font-medium hover:underline">View Financial Memory</Link><span className="text-sm text-muted-foreground">{records.length} record{records.length === 1 ? '' : 's'}</span></div></div>
      <Card className="divide-y divide-border overflow-hidden">
        {records.length ? records.map(record => <div key={record.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${record.recordType === 'income' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{record.recordType === 'income' ? 'Income' : 'Expense'}</span><span className="text-xs text-muted-foreground">{new Date(record.date).toLocaleDateString('en-GB')}</span></div><p className="font-medium mt-1">{record.description}</p><p className="text-xs text-muted-foreground mt-1">{record.category.replaceAll('_', ' ')}{record.note ? ` · ${record.note}` : ''}</p></div>
          <div className="flex items-center gap-3"><span className={`font-semibold ${record.recordType === 'income' ? 'text-emerald-700' : ''}`}>{record.recordType === 'income' ? '+' : '−'}£{Math.abs(record.amount).toFixed(2)}</span><Button variant="ghost" size="icon" aria-label={`Edit ${record.description}`} onClick={() => edit(record)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="icon" aria-label={`Delete ${record.description}`} onClick={() => remove(record)}><Trash2 className="w-4 h-4 text-destructive" /></Button></div>
        </div>) : <div className="p-10 text-center text-muted-foreground">No saved records yet. Add your first income or expense above.</div>}
      </Card>
    </section>
  </div>;
}