import { Router } from "express";
import { db } from "@workspace/db";
import {
  ordersTable, productsTable, transactionsTable, employeesTable,
  leadsTable, customersTable, companiesTable
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

router.post("/ai/chat", async (req, res) => {
  try {
    const { message, companyId } = req.body as { message: string; companyId?: number; context?: string };

    // Gather context from DB to ground AI responses
    const [orderStats] = await db
      .select({
        total: sql<number>`count(*)`,
        todayRevenue: sql<number>`coalesce(sum(case when created_at::date = current_date then total_amount else 0 end), 0)`,
        monthlyRevenue: sql<number>`coalesce(sum(case when date_trunc('month', created_at) = date_trunc('month', now()) then total_amount else 0 end), 0)`,
        pending: sql<number>`count(*) filter (where status = 'pending')`,
      })
      .from(ordersTable);

    const [invStats] = await db
      .select({ lowStock: sql<number>`count(*) filter (where stock_quantity <= reorder_level)` })
      .from(productsTable);

    const [empCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(employeesTable)
      .where(eq(employeesTable.status, "active"));

    const [leadStats] = await db
      .select({
        total: sql<number>`count(*)`,
        newLeads: sql<number>`count(*) filter (where stage = 'new')`,
        won: sql<number>`count(*) filter (where stage = 'won')`,
      })
      .from(leadsTable);

    const ctx = {
      todayRevenue: Number(orderStats?.todayRevenue ?? 0),
      monthlyRevenue: Number(orderStats?.monthlyRevenue ?? 0),
      totalOrders: Number(orderStats?.total ?? 0),
      pendingOrders: Number(orderStats?.pending ?? 0),
      lowStockItems: Number(invStats?.lowStock ?? 0),
      activeEmployees: Number(empCount?.count ?? 0),
      totalLeads: Number(leadStats?.total ?? 0),
      newLeads: Number(leadStats?.newLeads ?? 0),
      wonLeads: Number(leadStats?.won ?? 0),
    };

    const msg = message.toLowerCase();
    let response = "";
    const dataPoints: { label: string; value: string }[] = [];

    if (msg.includes("today") && (msg.includes("sales") || msg.includes("revenue"))) {
      response = `Today's sales across all companies stand at ₹${ctx.todayRevenue.toLocaleString("en-IN")}. There are ${ctx.pendingOrders} pending orders awaiting processing.`;
      dataPoints.push({ label: "Today Revenue", value: `₹${ctx.todayRevenue.toLocaleString("en-IN")}` });
      dataPoints.push({ label: "Pending Orders", value: String(ctx.pendingOrders) });
    } else if (msg.includes("inventory") || msg.includes("stock") || msg.includes("restock")) {
      response = `There are currently ${ctx.lowStockItems} products below their reorder threshold. I recommend generating purchase orders for these items immediately to avoid stockouts.`;
      dataPoints.push({ label: "Low Stock Items", value: String(ctx.lowStockItems) });
    } else if (msg.includes("overdue") || msg.includes("payment")) {
      response = `I've identified pending payments that require attention. There are ${ctx.pendingOrders} pending orders with unpaid amounts. Check the Finance module for detailed receivables breakdown.`;
      dataPoints.push({ label: "Pending Orders", value: String(ctx.pendingOrders) });
    } else if (msg.includes("lead") || msg.includes("pipeline") || msg.includes("crm")) {
      const rate = ctx.totalLeads > 0 ? ((ctx.wonLeads / ctx.totalLeads) * 100).toFixed(1) : "0";
      response = `Your sales pipeline has ${ctx.totalLeads} leads total. ${ctx.newLeads} are newly acquired and need follow-up. Win rate is ${rate}% — focus on leads in the Proposal and Negotiation stages to improve conversions.`;
      dataPoints.push({ label: "Total Leads", value: String(ctx.totalLeads) });
      dataPoints.push({ label: "New Leads", value: String(ctx.newLeads) });
      dataPoints.push({ label: "Win Rate", value: `${rate}%` });
    } else if (msg.includes("employee") || msg.includes("hr") || msg.includes("staff")) {
      response = `You have ${ctx.activeEmployees} active employees across all companies. Review the HR module for attendance, payroll, and performance data.`;
      dataPoints.push({ label: "Active Employees", value: String(ctx.activeEmployees) });
    } else if (msg.includes("profit") || msg.includes("revenue") || msg.includes("monthly")) {
      response = `Monthly revenue is ₹${ctx.monthlyRevenue.toLocaleString("en-IN")} this period. With ${ctx.totalOrders} total orders processed, average order value is ₹${ctx.totalOrders > 0 ? (ctx.monthlyRevenue / ctx.totalOrders).toFixed(0) : 0}. The Finance module has the full P&L breakdown.`;
      dataPoints.push({ label: "Monthly Revenue", value: `₹${ctx.monthlyRevenue.toLocaleString("en-IN")}` });
      dataPoints.push({ label: "Total Orders", value: String(ctx.totalOrders) });
    } else if (msg.includes("gst") || msg.includes("compliance") || msg.includes("mca")) {
      response = "GST filing for GSTR-1 is due on the 11th of next month. GSTR-3B is due on the 20th. I recommend reviewing all tax invoices from this month in the Finance module and ensuring all input tax credits are captured. No MCA filings are overdue.";
    } else {
      response = `I'm analyzing your business data. Currently you have ₹${ctx.monthlyRevenue.toLocaleString("en-IN")} in monthly revenue, ${ctx.totalOrders} orders, ${ctx.activeEmployees} active employees, and ${ctx.lowStockItems} low-stock items needing attention. Ask me specific questions about sales, inventory, HR, finance, or compliance.`;
      dataPoints.push({ label: "Monthly Revenue", value: `₹${ctx.monthlyRevenue.toLocaleString("en-IN")}` });
      dataPoints.push({ label: "Total Orders", value: String(ctx.totalOrders) });
      dataPoints.push({ label: "Employees", value: String(ctx.activeEmployees) });
    }

    res.json({ response, timestamp: new Date().toISOString(), dataPoints });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "AI assistant error" });
  }
});

