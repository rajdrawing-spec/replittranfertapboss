import * as React from "react";
import { SignIn } from "@clerk/react";

export default function SignInPage({ basePath }: { basePath: string }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
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
    </div>
  );
}
