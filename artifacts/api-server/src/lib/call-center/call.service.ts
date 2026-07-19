/**
 * Call provider abstraction for the Call Center module.
 *
 * TapasHub does not talk to a telephony vendor directly — all call actions go
 * through this interface. Today the only implementation is `MockCallProvider`
 * (returns fake call SIDs and never touches the network). When Exotel
 * credentials are available, implement `ExotelProvider` (see
 * exotel-provider.ts) and swap it in `getCallProvider()`.
 */

import { ExotelProvider } from "./exotel-provider";

export interface CallHandle {
  /** Provider call SID (mock-generated until Exotel is connected). */
  callId: string;
  status: "ringing" | "active" | "held" | "completed" | "failed";
}

export interface MakeCallParams {
  /** The business (virtual) number the call is placed from. */
  fromNumber: string;
  /** Customer phone number. */
  toNumber: string;
  /** Local agent user id. */
  agentUserId: number;
}

export interface CallService {
  makeCall(params: MakeCallParams): Promise<CallHandle>;
  receiveCall(callId: string, agentUserId: number): Promise<CallHandle>;
  hangup(callId: string): Promise<CallHandle>;
  transferCall(callId: string, toAgentUserId: number): Promise<CallHandle>;
  holdCall(callId: string, hold: boolean): Promise<CallHandle>;
  muteCall(callId: string, mute: boolean): Promise<CallHandle>;
  conferenceCall(callId: string, participantNumbers: string[]): Promise<CallHandle>;
  recordCall(callId: string, record: boolean): Promise<CallHandle>;
}

/** Mock provider: generates fake SIDs, resolves instantly, no network. */
export class MockCallProvider implements CallService {
  private newId() {
    return `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
  async makeCall(_params: MakeCallParams): Promise<CallHandle> {
    return { callId: this.newId(), status: "ringing" };
  }
  async receiveCall(callId: string): Promise<CallHandle> {
    return { callId, status: "active" };
  }
  async hangup(callId: string): Promise<CallHandle> {
    return { callId, status: "completed" };
  }
  async transferCall(callId: string): Promise<CallHandle> {
    return { callId, status: "active" };
  }
  async holdCall(callId: string, hold: boolean): Promise<CallHandle> {
    return { callId, status: hold ? "held" : "active" };
  }
  async muteCall(callId: string): Promise<CallHandle> {
    return { callId, status: "active" };
  }
  async conferenceCall(callId: string): Promise<CallHandle> {
    return { callId, status: "active" };
  }
  async recordCall(callId: string): Promise<CallHandle> {
    return { callId, status: "active" };
  }
}

let provider: CallService | null = null;

/**
 * Returns the active call provider. Swap to `new ExotelProvider()` here once
 * EXOTEL_ACCOUNT_SID / EXOTEL_API_KEY / EXOTEL_API_TOKEN are configured.
 */
export function getCallProvider(): CallService {
  if (!provider) provider = new MockCallProvider();
  return provider;
}

/**
 * Create a provider scoped to a company's configured credentials.
 * Falls back to the mock provider when Exotel credentials are not present.
 */
export function getCallProviderForCompany(credentials?: { accountSid?: string | null; apiKey?: string | null; apiToken?: string | null; subdomain?: string | null; callerId?: string | null }): CallService {
  if (credentials?.accountSid && credentials?.apiKey && credentials?.apiToken) {
    return new ExotelProvider({
      accountSid: credentials.accountSid,
      apiKey: credentials.apiKey,
      apiToken: credentials.apiToken,
      subdomain: credentials.subdomain || undefined,
      callerId: credentials.callerId,
    });
  }
  return new MockCallProvider();
}
