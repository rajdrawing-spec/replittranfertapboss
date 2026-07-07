import { useState, useRef, useEffect } from "react"
import { useAiChat } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Bot, User, Send, Sparkles, Database } from "lucide-react"
import { cn } from "@/lib/utils"

type Message = {
  role: 'user' | 'assistant';
  content: string;
  dataPoints?: { label: string, value: string }[];
}

export default function AiAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    { 
      role: 'assistant', 
      content: "Hello. I am the TAPBOSS AI Assistant. I have full context of all 6 subsidiaries, including realtime finance, inventory, and CRM data. How can I help you analyze the business today?" 
    }
  ])
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || chat.isPending) return

    const userMessage = input.trim()
    setInput("")
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    
    chat.mutate({ data: { message: userMessage } })
  }

  const suggestedPrompts = [
    "Summarize net profit across all subsidiaries this month",
    "Which products are low on stock in HugFAB?",
    "Show me the lead pipeline conversion rate",
    "Are there any overdue vendor payments?"
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Bot className="w-8 h-8 text-primary" />
          Business AI
        </h1>
        <p className="text-muted-foreground mt-1">Ask questions about portfolio performance and operations</p>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden border-muted shadow-md">
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
            {suggestedPrompts.map((prompt, i) => (
              <button 
                key={i}
                onClick={() => setInput(prompt)}
                className="text-[11px] bg-background border hover:border-primary text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <Input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your businesses..." 
              className="pr-12 bg-background border-muted h-12"
              disabled={chat.isPending}
            />
            <Button 
              type="submit" 
              size="icon" 
              disabled={!input.trim() || chat.isPending}
              className="absolute right-1 w-10 h-10 bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  )
}
