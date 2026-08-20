import { Card, Button, Badge } from '@/components/ui';
import { useStore } from '@/lib/store';
import { ShieldCheck, HardDrive, AlertTriangle, User } from 'lucide-react';

export default function Settings() {
  const { profileType, setProfileType } = useStore();

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Settings & Data</h1>
        <p className="text-muted-foreground mt-1">
          Manage your prototype preferences and data privacy.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-2">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <User className="w-5 h-5" /> Profile Type
          </h3>
          <p className="text-sm text-muted-foreground">
            Changing this will update how the Copilot contextualises your data.
          </p>
        </div>
        <Card className="p-6 md:col-span-2 space-y-4">
          <div className="space-y-4">
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-secondary/30 transition-colors">
                <input 
                  type="radio" 
                  name="profile" 
                  checked={profileType === 'individual'} 
                  onChange={() => setProfileType('individual')}
                  className="w-4 h-4 text-primary"
                />
                <div>
                  <div className="font-medium text-sm">Individual</div>
                  <div className="text-xs text-muted-foreground">Personal tax, PAYE</div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-lg border border-primary bg-primary/5 cursor-pointer">
                <input 
                  type="radio" 
                  name="profile" 
                  checked={profileType === 'sole_trader'} 
                  onChange={() => setProfileType('sole_trader')}
                  className="w-4 h-4 text-primary"
                />
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">Sole Trader / Landlord <Badge variant="secondary" className="text-[10px]">Active</Badge></div>
                  <div className="text-xs text-muted-foreground">Self-assessment, VAT</div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-secondary/30 transition-colors">
                <input 
                  type="radio" 
                  name="profile" 
                  checked={profileType === 'micro_company'} 
                  onChange={() => setProfileType('micro_company')}
                  className="w-4 h-4 text-primary"
                />
                <div>
                  <div className="font-medium text-sm">Micro Limited Co</div>
                  <div className="text-xs text-muted-foreground">Corp tax, dividends</div>
                </div>
              </label>
            </div>
          </div>
        </Card>

        <div className="md:col-span-1 space-y-2">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Data Safety
          </h3>
          <p className="text-sm text-muted-foreground">
            How your financial data is handled.
          </p>
        </div>
        <Card className="p-6 md:col-span-2 space-y-6">
          <div className="bg-amber-100/50 border border-amber-200 p-4 rounded-lg flex gap-3 text-amber-900">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="text-sm space-y-1">
              <p className="font-semibold">Prototype Mode Active</p>
              <p>This is a frontend-only prototype. Your data is fictional, lives entirely in your browser's memory, and will reset if you refresh the page. There is no backend, no real AI processing, and no connection to HMRC or Open Banking.</p>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Clear Local Data</p>
                <p className="text-xs text-muted-foreground mt-1">Reset all fictional data and start fresh.</p>
              </div>
              <Button variant="destructive" className="cursor-pointer" onClick={() => window.location.reload()}>Reset Prototype</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
