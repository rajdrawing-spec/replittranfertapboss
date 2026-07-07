import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

interface StarterCompany {
  name: string;
  slug: string;
  type: "parent" | "subsidiary";
  industry: string;
  category: string;
  brandColor: string;
}

/**
 * The 8 real starter companies. These are created only if missing (by slug),
 * so Super Admin edits/deletes are never clobbered on subsequent boots.
 * No fake revenue/employees — those default to 0.
 */
const STARTER_COMPANIES: StarterCompany[] = [
  { name: "TapasHub", slug: "tapashub", type: "parent", industry: "Holding Company", category: "Holding & Investments", brandColor: "#2563EB" },
  { name: "HugFAB", slug: "hugfab", type: "subsidiary", industry: "Fashion & Apparel", category: "Fashion & Apparel", brandColor: "#EC4899" },
  { name: "TikkaTails", slug: "tikkatails", type: "subsidiary", industry: "Pet Care", category: "Pet Food & Supplies", brandColor: "#F59E0B" },
  { name: "Throttledaires", slug: "throttledaires", type: "subsidiary", industry: "Automotive", category: "Automotive & Accessories", brandColor: "#EF4444" },
  { name: "Sanchikart", slug: "sanchikart", type: "subsidiary", industry: "E-commerce", category: "Online Marketplace", brandColor: "#8B5CF6" },
  { name: "Pepalworks", slug: "pepalworks", type: "subsidiary", industry: "Stationery", category: "Paper & Stationery", brandColor: "#14B8A6" },
  { name: "Tottotoy", slug: "tottotoy", type: "subsidiary", industry: "Toys", category: "Toys & Games", brandColor: "#10B981" },
  { name: "Undertree Games", slug: "undertreegames", type: "subsidiary", industry: "Gaming", category: "Game Studio", brandColor: "#6366F1" },
];

/**
 * Idempotently ensure the starter companies exist. Runs on server boot so a
 * fresh deployment always has the base set of companies. Existing records
 * (matched by slug) are left untouched to preserve admin edits.
 */
export async function ensureStarterCompanies(): Promise<void> {
  try {
    let created = 0;
    for (const c of STARTER_COMPANIES) {
      const existing = await db
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.slug, c.slug))
        .limit(1);
      if (existing[0]) continue;
      await db.insert(companiesTable).values({
        name: c.name,
        slug: c.slug,
        type: c.type,
        industry: c.industry,
        category: c.category,
        brandColor: c.brandColor,
        ownershipPercent: 100,
        status: "active",
        archived: false,
        currency: "INR",
        country: "India",
        timezone: "Asia/Kolkata",
      });
      created += 1;
    }
    logger.info({ created }, "Starter companies ensured");
  } catch (e) {
    logger.error({ err: e }, "Failed to ensure starter companies");
  }
}
