import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Sparkles, Wand2, Tags, Barcode, ScanLine, FileSpreadsheet, Image, Store, Plus, Trash2, Check } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface Product {
  id: number
  companyId: number
  name: string
  sku: string
  category: string
  description?: string
  price: number
  costPrice: number
  stockQuantity: number
}

export default function AiProductPanel({ product, onChange }: { product: Product; onChange: () => void }) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = React.useState("content")
  const [hint, setHint] = React.useState("")
  const [loading, setLoading] = React.useState<string | null>(null)
  const [generated, setGenerated] = React.useState<any>(null)
  const [metadata, setMetadata] = React.useState<any>(null)
  const [marketplace, setMarketplace] = React.useState("amazon")
  const [template, setTemplate] = React.useState<any>(null)

  React.useEffect(() => {
    fetch(`${basePath}/api/ai-products/${product.id}/ai-metadata`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(setMetadata)
  }, [product.id])

  async function generateContent() {
    setLoading("content")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/generate-content`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hint }),
      })
      if (!res.ok) throw new Error()
      setGenerated(await res.json())
    } catch {
      toast({ title: "Error", description: "Could not generate content", variant: "destructive" })
    } finally { setLoading(null) }
  }

  async function applyContent() {
    if (!generated) return
    setLoading("apply")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/apply-content`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(generated),
      })
      if (!res.ok) throw new Error()
      toast({ title: "AI content applied" })
      onChange()
    } catch {
      toast({ title: "Error", description: "Could not apply content", variant: "destructive" })
    } finally { setLoading(null) }
  }

  async function generateSku() {
    setLoading("sku")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/generate-sku`, { method: "POST", credentials: "include" })
      if (!res.ok) throw new Error()
      const { sku } = await res.json()
      setGenerated((g: any) => ({ ...g, sku }))
      toast({ title: "SKU generated", description: sku })
    } catch {
      toast({ title: "Error", description: "SKU generation failed", variant: "destructive" })
    } finally { setLoading(null) }
  }

  async function generateBarcode() {
    setLoading("barcode")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/generate-barcode`, { method: "POST", credentials: "include" })
      if (!res.ok) throw new Error()
      const { barcode } = await res.json()
      setGenerated((g: any) => ({ ...g, barcode }))
      toast({ title: "Barcode generated", description: barcode })
    } catch {
      toast({ title: "Error", description: "Barcode generation failed", variant: "destructive" })
    } finally { setLoading(null) }
  }

  async function generateMarketplace() {
    setLoading("marketplace")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/marketplace/${marketplace}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      })
      if (!res.ok) throw new Error()
      setTemplate(await res.json())
    } catch {
      toast({ title: "Error", description: "Template generation failed", variant: "destructive" })
    } finally { setLoading(null) }
  }

  async function computeHealth() {
    setLoading("health")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/health-score`, { method: "POST", credentials: "include" })
      if (!res.ok) throw new Error()
      const { score } = await res.json()
      setMetadata((m: any) => ({ ...m, metadata: { ...m?.metadata, healthScore: score } }))
      toast({ title: "Health score updated", description: `${score}/100` })
    } catch {
      toast({ title: "Error", description: "Health score failed", variant: "destructive" })
    } finally { setLoading(null) }
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> AI Product Assistant</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="content"><Wand2 className="w-4 h-4 mr-1" /> Content</TabsTrigger>
            <TabsTrigger value="seo"><Tags className="w-4 h-4 mr-1" /> SEO</TabsTrigger>
            <TabsTrigger value="identifiers"><Barcode className="w-4 h-4 mr-1" /> SKU/Barcode</TabsTrigger>
            <TabsTrigger value="marketplace"><Store className="w-4 h-4 mr-1" /> Marketplace</TabsTrigger>
            <TabsTrigger value="health"><ScanLine className="w-4 h-4 mr-1" /> Health</TabsTrigger>
            <TabsTrigger value="images"><Image className="w-4 h-4 mr-1" /> Images</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="space-y-3">
            <Label>Prompt hint (optional)</Label>
            <Textarea value={hint} onChange={e => setHint(e.target.value)} placeholder="e.g., premium organic cotton, target age 25-34..." />
            <Button onClick={generateContent} disabled={loading === "content"}><Wand2 className="w-4 h-4 mr-1" /> Generate</Button>
            {generated && (
              <div className="space-y-2 border rounded-md p-3 mt-2">
                <div><strong>Name:</strong> {generated.name}</div>
                <div><strong>Description:</strong> {generated.description}</div>
                <div><strong>Category:</strong> {generated.category}</div>
                {generated.suggestedPrice && <div><strong>Suggested price:</strong> ₹{generated.suggestedPrice}</div>}
                <Button size="sm" onClick={applyContent} disabled={loading === "apply"}><Check className="w-4 h-4 mr-1" /> Apply to product</Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="seo" className="space-y-3">
            <Button onClick={generateContent} disabled={loading === "content"}><Tags className="w-4 h-4 mr-1" /> Regenerate SEO</Button>
            {generated && (
              <div className="space-y-2 border rounded-md p-3">
                <div><strong>SEO Title:</strong> {generated.seoTitle}</div>
                <div><strong>SEO Description:</strong> {generated.seoDescription}</div>
                <div><strong>Keywords:</strong> {generated.keywords?.join(", ")}</div>
                <div><strong>Attributes:</strong> {JSON.stringify(generated.attributes)}</div>
                <Button size="sm" onClick={applyContent} disabled={loading === "apply"}><Check className="w-4 h-4 mr-1" /> Apply</Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="identifiers" className="space-y-3">
            <div className="flex gap-2">
              <Button onClick={generateSku} disabled={loading === "sku"}><Barcode className="w-4 h-4 mr-1" /> Generate SKU</Button>
              <Button onClick={generateBarcode} disabled={loading === "barcode"}><ScanLine className="w-4 h-4 mr-1" /> Generate Barcode</Button>
            </div>
            {generated?.sku && <div><strong>SKU:</strong> {generated.sku}</div>}
            {generated?.barcode && <div><strong>Barcode:</strong> {generated.barcode}</div>}
          </TabsContent>

          <TabsContent value="marketplace" className="space-y-3">
            <div className="flex gap-2">
              <Input value={marketplace} onChange={e => setMarketplace(e.target.value)} placeholder="amazon, flipkart, myntra, shopify..." />
              <Button onClick={generateMarketplace} disabled={loading === "marketplace"}><Store className="w-4 h-4 mr-1" /> Generate</Button>
            </div>
            {template && (
              <div className="border rounded-md p-3 space-y-2">
                <div><strong>Title:</strong> {template.title}</div>
                <div><strong>Description:</strong> {template.description}</div>
                <div><strong>Bullets:</strong> <ul className="list-disc ml-5">{template.bulletPoints?.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>
                <div><strong>Keywords:</strong> {template.keywords?.join(", ")}</div>
                <div><strong>Image requirements:</strong> {template.imageRequirements?.join(", ")}</div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="health" className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-bold">{metadata?.metadata?.healthScore ?? 0}/100</div>
              <Button onClick={computeHealth} disabled={loading === "health"}><ScanLine className="w-4 h-4 mr-1" /> Recompute</Button>
            </div>
            <p className="text-sm text-muted-foreground">Score is based on name, description, SKU, barcode, price, images, SEO, and variants.</p>
          </TabsContent>

          <TabsContent value="images" className="space-y-3">
            <p className="text-sm text-muted-foreground">Images with AI tags will appear here. Use the Analyze Image button in the product list.</p>
            <div className="flex flex-wrap gap-2">
              {metadata?.images?.map((img: any) => (
                <Badge key={img.id} variant="outline">{img.objectPath} {img.aiTags?.length ? `(${img.aiTags.join(", ")})` : ""}</Badge>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
