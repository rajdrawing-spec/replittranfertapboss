import type { MeetingProvider, MeetingContext, CreateMeetingRoomResult } from "./meeting-provider";

export class JitsiProvider implements MeetingProvider {
  readonly key = "jitsi";

  generateMeetingId(context: MeetingContext): string {
    const date = context.date;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const dept = context.department ? `-${context.department.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}` : "";
    return `TBOS-${context.companySlug.toUpperCase()}${dept}-${y}${m}${d}-${rand}`;
  }

  generateRoomUrl(meetingId: string, serverUrl = "https://meet.jit.si"): string {
    const base = serverUrl.replace(/\/$/, "");
    return `${base}/${encodeURIComponent(meetingId)}`;
  }

  createRoom(context: MeetingContext, serverUrl?: string): CreateMeetingRoomResult {
    const meetingId = this.generateMeetingId(context);
    return {
      meetingId,
      roomUrl: this.generateRoomUrl(meetingId, serverUrl),
    };
  }
}

export const jitsiProvider = new JitsiProvider();
