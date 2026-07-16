import crypto from "node:crypto";
import type { MeetingProvider, MeetingContext, CreateMeetingRoomResult } from "./meeting-provider";

export interface JaaSConfig {
  appId: string;
  apiKey: string;
}

function base64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function parseJaaSMagicCookie(cookie?: string): JaaSConfig | null {
  if (!cookie) return null;
  const match = cookie.match(/^vpaas-magic-cookie-([0-9a-fA-F]+)\/([0-9a-zA-Z]+)$/);
  if (!match) return null;
  return { apiKey: match[1], appId: match[2] };
}

export function buildJaaSJwt(meetingId: string, cfg: JaaSConfig, expiresInSeconds = 86400): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      aud: "jitsi",
      iss: cfg.appId,
      sub: cfg.appId,
      room: meetingId,
      exp: now + expiresInSeconds,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", Buffer.from(cfg.apiKey, "hex"))
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

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

  generateRoomUrl(meetingId: string, serverUrl = "https://meet.jit.si", jwt?: string): string {
    const base = serverUrl.replace(/\/$/, "");
    const url = `${base}/${encodeURIComponent(meetingId)}`;
    return jwt ? `${url}?jwt=${encodeURIComponent(jwt)}` : url;
  }

  createRoom(context: MeetingContext, serverUrl?: string): CreateMeetingRoomResult {
    const meetingId = this.generateMeetingId(context);
    const jaas = parseJaaSMagicCookie(process.env.JITSIAAS_MAGIC_COOKIE);
    let roomUrl = this.generateRoomUrl(meetingId, serverUrl);
    let jwt: string | undefined;
    if (jaas) {
      jwt = buildJaaSJwt(meetingId, jaas);
      const jaasServerUrl = `https://8x8.vc/${jaas.appId}`;
      roomUrl = this.generateRoomUrl(meetingId, serverUrl?.includes("8x8.vc") ? serverUrl : jaasServerUrl, jwt);
    }
    return { meetingId, roomUrl, jwt };
  }
}

export const jitsiProvider = new JitsiProvider();
