import { Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import { BrainCircuit } from 'lucide-react';

export default function Welcome() {
  const { login } = useStore();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center">
            <BrainCircuit className="w-8 h-8" />
          </div>
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-serif font-bold text-foreground">SME Finance Copilot</h1>
          <p className="text-lg text-muted-foreground">
            A calm, plain-English financial co-pilot for UK individuals and micro-businesses.
            Your trusted second brain for finance.
          </p>
        </div>
        <div className="pt-8 space-y-4">
          <Button
            size="lg"
            className="w-full text-lg h-12 cursor-pointer"
            onClick={login}
          >
            Get Started — Sign in with Replit
          </Button>
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-lg">
            Alpha-lite: real data, real AI analysis, fictional demo transactions pre-loaded.
            Not connected to HMRC or any bank feeds.
          </p>
        </div>
      </div>
    </div>
  );
}
