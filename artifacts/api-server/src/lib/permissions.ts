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
  { key: "treasury.view", label: "View treasury", group: "Treasury" },
  { key: "treasury.manage", label: "Manage treasury", group: "Treasury" },
  { key: "funds.view", label: "View fund allocations", group: "Fund Allocation" },
  { key: "funds.manage", label: "Manage fund allocations", group: "Fund Allocation" },
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
  { key: "ai.reports", label: "View & generate AI executive reports", group: "AI Intelligence" },
  { key: "ai_tasks.read", label: "View AI tasks", group: "AI Tasks" },
  { key: "ai_tasks.manage", label: "Manage AI tasks", group: "AI Tasks" },
  { key: "chat.read", label: "View chat", group: "Chat" },
  { key: "chat.write", label: "Create polls & announcements", group: "Chat" },
  { key: "chat.manage", label: "Manage chat", group: "Chat" },
  { key: "meetings.read", label: "View & join meetings", group: "Meetings" },
  { key: "meetings.create", label: "Create meetings", group: "Meetings" },
  { key: "meetings.manage", label: "Manage meetings (cancel, settings, notes)", group: "Meetings" },
  { key: "director.view", label: "View Director Portal", group: "Director" },
  { key: "callcenter.view", label: "Use the call center (make/receive calls, own history)", group: "Call Center" },
  { key: "callcenter.manage", label: "Manage call center (numbers, settings, all calls)", group: "Call Center" },
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
  { key: "marketing_manager", name: "Marketing Manager", description: "Runs marketing campaigns and analytics.", permissions: ["dashboard.view", "marketing.view", "marketing.manage", "crm.view", "documents.view", "chat.read", "chat.write", "meetings.read", "meetings.create"] },
  { key: "operations_manager", name: "Operations Manager", description: "Oversees orders, inventory and shipping.", permissions: ["dashboard.view", "orders.view", "orders.manage", "inventory.view", "inventory.manage", "shipping.view", "shipping.manage", "approvals.view", "chat.read", "chat.write", "meetings.read", "meetings.create"] },
  { key: "sales_manager", name: "Sales Manager", description: "Manages customers and sales orders.", permissions: ["dashboard.view", "crm.view", "crm.manage", "orders.view", "marketing.view", "chat.read", "chat.write", "meetings.read", "meetings.create"] },
  { key: "inventory_manager", name: "Inventory Manager", description: "Manages stock and products.", permissions: ["dashboard.view", "inventory.view", "inventory.manage", "orders.view", "chat.read", "chat.write", "meetings.read", "meetings.create"] },
  { key: "shipping_manager", name: "Shipping Manager", description: "Manages shipments and returns.", permissions: ["dashboard.view", "shipping.view", "shipping.manage", "orders.view", "chat.read", "chat.write", "meetings.read", "meetings.create"] },
  { key: "customer_support", name: "Customer Support", description: "Views customers and orders to help buyers.", permissions: ["dashboard.view", "crm.view", "orders.view", "chat.read", "chat.write", "callcenter.view", "meetings.read", "meetings.create"] },
  { key: "finance", name: "Finance", description: "Access to finance and documents.", permissions: ["dashboard.view", "finance.view", "finance.manage", "treasury.view", "treasury.manage", "funds.view", "funds.manage", "documents.view", "shareholders.view", "chat.read", "chat.write", "meetings.read", "meetings.create"] },
  { key: "director", name: "Director", description: "Company oversight: dashboard, finance, approvals and shareholder cap table.", permissions: ["dashboard.view", "finance.view", "treasury.view", "funds.view", "approvals.view", "approvals.manage", "shareholders.view", "documents.view", "chat.read", "chat.write", "chat.manage", "meetings.read", "meetings.create", "meetings.manage", "director.view"] },
  { key: "investor", name: "Investor", description: "Read-only high-level financial view.", permissions: ["dashboard.view", "finance.view", "meetings.read"] },
  { key: "shareholder", name: "Shareholder", description: "Views their own equity, cap table and investment history.", permissions: ["dashboard.view", "shareholders.view", "meetings.read"] },
];
