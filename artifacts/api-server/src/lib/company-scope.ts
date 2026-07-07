import type { Request } from "express";
import type { User } from "@workspace/db";
import { isSuperAdmin } from "./auth-user";

/**
 * Company IDs the caller is authorized to see.
 * - Super Admin  -> null  (no restriction: all companies)
 * - Scoped staff -> their companyIds (empty array = sees nothing)
 *
 * Never pass the returned array to drizzle `inArray` without first checking
 * `length` — an empty array is truthy and produces invalid/empty-set SQL.
 */
export function companyScope(req: Request): number[] | null {
  const u = (req as any).localUser as User | undefined;
  if (u && isSuperAdmin(u)) return null;
  return ((u?.companyIds as number[] | undefined) ?? []);
}

/** True when the caller may access the given company. */
export function canAccessCompany(req: Request, companyId: number): boolean {
  const scope = companyScope(req);
  return scope === null || scope.includes(companyId);
}