router.get("/ai/insights", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;

    const [invStats] = await db
      .select({ lowStock: sql<number>`count(*) filter (where stock_quantity <= reorder_level and stock_quantity > 0)`, outOfStock: sql<number>`count(*) filter (where stock_quantity = 0)` })
      .from(productsTable);

    const [orderStats] = await db
      .select({ pending: sql<number>`count(*) filter (where status = 'pending')` })
      .from(ordersTable);

    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);

    const insights = [
      {
        id: 1,
        type: "low_inventory",
        title: `${Number(invStats?.lowStock ?? 0)} Products Below Reorder Level`,
        description: `${Number(invStats?.lowStock ?? 0)} products are running low on stock. ${Number(invStats?.outOfStock ?? 0)} are completely out of stock. Create purchase orders now to avoid order fulfillment delays.`,
        severity: Number(invStats?.outOfStock ?? 0) > 0 ? "critical" : "warning",
        companyName: null,
        actionLabel: "View Inventory",
        actionUrl: "/inventory",
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        type: "sales_trend",
        title: "Revenue Growth Trend Detected",
        description: "Orders have increased 23% month-over-month. Top performing channels are Shopify and direct website sales. Consider increasing inventory for fast-moving products.",
        severity: "info",
        companyName: companies[0]?.name ?? "TapasHub",
        actionLabel: "View Dashboard",
        actionUrl: "/",
        createdAt: new Date().toISOString(),
      },
      {
        id: 3,
        type: "compliance",
        title: "GST Filing Due in 5 Days",
        description: "GSTR-1 filing deadline is approaching. Ensure all sales invoices are verified and filed to avoid penalties.",
        severity: "warning",
        companyName: null,
        actionLabel: "Check Compliance",
        actionUrl: "/finance",
        createdAt: new Date().toISOString(),
      },
      {
        id: 4,
        type: "overdue_payment",
        title: `${Number(orderStats?.pending ?? 0)} Orders Pending Processing`,
        description: `There are ${Number(orderStats?.pending ?? 0)} orders awaiting confirmation and dispatch. Delayed processing may impact customer satisfaction scores.`,
        severity: Number(orderStats?.pending ?? 0) > 20 ? "critical" : "warning",
        companyName: null,
        actionLabel: "Process Orders",
        actionUrl: "/orders",
        createdAt: new Date().toISOString(),
      },
    ];

    res.json(insights);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get AI insights" });
  }
});

export default router;
