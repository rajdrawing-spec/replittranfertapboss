---
name: TBOS meeting visibility across companies
description: Workspace meeting list should show meetings the user is invited to, not only meetings in their assigned companies, so non-company invitees can see and join calls.
---

The `/api/meetings` workspace list endpoint was filtering to a single `companyId` and rejecting users who could not `canAccessCompany` that company. This caused an invited user (e.g., Sales Manager assigned to companies 2,3,4,5,6,7,8,16) to see an empty meeting list when the meeting was created in company 15 (TapasHub), because the user is a participant but not a company member.

**Rule:** List and upcoming-meeting endpoints must return the union of:
- meetings in the user's accessible companies (`companyScope(req)`), and
- meetings where the user has an explicit participant row (invited/accepted/joined), even if the meeting's company is outside their assigned list.

**Why:** The join/token endpoint already allows invited participants to join meetings outside their assigned companies. The list view must match that policy, or users can join calls they cannot see.

**How to apply:** Use a helper query that ORs `companyId IN companyIds` with `meeting.id IN (SELECT meeting_id FROM meeting_participants WHERE user_id = :userId)`. Apply the same logic to `GET /meetings/:id` detail loads so invited users can open the meeting card. Continue to restrict creation/cancellation to the user's accessible companies and `meetings.create`/`meetings.manage` permissions.
