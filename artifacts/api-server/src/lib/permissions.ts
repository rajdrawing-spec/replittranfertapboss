// Central permission catalog + system role definitions for TAPBOSS.

export const SUPER_ADMIN_EMAIL = "tapashub@gmail.com";

// Permission catalog. "platform.*" are sensitive admin powers reserved for the
// Super Admin. The remaining module permissions are assignable to any role.
export interface PermissionDef {
  key: string;
  label: string;
  group: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // Platform administration (Super Admin only)
  { key: "platform.companies", label: "Manage companies", group: "Administration" },
  { key: "platform.users", label: "Manage users & invitations", group: "Administration" },
  { key: "platform.roles", label: "Manage roles & permissions", group: "Administration" },
  { key: "platform.integrations", label: "Manage integrations & APIs", group: "Administration" },
  { key: "platform.billing", label: "Manage billing", group: "Administration" },
  { key: "platform.audit", label: "View audit logs", group: "Administration" },
  // Modules (assignable)
  { key: "dashboard.view", label: "View dashboard", group: "Dashboard" },
  { key: "orders.view", label: "View orders", group: "Orders" },
  { key: "orders.manage", label: "Manage orders", group: "Orders" },
  { key: "inventory.view", label: "View inventory", group: "Inventory" },
  { key: "inventory.manage", label: "Manage inventory", group: "Inventory" },
  { key: "finance.view", label: "View finance", group: "Finance" },
  { key: "finance.manage", label: "Manage finance", group: "Finance" },
  { key: "hr.view", label: "View HR & people", group: "HR" },
  { key: "hr.manage", label: "Manage HR & people", group: "HR" },
  { key: "crm.view", label: "View customers", group: "CRM" },
  { key: "crm.manage", label: "Manage customers", group: "CRM" },
  { key: "marketing.view", label: "View marketing", group: "Marketing" },
  { key: "marketing.manage", label: "Manage marketing", group: "Marketing" },
  { key: "shipping.view", label: "View shipping", group: "Shipping" },
  { key: "shipping.manage", label: "Manage shipping", group: "Shipping" },
  { key: "documents.view", label: "View documents", group: "Documents" },
  { key: "documents.manage", label: "Manage documents", group: "Documents" },
  { key: "directory.view", label: "View account directory", group: "Directory" },
  { key: "directory.manage", label: "Manage account directory", group: "Directory" },
  { key: "approvals.view", label: "View approvals", group: "Approvals" },
  { key: "approvals.manage", label: "Manage approvals", group: "Approvals" },
  { key: "shareholders.view", label: "View shareholders & cap table", group: "Shareholders" },
  { key: "shareholders.manage", label: "Manage shareholders & equity", group: "Shareholders" },
  { key: "ai.read", label: "View AI business intelligence", group: "AI Intelligence" },
];

export const ALL_MODULE_PERMISSIONS = PERMISSIONS.filter((p) => !p.key.startsWith("platform.")).map((p) => p.key);

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

// System roles seeded on boot. super_admin is granted "*" (everything).
export const SYSTEM_ROLES: SystemRoleDef[] = [
  { key: "super_admin", name: "Super Admin", description: "Full platform control. Only one Super Admin exists.", permissions: ["*"] },
  { key: "company_admin", name: "Company Admin", description: "Full access to all modules for assigned companies.", permissions: ALL_MODULE_PERMISSIONS },
  { key: "marketing_manager", name: "Marketing Manager", description: "Runs marketing campaigns and analytics.", permissions: ["dashboard.view", "marketing.view", "marketing.manage", "crm.view", "documents.view"] },
  { key: "operations_manager", name: "Operations Manager", description: "Oversees orders, inventory and shipping.", permissions: ["dashboard.view", "orders.view", "orders.manage", "inventory.view", "inventory.manage", "shipping.view", "shipping.manage", "approvals.view"] },
  { key: "sales_manager", name: "Sales Manager", description: "Manages customers and sales orders.", permissions: ["dashboard.view", "crm.view", "crm.manage", "orders.view", "marketing.view"] },
  { key: "inventory_manager", name: "Inventory Manager", description: "Manages stock and products.", permissions: ["dashboard.view", "inventory.view", "inventory.manage", "orders.view"] },
  { key: "shipping_manager", name: "Shipping Manager", description: "Manages shipments and returns.", permissions: ["dashboard.view", "shipping.view", "shipping.manage", "orders.view"] },
  { key: "customer_support", name: "Customer Support", description: "Views customers and orders to help buyers.", permissions: ["dashboard.view", "crm.view", "orders.view"] },
  { key: "finance", name: "Finance", description: "Access to finance and documents.", permissions: ["dashboard.view", "finance.view", "finance.manage", "documents.view", "shareholders.view"] },
  { key: "director", name: "Director", description: "Company oversight: dashboard, finance, approvals and shareholder cap table.", permissions: ["dashboard.view", "finance.view", "approvals.view", "approvals.manage", "shareholders.view", "documents.view"] },
  { key: "investor", name: "Investor", description: "Read-only high-level financial view.", permissions: ["dashboard.view", "finance.view"] },
  { key: "shareholder", name: "Shareholder", description: "Views their own equity, cap table and investment history.", permissions: ["dashboard.view", "shareholders.view"] },
];
