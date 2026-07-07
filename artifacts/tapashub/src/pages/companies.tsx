import * as React from "react"
import {
  useListCompanies,
  useCreateCompany,
  useUpdateCompany,
  useDeleteCompany,
  getListCompaniesQueryKey,
  type Company,
} from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { Link } from "wouter"
import {
  Users, IndianRupee, ExternalLink, Plus, MoreVertical, Pencil, Trash2,
  Archive, ArchiveRestore, Power, PowerOff, Upload, Globe, Building2,
} from "lucide-react"

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"]

// Company logos are stored as an API-served path; render them as-is.
function logoSrc(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith("/objects")) return `/api/storage${url}`
  return url
}

interface FormState {
  name: string
  slug: string
  type: "parent" | "subsidiary"
  industry: string
  category: string
  ownershipPercent: string
  website: string
  description: string
  country: string
  currency: string
  timezone: string
  gstNumber: string
  panNumber: string
  address: string
  city: string
  state: string
  status: "active" | "inactive"
  brandColor: string
  logoUrl: string
}

const EMPTY_FORM: FormState = {
  name: "", slug: "", type: "subsidiary", industry: "", category: "",
  ownershipPercent: "100", website: "", description: "", country: "India",
  currency: "INR", timezone: "Asia/Kolkata", gstNumber: "", panNumber: "",
  address: "", city: "", state: "", status: "active", brandColor: "#2563EB", logoUrl: "",
}

function toForm(c: Company): FormState {
  return {
    name: c.name ?? "", slug: c.slug ?? "", type: (c.type as "parent" | "subsidiary") ?? "subsidiary",
    industry: c.industry ?? "", category: c.category ?? "",
    ownershipPercent: String(c.ownershipPercent ?? 100), website: c.website ?? "",
    description: c.description ?? "", country: c.country ?? "", currency: c.currency ?? "INR",
    timezone: c.timezone ?? "", gstNumber: c.gstNumber ?? "", panNumber: c.panNumber ?? "",
    address: c.address ?? "", city: c.city ?? "", state: c.state ?? "",
    status: (c.status as "active" | "inactive") ?? "active", brandColor: c.brandColor ?? "#2563EB",
    logoUrl: c.logoUrl ?? "",
  }
}

