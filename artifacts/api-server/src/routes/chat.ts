import { Router, type IRouter } from "express";
import { requirePermission } from "../middleware/authz";
import { createSocketToken } from "../lib/chat/socket-server";
import {
  listChannels,
  getChannelById,
  getMessages,
  getMessageById,
  searchMessages,
  getPinnedMessages,
  pinMessage,
  editMessage,
  deleteMessage,
  ensureDirectChannel,
  markChannelRead,
  getUserDisplayName,
  getPolls,
  createPoll,
  votePoll,
  closePoll,
  getUserStatuses,
  upsertUserStatus,
  getWorkspaceUsers,
  getWorkspaceUsersScopedToCompanies,
  createGroupChannel,
  updateChannelInfo,
  getChannelMembers,
  addChannelMember,
  removeChannelMember,
  setChannelMemberAdmin,
  isChannelMember,
  isChannelAdmin,
  canAccessChannel,
  forwardMessage,
  getPollById,
} from "../lib/chat/chat.service";
import { db, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

function getLocalUserId(req: any): number | undefined {
  return req.localUser?.id as number | undefined;
}

function getLocalUserCompanyId(req: any): number {
  const u = req.localUser;
  const ids: number[] = (u?.companyIds as number[]) ?? [];
  return ids[0] ?? 1; // fallback to 1 for super admin
}

/* ─────────────────── Auth token ──────────────────────────────────────── */

router.get("/chat/token", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const token = createSocketToken(userId);
    res.json({ token });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create token" });
  }
});

/* ─────────────────── Channel listing (workspace-level) ───────────────── */

router.get("/chat/channels", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const channels = await listChannels(userId);
    res.json(channels);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list channels" });
  }
});

router.get("/chat/channels/:id", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const channel = await getChannelById(channelId);
    if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    res.json(channel);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get channel" });
  }
});

/* ─────────────────── Channel update ──────────────────────────────────── */

router.patch("/chat/channels/:id", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const admin = await isChannelAdmin(channelId, userId);
    if (!admin) { res.status(403).json({ error: "Only channel admins can edit channel info" }); return; }
    const { name, iconUrl, description } = req.body;
    const updated = await updateChannelInfo(channelId, { name, iconUrl, description });
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update channel" });
  }
});

/* ─────────────────── Channel members ─────────────────────────────────── */

router.get("/chat/channels/:id/members", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    const members = await getChannelMembers(channelId);
    res.json(members);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get members" });
  }
});

router.post("/chat/channels/:id/members", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    const targetUserId = parseInt(req.body.userId as string);
    if (!userId || !targetUserId) { res.status(400).json({ error: "userId required" }); return; }
    const admin = await isChannelAdmin(channelId, userId);
    if (!admin) { res.status(403).json({ error: "Only admins can add members" }); return; }

    // Verify target user shares at least one company with the requester (SA bypasses)
    const callerRow = (req as any).localUser as { companyIds?: number[]; role?: string } | undefined;
    const isSA = callerRow?.role === "super_admin";
    if (!isSA) {
      const callerCompanyIds: number[] = (callerRow?.companyIds as number[] | null) ?? [];
      const [other] = await db.select({ companyIds: usersTable.companyIds, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, targetUserId)).limit(1);
      if (!other) { res.status(404).json({ error: "User not found" }); return; }
      const otherCompanyIds: number[] = (other.companyIds as number[] | null) ?? [];
      const hasSharedCompany = other.role === "super_admin" || otherCompanyIds.some((id) => callerCompanyIds.includes(id));
      if (!hasSharedCompany) { res.status(403).json({ error: "Cannot add user from a different company" }); return; }
    }

    await addChannelMember(channelId, targetUserId);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to add member" });
  }
});

router.delete("/chat/channels/:id/members/:userId", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const targetUserId = parseInt(String(req.params.userId), 10);
    const requesterId = getLocalUserId(req);
    if (!requesterId) { res.status(401).json({ error: "Authentication required" }); return; }
    // Allow self-leave or admin removal
    if (requesterId !== targetUserId) {
      const admin = await isChannelAdmin(channelId, requesterId);
      if (!admin) { res.status(403).json({ error: "Only admins can remove others" }); return; }
    }
    await removeChannelMember(channelId, targetUserId);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

router.patch("/chat/channels/:id/members/:userId", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const targetUserId = parseInt(String(req.params.userId), 10);
    const requesterId = getLocalUserId(req);
    if (!requesterId) { res.status(401).json({ error: "Authentication required" }); return; }
    const admin = await isChannelAdmin(channelId, requesterId);
    if (!admin) { res.status(403).json({ error: "Only admins can change admin status" }); return; }
    const isAdmin = !!req.body.isAdmin;
    await setChannelMemberAdmin(channelId, targetUserId, isAdmin);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update member" });
  }
});

/* ─────────────────── Messages ─────────────────────────────────────────── */

