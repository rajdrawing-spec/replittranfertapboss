import * as React from "react"
import { useAuth } from "@/contexts/auth-context"
import { useLocation } from "wouter"
import { Eye, EyeOff, LogIn, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function Login() {
  const { login, user } = useAuth()
  const [, setLocation] = useLocation()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPass, setShowPass] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    if (user) setLocation("/")
  }, [user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      await login(email.trim(), password)
      setLocation("/")
    } catch (err: any) {
      setError(err.message || "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center px-4">
      {/* Background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-white rounded-2xl p-3 shadow-2xl mb-4">
            <img src="/tapashub-logo.png" alt="TapasHub" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">TapasHub TBOS</h1>
          <p className="text-sm text-slate-400 mt-1">Business Operating System</p>
        </div>

        {/* Card */}
        <div className="bg-[#111827] border border-[#1E293B] rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-1">Sign in to your account</h2>
          <p className="text-sm text-slate-400 mb-6">Enter your credentials to access your workspace</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-sm text-red-300">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300 text-sm">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@tapashub.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="bg-[#0F172A] border-[#1E293B] text-white placeholder:text-slate-600 focus:border-blue-500 h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300 text-sm">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="bg-[#0F172A] border-[#1E293B] text-white placeholder:text-slate-600 focus:border-blue-500 h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn className="w-4 h-4" />
                  Sign In
                </span>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-[#1E293B]">
            <p className="text-xs text-slate-500 text-center">Default password for all accounts: <span className="text-slate-300 font-mono">Admin@123</span></p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          © {new Date().getFullYear()} TapasHub Holdings Pvt. Ltd. · Confidential
        </p>
      </div>
    </div>
  )
}
