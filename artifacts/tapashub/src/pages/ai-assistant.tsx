import { useState, useRef, useEffect } from "react"
import {
  useAiChat, useRunAiAnalysis, useGetAiAnalysisCached, useRunAiExecutive,
  getGetAiAnalysisCachedQueryKey
} from "@workspace/api-client-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Bot, User, Send, Sparkles, Database, RefreshCw, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, AlertTriangle, Zap, Target, Brain, CheckCircle2, Clock,
  BarChart3, Globe, ShieldAlert
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = "chat" | "bi" | "reports"
type BiSection = "swot" | "growth" | "market"
type Message = {
  role: 'user' | 'assistant';
  content: string;
  dataPoints?: { label: string, value: string }[];
}

interface PredictionItem {
  metric: string; horizon: number; value: number
  confidenceScore: number; riskLevel: string
  supportingFactors: string[]; recommendedActions: string[]
}
interface AiPredictions {
  id: number; companyId: number; provider: string
  predictions: PredictionItem[]; createdAt: string
}
interface CompetitorItem {
  name: string; strength: string; weakness: string; marketPosition: string
}
interface MarketRecommendation {
  type: string; title: string; description: string; priority: string
}
interface AiMarketAnalysis {
  id: number; companyId: number; provider: string
  industryDemand: string | null
  competitorAnalysis: CompetitorItem[]
  recommendations: MarketRecommendation[]
  createdAt: string
}

// ── Report types ─────────────────────────────────────────────────────────────
interface AiReportSchedule {
  id: number; companyId: number | null; type: string; enabled: boolean
  recipientEmails: string[]; lastRunAt: string | null; nextRunAt: string | null; createdAt: string
}
interface AiReportHistory {
  id: number; companyId: number | null; scheduleId: number | null
  type: string; status: string; subject: string; aiSummary: string | null
  recipientCount: number; errorMessage: string | null; sentAt: string | null; createdAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SUGGESTED_PROMPTS = [
  "Summarize net profit across all subsidiaries this month",
  "Which products are low on stock?",
  "Show me the lead pipeline conversion rate",
  "Are there any overdue vendor payments?"
]
const EXECUTIVE_PROMPTS = [
  "Where is our biggest revenue leak right now?",
  "Which subsidiary should we invest more capital into?",
  "What is the single highest-ROI action we can take this quarter?",
  "Which cost centres can be trimmed without operational impact?"
]

const METRIC_LABELS: Record<string, string> = {
  revenue: "Revenue", profit: "Profit", cash_flow: "Cash Flow",
  valuation: "Valuation", headcount: "Headcount",
}
const REC_TYPE_COLORS: Record<string, string> = {
  launch: "bg-green-500/10 text-green-400 border-green-500/20",
  enter: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  discontinue: "bg-red-500/10 text-red-400 border-red-500/20",
  pricing: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  operational: "bg-amber-500/10 text-amber-400 border-amber-500/20",
}
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
  high:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  medium:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low:      "bg-muted text-muted-foreground",
}

function priorityColor(p: string) {
  if (p === "critical") return "destructive"
  if (p === "high") return "warning"
  if (p === "medium") return "secondary"
  return "outline"
}

