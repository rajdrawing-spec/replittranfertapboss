---
name: TBOS group-call join policy
description: Who is allowed to join a meeting in TapasHub
---
Any company member may join a meeting in their workspace, not just invited participants or the organizer.

**Why:** Group calls are company-wide by default. The "Upcoming" tab shows all workspace meetings to all members, and the Join button must work for all of them.

**How to apply:**
- The token endpoint (`/api/meetings/token`) allows any user with company access. Only users whose `meeting_participants` status is `rejected` are blocked.
- The join endpoint (`/api/meetings/join/:meetingId`) verifies `canAccessCompany(req, meeting.companyId)` and blocks cancelled/ended meetings before adding the caller as a participant.
Update (July 2026): join/token endpoints must NOT trust a client-supplied companyId — resolve the meeting and authorize against meeting.companyId. Allowed: company members OR explicit invitees (participant row, status !== rejected). Because participant rows now grant join access, /accept and /reject must guard against unguarded upserts (invited-or-company-member check, 404 to avoid enumeration). Also: every ring recipient must be able to pass this check, or they see "Could not join the call — Forbidden".
