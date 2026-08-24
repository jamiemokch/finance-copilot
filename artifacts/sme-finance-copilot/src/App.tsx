import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from 'wouter';

import { StoreProvider, useStore } from '@/lib/store';
import { getAuthSurface } from '@/lib/auth-routing';
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
import FinancialMemory from '@/pages/financial-memory';
import TaxEstimate from '@/pages/tax-estimate';
import SelfAssessmentReadiness from '@/pages/self-assessment-readiness';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading, profiles, profilesLoaded, profileLoadError } = useStore();
  const authSurface = getAuthSurface({
    location,
    isLoading,
    isAuthenticated,
    profilesCount: profiles.length,
    profilesLoaded,
    profileLoadError,
  });

  // Block while auth resolves
  if (authSurface === 'loading') return null;

  // Block while authenticated — profile list is still loading from API
  if (authSurface === 'profile-error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="font-serif text-2xl text-foreground">We couldn’t load your businesses</h1>
        <p className="text-muted-foreground">Your data has not been changed. Check your connection and try again.</p>
        <button className="w-fit rounded-lg bg-primary px-4 py-2 text-primary-foreground" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  const isPublicRoute = location === '/' || location === '/welcome';

  // ── Unauthenticated ──────────────────────────────────────────────────────────
  if (authSurface === 'welcome') {
    // Lock all non-public routes to Welcome
    if (!isPublicRoute) return <Redirect to="/" />;
    return (
      <Switch>
        <Route path="/" component={Welcome} />
        <Route path="/welcome" component={Welcome} />
        <Route component={Welcome} />
      </Switch>
    );
  }

  // ── Authenticated, no profile → onboarding ───────────────────────────────────
  if (authSurface === 'onboarding') {
    if (location !== '/onboarding') return <Redirect to="/onboarding" />;
    return <Onboarding />;
  }

  // ── Authenticated with profile, on a public/onboarding route → dashboard ─────
  if (authSurface === 'dashboard') {
    return <Redirect to="/dashboard" />;
  }

  // ── Authenticated with profile → full app ─────────────────────────────────────
  return (
    <Layout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/position" component={Position} />
          <Route path="/business-ideas" component={BusinessIdeas} />
          <Route path="/decisions" component={BusinessIdeas} />
          <Route path="/tax" component={TaxEstimate} />
          <Route path="/tax-readiness" component={SelfAssessmentReadiness} />
          <Route path="/optimisation" component={BusinessIdeas} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/compliance" component={Tasks} />
          <Route path="/inbox" component={Tasks} />
          <Route path="/year-end" component={Tasks} />
          <Route path="/exceptions" component={Tasks} />
          <Route path="/copilot" component={Copilot} />
          <Route path="/settings" component={Settings} />
          <Route path="/memory/:entryId" component={FinancialMemory} />
          <Route path="/memory" component={FinancialMemory} />
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