router.get("/chat/channels/:id/messages", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
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
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    await markChannelRead(channelId, userId);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to mark channel read" });
  }
});

/* ─────────────────── Forward message ─────────────────────────────────── */

router.post("/chat/channels/:id/messages/:msgId/forward", requirePermission("chat.read"), async (req, res) => {
  try {
    const sourceChannelId = parseInt(String(req.params.id), 10);
    const originalMsgId = parseInt(String(req.params.msgId), 10);
    const targetChannelId = parseInt(req.body.targetChannelId as string);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!targetChannelId) { res.status(400).json({ error: "targetChannelId required" }); return; }
    // Must have access to both the source channel and the target channel
    if (!(await canAccessChannel(sourceChannelId, userId))) { res.status(403).json({ error: "Access denied to source channel" }); return; }
    if (!(await canAccessChannel(targetChannelId, userId))) { res.status(403).json({ error: "Access denied to target channel" }); return; }
    // Verify the original message actually belongs to the claimed source channel
    // (prevents exfiltrating messages from other channels via predictable IDs)
    const originalMsg = await getMessageById(originalMsgId);
    if (!originalMsg) { res.status(404).json({ error: "Original message not found" }); return; }
    if (originalMsg.channelId !== sourceChannelId) { res.status(403).json({ error: "Message does not belong to this channel" }); return; }
    const displayName = await getUserDisplayName(userId);
    const forwarded = await forwardMessage(originalMsgId, targetChannelId, userId, displayName);
    if (!forwarded) { res.status(404).json({ error: "Forward failed" }); return; }
    res.json(forwarded);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to forward message" });
  }
});

/* ─────────────────── Search ───────────────────────────────────────────── */

router.get("/chat/search", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    const q = (req.query.q as string) || "";
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const results = await searchMessages(userId, q, 20);
    res.json(results);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to search messages" });
  }
});

/* ─────────────────── Pinned messages ─────────────────────────────────── */

