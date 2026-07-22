import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import { db, notificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import {
  createMessage,
  getChannel,
  getChannelById,
  getMessageById,
  isChannelMember,
  canAccessChannel,
  userCanAccessCompany,
  getUserCompanyIds,
  addChannelMember,
  markChannelRead,
  addReaction,
  removeReaction,
  getUserDisplayName,
  ensureCompanyChannels,
  getCompanyUsers,
} from "./chat.service";
import { getMeetingByMeetingId } from "../meetings/meeting.service";

// In-memory ephemeral state
const tokenMap = new Map<string, { userId: number; expiresAt: number }>();
const typingMap = new Map<string, { userId: number; channelId: number; ts: number }>();
const presenceMap = new Map<number, Set<string>>(); // userId -> socket ids
const rateLimitMap = new Map<string, number[]>(); // userId -> timestamps

let _io: SocketServer | null = null;

/** Emit a meeting:ringing event to specific users via their socket connections. */
export function broadcastMeetingRinging(
  userIds: number[],
  data: { meetingId: string; title: string; organizerName: string; companyId: number },
) {
  if (!_io) return;
  for (const userId of userIds) {
    const sockets = presenceMap.get(userId);
    if (!sockets) continue;
    for (const sid of sockets) {
      _io.to(sid).emit("meeting:ringing", data);
    }
  }
}

/**
 * Broadcast a call-center event to specific users' socket connections.
 * Events (mock until Exotel webhooks replace them): incoming_call,
 * call_answered, call_rejected, call_started, call_ended, call_hold,
 * call_resume, call_transfer, call_recording.
 */
export function broadcastCallEvent(userIds: number[], event: string, data: Record<string, unknown>) {
  if (!_io) return;
  for (const userId of userIds) {
    const sockets = presenceMap.get(userId);
    if (!sockets) continue;
    for (const sid of sockets) {
      _io.to(sid).emit(event, data);
    }
  }
}

/** Broadcast an AI task event to every socket in the company room. */
export function broadcastTaskEvent(
  companyId: number,
  event: "ai_task:new" | "ai_task:updated",
  task: Record<string, unknown>,
) {
  if (!_io) return;
  _io.to(`company:${companyId}`).emit(event, task);
}

/** Emit a notification:new event to a specific user's socket connections. */
export function broadcastNotificationToUser(userId: number, notification: Record<string, unknown>) {
  if (!_io) return;
  const sockets = presenceMap.get(userId);
  if (!sockets) return;
  for (const sid of sockets) {
    _io.to(sid).emit("notification:new", notification);
  }
}

/** Emit a meeting:declined event to the organizer's socket connections. */
export function broadcastMeetingDeclined(
  organizerUserId: number,
  data: { meetingId: string; title: string; declinedByName: string },
) {
  if (!_io) return;
  const sockets = presenceMap.get(organizerUserId);
  if (!sockets) return;
  for (const sid of sockets) {
    _io.to(sid).emit("meeting:declined", data);
  }
}

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TYPING_TTL_MS = 5000;
const MESSAGE_RATE_LIMIT = 30; // per minute
const MESSAGE_MAX_LENGTH = 4000;

export function createSocketToken(userId: number): string {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tokenMap.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function initSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: true, credentials: true },
    // Mounted under /api so the traffic follows the same routing as every
    // other API call — in production only /api/* is forwarded to this server,
    // so a bare /socket.io path never reaches it.
    path: "/api/socket.io",
  });
  _io = io;

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing token"));
    const entry = tokenMap.get(token);
    if (!entry || entry.expiresAt < Date.now()) return next(new Error("Invalid or expired token"));
    tokenMap.delete(token);
    socket.data.userId = entry.userId;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as number;
    logger.info({ userId, socketId: socket.id }, "Chat socket connected");

    if (!presenceMap.has(userId)) presenceMap.set(userId, new Set());
    presenceMap.get(userId)!.add(socket.id);
    // Emit presence:online only to company rooms the user belongs to.
    // Looked up asynchronously so we don't block the connection setup.
    getUserCompanyIds(userId).then((cids) => {
      for (const cid of cids) {
        socket.to(`company:${cid}`).emit("presence:online", { userId });
      }
    }).catch(() => {/* non-fatal */});

    socket.on("join", async ({ companyId }: { companyId?: number }, callback: (res: any) => void) => {
      try {
        if (companyId) {
          // Validate user actually belongs to this company (super admins bypass)
          if (!(await userCanAccessCompany(userId, companyId))) {
            return callback?.({ ok: false, error: "Not a member of this company" });
          }
          socket.data.companyId = companyId;
          await ensureCompanyChannels(companyId);
          socket.join(`company:${companyId}`);
        }
        // Return presence for company members only. If no companyId was provided,
        // return presence for users in all the caller's companies (not all workspace users).
        const resolvedCompanyId = companyId ?? 0;
        let users: { id: number }[];
        if (resolvedCompanyId) {
          users = await getCompanyUsers(resolvedCompanyId);
        } else {
          // No company context — return presence for users sharing at least one company with the caller
          const callerCompanyIds = await getUserCompanyIds(userId);
          if (callerCompanyIds.length > 0) {
            const perCompany = await Promise.all(callerCompanyIds.map((cid: number) => getCompanyUsers(cid)));
            const seen = new Set<number>();
            users = perCompany.flat().filter((u: { id: number }) => {
              if (seen.has(u.id)) return false;
              seen.add(u.id);
              return true;
            });
          } else {
            users = []; // no company membership — no presence data
          }
        }
        const online = users.map((u) => ({ userId: u.id, online: presenceMap.has(u.id) && presenceMap.get(u.id)!.size > 0 }));
        callback?.({ ok: true, users: online });
      } catch (e) {
        logger.error({ err: e, userId }, "join failed");
        callback?.({ ok: false, error: String(e) });
      }
    });

    socket.on("join:channel", async ({ channelId }: { channelId: number }, callback: (res: any) => void) => {
      try {
        // Single authoritative access check: covers team/dept (company membership)
        // and direct/group (explicit membership)
        if (!(await canAccessChannel(channelId, userId))) {
          return callback?.({ ok: false, error: "Access denied" });
        }
        const channel = await getChannelById(channelId);
        if (!channel) return callback?.({ ok: false, error: "Channel not found" });
        socket.join(`channel:${channelId}`);
        await markChannelRead(channelId, userId);
        callback?.({ ok: true });
      } catch (e) {
        logger.error({ err: e, userId, channelId }, "join channel failed");
        callback?.({ ok: false, error: String(e) });
      }
    });

    socket.on("message:send", async (payload: { channelId: number; content: string; replyToId?: number; attachments?: any[]; mentions?: number[]; isAnnouncement?: boolean }, callback: (res: any) => void) => {
      try {
        if (!isRateLimited(userId)) {
          return callback?.({ ok: false, error: "Rate limit exceeded" });
        }
        const content = (payload.content || "").trim();
        if (!content || content.length > MESSAGE_MAX_LENGTH) {
          return callback?.({ ok: false, error: "Invalid message" });
        }
        // Single authoritative access check for all channel types
        if (!(await canAccessChannel(payload.channelId, userId))) {
          return callback?.({ ok: false, error: "Access denied" });
        }
        const channel = await getChannelById(payload.channelId);
        if (!channel) return callback?.({ ok: false, error: "Channel not found" });

        const displayName = await getUserDisplayName(userId);
        const message = await createMessage({
          channelId: payload.channelId,
          userId,
          displayName,
          content,
          replyToId: payload.replyToId,
          attachments: payload.attachments || [],
          mentions: payload.mentions || [],
          isAnnouncement: payload.isAnnouncement,
        });

        io.to(`channel:${payload.channelId}`).emit("message:new", message);
        // Scope channel:update by type:
        // - team/dept → company room (all company members need sidebar update)
        // - direct/group → channel room only (non-members must not see DM/group metadata)
        const isTeamChannel = channel.type !== "direct" && channel.type !== "group";
        if (isTeamChannel && channel.companyId) {
          io.to(`company:${channel.companyId}`).emit("channel:update", { channelId: payload.channelId, lastMessageAt: message.createdAt });
        }
        io.to(`channel:${payload.channelId}`).emit("channel:update", { channelId: payload.channelId, lastMessageAt: message.createdAt });

        // Notify mentioned users
        if (payload.mentions && payload.mentions.length > 0) {
          for (const mentionedUserId of payload.mentions) {
            if (mentionedUserId === userId) continue;
            await db.insert(notificationsTable).values({
              type: "chat",
              title: "New mention",
              message: `${displayName} mentioned you in ${channel.name}`,
              severity: "info",
              companyId: channel.companyId,
              companyName: "",
              actionUrl: "/chat",
              isRead: false,
            });
            io.to(`user:${mentionedUserId}`).emit("notification:new", { type: "chat" });
          }
        }

        callback?.({ ok: true, message });
      } catch (e) {
        logger.error({ err: e, userId }, "send message failed");
        callback?.({ ok: false, error: String(e) });
      }
    });

    socket.on("typing:start", async ({ channelId }: { channelId: number }) => {
      if (!(await canAccessChannel(channelId, userId))) return;
      const key = `${userId}-${channelId}`;
      typingMap.set(key, { userId, channelId, ts: Date.now() });
      socket.to(`channel:${channelId}`).emit("typing", { userId, channelId, typing: true });
    });

    socket.on("typing:stop", async ({ channelId }: { channelId: number }) => {
      if (!(await canAccessChannel(channelId, userId))) return;
      const key = `${userId}-${channelId}`;
      typingMap.delete(key);
      socket.to(`channel:${channelId}`).emit("typing", { userId, channelId, typing: false });
    });

    socket.on("message:read", async ({ channelId }: { channelId: number }) => {
      // Verify access before creating membership side-effects
      if (!(await canAccessChannel(channelId, userId))) return;
      await markChannelRead(channelId, userId);
      socket.to(`channel:${channelId}`).emit("message:read", { channelId, userId });
    });

    socket.on("reaction:add", async ({ messageId, emoji }: { messageId: number; emoji: string }, callback: (res: any) => void) => {
      try {
        // Verify caller has access to the message's channel before mutating reactions
        const msg = await getMessageById(messageId);
        if (!msg) return callback?.({ ok: false, error: "Message not found" });
        if (!(await canAccessChannel(msg.channelId, userId))) return callback?.({ ok: false, error: "Access denied" });
        const updated = await addReaction(messageId, userId, emoji);
        if (updated) io.to(`channel:${updated.channelId}`).emit("message:reaction", updated);
        callback?.({ ok: true });
      } catch (e) {
        callback?.({ ok: false, error: String(e) });
      }
    });

    socket.on("reaction:remove", async ({ messageId, emoji }: { messageId: number; emoji: string }, callback: (res: any) => void) => {
      try {
        // Verify caller has access to the message's channel before mutating reactions
        const msg = await getMessageById(messageId);
        if (!msg) return callback?.({ ok: false, error: "Message not found" });
        if (!(await canAccessChannel(msg.channelId, userId))) return callback?.({ ok: false, error: "Access denied" });
        const updated = await removeReaction(messageId, userId, emoji);
        if (updated) io.to(`channel:${updated.channelId}`).emit("message:reaction", updated);
        callback?.({ ok: true });
      } catch (e) {
        callback?.({ ok: false, error: String(e) });
      }
    });

    socket.on("presence:get", async ({ companyId }: { companyId: number }, callback: (res: any) => void) => {
      try {
        // Validate the requesting user actually belongs to this company (super admins bypass)
        if (!(await userCanAccessCompany(userId, companyId))) {
          return callback?.({ ok: false, error: "Not a member of this company" });
        }
        const users = await getCompanyUsers(companyId);
        const online = users.map((u) => ({ userId: u.id, online: presenceMap.has(u.id) && presenceMap.get(u.id)!.size > 0 }));
        callback?.({ ok: true, users: online });
      } catch (e) {
        callback?.({ ok: false, error: String(e) });
      }
    });

    socket.on("meeting:declined", async ({ meetingId }: { meetingId: string }) => {
      try {
        const meeting = await getMeetingByMeetingId(meetingId);
        if (!meeting) return;
        const declinedByName = await getUserDisplayName(userId);
        broadcastMeetingDeclined(meeting.organizerId, {
          meetingId,
          title: meeting.title,
          declinedByName,
        });
      } catch (e) {
        logger.error({ err: e, userId, meetingId }, "meeting:declined relay failed");
      }
    });

    socket.on("disconnect", () => {
      const set = presenceMap.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          presenceMap.delete(userId);
          // Emit presence:offline only to company rooms the user belonged to.
          getUserCompanyIds(userId).then((cids) => {
            for (const cid of cids) {
              io.to(`company:${cid}`).emit("presence:offline", { userId });
            }
          }).catch(() => {/* non-fatal */});
        }
      }
      logger.info({ userId, socketId: socket.id }, "Chat socket disconnected");
    });
  });

  // Cleanup typing map periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of typingMap.entries()) {
      if (now - val.ts > TYPING_TTL_MS) typingMap.delete(key);
    }
  }, 10000);

  return io;
}

function isRateLimited(userId: number): boolean {
  const key = String(userId);
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = rateLimitMap.get(key) || [];
  const recent = timestamps.filter((t) => t > windowStart);
  if (recent.length >= MESSAGE_RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}
