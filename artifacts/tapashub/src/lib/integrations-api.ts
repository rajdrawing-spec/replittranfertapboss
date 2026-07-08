// Lightweight typed client + react-query hooks for the platform integrations
// framework. Uses bare /api paths (same-origin) so Clerk's session cookie is sent.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi } from "./admin-api"

export type IntegrationCategory =
  | "storefront" | "marketplace" | "social" | "ads"
  | "analytics" | "payments" | "shipping" | "accounting" | "messaging"

export interface CatalogCapabilities { oauth: boolean; apiKey: boolean; webhook: boolean }
export interface CatalogQuickLink { label: string; url: string }

export interface CatalogPlatform {
  key: string
  name: string
  shortName: string
  category: IntegrationCategory
  description: string
  logo: string
  logoColor: string
  accent: string
  url: string
  capabilities: CatalogCapabilities
  syncFeatures: string[]
  secretKeys: string[]
  quickLinks: CatalogQuickLink[]
}

export type AuthType = "oauth" | "api_key" | "webhook" | "manual"

export interface Connection {
  id: number
  companyId: number
  platformKey: string
  status: "connected" | "disconnected" | "pending" | "error"
  health: "healthy" | "degraded" | "down" | "unknown"
  authType: AuthType | null
  accountHandle: string | null
  connectedUserId: number | null
  connectedUserName: string | null
  connectedUserEmail: string | null
  secretRefs: string[]
  autoSync: boolean
  syncSettings: Record<string, boolean>
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface SyncHistoryEntry {
  id: number
  trigger: "manual" | "scheduled"
  status: "success" | "failed" | "skipped"
  recordsSynced: number
  durationMs: number | null
  message: string | null
  createdAt: string
}

export interface ErrorLogEntry {
  id: number
  level: "error" | "warning"
  message: string
  detail: string | null
  createdAt: string
}

export interface EmbedCheckResult {
  embeddable: boolean
  reason: string
  xFrameOptions: string | null
  csp: string | null
}

/* ── Queries ── */

export function useCatalog() {
  return useQuery<CatalogPlatform[]>({
    queryKey: ["/api/integrations/catalog"],
    queryFn: () => adminApi.get("/integrations/catalog"),
    staleTime: 1000 * 60 * 60,
  })
}

export function useConnections(companyId: number | null) {
  return useQuery<Connection[]>({
    queryKey: ["/api/integrations/connections", companyId],
    queryFn: () =>
      adminApi.get(companyId != null ? `/integrations/connections?companyId=${companyId}` : "/integrations/connections"),
  })
}

export function useSyncHistory(connectionId: number | null) {
  return useQuery<SyncHistoryEntry[]>({
    queryKey: ["/api/integrations/history", connectionId],
    queryFn: () => adminApi.get(`/integrations/connections/${connectionId}/history`),
    enabled: connectionId != null,
  })
}

export function useErrorLogs(connectionId: number | null) {
  return useQuery<ErrorLogEntry[]>({
    queryKey: ["/api/integrations/errors", connectionId],
    queryFn: () => adminApi.get(`/integrations/connections/${connectionId}/errors`),
    enabled: connectionId != null,
  })
}

export function useEmbedCheck(url: string | null) {
  return useQuery<EmbedCheckResult>({
    queryKey: ["/api/integrations/embed-check", url],
    queryFn: () => adminApi.get(`/integrations/embed-check?url=${encodeURIComponent(url!)}`),
    enabled: !!url,
    staleTime: 1000 * 60 * 5, // cache 5 min
    retry: false,
  })
}

/* ── Mutations ── */

function useInvalidateConnections() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ["/api/integrations/connections"] })
}

export function useConnect() {
  const invalidate = useInvalidateConnections()
  return useMutation({
    mutationFn: (body: {
      companyId: number
      platformKey: string
      authType: AuthType
      accountHandle?: string
      credentials?: Record<string, string>
    }) => adminApi.post("/integrations/connections", body) as Promise<Connection>,
    onSuccess: invalidate,
  })
}

export function useSaveCredentials() {
  const invalidate = useInvalidateConnections()
  return useMutation({
    mutationFn: ({ id, credentials }: { id: number; credentials: Record<string, string> }) =>
      adminApi.post(`/integrations/connections/${id}/credentials`, credentials) as Promise<Connection>,
    onSuccess: invalidate,
  })
}

export function useRetestConnection() {
  const invalidate = useInvalidateConnections()
  return useMutation({
    mutationFn: (id: number) =>
      adminApi.post(`/integrations/connections/${id}/retest`) as Promise<Connection>,
    onSuccess: invalidate,
  })
}

export function useDisconnect() {
  const invalidate = useInvalidateConnections()
  return useMutation({
    mutationFn: (id: number) => adminApi.post(`/integrations/connections/${id}/disconnect`) as Promise<Connection>,
    onSuccess: invalidate,
  })
}

export function useUpdateConnection() {
  const invalidate = useInvalidateConnections()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; autoSync?: boolean; accountHandle?: string | null; syncSettings?: Record<string, boolean> }) =>
      adminApi.patch(`/integrations/connections/${id}`, body) as Promise<Connection>,
    onSuccess: invalidate,
  })
}

export function useSyncNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      adminApi.post(`/integrations/connections/${id}/sync`) as Promise<{ result: { status: string; recordsSynced: number; message: string }; connection: Connection }>,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["/api/integrations/connections"] })
      qc.invalidateQueries({ queryKey: ["/api/integrations/history", id] })
    },
  })
}
