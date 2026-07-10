/**
 * Business context builder for AI analysis.
 *
 * Aggregates a rich company snapshot from Finance, Treasury, Orders, CRM,
 * HR, and Inventory — returning a structured object that can be serialised
 * into an AI prompt.
 */

import { db, transactionsTable, ordersTable, leadsTable, customersTable, employeesTable, productsTable, companiesTable, treasuryEntriesTable, fundAllocationsTable } from "@workspace/db";
import { eq, and, sql, inArray, ne } from "drizzle-orm";

export interface CompanyContext {
  companyId: number;
  companyName: string;
  companyType: string;
  // Finance
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  netMargin: number | null;
  // Treasury (only for parent company)
  treasuryCapital?: number;
  treasuryAvailable?: number;
  treasuryUtilisation?: number;
  // Orders / Sales
  totalOrders: number;
  pendingOrders: number;
  monthlyOrderRevenue: number;
  // CRM
  totalLeads: number;
  activeLeads: number;
  wonLeads: number;
  totalCustomers: number;
  // HR
  activeEmployees: number;
  estimatedPayrollCost: number;
  // Inventory
  totalProducts: number;
  lowStockItems: number;
  outOfStockItems: number;
  // Derived
  revenuePerEmployee: number | null;
  expenseRatio: number | null;
  topExpenseCategories: { category: string; total: number }[];
}

export interface PortfolioContext {
  companies: CompanyContext[];
  groupRevenue: number;
  groupExpenses: number;
  groupNetProfit: number;
  activeEmployees: number;
}

