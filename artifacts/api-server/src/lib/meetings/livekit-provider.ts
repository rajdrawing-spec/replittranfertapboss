import crypto from "node:crypto";
import type { MeetingProvider, MeetingContext, CreateMeetingRoomResult } from "./meeting-provider";

export function isLiveKitConfigured(): boolean {
  return !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

export class LiveKitProvider implements MeetingProvider {
  readonly key = "livekit";

  generateMeetingId(context: MeetingContext): string {
    const date = context.date;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
    const dept = context.department
      ? `-${context.department.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`
      : "";
    return `TBOS-${context.companySlug.toUpperCase()}${dept}-${y}${m}${d}-${rand}`;
  }

  generateRoomUrl(meetingId: string): string {
    const serverUrl = (process.env.LIVEKIT_URL || "wss://your-livekit-server.example.com").replace(/\/$/, "");
    return `${serverUrl}/${encodeURIComponent(meetingId)}`;
  }

  createRoom(context: MeetingContext): CreateMeetingRoomResult {
    const meetingId = this.generateMeetingId(context);
    const roomUrl = this.generateRoomUrl(meetingId);
    // JWT is generated per-participant at join time via the /api/meetings/token endpoint
    return { meetingId, roomUrl };
  }
}

export const liveKitProvider = new LiveKitProvider();
