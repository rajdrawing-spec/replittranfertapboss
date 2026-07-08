---
name: TBOS frontend auth-mock in tests
description: Tests that render admin views must mock useAuth to return hasPermission:()=>true
---

## Problem
`company-scoping-selector-views.test.tsx` renders page components without an `AuthProvider`. The default context returns `hasPermission: () => false`. Any component that branches on `hasPermission("X.manage")` will render the self-service (non-admin) view, causing test assertions against admin UI elements to fail silently.

## Fix
Add at the top of the test file:
```ts
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Admin", email: "admin@test.com", role: "company_admin", companyIds: [], permissions: ["X.manage", "X.view"] },
    hasPermission: () => true,
    isSuperAdmin: false,
    loading: false,
    accessError: null, accessMessage: null, loadError: false,
    logout: async () => {}, refetch: async () => {},
  }),
}))
```

## Rule
Whenever a new page component branches on `hasPermission` and the existing test suite wraps components without `AuthProvider`, add or update the `@/contexts/auth-context` mock so tests render the intended (admin) path.
