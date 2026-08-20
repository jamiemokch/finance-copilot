import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { StoreProvider } from '@/lib/store';
import { Layout } from '@/components/layout';

import Welcome from '@/pages/welcome';
import Onboarding from '@/pages/onboarding';
import Dashboard from '@/pages/dashboard';
import Memory from '@/pages/memory';
import Ingest from '@/pages/ingest';
import Copilot from '@/pages/copilot';
import Optimisation from '@/pages/optimisation';
import Exceptions from '@/pages/exceptions';
import YearEnd from '@/pages/year-end';
import Pack from '@/pages/pack';
import Match from '@/pages/match';
import Settings from '@/pages/settings';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();

  // Pages that don't use the shell layout
  if (location === '/welcome' || location === '/onboarding' || location === '/') {
    return (
      <Switch>
        <Route path="/" component={Welcome} />
        <Route path="/welcome" component={Welcome} />
        <Route path="/onboarding" component={Onboarding} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  // App pages wrapped in Layout
  return (
    <Layout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/memory" component={Memory} />
          <Route path="/ingest" component={Ingest} />
          <Route path="/copilot" component={Copilot} />
          <Route path="/optimisation" component={Optimisation} />
          <Route path="/exceptions" component={Exceptions} />
          <Route path="/year-end" component={YearEnd} />
          <Route path="/pack" component={Pack} />
          <Route path="/match" component={Match} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Layout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <StoreProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </StoreProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
