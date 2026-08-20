import { useLocation } from 'wouter';
import { Button, Card } from '@/components/ui';
import { useStore, ProfileType } from '@/lib/store';
import { User, Briefcase, Building } from 'lucide-react';

export default function Onboarding() {
  const { setProfileType } = useStore();
  const [, setLocation] = useLocation();

  const handleSelect = (type: ProfileType) => {
    setProfileType(type);
    setLocation('/dashboard');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-3xl w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-serif font-bold text-foreground">How do you operate?</h1>
          <p className="text-muted-foreground">We'll tailor your copilot to your specific UK tax and compliance needs.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card 
            className="p-6 cursor-pointer hover:border-primary transition-all hover:-translate-y-1 flex flex-col items-center text-center space-y-4 hover:shadow-md group"
            onClick={() => handleSelect('individual')}
          >
            <div className="p-4 bg-secondary rounded-full text-secondary-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <User className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Individual</h3>
              <p className="text-sm text-muted-foreground mt-2">Personal tax, PAYE, and simple investments.</p>
            </div>
          </Card>

          <Card 
            className="p-6 cursor-pointer border-primary shadow-sm hover:shadow-md transition-all hover:-translate-y-1 flex flex-col items-center text-center space-y-4 ring-2 ring-primary ring-offset-2 ring-offset-background"
            onClick={() => handleSelect('sole_trader')}
          >
            <div className="p-4 bg-primary text-primary-foreground rounded-full">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Sole Trader / Landlord</h3>
              <p className="text-sm text-muted-foreground mt-2">Self-assessment, VAT, and property income.</p>
            </div>
            <div className="mt-auto pt-4 text-xs font-medium text-primary">
              Demo Default Profile
            </div>
          </Card>

          <Card 
            className="p-6 cursor-pointer hover:border-primary transition-all hover:-translate-y-1 flex flex-col items-center text-center space-y-4 hover:shadow-md group"
            onClick={() => handleSelect('micro_company')}
          >
            <div className="p-4 bg-secondary rounded-full text-secondary-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Building className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Micro Limited Co</h3>
              <p className="text-sm text-muted-foreground mt-2">Director payroll, corporation tax, and dividends.</p>
            </div>
          </Card>
        </div>
        
        <div className="text-center pt-8">
          <Button variant="ghost" onClick={() => setLocation('/welcome')} className="cursor-pointer">
            Back to Start
          </Button>
        </div>
      </div>
    </div>
  );
}
