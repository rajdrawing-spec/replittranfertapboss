export interface MeetingProvider {
  readonly key: string;
  generateRoomUrl(meetingId: string, serverUrl?: string): string;
  generateMeetingId(context: MeetingContext): string;
  createRoom(context: MeetingContext, serverUrl?: string): CreateMeetingRoomResult;
}

export interface MeetingContext {
  companySlug: string;
  department?: string | null;
  project?: string | null;
  date: Date;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface CreateMeetingRoomResult {
  roomUrl: string;
  meetingId: string;
  jwt?: string;
}
