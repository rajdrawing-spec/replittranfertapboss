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
  getPolls,
  createPoll,
  votePoll,
  closePoll,
  getUserStatuses,
  upsertUserStatus,
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

router.get("/chat/channels/:id/polls", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const polls = await getPolls(channelId);
    res.json(polls);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load polls" });
  }
});

router.post("/chat/channels/:id/polls", requirePermission("chat.write"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { question, options, isMultiple } = req.body;
    if (!question || !Array.isArray(options) || options.length < 2) {
      res.status(400).json({ error: "Question and at least two options required" });
      return;
    }
    const poll = await createPoll({ channelId, userId, question, options, isMultiple });
    res.json(poll);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create poll" });
  }
});

router.post("/chat/polls/:id/vote", requirePermission("chat.read"), async (req, res) => {
  try {
    const pollId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const optionIndex = parseInt(req.body.optionIndex as string);
    if (Number.isNaN(optionIndex)) {
      res.status(400).json({ error: "Invalid option index" });
      return;
    }
    const updated = await votePoll(pollId, userId, optionIndex);
    if (!updated) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to vote" });
  }
});

router.post("/chat/polls/:id/close", requirePermission("chat.write"), async (req, res) => {
  try {
    const pollId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const updated = await closePoll(pollId, userId);
    if (!updated) {
      res.status(404).json({ error: "Poll not found or not owner" });
      return;
    }
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to close poll" });
  }
});

router.get("/users/status", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const statuses = await getUserStatuses(companyId);
    res.json(statuses);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load statuses" });
  }
});

router.post("/users/status", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { presence, statusMessage, doNotDisturb } = req.body;
    const updated = await upsertUserStatus(userId, {
      presence,
      statusMessage,
      doNotDisturb: !!doNotDisturb,
    });
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update status" });
  }
});

export default router;