function inr(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`
  return `₹${Math.round(n).toLocaleString("en-IN")}`
}
function formatMetricValue(metric: string, value: number) {
  return metric === "headcount" ? String(Math.round(value)) : inr(value)
}

// ── Growth Predictions Panel ──────────────────────────────────────────────────
function GrowthPredictionsPanel({ companyId }: { companyId: number }) {
  const qc = useQueryClient()
  const predKey = ["/api/ai/predictions", companyId]

  const { data: cached, isLoading: cacheLoading } = useQuery<AiPredictions | null>({
    queryKey: predKey,
    queryFn: () => adminApi.get(`/ai/predictions/${companyId}`),
  })

  const runPred = useMutation<AiPredictions, Error, boolean>({
    mutationFn: (force: boolean) =>
      adminApi.post(`/ai/predictions/${companyId}${force ? "?force=true" : ""}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: predKey }),
  })

  const data: AiPredictions | null | undefined = runPred.data ?? cached
  const horizons = [3, 6, 12]
  const metrics  = ["revenue", "profit", "cash_flow", "valuation", "headcount"]

  const cell = (metric: string, horizon: number) => {
    const p = data?.predictions.find(p => p.metric === metric && p.horizon === horizon)
    if (!p) return <td key={horizon} className="px-3 py-2 text-muted-foreground text-center">—</td>
    const riskColor = p.riskLevel === "high" ? "text-red-400" : p.riskLevel === "medium" ? "text-amber-400" : "text-green-400"
    return (
      <td key={horizon} className="px-3 py-2 text-center">
        <div className="font-semibold text-sm">{formatMetricValue(p.metric, p.value)}</div>
        <div className="flex items-center justify-center gap-1 mt-0.5">
          <Badge variant="outline" className="text-[9px] py-0 px-1">{p.confidenceScore}% confidence</Badge>
          <span className={cn("text-[9px]", riskColor)}>{p.riskLevel} risk</span>
        </div>
      </td>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            AI Growth Predictions
          </CardTitle>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(data.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                <Badge variant="outline" className="text-[9px] ml-1">AI estimate</Badge>
              </span>
            )}
            {data ? (
              <Button size="sm" variant="outline" onClick={() => runPred.mutate(true)} disabled={runPred.isPending} className="h-7 text-xs gap-1">
                <RefreshCw className={cn("w-3 h-3", runPred.isPending && "animate-spin")} /> Refresh
              </Button>
            ) : (
              <Button size="sm" onClick={() => runPred.mutate(false)} disabled={runPred.isPending || cacheLoading} className="h-7 text-xs gap-1.5">
                {runPred.isPending ? <Sparkles className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                {cacheLoading ? "Loading…" : "Run Predictions"}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">3, 6, and 12-month AI forecasts with confidence scores. <span className="text-amber-400">AI estimate — not financial advice.</span></p>
      </CardHeader>
      <CardContent>
        {(cacheLoading || runPred.isPending) && (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        )}
        {!data && !cacheLoading && !runPred.isPending && (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Click "Run Predictions" to generate 3/6/12-month AI forecasts
          </div>
        )}
        {data && !runPred.isPending && (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground">3 Months</th>
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground">6 Months</th>
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground">12 Months</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(metric => (
                    <tr key={metric} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{METRIC_LABELS[metric] ?? metric}</td>
                      {horizons.map(h => cell(metric, h))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recommended actions from the first few predictions */}
            {data.predictions.some(p => p.recommendedActions.length > 0) && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Key Recommended Actions</div>
                <ul className="space-y-1">
                  {Array.from(
                    new Set(data.predictions.flatMap(p => p.recommendedActions).slice(0, 6))
                  ).map((action, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                      <ChevronRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Market & Competitors Panel ────────────────────────────────────────────────
function MarketAnalysisPanel({ companyId }: { companyId: number }) {
  const qc = useQueryClient()
  const marketKey = ["/api/ai/market", companyId]

  const { data: cached, isLoading: cacheLoading } = useQuery<AiMarketAnalysis | null>({
    queryKey: marketKey,
    queryFn: () => adminApi.get(`/ai/market/${companyId}`),
  })

  const runMarket = useMutation<AiMarketAnalysis, Error, boolean>({
    mutationFn: (force: boolean) =>
      adminApi.post(`/ai/market/${companyId}${force ? "?force=true" : ""}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: marketKey }),
  })

  const data: AiMarketAnalysis | null | undefined = runMarket.data ?? cached

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Market & Competitor Intelligence
          </CardTitle>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(data.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                <Badge variant="outline" className="text-[9px] ml-1">AI estimate</Badge>
              </span>
            )}
            {data ? (
              <Button size="sm" variant="outline" onClick={() => runMarket.mutate(true)} disabled={runMarket.isPending} className="h-7 text-xs gap-1">
                <RefreshCw className={cn("w-3 h-3", runMarket.isPending && "animate-spin")} /> Refresh
              </Button>
            ) : (
              <Button size="sm" onClick={() => runMarket.mutate(false)} disabled={runMarket.isPending || cacheLoading} className="h-7 text-xs gap-1.5">
                {runMarket.isPending ? <Sparkles className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                {cacheLoading ? "Loading…" : "Run Analysis"}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Industry demand, competitor positioning, and product/market recommendations. <span className="text-amber-400">AI estimate.</span></p>
      </CardHeader>
      <CardContent>
        {(cacheLoading || runMarket.isPending) && (
          <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        )}
        {!data && !cacheLoading && !runMarket.isPending && (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <Globe className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Click "Run Analysis" to generate market intelligence
          </div>
        )}
        {data && !runMarket.isPending && (
          <div className="space-y-5">
            {/* Industry demand */}
            {data.industryDemand && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3" /> Industry Demand
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed bg-muted/30 rounded-lg p-3">
                  {data.industryDemand}
                </p>
              </div>
            )}

            {/* Competitor analysis */}
            {data.competitorAnalysis.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <ShieldAlert className="w-3 h-3" /> Competitor Analysis
                </div>
                <div className="space-y-2">
                  {data.competitorAnalysis.map((c, i) => (
                    <div key={i} className="rounded-lg border p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{c.marketPosition}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-green-400 mb-0.5">Strength</div>
                        <div className="text-xs text-muted-foreground">{c.strength}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-red-400 mb-0.5">Weakness</div>
                        <div className="text-xs text-muted-foreground">{c.weakness}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {data.recommendations.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Target className="w-3 h-3" /> Prioritised Recommendations
                </div>
                <div className="space-y-2">
                  {data.recommendations
                    .sort((a, b) => ["critical","high","medium","low"].indexOf(a.priority) - ["critical","high","medium","low"].indexOf(b.priority))
                    .map((r, i) => (
                      <div key={i} className="rounded-lg border p-3 flex items-start gap-3">
                        <div className="flex flex-col items-start gap-1 shrink-0">
                          <Badge variant="outline" className={cn("text-[9px] py-0 px-1.5", PRIORITY_COLORS[r.priority])}>{r.priority}</Badge>
                          <Badge variant="outline" className={cn("text-[9px] py-0 px-1.5", REC_TYPE_COLORS[r.type] ?? "")}>{r.type}</Badge>
                        </div>
                        <div>
                          <div className="text-sm font-medium">{r.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AiAssistant() {
  const { activeCompany, companies } = useCompany()
  const [tab, setTab] = useState<Tab>("chat")
  const [biSection, setBiSection] = useState<BiSection>("swot")
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hello. I am the TAPBOSS AI Assistant. I have full context of all subsidiaries, including realtime finance, inventory, and CRM data. How can I help you today?"
    }
  ])
  const [input, setInput] = useState("")
  const [execQuestion, setExecQuestion] = useState("")
  const [biCompanyId, setBiCompanyId] = useState<string>(activeCompany?.id ? String(activeCompany.id) : "all")
  const bottomRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  const selectedCompanyId = biCompanyId !== "all" ? parseInt(biCompanyId) : null

  const chat = useAiChat({
    mutation: {
      onSuccess: (data) => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.response,
          dataPoints: data.dataPoints
        }])
      }
    }
  })

  const { data: cached, isLoading: cacheLoading } = useGetAiAnalysisCached(
    selectedCompanyId ?? 0,
    { query: { enabled: !!selectedCompanyId, queryKey: getGetAiAnalysisCachedQueryKey(selectedCompanyId ?? 0) } }
  )

  const runAnalysis = useRunAiAnalysis({
    mutation: {
      onSuccess: () => {
        if (selectedCompanyId) {
          qc.invalidateQueries({ queryKey: getGetAiAnalysisCachedQueryKey(selectedCompanyId) })
        }
      }
    }
  })

  const runExecutive = useRunAiExecutive()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || chat.isPending) return
    const userMessage = input.trim()
    setInput("")
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    chat.mutate({ data: { message: userMessage, companyId: activeCompany?.id ?? null } })
  }

  const handleRunAnalysis = (force = false) => {
    if (!selectedCompanyId) return
    runAnalysis.mutate({
      companyId: selectedCompanyId,
      params: force ? { force: true } : undefined
    })
  }

  const handleExecutiveQuery = () => {
    if (!execQuestion.trim() || runExecutive.isPending) return
    runExecutive.mutate({
      data: {
        question: execQuestion.trim(),
        companyId: selectedCompanyId ?? null,
        companyIds: !selectedCompanyId ? companies.map(c => c.id) : undefined
      }
    })
  }

  const analysis = runAnalysis.data ?? (cached ?? null)
  const execResult = runExecutive.data

  const biSections: { id: BiSection; label: string; icon: React.ElementType }[] = [
    { id: "swot",   label: "SWOT Analysis",  icon: Brain },
    { id: "growth", label: "Growth Predictions", icon: BarChart3 },
    { id: "market", label: "Market & Competitors", icon: Globe },
  ]

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex justify-between items-end border-b pb-4 border-muted">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Brain className="w-8 h-8 text-primary" />
            AI Business Intelligence
          </h1>
          <p className="text-muted-foreground mt-1">Real-time SWOT analysis, growth predictions, market intelligence, and AI-powered Q&A</p>
        </div>
        <Badge variant="outline" className="text-xs gap-1">
          <Sparkles className="w-3 h-3 text-primary" /> AI-generated analysis
        </Badge>
      </div>

      {/* Top-level tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        {(["chat", "bi", "reports"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 text-sm rounded-md transition-colors font-medium",
              tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "chat" ? "AI Chat" : t === "bi" ? "Business Intelligence" : "Executive Reports"}
          </button>
        ))}
      </div>

      {/* ── CHAT TAB ── */}
      {tab === "chat" && (
        <Card className="flex flex-col overflow-hidden border-muted shadow-md" style={{ height: "calc(100vh - 16rem)" }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex gap-4 max-w-[85%]", msg.role === 'user' ? "ml-auto flex-row-reverse" : "")}>
                <div className={cn(
                  "w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-1",
                  msg.role === 'user' ? "bg-secondary text-secondary-foreground" : "bg-primary/20 text-primary border border-primary/20"
                )}>
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className="space-y-2">
                  <div className={cn(
                    "p-3 rounded-lg text-sm",
                    msg.role === 'user' ? "bg-secondary text-secondary-foreground" : "bg-card border border-muted"
                  )}>
                    {msg.content}
                  </div>
                  {msg.dataPoints && msg.dataPoints.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {msg.dataPoints.map((dp, idx) => (
                        <div key={idx} className="bg-background/50 border border-primary/10 rounded p-2 text-xs flex items-center gap-2">
                          <Database className="w-3 h-3 text-primary shrink-0" />
                          <div>
                            <div className="text-muted-foreground">{dp.label}</div>
                            <div className="font-semibold text-foreground">{dp.value}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chat.isPending && (
              <div className="flex gap-4 max-w-[85%]">
                <div className="w-8 h-8 rounded-md bg-primary/20 text-primary border border-primary/20 flex items-center justify-center shrink-0 mt-1">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                </div>
                <div className="p-4 rounded-lg bg-card border border-muted flex gap-1 items-center h-10">
                  <div className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" />
                  <div className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:0.2s]" />
                  <div className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="p-4 border-t bg-card/50">
            <div className="flex flex-wrap gap-2 mb-3">
              {SUGGESTED_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => setInput(prompt)}
                  className="text-[11px] bg-background border hover:border-primary text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <form onSubmit={handleChatSubmit} className="relative flex items-center">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask anything about your businesses..."
                className="pr-12 bg-background border-muted h-12"
                disabled={chat.isPending}
              />
              <Button
                type="submit" size="icon"
                disabled={!input.trim() || chat.isPending}
                className="absolute right-1 w-10 h-10 bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </Card>
      )}

      {/* ── BUSINESS INTELLIGENCE TAB ── */}
      {tab === "bi" && (
        <div className="space-y-5">
          {/* Company selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={biCompanyId} onValueChange={v => { setBiCompanyId(v); runAnalysis.reset() }}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">📊 Portfolio (all)</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {analysis && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <Clock className="w-3 h-3" />
                Analysis: {new Date(analysis.createdAt).toLocaleTimeString()} · via {analysis.provider}
                <Badge variant="outline" className="ml-1 text-[10px]">AI-generated</Badge>
              </div>
            )}
          </div>

          {!selectedCompanyId && (
            <Card className="p-8 text-center border-dashed">
              <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <div className="text-muted-foreground text-sm">Select a company to run analysis</div>
              <div className="text-xs text-muted-foreground mt-1">Finance, CRM, HR, Inventory, Growth Predictions and Market Intelligence</div>
            </Card>
          )}

          {selectedCompanyId && (
            <>
              {/* BI section tabs */}
              <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit border">
                {biSections.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setBiSection(s.id)}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 font-medium",
                      biSection === s.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <s.icon className="w-3 h-3" />
                    {s.label}
                  </button>
                ))}
              </div>

              {/* ── SWOT section ── */}
              {biSection === "swot" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      onClick={() => handleRunAnalysis(false)}
                      disabled={runAnalysis.isPending || !!analysis}
                      className="gap-2"
                    >
                      {runAnalysis.isPending ? <Sparkles className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                      {analysis ? "Analysis ready" : "Run Analysis"}
                    </Button>
                    {analysis && (
                      <Button size="sm" variant="outline" onClick={() => handleRunAnalysis(true)} disabled={runAnalysis.isPending} className="gap-2">
                        <RefreshCw className={cn("w-3 h-3", runAnalysis.isPending && "animate-spin")} />
                        Refresh
                      </Button>
                    )}
                  </div>

                  {selectedCompanyId && (cacheLoading || runAnalysis.isPending) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {["Strengths", "Weaknesses", "Opportunities", "Threats"].map(label => (
                        <Card key={label} className="p-4 space-y-3">
                          <Skeleton className="h-4 w-32" />
                          {[1, 2, 3].map(i => <Skeleton key={i} className="h-3 w-full" />)}
                        </Card>
                      ))}
                    </div>
                  )}

                  {analysis && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SwotCard title="Strengths"     items={analysis.strengths}     color="green" icon={<CheckCircle2 className="w-4 h-4 text-green-500" />} />
                        <SwotCard title="Weaknesses"    items={analysis.weaknesses}    color="amber" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} />
                        <SwotCard title="Opportunities" items={analysis.opportunities} color="blue"  icon={<TrendingUp className="w-4 h-4 text-blue-500" />} />
                        <SwotCard title="Threats"       items={analysis.threats}       color="red"   icon={<AlertTriangle className="w-4 h-4 text-red-500" />} />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InsightCard title="Revenue Leaks"       items={analysis.revenueleaks}       icon={<TrendingDown className="w-4 h-4 text-red-400" />} />
                        <InsightCard title="Cost Opportunities"  items={analysis.costOpportunities}  icon={<Target className="w-4 h-4 text-green-400" />} />
                        <InsightCard title="Cash Flow Risks"     items={analysis.cashRisks}          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />} />
                        <InsightCard title="Growth Opportunities" items={analysis.growthOpportunities} icon={<Zap className="w-4 h-4 text-blue-400" />} />
                      </div>
                      {analysis.summary && (
                        <Card className="border-primary/20 bg-primary/5">
                          <CardContent className="pt-4">
                            <div className="flex items-start gap-3">
                              <Brain className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                              <div>
                                <div className="text-xs font-semibold text-primary mb-1 uppercase tracking-wide">Executive Summary</div>
                                <p className="text-sm text-foreground">{analysis.summary}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}

                  {/* Executive AI panel always visible in SWOT section */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Brain className="w-4 h-4 text-primary" />
                        Executive AI Decision Engine
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Ask a strategic question — the AI acts as your virtual CEO, CFO, COO and CMO simultaneously.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {EXECUTIVE_PROMPTS.map((p, i) => (
                          <button
                            key={i}
                            onClick={() => setExecQuestion(p)}
                            className="text-[11px] bg-background border hover:border-primary text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Textarea
                          value={execQuestion}
                          onChange={e => setExecQuestion(e.target.value)}
                          placeholder="Ask a strategic question about the business..."
                          className="min-h-[80px] text-sm"
                          disabled={runExecutive.isPending}
                        />
                        <Button
                          onClick={handleExecutiveQuery}
                          disabled={!execQuestion.trim() || runExecutive.isPending}
                          className="shrink-0 gap-2"
                        >
                          {runExecutive.isPending ? <Sparkles className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          Ask
                        </Button>
                      </div>

                      {runExecutive.isPending && (
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-4 w-1/2" />
                        </div>
                      )}

                      {execResult && (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/40 px-4 py-3 flex items-center justify-between">
                            <div className="text-sm font-semibold flex items-center gap-2">
                              <Brain className="w-4 h-4 text-primary" />
                              Executive AI Response
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={priorityColor(execResult.priority) as never}>{execResult.priority} priority</Badge>
                              <Badge variant="outline">{execResult.confidence}% confidence</Badge>
                              {execResult.effort && <Badge variant="outline">Effort: {execResult.effort}</Badge>}
                            </div>
                          </div>
                          <div className="p-4 space-y-4">
                            <div>
                              <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Answer</div>
                              <p className="text-sm">{execResult.answer}</p>
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Reasoning</div>
                              <p className="text-sm text-muted-foreground">{execResult.reasoning}</p>
                            </div>
                            {execResult.supportingData && execResult.supportingData.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Supporting Data</div>
                                <ul className="space-y-1">
                                  {execResult.supportingData.map((d, i) => (
                                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                                      <ChevronRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                                      {d}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {execResult.financialImpact && (
                              <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
                                <div className="text-xs font-semibold text-green-600 mb-1">Financial Impact</div>
                                <div className="text-sm">{execResult.financialImpact}</div>
                              </div>
                            )}
                          </div>
                          <div className="px-4 py-2 bg-muted/20 border-t">
                            <Badge variant="outline" className="text-[10px]">AI-generated analysis — verify with your team</Badge>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* ── GROWTH PREDICTIONS section ── */}
              {biSection === "growth" && (
                <GrowthPredictionsPanel companyId={selectedCompanyId} />
              )}

              {/* ── MARKET & COMPETITORS section ── */}
              {biSection === "market" && (
                <MarketAnalysisPanel companyId={selectedCompanyId} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── EXECUTIVE REPORTS TAB ── */}
      {tab === "reports" && (
        <ReportsTab companies={companies} />
      )}
    </div>
  )
}

// ── Reports Tab ───────────────────────────────────────────────────────────────
function ReportsTab({ companies }: { companies: { id: number; name: string }[] }) {
  const { hasPermission } = useAuth()
  const isSuperAdmin = hasPermission("super_admin")
  const qc = useQueryClient()
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("null")
  const [reportType, setReportType] = useState<string>("monthly")
  const [recipientInput, setRecipientInput] = useState<string>("")
  const [previewReport, setPreviewReport] = useState<AiReportHistory | null>(null)
  const [historyFilterId, setHistoryFilterId] = useState<string>("all")

  const schedKey  = ["/api/reports/schedules"]
  const histKey   = ["/api/reports/history"]

  const { data: schedules, isLoading: schedLoading } = useQuery<AiReportSchedule[]>({
    queryKey: schedKey,
    queryFn:  () => adminApi.get("/reports/schedules"),
  })

  const { data: history, isLoading: histLoading } = useQuery<AiReportHistory[]>({
    queryKey: histKey,
    queryFn:  () => adminApi.get("/reports/history"),
    refetchInterval: (data) =>
      data?.state?.data?.some?.((r: AiReportHistory) => r.status === "generating") ? 3000 : false,
  })

  const createSchedule = useMutation<AiReportSchedule, Error, { companyId: number | null; type: string; recipientEmails: string[] }>({
    mutationFn: (body) => adminApi.post("/reports/schedules", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: schedKey }); setRecipientInput("") },
  })

  const deleteSchedule = useMutation<void, Error, number>({
    mutationFn: (id: number) => adminApi.del(`/reports/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: schedKey }),
  })

  const toggleSchedule = useMutation<AiReportSchedule, Error, { id: number; enabled: boolean }>({
    mutationFn: ({ id, enabled }) => adminApi.patch(`/reports/schedules/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: schedKey }),
  })

  const generateNow = useMutation<{ id: number; status: string }, Error, void>({
    mutationFn: () => adminApi.post("/reports/generate", {
      companyId:       selectedCompanyId === "null" ? null : parseInt(selectedCompanyId),
      type:            "manual",
      recipientEmails: recipientInput.split(/[,\s]+/).map(s => s.trim()).filter(s => s.includes("@")),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: histKey })
    },
  })

  function handleCreateSchedule() {
    const emails = recipientInput.split(/[,\s]+/).map(s => s.trim()).filter(s => s.includes("@"))
    createSchedule.mutate({
      companyId: selectedCompanyId === "null" ? null : parseInt(selectedCompanyId),
      type: reportType,
      recipientEmails: emails,
    })
  }

  const filteredHistory = historyFilterId === "all"
    ? history ?? []
    : (history ?? []).filter(r => String(r.companyId) === historyFilterId || (r.companyId == null && historyFilterId === "null"))

  const companyName = (id: number | null) => id == null
    ? "Portfolio (all)"
    : companies.find(c => c.id === id)?.name ?? `Company #${id}`

  const TYPE_LABELS: Record<string, string> = {
    weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", manual: "One-off"
  }

  const STATUS_STYLES: Record<string, string> = {
    sent:       "bg-green-500/10 text-green-400 border-green-500/20",
    generating: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    failed:     "bg-red-500/10 text-red-400 border-red-500/20",
  }

  return (
    <div className="space-y-6">
      {/* Create schedule / generate now */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            Schedule or Generate Executive Report
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            AI-generated reports summarising SWOT, valuation, predictions, and financial health — delivered by email.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Company / Portfolio</label>
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="null">📊 Portfolio (all companies)</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Report Type</label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Recipient Email(s)</label>
              <Input
                value={recipientInput}
                onChange={e => setRecipientInput(e.target.value)}
                placeholder="email@example.com, another@example.com"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => generateNow.mutate()}
              disabled={generateNow.isPending}
              variant="outline"
              className="gap-2"
            >
              {generateNow.isPending
                ? <><Sparkles className="w-3 h-3 animate-spin" /> Generating…</>
                : <><Send className="w-3 h-3" /> Generate & Send Now</>
              }
            </Button>
            {isSuperAdmin && (
              <Button
                onClick={handleCreateSchedule}
                disabled={createSchedule.isPending}
                className="gap-2"
              >
                <Clock className="w-3 h-3" />
                {createSchedule.isPending ? "Saving…" : `Schedule ${TYPE_LABELS[reportType] ?? reportType} Reports`}
              </Button>
            )}
          </div>
          {generateNow.isSuccess && (
            <div className="text-xs text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" /> Report queued — check history below in a few seconds.
            </div>
          )}
          {generateNow.isError && (
            <div className="text-xs text-red-400 flex items-center gap-1.5">
              ✗ {generateNow.error?.message ?? "Report generation failed. Please try again."}
            </div>
          )}
          {createSchedule.isError && (
            <div className="text-xs text-red-400 flex items-center gap-1.5">
              ✗ {createSchedule.error?.message ?? "Failed to create schedule."}
            </div>
          )}
          {!isSuperAdmin && (
            <p className="text-xs text-muted-foreground">
              Only super admins can create automated schedules. You can still generate one-off reports.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Active schedules */}
      {isSuperAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" /> Automated Schedules
            </CardTitle>
          </CardHeader>
          <CardContent>
            {schedLoading ? (
              <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : !schedules || schedules.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Clock className="w-7 h-7 mx-auto mb-2 opacity-40" />
                No automated schedules yet. Create one above.
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map(s => (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{companyName(s.companyId)}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[9px] py-0 px-1">{TYPE_LABELS[s.type] ?? s.type}</Badge>
                        {s.recipientEmails.length > 0 && (
                          <span className="truncate">{s.recipientEmails.slice(0, 2).join(", ")}{s.recipientEmails.length > 2 ? ` +${s.recipientEmails.length - 2}` : ""}</span>
                        )}
                        {s.nextRunAt && (
                          <span className="text-muted-foreground">Next: {new Date(s.nextRunAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] cursor-pointer", s.enabled ? "bg-green-500/10 text-green-400 border-green-500/20" : "text-muted-foreground")}
                        onClick={() => toggleSchedule.mutate({ id: s.id, enabled: !s.enabled })}
                      >
                        {s.enabled ? "Active" : "Paused"}
                      </Badge>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => { if (confirm("Delete this schedule?")) deleteSchedule.mutate(s.id) }}
                        className="h-7 w-7 text-red-400 hover:text-red-300"
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Report history */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" /> Report History
            </CardTitle>
            <Select value={historyFilterId} onValueChange={setHistoryFilterId}>
              <SelectTrigger className="w-44 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                <SelectItem value="null">Portfolio</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {histLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : filteredHistory.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No reports generated yet. Use the panel above to generate your first report.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map(r => (
                <div key={r.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.subject}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-[9px] py-0 px-1">{TYPE_LABELS[r.type] ?? r.type}</Badge>
                        <span>{companyName(r.companyId)}</span>
                        <span>{new Date(r.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        {r.recipientCount > 0 && <span>📧 {r.recipientCount} sent</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLES[r.status] ?? "")}>
                        {r.status === "generating" ? "⏳ Generating" : r.status === "sent" ? "✓ Sent" : "✗ Failed"}
                      </Badge>
                      {r.aiSummary && r.status !== "generating" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreviewReport(r)}>
                          Preview
                        </Button>
                      )}
                    </div>
                  </div>
                  {r.errorMessage && (
                    <div className="text-xs text-red-400 bg-red-500/5 rounded p-2">{r.errorMessage}</div>
                  )}
                  {r.aiSummary && r.status !== "generating" && (
                    <div className="text-xs text-muted-foreground line-clamp-2 bg-muted/30 rounded p-2">{r.aiSummary}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview modal */}
      {previewReport && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreviewReport(null)}
        >
          <div
            className="bg-background border rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <div className="font-semibold text-sm">{previewReport.subject}</div>
                <div className="text-xs text-muted-foreground">{companyName(previewReport.companyId)} · {new Date(previewReport.createdAt).toLocaleDateString("en-IN")}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreviewReport(null)}>✕</Button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{previewReport.aiSummary}</div>
            </div>
            <div className="p-4 border-t text-xs text-muted-foreground">
              AI-generated summary — not official financial advice
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SwotCard({ title, items, color, icon }: { title: string; items: string[]; color: string; icon: React.ReactNode }) {
  const borderMap: Record<string, string> = {
    green: "border-green-500/20", amber: "border-amber-500/20", blue: "border-blue-500/20", red: "border-red-500/20"
  }
  const bgMap: Record<string, string> = {
    green: "bg-green-500/5", amber: "bg-amber-500/5", blue: "bg-blue-500/5", red: "bg-red-500/5"
  }
  return (
    <Card className={cn("border", borderMap[color] ?? "", bgMap[color] ?? "")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
              <ChevronDown className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function InsightCard({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
              <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
