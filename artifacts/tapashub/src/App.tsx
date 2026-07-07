import * as React from "react"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, SignIn, Show } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation, Redirect } from 'wouter';
import { ThemeProvider } from '@/components/theme-provider';
import { Layout } from '@/components/layout';
import { CompanyProvider } from '@/contexts/company-context';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { ClerkQueryClientCacheInvalidator } from '@/components/clerk-cache-invalidator';

// Page components are code-split: each becomes its own chunk loaded on demand,
// so the initial bundle stays small and first paint is fast.
const Dashboard = React.lazy(() => import('@/pages/dashboard'));
const Companies = React.lazy(() => import('@/pages/companies'));
const CompanyDetail = React.lazy(() => import('@/pages/company-detail'));
const Orders = React.lazy(() => import('@/pages/orders'));
const Inventory = React.lazy(() => import('@/pages/inventory'));
const Finance = React.lazy(() => import('@/pages/finance'));
const FundAllocations = React.lazy(() => import('@/pages/fund-allocations'));
const HR = React.lazy(() => import('@/pages/hr'));
const CRM = React.lazy(() => import('@/pages/crm'));
const Approvals = React.lazy(() => import('@/pages/approvals'));
const Notifications = React.lazy(() => import('@/pages/notifications'));
const AiAssistant = React.lazy(() => import('@/pages/ai-assistant'));
const Settings = React.lazy(() => import('@/pages/settings'));
const Integrations = React.lazy(() => import('@/pages/integrations'));
const DirectorPortal = React.lazy(() => import('@/pages/director'));
const AccountDirectory = React.lazy(() => import('@/pages/account-directory'));
const Shipping = React.lazy(() => import('@/pages/shipping'));
const Documents = React.lazy(() => import('@/pages/documents'));
const Marketing = React.lazy(() => import('@/pages/marketing'));
const AccessControl = React.lazy(() => import('@/pages/admin/access-control'));
const AuditLogs = React.lazy(() => import('@/pages/admin/audit-logs'));
import { LoadingScreen } from '@/components/loading-screen';
import { Button } from '@/components/ui/button';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data across mounts so navigating between pages doesn't refetch
      // everything every time; background-refresh once it goes stale.
      staleTime: 60_000, // 1 minute
      gcTime: 5 * 60_000, // keep unused data 5 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Lightweight fallback shown while a route chunk loads — never a blank screen.
function PageFallback() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

// REQUIRED — copy verbatim.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
// REQUIRED — copy verbatim. Empty in dev, auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "hsl(var(--primary))",
    colorForeground: "hsl(var(--foreground))",
    colorMutedForeground: "hsl(var(--muted-foreground))",
    colorDanger: "hsl(var(--destructive))",
    colorBackground: "hsl(var(--card))",
    colorInput: "hsl(var(--background))",
    colorInputForeground: "hsl(var(--foreground))",
    colorNeutral: "hsl(var(--border))",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "0.6rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card border border-border rounded-2xl w-[420px] max-w-full overflow-hidden shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground text-xl font-bold",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButton: "border border-border bg-background hover:bg-muted transition-colors",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground",
    formFieldInput: "bg-background border border-border text-foreground",
    formButtonPrimary: "bg-primary text-primary-foreground hover:opacity-90",
    footerActionText: "text-muted-foreground",
    footerActionLink: "text-primary hover:opacity-80",
    dividerText: "text-muted-foreground",
    dividerLine: "bg-border",
    identityPreviewEditButton: "text-primary",
    logoImage: "h-10 w-10",
  },
};

function AuthShell() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2">
            <img src={`${basePath}/logo.svg`} alt="TAPBOSS" className="h-10 w-10" />
            <span className="text-2xl font-bold tracking-tight">TAPBOSS</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Business Operating System · invite-only access</p>
        </div>
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
        />
      </div>
    </div>
  );
}

// The app is invite-only: no public content, so signed-out users always land on
// the branded sign-in screen.
function AccessDenied() {
  const { accessMessage, logout } = useAuth();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <img src={`${basePath}/logo.svg`} alt="TAPBOSS" className="h-12 w-12" />
      <h1 className="text-2xl font-bold">Access restricted</h1>
      <p className="max-w-md text-muted-foreground">
        {accessMessage || "You have not been invited to this workspace. Contact your administrator."}
      </p>
      <Button variant="outline" onClick={() => logout()}>Sign out</Button>
    </div>
  );
}

function ProfileError() {
  const { refetch, logout } = useAuth();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <img src={`${basePath}/logo.svg`} alt="TAPBOSS" className="h-12 w-12" />
      <h1 className="text-2xl font-bold">Couldn't load your profile</h1>
      <p className="max-w-md text-muted-foreground">
        We couldn't reach the server to load your account. Check your connection and try again.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => refetch()}>Retry</Button>
        <Button variant="outline" onClick={() => logout()}>Sign out</Button>
      </div>
    </div>
  );
}

function AuthedApp() {
  const { loading, user, accessError, loadError } = useAuth();
  if (loading) return <LoadingScreen />;
  if (accessError) return <AccessDenied />;
  if (loadError) return <ProfileError />;
  if (!user) return <LoadingScreen />;

  return (
    <CompanyProvider>
      <Layout>
        <React.Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/companies" component={Companies} />
          <Route path="/companies/:id" component={CompanyDetail} />
          <Route path="/orders" component={Orders} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/finance" component={Finance} />
          <Route path="/fund-allocation" component={FundAllocations} />
          <Route path="/hr" component={HR} />
          <Route path="/crm" component={CRM} />
          <Route path="/approvals" component={Approvals} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/ai-assistant" component={AiAssistant} />
          <Route path="/integrations" component={Integrations} />
          <Route path="/director" component={DirectorPortal} />
          <Route path="/settings" component={Settings} />
          <Route path="/accounts" component={AccountDirectory} />
          <Route path="/shipping" component={Shipping} />
          <Route path="/documents" component={Documents} />
          <Route path="/marketing" component={Marketing} />
          <Route path="/platforms" component={Integrations} />
          <Route path="/admin/access" component={AccessControl} />
          <Route path="/admin/audit" component={AuditLogs} />
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
        </React.Suspense>
      </Layout>
    </CompanyProvider>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <AuthProvider>
        <Switch>
          <Route path="/sign-in/*?" component={AuthShell} />
          <Route path="/sign-up/*?" component={AuthShell} />
          <Route path="/login">{() => <Redirect to="/sign-in" />}</Route>
          <Route>
            <Show when="signed-out"><Redirect to="/sign-in" /></Show>
            <Show when="signed-in"><AuthedApp /></Show>
          </Route>
        </Switch>
      </AuthProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="tbos-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <ClerkProviderWithRoutes />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
