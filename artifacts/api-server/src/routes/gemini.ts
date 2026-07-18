/**
 * Gemini conversation routes — wraps the Gemini AI integration for
 * persistent chat history stored in the conversations/messages tables.
 *
 * Conversations are private per authenticated user (ownerUserId).
 */
import { Router } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { ai } from "@workspace/integrations-gemini-ai";
import { eq, and, asc } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";

const router = Router();

// All Gemini chat routes require ai.read permission
router.use("/gemini", requirePermission("ai.read"));

/** Get the authenticated local user's ID from the request. */
function localUserId(req: Parameters<typeof router.get>[1] extends (...args: infer A) => unknown ? A[0] : never): number | null {
  const u = (req as any).localUser as User | undefined;
  return u?.id ?? null;
}

// ── List conversations (own only) ─────────────────────────────────────────────
router.get("/gemini/conversations", async (req, res) => {
  try {
    const userId = localUserId(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.ownerUserId, userId))
      .orderBy(conversationsTable.createdAt);
    res.json(rows.map(fmt));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

// ── Create conversation ───────────────────────────────────────────────────────
router.post("/gemini/conversations", async (req, res) => {
  try {
    const userId = localUserId(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { title } = req.body as { title?: string };
    if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }
    const [row] = await db
      .insert(conversationsTable)
      .values({ title: title.trim(), ownerUserId: userId })
      .returning();
    res.status(201).json(fmt(row));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// ── Get conversation with messages (own only) ─────────────────────────────────
router.get("/gemini/conversations/:id", async (req, res) => {
  try {
    const userId = localUserId(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = parseInt(req.params.id as string);
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.ownerUserId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "Not found" }); return; }
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(asc(messagesTable.createdAt));
    res.json({ ...fmt(conv), messages: msgs.map(fmtMsg) });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

// ── Delete conversation (own only) ────────────────────────────────────────────
router.delete("/gemini/conversations/:id", async (req, res) => {
  try {
    const userId = localUserId(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = parseInt(req.params.id as string);
    // Verify ownership before deleting
    const [conv] = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.ownerUserId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
    res.status(204).end();
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// ── List messages (own conversation only) ──────────────────────────────────────
router.get("/gemini/conversations/:id/messages", async (req, res) => {
  try {
    const userId = localUserId(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = parseInt(req.params.id as string);
    const [conv] = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.ownerUserId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "Not found" }); return; }
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(asc(messagesTable.createdAt));
    res.json(msgs.map(fmtMsg));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list messages" });
  }
});

// ── Send message (own conversation only, SSE streaming) ───────────────────────
router.post("/gemini/conversations/:id/messages", async (req, res) => {
  try {
    const userId = localUserId(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = parseInt(req.params.id as string);
    const { content } = req.body as { content?: string };
    if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.ownerUserId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Save user message
    await db.insert(messagesTable).values({ conversationId: id, role: "user", content: content.trim() });

    // Load history for context
    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(asc(messagesTable.createdAt));

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";
    const stream = await ai.models.generateContentStream({
      model: "gemini-flash-latest",
      contents: history.map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      })),
      config: {
        maxOutputTokens: 8192,
        systemInstruction:
          "You are TAPBOSS AI, an intelligent business assistant for a multi-company business operating system. Be concise, professional, and data-driven.",
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    // Save assistant reply
    await db.insert(messagesTable).values({ conversationId: id, role: "assistant", content: fullResponse });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (e) {
    req.log.error(e);
    res.write(`data: ${JSON.stringify({ error: "AI response failed" })}\n\n`);
    res.end();
  }
});

function fmt(c: typeof conversationsTable.$inferSelect) {
  return { id: c.id, title: c.title, createdAt: c.createdAt.toISOString() };
}
function fmtMsg(m: typeof messagesTable.$inferSelect) {
  return { id: m.id, conversationId: m.conversationId, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() };
}

export default router;
