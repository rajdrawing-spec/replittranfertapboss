---
name: TBOS client-side company scoping
description: How company-scoped list pages must pass the active company on the frontend
---

# Client-side company scoping (TapasHub web)

A company-scoped list page must include `activeCompany.id` (from `useCompany()`)
in BOTH the request params AND the react-query `queryKey`.

**Why:** If the page omits it, the request has no `companyId`, so the server
returns every company the user can access (not the active one), and the query
key never changes on company switch — so the page silently shows cross-company
data and never rescopes. CRM and Approvals originally did exactly this (fetched
a constant `{ limit: 50 }`), unlike Orders/Inventory/Finance/HR.

**How to apply:** For any new scoped list view, build a params object, add
`companyId` when `activeCompany` is set, and pass the same object to both the
hook and its `getListXQueryKey(...)`. Isolation is proven in
`src/pages/company-scoping.test.tsx` (Orders + detail) and
`src/pages/company-scoping-modules.test.tsx` (Inventory/Finance/HR/CRM/Approvals):
mock global fetch keyed by the `companyId` query param, drive the active company
via `CompanyProvider` + a switcher, assert only the active company's row renders
and requests carry the right `companyId`.
