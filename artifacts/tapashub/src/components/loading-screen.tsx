import * as React from "react"

/**
 * Branded loading screen shown only while the session is genuinely being
 * resolved. It uses an *indeterminate* progress bar (no fake percentage timer),
 * so it never pretends to make progress and disappears the instant readiness is
 * known.
 */
export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#09090B] flex items-center justify-center relative overflow-hidden">
      {/* ambient glow */}
      <div className="absolute w-[500px] h-[500px] rounded-full bg-blue-600/20 blur-[120px] animate-pulse" />
      <div className="absolute w-[300px] h-[300px] rounded-full bg-indigo-500/10 blur-[100px] -translate-x-40 translate-y-32" />

      <div className="relative flex flex-col items-center gap-6 px-8">
        {/* animated logo */}
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-blue-500/30 blur-xl animate-pulse" />
          <div className="relative bg-white rounded-2xl p-3 shadow-2xl animate-[float_2.5s_ease-in-out_infinite]">
            <img src="/tapashub-logo.png" alt="TAPBOSS" className="w-14 h-14 object-contain" />
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">TAPBOSS</h1>
          <p className="text-xs text-white/40 mt-1 tracking-wide">TapasHub Business Operating System</p>
        </div>

        {/* indeterminate progress bar */}
        <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full animate-[indeterminate_1.2s_ease-in-out_infinite]" />
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes indeterminate {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </div>
  )
}
