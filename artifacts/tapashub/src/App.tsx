import * as React from "react"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ThemeProvider } from '@/components/theme-provider';
import { Layout } from '@/components/layout';
import { CompanyProvider } from '@/contexts/company-context';
import { AuthProvider, useAuth } from '@/contexts/auth-context';

import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Companies from '@/pages/companies';
import CompanyDetail from '@/pages/company-detail';
import Orders from '@/pages/orders';
import Inventory from '@/pages/inventory';
import Finance from '@/pages/finance';
import HR from '@/pages/hr';
import CRM from '@/pages/crm';
import Approvals from '@/pages/approvals';
import Notifications from '@/pages/notifications';
import AiAssistant from '@/pages/ai-assistant';
import Settings from '@/pages/settings';
import Integrations from '@/pages/integrations';
import DirectorPortal from '@/pages/director';
import Vault from '@/pages/vault';
import Shipping from '@/pages/shipping';
import Documents from '@/pages/documents';
import Marketing from '@/pages/marketing';
import Platforms from '@/pages/platforms';
import { LoadingScreen } from '@/components/loading-screen';

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const [, setLocation] = useLocation()

  React.useEffect(() => {
    if (!loading && !user) setLocation('/login')
  }, [user, loading])

  if (loading) return <LoadingScreen />
  if (!user) return null
  return <>{children}</>
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route>
        <AuthGuard>
          <CompanyProvider>
            <Layout>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/companies" component={Companies} />
                <Route path="/companies/:id" component={CompanyDetail} />
                <Route path="/orders" component={Orders} />
                <Route path="/inventory" component={Inventory} />
                <Route path="/finance" component={Finance} />
                <Route path="/hr" component={HR} />
                <Route path="/crm" component={CRM} />
                <Route path="/approvals" component={Approvals} />
                <Route path="/notifications" component={Notifications} />
                <Route path="/ai-assistant" component={AiAssistant} />
                <Route path="/integrations" component={Integrations} />
                <Route path="/director" component={DirectorPortal} />
                <Route path="/settings" component={Settings} />
                <Route path="/vault" component={Vault} />
                <Route path="/shipping" component={Shipping} />
                <Route path="/documents" component={Documents} />
                <Route path="/marketing" component={Marketing} />
                <Route path="/platforms" component={Platforms} />
                {/* Subsidiary-specific stubs */}
                <Route path="/reports" component={Finance} />
                <Route path="/analytics" component={Dashboard} />
                <Route path="/veterinary" component={HR} />
                <Route path="/community" component={CRM} />
                <Route path="/collections" component={Inventory} />
                <Route path="/lookbook" component={Inventory} />
                <Route path="/catalog" component={Inventory} />
                <Route path="/services" component={Orders} />
                <Route component={NotFound} />
              </Switch>
            </Layout>
          </CompanyProvider>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="tbos-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
