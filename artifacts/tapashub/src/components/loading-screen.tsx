import * as React from "react"

const MESSAGES = [
  "Loading your workspace…",
  "Syncing business data…",
  "Securing the vault…",
  "Preparing dashboard…",
]

export function LoadingScreen() {
  const [progress, setProgress] = React.useState(8)
  const [msgIndex, setMsgIndex] = React.useState(0)

  React.useEffect(() => {
    const p = setInterval(() => {
      setProgress((v) => (v >= 95 ? 95 : v + Math.random() * 12))
    }, 300)
    const m = setInterval(() => {
      setMsgIndex((i) => (i + 1) % MESSAGES.length)
    }, 1100)
    return () => { clearInterval(p); clearInterval(m) }
  }, [])

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

        {/* progress bar */}
        <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="text-sm text-white/50 h-5 transition-opacity duration-500">{MESSAGES[msgIndex]}</p>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  )
}
