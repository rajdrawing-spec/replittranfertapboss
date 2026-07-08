// Lightweight fetch helper for admin endpoints that have no generated client.
// Uses bare /api paths (same-origin) so Clerk's session cookie is sent.

async function handle(res: Response) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const adminApi = {
  get: (p: string) => fetch(`/api${p}`, { credentials: "include" }).then(handle),
  post: (p: string, body?: unknown) =>
    fetch(`/api${p}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(handle),
  patch: (p: string, body: unknown) =>
    fetch(`/api${p}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(handle),
  del: (p: string) =>
    fetch(`/api${p}`, { method: "DELETE", credentials: "include" }).then(handle),
}

export interface AdminUser {
  id: number
  name: string
  email: string
  role: string
  extraRoles: string[]
  department: string | null
  companyIds: number[]
  status: string
  avatarUrl: string | null
  lastLoginAt: string | null
}

export interface AdminInvitation {
  id: number
  email: string
  name: string | null
  role: string
  department: string | null
  companyIds: number[]
  status: string
  createdAt: string
}

export interface AdminRole {
  id: number
  key: string
  name: string
  description: string | null
  permissions: string[]
  isSystem: boolean
}

export interface PermissionDef {
  key: string
  label: string
  group: string
}

export interface AuditLogEntry {
  id: number
  userId: number | null
  userEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  description: string | null
  createdAt: string
}
