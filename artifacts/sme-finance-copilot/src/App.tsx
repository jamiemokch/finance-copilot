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
import Position from '@/pages/position';
import BusinessIdeas from '@/pages/business-ideas';
import Tasks from '@/pages/tasks';
import Ingest from '@/pages/ingest';
import Copilot from '@/pages/copilot';
import Match from '@/pages/match';
import Settings from '@/pages/settings';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();

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

  return (
    <Layout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/position" component={Position} />
          {/* Business Ideas — merges old /decisions and /tax */}
          <Route path="/business-ideas" component={BusinessIdeas} />
          <Route path="/decisions" component={BusinessIdeas} />
          <Route path="/tax" component={BusinessIdeas} />
          <Route path="/optimisation" component={BusinessIdeas} />
          {/* Tasks — merges old /compliance, /inbox, /year-end */}
          <Route path="/tasks" component={Tasks} />
          <Route path="/compliance" component={Tasks} />
          <Route path="/inbox" component={Tasks} />
          <Route path="/year-end" component={Tasks} />
          <Route path="/exceptions" component={Tasks} />
          {/* Other */}
          <Route path="/copilot" component={Copilot} />
          <Route path="/settings" component={Settings} />
          <Route path="/memory" component={Position} />
          <Route path="/ingest" component={Ingest} />
          <Route path="/match" component={Match} />
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
