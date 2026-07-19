import type { CallService, CallHandle, MakeCallParams } from "./call.service";

export interface ExotelCredentials {
  accountSid: string;
  apiKey: string;
  apiToken: string;
  subdomain?: string;
  callerId?: string | null;
}

/**
 * Exotel implementation of CallService.
 *
 * Uses the Exotel Voice v1 API:
 *   - Outgoing call: POST /v1/Accounts/{Sid}/Calls/connect
 *
 * The incoming call path is handled by the Exotel webhook pointing to
 * POST /api/call/incoming; this provider only deals with actions initiated
 * from the TapasHub UI (outgoing, answer, hangup, hold).
 */
export class ExotelProvider implements CallService {
  constructor(private credentials: ExotelCredentials) {}

  private baseUrl(): string {
    return `https://${this.credentials.subdomain || "api.exotel.com"}`;
  }

  private authHeader(): string {
    const { apiKey, apiToken } = this.credentials;
    return "Basic " + Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
  }

  async makeCall(params: MakeCallParams): Promise<CallHandle> {
    const { accountSid, callerId } = this.credentials;
    const from = callerId || params.fromNumber;
    const url = `${this.baseUrl()}/v1/Accounts/${accountSid}/Calls/connect`;
    const body = new URLSearchParams({
      From: params.fromNumber,
      To: params.toNumber,
      CallerId: from,
      // Passthru applet: Exotel will POST call status to the configured URL.
      // We keep a stable URL parameter so the backend can correlate updates.
      Url: "http://example.com/", // Exotel requires a Url; webhooks will override this.
      StatusCallback: "",
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: this.authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "Exotel call failed");
      throw new Error(`Exotel error ${res.status}: ${text}`);
    }
    const data = await res.json() as { Call?: { Sid?: string } };
    const callId = data?.Call?.Sid || `exotel_${Date.now()}`;
    return { callId, status: "ringing" };
  }

  async receiveCall(callId: string): Promise<CallHandle> {
    // Exotel calls are answered by the agent picking up the phone; no API call is needed.
    return { callId, status: "active" };
  }

  async hangup(callId: string): Promise<CallHandle> {
    const { accountSid } = this.credentials;
    const url = `${this.baseUrl()}/v1/Accounts/${accountSid}/Calls/${callId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "Exotel hangup failed");
      throw new Error(`Exotel error ${res.status}: ${text}`);
    }
    return { callId, status: "completed" };
  }

  async transferCall(callId: string): Promise<CallHandle> {
    // Exotel transfer requires a specific flow; treat as active until implemented.
    return { callId, status: "active" };
  }

  async holdCall(callId: string, hold: boolean): Promise<CallHandle> {
    // Exotel does not expose a direct hold API; update local status only.
    return { callId, status: hold ? "held" : "active" };
  }

  async muteCall(callId: string): Promise<CallHandle> {
    // Mute is a client-side concern; no-op on the provider.
    return { callId, status: "active" };
  }

  async conferenceCall(callId: string): Promise<CallHandle> {
    return { callId, status: "active" };
  }

  async recordCall(callId: string): Promise<CallHandle> {
    return { callId, status: "active" };
  }
}
