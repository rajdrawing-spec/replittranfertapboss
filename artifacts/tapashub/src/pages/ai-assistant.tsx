import { useState, useRef, useEffect } from "react"
import {
  useAiChat, useRunAiAnalysis, useGetAiAnalysisCached, useRunAiExecutive,
  getGetAiAnalysisCachedQueryKey
} from "@workspace/api-client-react"
import { useCompany } from "@/contexts/company-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Bot, User, Send, Sparkles, Database, RefreshCw, ChevronDown, ChevronRight,
  TrendingUp, AlertTriangle, Zap, Target, Brain, CheckCircle2, Clock
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Tab = "chat" | "bi"
type Message = {
  role: 'user' | 'assistant';
  content: string;
  dataPoints?: { label: string, value: string }[];
}

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

function priorityColor(p: string) {
  if (p === "critical") return "destructive"
  if (p === "high") return "warning"
  if (p === "medium") return "secondary"
  return "outline"
}

export default function AiAssistant() {
  const { activeCompany, companies } = useCompany()
  const [tab, setTab] = useState<Tab>("chat")
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

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex justify-between items-end border-b pb-4 border-muted">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Brain className="w-8 h-8 text-primary" />
            AI Business Intelligence
          </h1>
          <p className="text-muted-foreground mt-1">Real-time SWOT analysis, executive insights, and AI-powered Q&A</p>
        </div>
        <Badge variant="outline" className="text-xs gap-1">
          <Sparkles className="w-3 h-3 text-primary" /> AI-generated analysis
        </Badge>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        {(["chat", "bi"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 text-sm rounded-md transition-colors font-medium",
              tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "chat" ? "AI Chat" : "Business Intelligence"}
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
        <div className="space-y-6">
          {/* Company selector + controls */}
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
            {selectedCompanyId && (
              <>
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
              </>
            )}
            {analysis && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <Clock className="w-3 h-3" />
                Generated {new Date(analysis.createdAt).toLocaleTimeString()} · via {analysis.provider}
                <Badge variant="outline" className="ml-1 text-[10px]">AI-generated analysis</Badge>
              </div>
            )}
          </div>

          {!selectedCompanyId && (
            <Card className="p-8 text-center border-dashed">
              <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <div className="text-muted-foreground text-sm">Select a company above to run SWOT analysis</div>
              <div className="text-xs text-muted-foreground mt-1">AI will analyse Finance, CRM, HR, Inventory and more</div>
            </Card>
          )}

          {/* SWOT Grid */}
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
              {/* SWOT */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SwotCard title="Strengths" items={analysis.strengths} color="green" icon={<CheckCircle2 className="w-4 h-4 text-green-500" />} />
                <SwotCard title="Weaknesses" items={analysis.weaknesses} color="amber" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} />
                <SwotCard title="Opportunities" items={analysis.opportunities} color="blue" icon={<TrendingUp className="w-4 h-4 text-blue-500" />} />
                <SwotCard title="Threats" items={analysis.threats} color="red" icon={<AlertTriangle className="w-4 h-4 text-red-500" />} />
              </div>

              {/* Insights grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InsightCard title="Revenue Leaks" items={analysis.revenueleaks} icon={<TrendingUp className="w-4 h-4 text-red-400" />} />
                <InsightCard title="Cost Opportunities" items={analysis.costOpportunities} icon={<Target className="w-4 h-4 text-green-400" />} />
                <InsightCard title="Cash Flow Risks" items={analysis.cashRisks} icon={<AlertTriangle className="w-4 h-4 text-amber-400" />} />
                <InsightCard title="Growth Opportunities" items={analysis.growthOpportunities} icon={<Zap className="w-4 h-4 text-blue-400" />} />
              </div>

              {/* Executive summary */}
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

          {/* Executive AI panel */}
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
