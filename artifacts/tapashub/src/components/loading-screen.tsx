import * as React from "react"

/**
 * Branded loading screen shown while the session is being resolved.
 * Uses an indeterminate progress bar — no fake percentages.
 */
export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#08080d] flex items-center justify-center relative overflow-hidden">
      {/* Ambient glow layers — clamp to viewport so they never overflow on mobile. */}
      <div className="absolute w-[80vw] h-[80vw] max-w-[600px] max-h-[600px] rounded-full bg-violet-600/15 blur-[140px] animate-pulse" />
      <div className="absolute w-[60vw] h-[60vw] max-w-[400px] max-h-[400px] rounded-full bg-blue-600/10 blur-[110px] -translate-x-52 translate-y-32" />
      <div className="absolute w-[50vw] h-[50vw] max-w-[300px] max-h-[300px] rounded-full bg-indigo-400/8 blur-[90px] translate-x-64 -translate-y-24" />

      {/* Decorative grid */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,.4) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.4) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative flex flex-col items-center gap-7 px-8 text-center max-w-sm">

        {/* Logo with glow ring */}
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-violet-500/40 blur-2xl scale-110 animate-pulse" />
          <div className="relative bg-gradient-to-br from-white to-gray-100 rounded-2xl p-3.5 shadow-2xl animate-[float_3s_ease-in-out_infinite]">
            {/* TapasHub "A" triangle logo */}
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="56" height="56" rx="12" fill="white" />
              {/* Outer triangle */}
              <path d="M28 6 L50 46 L6 46 Z" fill="#1a1a2e" />
              {/* Inner keyhole / arch cutout */}
              <path d="M28 18 L38 38 L18 38 Z" fill="white" />
              <circle cx="28" cy="26" r="5" fill="#1a1a2e" />
            </svg>
          </div>
        </div>

        {/* Brand name */}
        <div>
          <div className="flex items-baseline justify-center gap-1.5 mb-1">
            <span className="text-3xl font-black text-white tracking-[-0.03em]">TAPAS</span>
            <span className="text-3xl font-black text-violet-400 tracking-[-0.03em]">HUB</span>
          </div>
          <div className="text-[11px] font-semibold text-white/40 tracking-[0.22em] uppercase mb-2">
            CONNECT · EMPOWER · GROW
          </div>
          <div className="text-sm text-white/50 font-light">Business Operating System</div>
        </div>

        {/* Welcome message */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-base font-semibold text-white/85">Welcome back 👋</div>
          <div className="text-xs text-white/35">Loading your workspace…</div>
        </div>

        {/* Indeterminate progress bar */}
        <div className="w-60 flex flex-col items-center gap-2">
          <div className="w-full h-[3px] bg-white/8 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-violet-500 via-indigo-400 to-blue-500 rounded-full animate-[indeterminate_1.4s_cubic-bezier(0.65,0,0.35,1)_infinite]" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-[dot_1.4s_ease-in-out_infinite]" />
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-[dot_1.4s_ease-in-out_0.2s_infinite]" />
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-[dot_1.4s_ease-in-out_0.4s_infinite]" />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        @keyframes indeterminate {
          0%   { transform: translateX(-130%); }
          100% { transform: translateX(340%); }
        }
        @keyframes dot {
          0%, 80%, 100% { opacity: .25; transform: scale(0.75); }
          40%            { opacity: 1;   transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
