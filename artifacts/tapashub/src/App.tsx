import * as React from "react"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, ClerkLoaded, ClerkLoading, Show } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation, Redirect } from 'wouter';
import { ThemeProvider } from '@/components/theme-provider';
// Lazy-load the sidebar/topbar shell so the entry chunk stays small and the app
// shell renders faster on mobile/slow networks.
const Layout = React.lazy(() => import('@/components/layout').then((m) => ({ default: m.Layout })));
import { CompanyProvider } from '@/contexts/company-context';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { MeetingProvider } from '@/contexts/meeting-context';
import { DmNotificationProvider } from '@/contexts/dm-notification-context';
import { AiTaskRealtimeProvider } from '@/contexts/ai-task-realtime-context';
import { ClerkQueryClientCacheInvalidator } from '@/components/clerk-cache-invalidator';
import { RouteErrorBoundary } from '@/components/error-boundary';

// Page components are code-split: each becomes its own chunk loaded on demand,
// so the initial bundle stays small and first paint is fast.
const Dashboard = React.lazy(() => import('@/pages/dashboard'));
const Companies = React.lazy(() => import('@/pages/companies'));
const CompanyDetail = React.lazy(() => import('@/pages/company-detail'));
const Orders = React.lazy(() => import('@/pages/orders'));
const Inventory = React.lazy(() => import('@/pages/inventory'));
const Finance = React.lazy(() => import('@/pages/finance'));
const FundAllocations = React.lazy(() => import('@/pages/fund-allocations'));
const Shareholders = React.lazy(() => import('@/pages/shareholders'));
const Analytics = React.lazy(() => import('@/pages/analytics'));
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
const AdminDashboard = React.lazy(() => import('@/pages/admin/dashboard'));
const Treasury = React.lazy(() => import('@/pages/treasury'));
const AiReports = React.lazy(() => import('@/pages/ai-reports'));
const AiTasks = React.lazy(() => import('@/pages/ai-tasks'));
const Chat = React.lazy(() => import('@/pages/chat'));
const Meetings = React.lazy(() => import('@/pages/meetings'));
const CallCenter = React.lazy(() => import('@/pages/call-center'));
const Planner = React.lazy(() => import('@/pages/planner'));
// Lazy-load the sign-in shell so the public landing page does not pay for the
// entire signed-in app bundle on first paint.
const SignInPage = React.lazy(() => import('@/pages/sign-in'));

// Prefetch the home dashboard chunk during idle time so the most common landing
// page feels instant when the user navigates to it.
if (typeof window !== 'undefined') {
  setTimeout(() => import('@/pages/dashboard'), 1500);
}

import { LoadingScreen } from '@/components/loading-screen';
import { OfflineBanner } from '@/components/offline-banner';
import { Button } from '@/components/ui/button';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data across mounts so navigating between pages doesn't refetch
      // everything every time; background-refresh once it goes stale.
      staleTime: 60_000, // 1 minute
      // Keep unused data for 30 min: on slow connections, revisiting a page
      // shows cached content instantly instead of a blank spinner.
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      // Re-fetch automatically once the connection comes back.
      refetchOnReconnect: true,
      // Retry transient failures a couple of times with exponential backoff,
      // which rides out brief drops on unreliable mobile networks.
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
    },
    // Mutations are intentionally NOT retried: a write can succeed server-side
    // and still fail client-side on a flaky connection, so an automatic retry
    // risks duplicate records/side effects. Users re-submit explicitly instead.
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

function SignInFallback() {
  return (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-background px-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

function SignInRoute() {
  return (
    <React.Suspense fallback={<SignInFallback />}>
      <SignInPage basePath={basePath} />
    </React.Suspense>
  );
}

// The app is invite-only: no public content, so signed-out users always land on
// the branded sign-in screen.
function AccessDenied() {
  const { accessMessage, logout } = useAuth();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <img src={`${basePath}/logo.svg`} alt="TAPBOSS" className="h-12 w-12" loading="lazy" decoding="async" />
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
      <img src={`${basePath}/logo.svg`} alt="TAPBOSS" className="h-12 w-12" loading="lazy" decoding="async" />
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
    <MeetingProvider>
    <DmNotificationProvider>
    <CompanyProvider>
    <AiTaskRealtimeProvider>
      <React.Suspense fallback={<PageFallback />}>
        <Switch>
          {/* Integrations has its own minimal layout (no sidebar) */}
          <Route path="/integrations" component={Integrations} />
          {/* All other pages use the full sidebar layout */}
          <Route>
            <Layout>
              <RouteErrorBoundary>
              <React.Suspense fallback={<PageFallback />}>
                <Switch>
                  <Route path="/" component={Dashboard} />
                  <Route path="/companies" component={Companies} />
                  <Route path="/companies/:id" component={CompanyDetail} />
                  <Route path="/orders" component={Orders} />
                  <Route path="/inventory" component={Inventory} />
                  <Route path="/finance" component={Finance} />
                  <Route path="/fund-allocation" component={FundAllocations} />
                  <Route path="/treasury" component={Treasury} />
                  <Route path="/shareholders" component={Shareholders} />
                  <Route path="/hr" component={HR} />
                  <Route path="/crm" component={CRM} />
                  <Route path="/approvals" component={Approvals} />
                  <Route path="/notifications" component={Notifications} />
                  <Route path="/ai-assistant" component={AiAssistant} />
                  <Route path="/director" component={DirectorPortal} />
                  <Route path="/settings" component={Settings} />
                  <Route path="/accounts" component={AccountDirectory} />
                  <Route path="/shipping" component={Shipping} />
                  <Route path="/documents" component={Documents} />
                  <Route path="/marketing" component={Marketing} />
                  <Route path="/admin/access" component={AccessControl} />
                  <Route path="/admin/audit" component={AuditLogs} />
                  <Route path="/admin/dashboard" component={AdminDashboard} />
                  <Route path="/ai-reports" component={AiReports} />
                  <Route path="/ai-tasks" component={AiTasks} />
                  <Route path="/chat" component={Chat} />
                  <Route path="/meetings" component={Meetings} />
                  <Route path="/call-center" component={CallCenter} />
                  <Route path="/planner" component={Planner} />
                  <Route path="/analytics" component={Analytics} />
                  <Route component={NotFound} />
                </Switch>
              </React.Suspense>
              </RouteErrorBoundary>
            </Layout>
          </Route>
        </Switch>
      </React.Suspense>
    </AiTaskRealtimeProvider>
    </CompanyProvider>
    </DmNotificationProvider>
    </MeetingProvider>
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
          <Route path="/sign-in/*?" component={SignInRoute} />
          <Route path="/sign-up/*?" component={SignInRoute} />
          <Route path="/login">{() => <Redirect to="/sign-in" />}</Route>
          <Route>
            {/* While Clerk fetches auth state from the proxy, render a full-screen
                spinner so the user never sees a blank white page on cold start. */}
            <ClerkLoading>
              <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background">
                <div className="mb-1 text-center">
                  <span className="text-2xl font-black tracking-tight text-foreground">TAPAS</span>
                  <span className="text-2xl font-black tracking-tight text-[#1d90e8]">HUB</span>
                </div>
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
              </div>
            </ClerkLoading>
            <ClerkLoaded>
              <Show when="signed-out"><Redirect to="/sign-in" /></Show>
              <Show when="signed-in"><AuthedApp /></Show>
            </ClerkLoaded>
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
          <OfflineBanner />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
