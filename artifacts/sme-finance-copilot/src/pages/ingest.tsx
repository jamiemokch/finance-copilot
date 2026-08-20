import { Card, Button, Input, Label, Select, Badge } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useState } from 'react';
import { UploadCloud, CheckCircle2, FileText, Plus, Database, Loader2 } from 'lucide-react';

export default function Ingest() {
  const { transactions, addTransaction } = useStore();
  const [isSimulatingUpload, setIsSimulatingUpload] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);

  const [manualItem, setManualItem] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    category: 'General'
  });

  const handleSimulateUpload = () => {
    setIsSimulatingUpload(true);
    setTimeout(() => {
      setIsSimulatingUpload(false);
      setUploadComplete(true);
      
      addTransaction({ date: '2024-03-12', description: 'Train to Manchester', amount: -85.50, category: 'Travel', source: 'receipt' });
      addTransaction({ date: '2024-03-14', description: 'Stationery Supplies', amount: -12.99, category: 'Office', source: 'receipt' });
      
      setTimeout(() => setUploadComplete(false), 3000);
    }, 2000);
  };

  const handleAddManual = () => {
    if (manualItem.description && manualItem.amount) {
      addTransaction({
        date: manualItem.date,
        description: manualItem.description,
        amount: parseFloat(manualItem.amount),
        category: manualItem.category,
        source: 'manual'
      });
      setManualItem({ ...manualItem, description: '', amount: '' });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Ingest Data</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Bring in your financial records. The copilot will parse, categorise, and reconcile them automatically against your Financial Memory.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="p-8 flex flex-col items-center justify-center text-center space-y-6 border-dashed border-2 border-primary/30 bg-primary/5">
          <div className="w-20 h-20 bg-background shadow-sm text-primary rounded-full flex items-center justify-center">
            {isSimulatingUpload ? (
              <Loader2 className="w-10 h-10 animate-spin" />
            ) : uploadComplete ? (
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            ) : (
              <UploadCloud className="w-10 h-10" />
            )}
          </div>
          <div>
            <h3 className="font-serif text-xl font-semibold">Upload Bank CSV or Receipts</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
              Drag and drop your files here. We extract dates, amounts, and infer tax categories instantly.
            </p>
          </div>
          <Button 
            variant={uploadComplete ? "outline" : "default"}
            onClick={handleSimulateUpload} 
            disabled={isSimulatingUpload}
            className="cursor-pointer w-full max-w-xs"
            size="lg"
          >
            {isSimulatingUpload ? 'Extracting & Reconciling...' : uploadComplete ? 'Upload Successful' : 'Simulate Upload Prototype'}
          </Button>
        </Card>

        <Card className="p-6 space-y-6">
          <div className="border-b border-border pb-4">
            <h3 className="font-serif text-xl font-semibold flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Manual Entry
            </h3>
            <p className="text-sm text-muted-foreground mt-1">For cash expenses or out-of-pocket items.</p>
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={manualItem.date} onChange={e => setManualItem({...manualItem, date: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Amount (£)</Label>
                <Input type="number" placeholder="-50.00" value={manualItem.amount} onChange={e => setManualItem({...manualItem, amount: e.target.value})} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="e.g. Client Dinner at Dishoom" value={manualItem.description} onChange={e => setManualItem({...manualItem, description: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Category Override</Label>
              <Select value={manualItem.category} onChange={e => setManualItem({...manualItem, category: e.target.value})}>
                <option value="Sales">Sales (Income)</option>
                <option value="Travel">Travel</option>
                <option value="Office">Office & Software</option>
                <option value="Entertainment">Entertainment</option>
                <option value="General">General Expense</option>
              </Select>
            </div>
            <Button className="w-full cursor-pointer mt-2" size="lg" onClick={handleAddManual}>
              Add Transaction
            </Button>
          </div>
        </Card>
      </div>

      <div className="pt-4">
        <h2 className="text-xl font-serif font-semibold mb-4">Recent Transactions</h2>
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {transactions.slice(0, 8).map(t => (
              <div key={t.id} className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
                    {t.source === 'bank' ? <Database className="w-5 h-5" /> : t.source === 'manual' ? <Plus className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-muted-foreground">{new Date(t.date).toLocaleDateString('en-GB')}</p>
                      <span className="text-[10px] text-muted-foreground capitalize bg-secondary px-1.5 py-0.5 rounded">Source: {t.source}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`font-bold ${t.amount > 0 ? 'text-emerald-600' : 'text-foreground'}`}>
                    {t.amount > 0 ? '+' : ''}£{Math.abs(t.amount).toFixed(2)}
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground border-border">{t.category}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
