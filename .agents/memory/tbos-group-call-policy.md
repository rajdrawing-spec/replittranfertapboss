---
name: TBOS group-call join policy
description: Who is allowed to join a meeting in TapasHub
---
Any company member may join a meeting in their workspace, not just invited participants or the organizer.

**Why:** Group calls are company-wide by default. The "Upcoming" tab shows all workspace meetings to all members, and the Join button must work for all of them.

**How to apply:**
- The token endpoint (`/api/meetings/token`) allows any user with company access. Only users whose `meeting_participants` status is `rejected` are blocked.
- The join endpoint (`/api/meetings/join/:meetingId`) verifies `canAccessCompany(req, meeting.companyId)` and blocks cancelled/ended meetings before adding the caller as a participant.