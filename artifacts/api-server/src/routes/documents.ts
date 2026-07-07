import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, insertDocumentSchema } from "@workspace/db";
import { eq, and, desc, or, ilike } from "drizzle-orm";
import { isSafeAttachmentUrl } from "../lib/url-safety";
import { canAccessCompany } from "../lib/company-scope";

const router = Router();

router.get("/documents", async (req, res) => {
  try {
    const { companyId, category, q } = req.query as Record<string, string>;
    const conds = [];
    if (companyId) conds.push(eq(documentsTable.companyId, parseInt(companyId)));
    if (category && category !== "all") conds.push(eq(documentsTable.category, category));
    if (q) {
      const like = `%${q}%`;
      conds.push(or(ilike(documentsTable.name, like), ilike(documentsTable.issuer, like), ilike(documentsTable.referenceNumber, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(documentsTable).where(where).orderBy(desc(documentsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list documents" }); }
});

router.post("/documents", async (req, res) => {
  try {
    const parsed = insertDocumentSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    if (parsed.data.companyId != null && !canAccessCompany(req, parsed.data.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!isSafeAttachmentUrl(parsed.data.fileUrl)) {
      res.status(400).json({ error: "Unsafe URL: only http(s) links or uploaded files are allowed" }); return;
    }
    const [d] = await db.insert(documentsTable).values(parsed.data).returning();
    res.status(201).json(d);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create document" }); }
});

router.patch("/documents/:id", async (req, res) => {
  try {
    const { id: _id, createdAt: _c, updatedAt: _u, companyId: _cid, ...body } = req.body ?? {};
    const [existing] = await db.select().from(documentsTable).where(eq(documentsTable.id, parseInt(req.params.id)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.companyId != null && !canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!isSafeAttachmentUrl(body.fileUrl)) {
      res.status(400).json({ error: "Unsafe URL: only http(s) links or uploaded files are allowed" }); return;
    }
    const [d] = await db.update(documentsTable).set({ ...body, updatedAt: new Date() }).where(eq(documentsTable.id, parseInt(req.params.id))).returning();
    if (!d) { res.status(404).json({ error: "Not found" }); return; }
    res.json(d);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update document" }); }
});

router.delete("/documents/:id", async (req, res) => {
  try {
    const [d] = await db.delete(documentsTable).where(eq(documentsTable.id, parseInt(req.params.id))).returning();
    if (!d) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete document" }); }
});

export default router;
