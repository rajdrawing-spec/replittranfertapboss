---
name: TBOS AI meeting assistant
description: Architecture and pitfalls of the post-call AI notes pipeline (recorder, upload, Gemini audio, action-item tasks)
---

- Client recorder holds MediaRecorder chunks in a module-level map keyed by meetingId so the recording survives LiveKitRoom remounts (room is keyed on token, which changes on reconnect). On each mount, disconnect+clear stale WebAudio source nodes before reattaching — old nodes reference dead tracks.
- `finishRecording(meetingId)` must be called from EVERY leave path in meeting-context (leaveCall, CLIENT_INITIATED, call-ended 4xx, reconnect-exhausted), not from recorder unmount — unmount also happens on token remounts.
- **Why:** an unmount-time upload would trigger early processing mid-call; the note claim is one-shot per meeting.
- Server dedup: unique meeting_db_id + onConflictDoNothing claims the note; a `failed` row is atomically reclaimable (UPDATE ... WHERE status='failed') so a poisoned first upload doesn't permanently block notes.
- Audio upload authz needs participant/organizer membership, not just company scope; channel auto-invite must validate the channel belongs to the meeting's company.
- Gemini flash accepts audio via inlineData parts; use responseMimeType application/json + thinkingBudget 0; ~30MB decoded cap fits 50mb express body limit with base64 overhead. Use the `gemini-flash-latest` alias (pinned 2.5 names 404 for new keys).
- Pipeline verified end-to-end 2026-07-18 with a real speech recording (transcript, summary, action items, assigned task with resolved relative due date, notifications, dedup claim); replayable via the verify script in api-server/scripts.

**Retry from stored audio:** the upload route persists the recording to private object storage (best-effort, alongside the pipeline) and stamps `/objects/meeting-audio/...` + mime on the note row; retry endpoint reclaims via `UPDATE ... WHERE status='failed'` (atomic, single winner) and downloads the object BEFORE reclaiming so a missing object never strands the note in "processing".