router.get("/chat/channels/:id/pinned", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
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
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    const pinned = req.body.pinned !== false;
    const updated = await pinMessage(messageId, channelId, pinned);
    if (!updated) { res.status(404).json({ error: "Message not found" }); return; }
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
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    // Only the message author may edit their own message
    const existing = await getMessageById(messageId);
    if (!existing) { res.status(404).json({ error: "Message not found" }); return; }
    if (existing.userId !== userId) { res.status(403).json({ error: "Cannot edit another user's message" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    const updated = await editMessage(messageId, channelId, content);
    if (!updated) { res.status(404).json({ error: "Message not found" }); return; }
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to edit message" });
  }
});

router.delete("/chat/messages/:id", requirePermission("chat.read"), async (req, res) => {
  try {
    const messageId = parseInt(String(req.params.id), 10);
    const channelId = parseInt(req.query.channelId as string);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    // Only the message author or a channel admin may delete
    const existing = await getMessageById(messageId);
    if (!existing) { res.status(404).json({ error: "Message not found" }); return; }
    const isAdmin = await isChannelAdmin(channelId, userId);
    if (existing.userId !== userId && !isAdmin) { res.status(403).json({ error: "Cannot delete another user's message" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    const deleted = await deleteMessage(messageId, channelId, userId ?? 0);
    if (!deleted) { res.status(404).json({ error: "Message not found" }); return; }
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

/* ─────────────────── Direct message ──────────────────────────────────── */

router.post("/chat/direct", requirePermission("chat.read"), async (req, res) => {
  try {
    const otherUserId = parseInt(req.body.userId as string);
    const userId = getLocalUserId(req);
    if (!userId || !otherUserId) { res.status(400).json({ error: "userId required" }); return; }

    const callerRow = (req as any).localUser as { companyIds?: number[]; role?: string } | undefined;
    const isSA = callerRow?.role === "super_admin";
    const callerCompanyIds: number[] = (callerRow?.companyIds as number[] | null) ?? [];

    // Validate that the target user shares at least one company with the caller (SA bypasses)
    if (!isSA) {
      const [other] = await db.select({ companyIds: usersTable.companyIds, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, otherUserId)).limit(1);
      if (!other) { res.status(404).json({ error: "User not found" }); return; }
      const otherCompanyIds: number[] = (other.companyIds as number[] | null) ?? [];
      const hasSharedCompany = other.role === "super_admin" || otherCompanyIds.some((id) => callerCompanyIds.includes(id));
      if (!hasSharedCompany) { res.status(403).json({ error: "Cannot create DM with user outside your companies" }); return; }
    }

    const companyId = getLocalUserCompanyId(req);
    const channelId = await ensureDirectChannel(userId, otherUserId, companyId);
    res.json({ channelId });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create direct channel" });
  }
});

/* ─────────────────── Group channels ──────────────────────────────────── */

router.post("/chat/groups", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const { name, description, iconUrl, memberIds } = req.body;
    if (!name || typeof name !== "string") { res.status(400).json({ error: "name required" }); return; }
    const members: number[] = Array.isArray(memberIds) ? memberIds.map(Number).filter(Boolean) : [];
    if (!members.includes(userId)) members.unshift(userId);

    const callerRow = (req as any).localUser as { companyIds?: number[]; role?: string } | undefined;
    const isSA = callerRow?.role === "super_admin";
    const callerCompanyIds: number[] = (callerRow?.companyIds as number[] | null) ?? [];

    // Validate that each member (other than the creator) shares a company with the caller
    if (!isSA) {
      const otherMembers = members.filter((m) => m !== userId);
      if (otherMembers.length > 0) {
        const targetRows = await db.select({ id: usersTable.id, companyIds: usersTable.companyIds, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, otherMembers));
        for (const t of targetRows) {
          const tIds: number[] = (t.companyIds as number[] | null) ?? [];
          const allowed = t.role === "super_admin" || tIds.some((id) => callerCompanyIds.includes(id));
          if (!allowed) { res.status(403).json({ error: `User ${t.id} is outside your company scope` }); return; }
        }
      }
    }

    const companyId = getLocalUserCompanyId(req);
    const channel = await createGroupChannel({
      name,
      description,
      iconUrl,
      createdBy: userId,
      memberUserIds: members,
      companyId,
    });
    res.status(201).json(channel);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create group" });
  }
});

/* ─────────────────── Workspace user directory ─────────────────────────── */

router.get("/chat/users", requirePermission("chat.read"), async (req, res) => {
  try {
    const callerId = getLocalUserId(req);
    if (!callerId) { res.status(401).json({ error: "Authentication required" }); return; }
    const callerRow = (req as any).localUser as { companyIds?: number[]; role?: string } | undefined;
    const isSA = callerRow?.role === "super_admin";
    const callerCompanyIds: number[] = (callerRow?.companyIds as number[] | null) ?? [];
    const users = await getWorkspaceUsersScopedToCompanies(callerId, callerCompanyIds, isSA);
    res.json(users);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list users" });
  }
});

/* ─────────────────── Polls ────────────────────────────────────────────── */

router.get("/chat/channels/:id/polls", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
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
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    if (!(await canAccessChannel(channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    const { question, options, isMultiple } = req.body;
    if (!question || !Array.isArray(options) || options.length < 2) {
      res.status(400).json({ error: "Question and at least two options required" }); return;
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
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    // Load poll to verify channel access before allowing vote
    const pollRow = await getPollById(pollId);
    if (!pollRow) { res.status(404).json({ error: "Poll not found" }); return; }
    if (!(await canAccessChannel(pollRow.channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    const optionIndex = parseInt(req.body.optionIndex as string);
    if (Number.isNaN(optionIndex)) { res.status(400).json({ error: "Invalid option index" }); return; }
    const updated = await votePoll(pollId, userId, optionIndex);
    if (!updated) { res.status(404).json({ error: "Poll not found" }); return; }
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
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    // Load poll to verify channel access before allowing close
    const pollRow = await getPollById(pollId);
    if (!pollRow) { res.status(404).json({ error: "Poll not found" }); return; }
    if (!(await canAccessChannel(pollRow.channelId, userId))) { res.status(403).json({ error: "Access denied" }); return; }
    const updated = await closePoll(pollId, userId);
    if (!updated) { res.status(404).json({ error: "Poll not found or not owner" }); return; }
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to close poll" });
  }
});

/* ─────────────────── Status endpoints ────────────────────────────────── */

router.get("/users/status", requirePermission("chat.read"), async (req, res) => {
  try {
    const callerId = getLocalUserId(req);
    if (!callerId) { res.status(401).json({ error: "Authentication required" }); return; }

    // Scope status listing to users in the same companies as the caller.
    // Super admins see all active users.
    const callerRow = (req as any).localUser as { companyIds?: number[]; role?: string } | undefined;
    const isSA = callerRow?.role === "super_admin";
    const callerCompanyIds: number[] = (callerRow?.companyIds as number[] | null) ?? [];

    let allUsers: { id: number }[];
    if (isSA) {
      allUsers = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.status, "active"));
    } else if (callerCompanyIds.length > 0) {
      // Include users whose companyIds overlap with the caller's companies
      const all = await db.select({ id: usersTable.id, companyIds: usersTable.companyIds }).from(usersTable).where(eq(usersTable.status, "active"));
      allUsers = all.filter((u) => {
        const ids: number[] = (u.companyIds as number[] | null) ?? [];
        return ids.some((id) => callerCompanyIds.includes(id));
      });
    } else {
      allUsers = [];
    }

    const userIds = allUsers.map((u) => u.id);
    const statuses = await getUserStatuses(userIds);
    res.json(statuses);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load statuses" });
  }
});

router.post("/users/status", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const { presence, statusMessage, doNotDisturb } = req.body;
    const updated = await upsertUserStatus(userId, { presence, statusMessage, doNotDisturb: !!doNotDisturb });
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update status" });
  }
});

export default router;
