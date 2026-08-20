import { Link } from 'wouter';
import { Button } from '@/components/ui';
import { BrainCircuit } from 'lucide-react';

export default function Welcome() {
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
          <Link href="/onboarding" className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-12 px-8 w-full text-lg">
            Get Started
          </Link>
          <p className="text-xs text-muted-foreground bg-amber-100 text-amber-800 p-2 rounded-lg">
            Prototype mode: Uses fictional sample data. Not connected to HMRC or any banks.
          </p>
        </div>
      </div>
    </div>
  );
}
