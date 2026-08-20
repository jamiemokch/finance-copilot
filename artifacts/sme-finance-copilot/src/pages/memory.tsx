import { Card, Badge, Button, Input, Label, Select } from '@/components/ui';
import { useStore, MemoryItem } from '@/lib/store';
import { useState } from 'react';
import { Plus, Check, Edit2, ShieldCheck, HelpCircle, AlertCircle } from 'lucide-react';

export default function Memory() {
  const { memories, updateMemory, addMemory } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  
  const [isAdding, setIsAdding] = useState(false);
  const [newItem, setNewItem] = useState<Partial<MemoryItem>>({ category: 'business', confidence: 'high', source: 'Manual Entry' });

  const handleEdit = (item: MemoryItem) => {
    setEditingId(item.id);
    setEditValue(item.value);
  };

  const handleSave = (id: string) => {
    updateMemory(id, editValue);
    setEditingId(null);
  };

  const handleAdd = () => {
    if (newItem.title && newItem.value && newItem.category) {
      addMemory(newItem as Omit<MemoryItem, 'id'>);
      setIsAdding(false);
      setNewItem({ category: 'business', confidence: 'high', source: 'Manual Entry' });
    }
  };

  const grouped = memories.reduce((acc, curr) => {
    if (!acc[curr.category]) acc[curr.category] = [];
    acc[curr.category].push(curr);
    return acc;
  }, {} as Record<string, MemoryItem[]>);

  const categoryNames = {
    personal: 'Personal Context',
    business: 'Business Context',
    property: 'Property Details',
    tax: 'Tax Status'
  };

  const getConfidenceIcon = (confidence: string) => {
    if (confidence === 'high') return <ShieldCheck className="w-3 h-3 text-emerald-600" />;
    if (confidence === 'medium') return <HelpCircle className="w-3 h-3 text-amber-500" />;
    return <AlertCircle className="w-3 h-3 text-red-500" />;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Financial Memory</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            The complete context of your financial life. The copilot uses this to personalise advice, infer tax categories, and minimise repetitive questions.
          </p>
        </div>
        <Button onClick={() => setIsAdding(!isAdding)} className="gap-2 cursor-pointer shrink-0">
          <Plus className="w-4 h-4" /> Add Memory
        </Button>
      </div>

      {isAdding && (
        <Card className="p-6 border-primary bg-primary/5 animate-in slide-in-from-top-4">
          <h3 className="font-semibold mb-4 text-lg">Add New Context</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select 
                value={newItem.category} 
                onChange={(e) => setNewItem({...newItem, category: e.target.value as any})}
              >
                <option value="personal">Personal</option>
                <option value="business">Business</option>
                <option value="property">Property</option>
                <option value="tax">Tax</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fact Title</Label>
              <Input 
                placeholder="e.g. Spouse Income Band" 
                value={newItem.title || ''}
                onChange={(e) => setNewItem({...newItem, title: e.target.value})}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Value / Detail</Label>
              <Input 
                placeholder="e.g. Basic Rate (20%)" 
                value={newItem.value || ''}
                onChange={(e) => setNewItem({...newItem, value: e.target.value})}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setIsAdding(false)} className="cursor-pointer">Cancel</Button>
            <Button onClick={handleAdd} className="cursor-pointer">Save Memory</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {(Object.entries(grouped) as [string, MemoryItem[]][]).map(([category, items]) => (
          <div key={category} className="space-y-4">
            <h2 className="text-xl font-serif font-semibold border-b border-border pb-2 text-primary">
              {categoryNames[category as keyof typeof categoryNames] || category}
            </h2>
            <div className="space-y-3">
              {items.map(item => (
                <Card key={item.id} className="p-4 flex flex-col gap-2 hover:border-primary/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="font-medium text-sm text-muted-foreground">{item.title}</div>
                    <Badge variant="outline" className="text-[10px] font-normal gap-1 bg-secondary/50">
                      {getConfidenceIcon(item.confidence)}
                      {item.source}
                    </Badge>
                  </div>
                  
                  {editingId === item.id ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Input 
                        value={editValue} 
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-9 text-base"
                        autoFocus
                      />
                      <Button size="icon" className="h-9 w-9 shrink-0 cursor-pointer bg-primary text-primary-foreground" onClick={() => handleSave(item.id)}>
                        <Check className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center group mt-1">
                      <div className="font-semibold text-base text-foreground leading-snug">{item.value}</div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-muted-foreground hover:text-primary"
                        onClick={() => handleEdit(item)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
