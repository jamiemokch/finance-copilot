import { Card, Button, Badge, Input, Label } from '@/components/ui';
import { useStore, ProfileType } from '@/lib/store';
import { UserCircle, Briefcase, Building2, Plus, ShieldCheck, Check } from 'lucide-react';
import { useState } from 'react';

export default function Settings() {
  const { profiles, activeProfileId, setActiveProfileId, addProfile, sharedContext, updateSharedContext } = useStore();
  
  const [isCreating, setIsCreating] = useState(false);
  const [newProfileType, setNewProfileType] = useState<ProfileType>('sole_trader');
  const [newProfileName, setNewProfileName] = useState('');

  const handleCreate = () => {
    if (newProfileName.trim()) {
      addProfile({ type: newProfileType, name: newProfileName });
      setIsCreating(false);
      setNewProfileName('');
    }
  };

  const getTypeIcon = (type: string) => {
    if (type === 'individual') return <UserCircle className="w-5 h-5 text-blue-500" />;
    if (type === 'company') return <Building2 className="w-5 h-5 text-purple-500" />;
    return <Briefcase className="w-5 h-5 text-amber-600" />;
  };

  const getTypeName = (type: string) => {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif text-foreground">Profile & Settings</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Manage your personal context and switch between different tax profiles.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-serif mb-4">Your Profiles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {profiles.map(profile => (
            <Card 
              key={profile.id} 
              className={`p-5 cursor-pointer transition-all border-2 ${activeProfileId === profile.id ? 'border-primary shadow-md bg-primary/5' : 'border-transparent hover:border-border shadow-sm'}`}
              onClick={() => setActiveProfileId(profile.id)}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-background rounded-full border border-border shadow-sm">
                    {getTypeIcon(profile.type)}
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{profile.name}</h3>
                    <p className="text-xs text-muted-foreground">{getTypeName(profile.type)}</p>
                  </div>
                </div>
                {activeProfileId === profile.id && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </div>
            </Card>
          ))}
          
          {!isCreating ? (
            <button 
              onClick={() => setIsCreating(true)}
              className="p-5 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:bg-secondary/30 transition-colors gap-2 h-full cursor-pointer"
            >
              <Plus className="w-6 h-6" />
              <span className="font-medium text-sm">Register new profile</span>
            </button>
          ) : (
            <Card className="p-5 shadow-sm border-primary/20 space-y-4">
              <h3 className="font-medium text-sm">New Profile</h3>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Type</Label>
                  <select 
                    className="w-full text-sm p-2 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={newProfileType}
                    onChange={(e) => setNewProfileType(e.target.value as ProfileType)}
                  >
                    <option value="sole_trader">Sole Trader</option>
                    <option value="landlord">Landlord</option>
                    <option value="company">Limited Company</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input 
                    placeholder="e.g. Graphic Design Business" 
                    value={newProfileName}
                    onChange={e => setNewProfileName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setIsCreating(false)} className="cursor-pointer">Cancel</Button>
                  <Button size="sm" onClick={handleCreate} disabled={!newProfileName} className="cursor-pointer">Create</Button>
                </div>
              </div>
            </Card>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          Financial data stays separated per profile, but uses your shared personal context below.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-serif mb-4">Shared Personal Context</h2>
        <Card className="p-6 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input 
                value={sharedContext.name} 
                onChange={e => updateSharedContext({ name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>National Insurance Number</Label>
              <Input 
                value={sharedContext.niNumber} 
                onChange={e => updateSharedContext({ niNumber: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Primary Address</Label>
              <Input 
                value={sharedContext.address} 
                onChange={e => updateSharedContext({ address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>UTR (Unique Taxpayer Reference)</Label>
              <Input 
                value={sharedContext.utr} 
                onChange={e => updateSharedContext({ utr: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button className="cursor-pointer">Save Changes</Button>
          </div>
        </Card>
      </section>
    </div>
  );
}