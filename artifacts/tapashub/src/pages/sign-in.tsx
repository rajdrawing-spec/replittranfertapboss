import * as React from "react";
import { SignIn, useClerk } from "@clerk/react";

/** Shown while Clerk processes the SSO callback (OAuth redirect handling).
 *  Without this, the <SignIn> component renders nothing visible during that
 *  window and the user sees a completely blank white page. */
function SsoCallbackOverlay() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4">
      <div className="mb-1 text-center">
        <span className="text-3xl font-black tracking-tight text-foreground">TAPAS</span>
        <span className="text-3xl font-black tracking-tight text-[#1d90e8]">HUB</span>
      </div>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}

export default function SignInPage({ basePath }: { basePath: string }) {
  // Detect SSO callback path so we can show a spinner instead of the blank
  // state that Clerk renders while it exchanges the OAuth code for a session.
  const isSsoCallback = typeof window !== "undefined" &&
    window.location.pathname.includes("/sso-callback");

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      {isSsoCallback ? (
        // The <SignIn> component still needs to be rendered (it handles the
        // OAuth exchange internally), but we layer a visible overlay on top so
        // the user sees something other than a blank white page.
        <div className="relative w-full">
          {/* Spinner overlay — stays visible while Clerk silently processes the
              OAuth code. The <SignIn> is rendered (mounted) but visually covered. */}
          <div className="absolute inset-0 z-10">
            <SsoCallbackOverlay />
          </div>
          <div className="invisible">
            <SignIn
              routing="path"
              path={`${basePath}/sign-in`}
              signUpUrl={`${basePath}/sign-up`}
            />
          </div>
        </div>
      ) : (
        <div className="w-full max-w-[420px]">
          <div className="mb-8 text-center">
            <img
              src={`${basePath}/tapashub-logo.png`}
              alt="TapasHub"
              className="mx-auto mb-4 h-20 w-20 object-contain"
            />
            <div className="mb-1">
              <span className="text-3xl font-black tracking-tight text-foreground">TAPAS</span>
              <span className="text-3xl font-black tracking-tight text-[#1d90e8]">HUB</span>
            </div>
            <p className="text-base font-semibold text-foreground">Welcome to TapasHub Business OS</p>
            <p className="mt-1 text-sm text-muted-foreground">Connect · Empower · Grow · invite-only access</p>
          </div>
          <SignIn
            routing="path"
            path={`${basePath}/sign-in`}
            signUpUrl={`${basePath}/sign-up`}
          />
        </div>
      )}
    </div>
  );
}