export async function buildCompanyContext(companyId: number): Promise<CompanyContext | null> {
  const [company] = await db
    .select({ id: companiesTable.id, name: companiesTable.name, type: companiesTable.type })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) return null;

  // Finance totals
  const [finance] = await db
    .select({
      totalIncome:   sql<number>`coalesce(sum(case when type='income'  and status='completed' then amount else 0 end),0)`,
      totalExpenses: sql<number>`coalesce(sum(case when type='expense' and status='completed' then amount else 0 end),0)`,
    })
    .from(transactionsTable)
    .where(eq(transactionsTable.companyId, companyId));

  // Top expense categories (last 6 months)
  const topExpenseCats = await db
    .select({
      category: transactionsTable.category,
      total: sql<number>`coalesce(sum(amount),0)`,
    })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.companyId, companyId),
        eq(transactionsTable.type, "expense"),
        sql`created_at >= now() - interval '6 months'`,
      ),
    )
    .groupBy(transactionsTable.category)
    .orderBy(sql`sum(amount) desc`)
    .limit(5);

  // Orders
  const [orders] = await db
    .select({
      total:   sql<number>`count(*)`,
      pending: sql<number>`count(*) filter (where status='pending')`,
      revenue: sql<number>`coalesce(sum(total_amount),0)`,
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.companyId, companyId),
        sql`created_at >= date_trunc('month', now())`,
      ),
    );

  const [allOrders] = await db
    .select({ total: sql<number>`count(*)` })
    .from(ordersTable)
    .where(eq(ordersTable.companyId, companyId));

  // CRM
  const [leads] = await db
    .select({
      total:  sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where stage not in ('won','lost'))`,
      won:    sql<number>`count(*) filter (where stage='won')`,
    })
    .from(leadsTable)
    .where(eq(leadsTable.companyId, companyId));

  const [custCount] = await db
    .select({ total: sql<number>`count(*)` })
    .from(customersTable)
    .where(eq(customersTable.companyId, companyId));

  // HR
  const [emp] = await db
    .select({
      count:   sql<number>`count(*)`,
      payroll: sql<number>`coalesce(sum(salary),0)`,
    })
    .from(employeesTable)
    .where(
      and(eq(employeesTable.companyId, companyId), eq(employeesTable.status, "active")),
    );

  // Inventory
  const [inv] = await db
    .select({
      total:      sql<number>`count(*)`,
      lowStock:   sql<number>`count(*) filter (where stock_quantity <= reorder_level and stock_quantity > 0)`,
      outOfStock: sql<number>`count(*) filter (where stock_quantity = 0)`,
    })
    .from(productsTable)
    .where(eq(productsTable.companyId, companyId));

  const totalIncome   = Number(finance?.totalIncome   ?? 0);
  const totalExpenses = Number(finance?.totalExpenses ?? 0);
  const netProfit     = totalIncome - totalExpenses;
  const activeEmp     = Number(emp?.count ?? 0);

  // Treasury (only meaningful for parent)
  let treasuryCapital: number | undefined;
  let treasuryAvailable: number | undefined;
  let treasuryUtilisation: number | undefined;
  if (company.type === "parent") {
    const [raised] = await db
      .select({ total: sql<number>`coalesce(sum(amount),0)` })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "approved"), eq(treasuryEntriesTable.isReversed, false)));
    treasuryCapital = Number(raised?.total ?? 0);
    treasuryAvailable = treasuryCapital - totalExpenses;
    treasuryUtilisation = treasuryCapital > 0 ? (totalExpenses / treasuryCapital) * 100 : 0;
  }

  return {
    companyId:    company.id,
    companyName:  company.name,
    companyType:  company.type,
    totalIncome,
    totalExpenses,
    netProfit,
    netMargin:    totalIncome > 0 ? (netProfit / totalIncome) * 100 : null,
    treasuryCapital,
    treasuryAvailable,
    treasuryUtilisation,
    totalOrders:         Number(allOrders?.total ?? 0),
    pendingOrders:       Number(orders?.pending  ?? 0),
    monthlyOrderRevenue: Number(orders?.revenue  ?? 0),
    totalLeads:      Number(leads?.total  ?? 0),
    activeLeads:     Number(leads?.active ?? 0),
    wonLeads:        Number(leads?.won    ?? 0),
    totalCustomers:  Number(custCount?.total ?? 0),
    activeEmployees: activeEmp,
    estimatedPayrollCost: Number(emp?.payroll ?? 0),
    totalProducts:  Number(inv?.total      ?? 0),
    lowStockItems:  Number(inv?.lowStock   ?? 0),
    outOfStockItems: Number(inv?.outOfStock ?? 0),
    revenuePerEmployee: activeEmp > 0 ? Math.round(totalIncome / activeEmp) : null,
    expenseRatio: totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : null,
    topExpenseCategories: topExpenseCats.map((r) => ({
      category: r.category ?? "Uncategorised",
      total:    Number(r.total),
    })),
  };
}

export async function buildPortfolioContext(companyIds?: number[]): Promise<PortfolioContext> {
  const allCompanies = await db
    .select({ id: companiesTable.id })
    .from(companiesTable);

  const ids = companyIds?.length ? companyIds : allCompanies.map((c) => c.id);
  const contexts = await Promise.all(ids.map(buildCompanyContext));
  const valid = contexts.filter(Boolean) as CompanyContext[];

  return {
    companies:     valid,
    groupRevenue:  valid.reduce((s, c) => s + c.totalIncome,   0),
    groupExpenses: valid.reduce((s, c) => s + c.totalExpenses, 0),
    groupNetProfit: valid.reduce((s, c) => s + c.netProfit,    0),
    activeEmployees: valid.reduce((s, c) => s + c.activeEmployees, 0),
  };
}

/** Serialise a company context into a concise prose block for use in AI prompts. */
export function formatContextForPrompt(ctx: CompanyContext): string {
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const lines: string[] = [
    `Company: ${ctx.companyName} (${ctx.companyType})`,
    `Finance: Income ${fmt(ctx.totalIncome)}, Expenses ${fmt(ctx.totalExpenses)}, Net Profit ${fmt(ctx.netProfit)}${ctx.netMargin != null ? ` (${ctx.netMargin.toFixed(1)}% margin)` : ""}`,
  ];
  if (ctx.treasuryCapital !== undefined) {
    lines.push(`Treasury: Capital raised ${fmt(ctx.treasuryCapital)}, Available ${fmt(ctx.treasuryAvailable ?? 0)}, Utilisation ${(ctx.treasuryUtilisation ?? 0).toFixed(1)}%`);
  }
  lines.push(`Orders: ${ctx.totalOrders} total, ${ctx.pendingOrders} pending, ${fmt(ctx.monthlyOrderRevenue)} this month`);
  lines.push(`CRM: ${ctx.totalLeads} leads (${ctx.activeLeads} active, ${ctx.wonLeads} won), ${ctx.totalCustomers} customers`);
  lines.push(`HR: ${ctx.activeEmployees} active employees, estimated payroll ${fmt(ctx.estimatedPayrollCost)}/month`);
  lines.push(`Inventory: ${ctx.totalProducts} products, ${ctx.lowStockItems} low stock, ${ctx.outOfStockItems} out of stock`);
  if (ctx.topExpenseCategories.length > 0) {
    lines.push(`Top expense categories: ${ctx.topExpenseCategories.map((e) => `${e.category} ${fmt(e.total)}`).join(", ")}`);
  }
  return lines.join("\n");
}