export default function Companies() {
  const { isSuperAdmin } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Company | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = React.useState<Company | null>(null)

  const { data: companies, isLoading } = useListCompanies({
    query: { enabled: true, queryKey: getListCompaniesQueryKey() },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey() })

  const createMut = useCreateCompany({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateCompany({ mutation: { onSuccess: invalidate } })
  const deleteMut = useDeleteCompany({ mutation: { onSuccess: invalidate } })

  const { uploadFile, isUploading } = useUpload({
    onError: (e) => toast({ title: "Logo upload failed", description: e.message, variant: "destructive" }),
  })

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  const openEdit = (c: Company) => { setEditing(c); setForm(toForm(c)); setDialogOpen(true) }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const res = await uploadFile(file)
    if (res) set("logoUrl", res.objectPath)
    e.target.value = ""
  }

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" })
      return
    }
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim().toLowerCase(),
      type: form.type,
      industry: form.industry || undefined,
      category: form.category || undefined,
      ownershipPercent: Number(form.ownershipPercent) || 0,
      website: form.website || undefined,
      description: form.description || undefined,
      country: form.country || undefined,
      currency: form.currency || "INR",
      timezone: form.timezone || undefined,
      gstNumber: form.gstNumber || undefined,
      panNumber: form.panNumber || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      state: form.state || undefined,
      status: form.status,
      brandColor: form.brandColor || undefined,
      logoUrl: form.logoUrl || undefined,
    }
    try {
      if (editing) {
        const { slug, ...rest } = payload
        await updateMut.mutateAsync({ companyId: editing.id, data: rest })
        toast({ title: "Company updated" })
      } else {
        await createMut.mutateAsync({ data: payload })
        toast({ title: "Company created" })
      }
      setDialogOpen(false)
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" })
    }
  }

  const quickPatch = async (c: Company, data: Record<string, unknown>, msg: string) => {
    try {
      await updateMut.mutateAsync({ companyId: c.id, data })
      toast({ title: msg })
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" })
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMut.mutateAsync({ companyId: deleteTarget.id })
      toast({ title: "Company deleted" })
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setDeleteTarget(null)
    }
  }

  const visible = (companies ?? []).filter((c) => (showArchived ? c.archived : !c.archived))
  const saving = createMut.isPending || updateMut.isPending

  if (isLoading) {
    return <div className="space-y-6">
      <Skeleton className="h-10 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    </div>
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Companies</h1>
          <p className="text-muted-foreground mt-1">Manage subsidiary businesses and investments</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setShowArchived((s) => !s)} data-testid="button-toggle-archived">
            {showArchived ? "View Active" : "View Archived"}
          </Button>
          {isSuperAdmin && (
            <Button onClick={openCreate} data-testid="button-add-company">
              <Plus className="w-4 h-4 mr-2" /> Add Company
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border rounded-lg">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p>{showArchived ? "No archived companies." : "No companies yet."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map((company) => {
            const color = company.brandColor || "#64748B"
            return (
              <div key={company.id} className="block group">
                <Card className="h-full bg-card/50 hover:bg-accent/30 hover:border-primary/50 transition-all duration-300 overflow-hidden">
                  <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-xl overflow-hidden"
                        style={{ backgroundColor: `${color}1A`, color }}
                      >
                        {company.logoUrl
                          ? <img src={logoSrc(company.logoUrl)} alt={company.name} className="w-full h-full object-cover rounded-lg" />
                          : company.name.charAt(0)}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={company.status === "active" ? "success" : "outline"} className="uppercase text-[10px]">
                          {company.status}
                        </Badge>
                        {company.archived && (
                          <Badge variant="outline" className="uppercase text-[10px]">archived</Badge>
                        )}
                        {isSuperAdmin && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`menu-company-${company.id}`}>
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(company)}>
                                <Pencil className="w-4 h-4 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => quickPatch(company,
                                  { status: company.status === "active" ? "inactive" : "active" },
                                  company.status === "active" ? "Company deactivated" : "Company activated")}
                              >
                                {company.status === "active"
                                  ? <><PowerOff className="w-4 h-4 mr-2" /> Deactivate</>
                                  : <><Power className="w-4 h-4 mr-2" /> Activate</>}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => quickPatch(company, { archived: !company.archived },
                                  company.archived ? "Company unarchived" : "Company archived")}
                              >
                                {company.archived
                                  ? <><ArchiveRestore className="w-4 h-4 mr-2" /> Unarchive</>
                                  : <><Archive className="w-4 h-4 mr-2" /> Archive</>}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(company)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                    <Link href={`/companies/${company.id}`}>
                      <CardTitle className="mt-4 text-xl group-hover:text-primary transition-colors cursor-pointer">{company.name}</CardTitle>
                    </Link>
                    <CardDescription>
                      {company.category || company.industry || "General Business"} • {company.ownershipPercent}% Ownership
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {company.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{company.description}</p>
                    )}
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Team</span>
                        <p className="font-medium">{company.employeeCount || 0}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><IndianRupee className="w-3 h-3" /> Revenue</span>
                        <p className="font-medium">₹{(company.totalRevenue || 0).toLocaleString("en-IN")}</p>
                      </div>
                    </div>
                    {company.website && (
                      <div className="mt-4 pt-3 border-t">
                        <a
                          href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {company.website.replace(/^https?:\/\//, "")}
                        </a>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Company" : "Add Company"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update this company's details." : "Create a new company record."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center font-bold text-2xl overflow-hidden shrink-0"
                style={{ backgroundColor: `${form.brandColor}1A`, color: form.brandColor }}
              >
                {form.logoUrl
                  ? <img src={logoSrc(form.logoUrl)} alt="logo" className="w-full h-full object-cover rounded-xl" />
                  : (form.name.charAt(0) || "?")}
              </div>
              <div>
                <Label className="mb-1 block">Logo</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" asChild disabled={isUploading}>
                    <label className="cursor-pointer">
                      <Upload className="w-4 h-4 mr-2" />
                      {isUploading ? "Uploading..." : "Upload"}
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogo} data-testid="input-logo" />
                    </label>
                  </Button>
                  {form.logoUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => set("logoUrl", "")}>Remove</Button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="input-name" />
              </Field>
              <Field label="Slug">
                <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} disabled={!!editing} data-testid="input-slug" />
              </Field>
              <Field label="Type">
                <Select value={form.type} onValueChange={(v) => set("type", v as "parent" | "subsidiary")}>
                  <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parent">Parent</SelectItem>
                    <SelectItem value="subsidiary">Subsidiary</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => set("status", v as "active" | "inactive")}>
                  <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Business Category">
                <Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Fashion & Apparel" />
              </Field>
              <Field label="Industry">
                <Input value={form.industry} onChange={(e) => set("industry", e.target.value)} />
              </Field>
              <Field label="Ownership %">
                <Input type="number" value={form.ownershipPercent} onChange={(e) => set("ownershipPercent", e.target.value)} />
              </Field>
              <Field label="Brand Color">
                <div className="flex items-center gap-2">
                  <input type="color" value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)}
                    className="h-9 w-12 rounded border cursor-pointer bg-transparent" data-testid="input-brandcolor" />
                  <Input value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)} />
                </div>
              </Field>
              <Field label="Website">
                <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://example.com" />
              </Field>
              <Field label="Currency">
                <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                  <SelectTrigger data-testid="select-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Country">
                <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
              </Field>
              <Field label="Time Zone">
                <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="Asia/Kolkata" />
              </Field>
              <Field label="GST Number">
                <Input value={form.gstNumber} onChange={(e) => set("gstNumber", e.target.value)} />
              </Field>
              <Field label="PAN Number">
                <Input value={form.panNumber} onChange={(e) => set("panNumber", e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="State">
                <Input value={form.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
            </div>

            <Field label="Address">
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="Description">
              <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || isUploading} data-testid="button-save-company">
              {saving ? "Saving..." : editing ? "Save Changes" : "Create Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the company record. This action cannot be undone.
              Consider archiving instead if you may need it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
