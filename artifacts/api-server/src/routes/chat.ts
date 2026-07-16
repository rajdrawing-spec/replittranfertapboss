import { Router, type IRouter } from "express";
import { requirePermission } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import { createSocketToken } from "../lib/chat/socket-server";
import {
  listChannels,
  getChannel,
  getMessages,
  searchMessages,
  getPinnedMessages,
  pinMessage,
  editMessage,
  deleteMessage,
  ensureDirectChannel,
  markChannelRead,
  getCompanyUsers,
  getUserDisplayName,
} from "../lib/chat/chat.service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function getLocalUserId(req: any): number | undefined {
  return req.localUser?.id as number | undefined;
}

// Token for Socket.IO authentication
router.get("/chat/token", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const token = createSocketToken(userId);
    res.json({ token });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create token" });
  }
});

router.get("/chat/channels", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const channels = await listChannels(companyId, userId);
    res.json(channels);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list channels" });
  }
});

router.get("/chat/channels/:id", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const channel = await getChannel(channelId, companyId);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    res.json(channel);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get channel" });
  }
});

router.get("/chat/channels/:id/messages", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string) : undefined;
    const messages = await getMessages(channelId, limit, beforeId);
    res.json(messages.reverse());
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

router.post("/chat/channels/:id/read", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    await markChannelRead(channelId, userId);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to mark channel read" });
  }
});

router.get("/chat/search", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const q = (req.query.q as string) || "";
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const results = await searchMessages(companyId, q, 20);
    res.json(results);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to search messages" });
  }
});

router.get("/chat/channels/:id/pinned", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const messages = await getPinnedMessages(channelId);
    res.json(messages);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load pinned messages" });
  }
});

router.patch("/chat/messages/:id/pin", requirePermission("chat.manage"), async (req, res) => {
  try {
    const messageId = parseInt(String(req.params.id), 10);
    const channelId = parseInt(req.body.channelId as string);
    const pinned = req.body.pinned !== false;
    const updated = await pinMessage(messageId, channelId, pinned);
    if (!updated) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to pin message" });
  }
});

router.patch("/chat/messages/:id", requirePermission("chat.read"), async (req, res) => {
  try {
    const messageId = parseInt(String(req.params.id), 10);
    const channelId = parseInt(req.body.channelId as string);
    const content = req.body.content as string;
    const updated = await editMessage(messageId, channelId, content);
    if (!updated) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to edit message" });
  }
});

router.delete("/chat/messages/:id", requirePermission("chat.manage"), async (req, res) => {
  try {
    const messageId = parseInt(String(req.params.id), 10);
    const channelId = parseInt(req.query.channelId as string);
    const userId = getLocalUserId(req);
    const deleted = await deleteMessage(messageId, channelId, userId ?? 0);
    if (!deleted) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

router.post("/chat/direct", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    const otherUserId = parseInt(req.body.userId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const channelId = await ensureDirectChannel(companyId, userId, otherUserId);
    res.json({ channelId });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create direct channel" });
  }
});

router.get("/chat/users", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const users = await getCompanyUsers(companyId);
    res.json(users);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list users" });
  }
});

export default router;
