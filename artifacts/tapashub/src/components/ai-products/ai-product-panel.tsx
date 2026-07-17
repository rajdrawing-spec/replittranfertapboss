import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Sparkles, Wand2, Tags, Barcode, ScanLine, Image, Store, Check, Loader2, Star, CheckCircle2, AlertTriangle, XCircle, Crop, Eraser } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface Product {
  id: number
  companyId: number
  name: string
  sku: string
  category: string
  subcategory?: string
  description?: string
  shortDescription?: string
  price: number
  costPrice: number
  stockQuantity: number
  brand?: string
  mrp?: number
  gst?: number
  weight?: string
  dimensions?: string
  hsn?: string
}

interface ImageCheck {
  resolutionOk?: boolean
  aspectRatioOk?: boolean
  whiteBackground?: boolean
  blur?: boolean
  brightnessOk?: boolean
  score: number
  issues: string[]
}

interface ImageResult {
  tags: string[]
  suggestedName: string
  category: string
  subcategory: string
  attributes: Record<string, string>
  keywords: string[]
  seoTags: string[]
  quality: ImageCheck
  marketplaceReady: boolean
  suggestions: string[]
}

interface GeneratedContent {
  name: string
  shortDescription: string
  description: string
  amazonDescription: string
  flipkartDescription: string
  shopifyDescription: string
  seoDescription: string
  seoTitle: string
  keywords: string[]
  seoTags: string[]
  attributes: Record<string, string>
  category: string
  subcategory: string
  suggestedPrice: number | null
  mrp: number | null
  brand: string
  color: string
  size: string
  weight: string
  dimensions: string
  hsn: string
  gst: number | null
  sku?: string
  barcode?: string
}

