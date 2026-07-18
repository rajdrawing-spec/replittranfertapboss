import type { CallService, CallHandle, MakeCallParams } from "./call.service";

/**
 * Exotel implementation of CallService — INTENTIONALLY NOT IMPLEMENTED YET.
 *
 * When Exotel credentials are ready, set these secrets and fill in the
 * methods below with calls to the Exotel Voice v1 API
 * (https://developer.exotel.com/api):
 *   - EXOTEL_ACCOUNT_SID
 *   - EXOTEL_API_KEY
 *   - EXOTEL_API_TOKEN
 *   - EXOTEL_SUBDOMAIN (e.g. api.exotel.com or api.in.exotel.com)
 *
 * Outgoing call:  POST /v1/Accounts/{Sid}/Calls/connect
 * Incoming calls: configure the Exotel "Passthru"/webhook applet to POST to
 *                 /api/call/incoming (already implemented with mock events).
 * Then switch getCallProvider() in call.service.ts to return ExotelProvider.
 */
export class ExotelProvider implements CallService {
  private notReady(): never {
    throw new Error("Exotel is not configured yet. Add EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY and EXOTEL_API_TOKEN, then implement ExotelProvider.");
  }
  async makeCall(_params: MakeCallParams): Promise<CallHandle> { this.notReady(); }
  async receiveCall(_callId: string, _agentUserId: number): Promise<CallHandle> { this.notReady(); }
  async hangup(_callId: string): Promise<CallHandle> { this.notReady(); }
  async transferCall(_callId: string, _toAgentUserId: number): Promise<CallHandle> { this.notReady(); }
  async holdCall(_callId: string, _hold: boolean): Promise<CallHandle> { this.notReady(); }
  async muteCall(_callId: string, _mute: boolean): Promise<CallHandle> { this.notReady(); }
  async conferenceCall(_callId: string, _participantNumbers: string[]): Promise<CallHandle> { this.notReady(); }
  async recordCall(_callId: string, _record: boolean): Promise<CallHandle> { this.notReady(); }
}
