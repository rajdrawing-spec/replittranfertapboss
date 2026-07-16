---
name: TBOS Connect + AI Work Manager module
description: Tracks implementation decisions for TapBoss Connect and AI Work Manager features, including schema extensions, feature reuse, and AI cost rules.
---

# TBOS Connect + AI Work Manager

## Reused existing features
- AI Tasks scheduler, templates, generated_tasks, approval workflow
- Socket.IO chat with channels, reactions, mentions, search, pinned messages, announcements
- Meetings with Jitsi provider, waiting room, passwords, recurrence, attendance, project linking
- Notifications via `emitNotification`
- RBAC via `inventory.read` / `inventory.write` / `chat.read` / `meetings.read` / `meetings.manage`
- Company isolation via `canAccessCompany`
- AI provider abstraction via `getActiveProvider()`
- Storage upload URLs for file attachments

## Newly implemented features
- Chat project channels, quick polls, threaded replies, team status/DND, drag-and-drop file uploads
- Meeting templates, meeting notes, meeting analytics
- FullCalendar planner with daily/weekly/monthly views
- AI planner suggestions, workload analysis, smart workload balancing with manager approval
- Reminder notifications for meetings, tasks, deadlines

## Schema additions
- `chat_polls`, `user_status`
- `meeting_templates`, `meeting_notes`
- `planner_events`, `workload_snapshots`

## AI rules
- Only call AI when user explicitly clicks Generate or the scheduler runs.
- Cache workload snapshots and dashboard summaries.
- Prefer Ollama when configured; otherwise fall back to Gemini.
