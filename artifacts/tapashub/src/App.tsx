import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ThemeProvider } from '@/components/theme-provider';
import { Layout } from '@/components/layout';

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

const queryClient = new QueryClient();

function Router() {
  return (
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
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="tbos-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