export default function AiProductPanel({ product, onChange }: { product: Product; onChange: () => void }) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = React.useState("content")
  const [hint, setHint] = React.useState("")
  const [loading, setLoading] = React.useState<string | null>(null)
  const [generated, setGenerated] = React.useState<GeneratedContent | null>(null)
  const [metadata, setMetadata] = React.useState<any>(null)
  const [marketplace, setMarketplace] = React.useState("amazon")
  const [template, setTemplate] = React.useState<any>(null)
  const [imageResult, setImageResult] = React.useState<ImageResult | null>(null)
  const [resizeWidth, setResizeWidth] = React.useState(1000)
  const [resizeHeight, setResizeHeight] = React.useState(1000)
  const [selectedImage, setSelectedImage] = React.useState<number>(0)

  React.useEffect(() => { loadMetadata() }, [product.id])

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
      const { healthScore } = await res.json()
      toast({ title: "AI content applied", description: `Health score: ${healthScore}/100` })
      setMetadata((m: any) => ({ ...m, metadata: { ...m?.metadata, healthScore } }))
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

  async function resizeImage() {
    setLoading("resize")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/images/${selectedImage}/resize`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: resizeWidth, height: resizeHeight }),
      })
      if (!res.ok) throw new Error()
      const result = await res.json()
      toast({ title: "Image resized", description: `${result.width}x${result.height} · ${result.objectPath}` })
      loadMetadata()
    } catch {
      toast({ title: "Resize failed", variant: "destructive" })
    } finally { setLoading(null) }
  }

  async function removeBg() {
    setLoading("removeBg")
    try {
      const res = await fetch(`${basePath}/api/ai-products/${product.id}/images/${selectedImage}/remove-background`, {
        method: "POST", credentials: "include",
      })
      if (!res.ok) throw new Error()
      const result = await res.json()
      toast({ title: "Background removed", description: result.objectPath })
      loadMetadata()
    } catch (e: any) {
      toast({ title: "Background removal failed", description: e?.message || "Service not configured", variant: "destructive" })
    } finally { setLoading(null) }
  }

  function loadMetadata() {
    fetch(`${basePath}/api/ai-products/${product.id}/ai-metadata`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setMetadata(data)
        if (data?.metadata?.aiAnalysis) setImageResult(data.metadata.aiAnalysis)
      })
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

  const healthScore = metadata?.metadata?.healthScore ?? 0
  const stars = Math.round(healthScore / 20)

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> AI Product Assistant</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="content"><Wand2 className="w-4 h-4 mr-1" /> Content</TabsTrigger>
            <TabsTrigger value="images"><Image className="w-4 h-4 mr-1" /> Images</TabsTrigger>
            <TabsTrigger value="marketplace"><Store className="w-4 h-4 mr-1" /> Marketplace</TabsTrigger>
            <TabsTrigger value="health"><ScanLine className="w-4 h-4 mr-1" /> Health</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>Prompt hint (optional)</Label>
                <Textarea value={hint} onChange={e => setHint(e.target.value)} placeholder="e.g., premium organic cotton, target age 25-34, festival wear..." />
              </div>
              <Button onClick={generateContent} disabled={loading === "content"} className="shrink-0"><Wand2 className="w-4 h-4 mr-1" /> {loading === "content" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate"}</Button>
            </div>

            {generated && (
              <div className="space-y-3 border rounded-md p-3 mt-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><strong>Name:</strong> {generated.name}</div>
                  <div><strong>Category:</strong> {generated.category}{generated.subcategory ? ` · ${generated.subcategory}` : ""}</div>
                  <div><strong>Brand:</strong> {generated.brand || "—"}</div>
                  <div><strong>Price:</strong> ₹{generated.suggestedPrice ?? "—"} <span className="text-muted-foreground">MRP ₹{generated.mrp ?? "—"}</span></div>
                  <div><strong>Color:</strong> {generated.color || "—"}</div>
                  <div><strong>Size:</strong> {generated.size || "—"}</div>
                </div>
                <div className="text-sm"><strong>Short:</strong> {generated.shortDescription}</div>
                <div className="text-sm"><strong>Long:</strong> {generated.description}</div>
                <div className="text-sm"><strong>Amazon:</strong> {generated.amazonDescription}</div>
                <div className="text-sm"><strong>Flipkart:</strong> {generated.flipkartDescription}</div>
                <div className="text-sm"><strong>Shopify:</strong> {generated.shopifyDescription}</div>
                <div className="text-sm"><strong>SEO Title:</strong> {generated.seoTitle}</div>
                <div className="text-sm"><strong>SEO Desc:</strong> {generated.seoDescription}</div>
                <div className="text-sm"><strong>Keywords:</strong> {generated.keywords?.join(", ")}</div>
                <div className="text-sm"><strong>SEO Tags:</strong> {generated.seoTags?.join(", ")}</div>
                <div className="text-sm"><strong>Attributes:</strong> {Object.entries(generated.attributes || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                <Button size="sm" onClick={applyContent} disabled={loading === "apply"}><Check className="w-4 h-4 mr-1" /> Apply to product</Button>
              </div>
            )}

            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Button onClick={generateSku} disabled={loading === "sku"} size="sm"><Barcode className="w-4 h-4 mr-1" /> Generate SKU</Button>
                <Button onClick={generateBarcode} disabled={loading === "barcode"} size="sm"><ScanLine className="w-4 h-4 mr-1" /> Generate Barcode</Button>
              </div>
              {generated?.sku && <div className="text-sm"><strong>SKU:</strong> {generated.sku}</div>}
              {generated?.barcode && <div className="text-sm"><strong>Barcode:</strong> {generated.barcode}</div>}
            </div>
          </TabsContent>

          <TabsContent value="images" className="space-y-3">
            {!imageResult && (
              <p className="text-sm text-muted-foreground">Images with AI tags will appear here. Upload images while editing the product to trigger automatic analysis.</p>
            )}
            {imageResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {["Resolution", "Aspect Ratio", "White Background", "No Blur", "Brightness"].map(label => {
                    const key = label.toLowerCase().replace(/ /g, "") as keyof ImageCheck
                    const ok = imageResult.quality?.[key as keyof ImageCheck]
                    const isBlur = label === "No Blur"
                    const pass = isBlur ? !ok : !!ok
                    return (
                      <div key={label} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${pass ? "bg-green-500/10 border-green-500/30" : "bg-yellow-500/10 border-yellow-500/30"}`}>
                        {pass ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                        {label}
                      </div>
                    )
                  })}
                </div>
                <div className="text-sm"><strong>Suggested name:</strong> {imageResult.suggestedName}</div>
                <div className="text-sm"><strong>Category:</strong> {imageResult.category} {imageResult.subcategory ? `· ${imageResult.subcategory}` : ""}</div>
                <div className="text-sm"><strong>Tags:</strong> {imageResult.tags?.join(", ")}</div>
                <div className="text-sm"><strong>Keywords:</strong> {imageResult.keywords?.join(", ")}</div>
                <div className="text-sm"><strong>SEO Tags:</strong> {imageResult.seoTags?.join(", ")}</div>
                <div className="text-sm"><strong>Attributes:</strong> {Object.entries(imageResult.attributes || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                <div className="text-sm"><strong>Quality score:</strong> {imageResult.quality?.score ?? 0}/100</div>
                <div className="text-sm"><strong>Marketplace ready:</strong> {imageResult.marketplaceReady ? "Yes" : "No"}</div>
                {imageResult.suggestions?.length > 0 && (
                  <div className="text-sm"><strong>Suggestions:</strong> <ul className="list-disc ml-5">{imageResult.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                )}
              </div>
            )}

            <div className="border rounded-md p-3 space-y-3">
              <Label className="flex items-center gap-2"><Image className="w-4 h-4" /> Image actions</Label>
              <div className="flex flex-wrap gap-2">
                {metadata?.images?.map((img: any, i: number) => (
                  <Button
                    key={img.id}
                    variant={selectedImage === i ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => setSelectedImage(i)}
                  >
                    {img.altText || `img-${i + 1}`}
                  </Button>
                ))}
                {metadata?.images?.length === 0 && <p className="text-xs text-muted-foreground">No images yet. Upload images in the product form.</p>}
              </div>
              {metadata?.images?.length > 0 && (
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div className="space-y-1"><Label className="text-xs">Width</Label><Input type="number" value={resizeWidth} onChange={e => setResizeWidth(parseInt(e.target.value) || 0)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Height</Label><Input type="number" value={resizeHeight} onChange={e => setResizeHeight(parseInt(e.target.value) || 0)} /></div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={resizeImage} disabled={loading === "resize"}><Crop className="w-4 h-4 mr-1" /> Resize</Button>
                    <Button size="sm" variant="outline" onClick={removeBg} disabled={loading === "removeBg"}><Eraser className="w-4 h-4 mr-1" /> Remove BG</Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {[[1000, 1000], [800, 800], [500, 500], [1200, 900]].map(([w, h]) => (
                  <Button key={`${w}x${h}`} variant="ghost" size="sm" className="text-xs" onClick={() => { setResizeWidth(w); setResizeHeight(h); }}>{w}x{h}</Button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="marketplace" className="space-y-3">
            <div className="flex gap-2">
              <Input value={marketplace} onChange={e => setMarketplace(e.target.value)} placeholder="amazon, flipkart, myntra, shopify..." />
              <Button onClick={generateMarketplace} disabled={loading === "marketplace"}><Store className="w-4 h-4 mr-1" /> Generate</Button>
            </div>
            {template && (
              <div className="border rounded-md p-3 space-y-2">
                <div className="text-sm"><strong>Title:</strong> {template.title}</div>
                <div className="text-sm"><strong>Description:</strong> {template.description}</div>
                <div className="text-sm"><strong>Bullets:</strong> <ul className="list-disc ml-5">{template.bulletPoints?.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>
                <div className="text-sm"><strong>Keywords:</strong> {template.keywords?.join(", ")}</div>
                <div className="text-sm"><strong>Image requirements:</strong> {template.imageRequirements?.join(", ")}</div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="health" className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold">{healthScore}/100</div>
              <div className="flex">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`w-5 h-5 ${i < stars ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                ))}
              </div>
              <Button onClick={computeHealth} disabled={loading === "health"}><ScanLine className="w-4 h-4 mr-1" /> Recompute</Button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "Name", ok: product.name?.length > 3 },
                { label: "Description", ok: (product.description?.length ?? 0) > 20 },
                { label: "Short Description", ok: (product.shortDescription?.length ?? 0) > 10 },
                { label: "SKU", ok: !!product.sku },
                { label: "Brand", ok: !!product.brand },
                { label: "HSN", ok: !!product.hsn },
                { label: "Weight", ok: !!product.weight },
                { label: "Dimensions", ok: !!product.dimensions },
                { label: "Price/MRP", ok: product.price > 0 && (product.mrp || 0) > 0 },
                { label: "Images", ok: (metadata?.images?.length || 0) > 0 },
                { label: "SEO Keywords", ok: (metadata?.metadata?.keywords?.length || 0) > 0 },
                { label: "SEO Tags", ok: (metadata?.metadata?.seoTags?.length || 0) > 0 },
                { label: "SEO Title/Desc", ok: !!(metadata?.metadata?.seoTitle && metadata?.metadata?.seoDescription) },
                { label: "Variants", ok: (metadata?.variants?.length || 0) > 0 },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  {item.ok ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
                  {item.label}
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">Score is based on name, description, SKU, brand, HSN, weight, dimensions, price, images, SEO, and variants.</p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
