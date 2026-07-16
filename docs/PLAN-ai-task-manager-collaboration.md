# TBOS — AI Task Manager & Collaboration MVP

Implementation plan for Priority 1 of the TBOS enhancement roadmap.  
**Goal:** add a self-contained AI task manager + team collaboration module without changing any existing products, inventory, CRM, dashboard, HR, or authentication code.

---

## 1. Guiding principles

1. **No existing module changes.** No edits to existing tables, routes, pages, or CRUD.
2. **Optional add-on.** Everything is gated behind a new sidebar item and new permissions.
3. **Cost-first AI.** Use templates first, call AI only once per day or on explicit manager request, batch employees by department, and prefer Ollama before paid APIs.
4. **Reusable provider layer.** Ollama plugs into the existing `ai-provider.ts` abstraction so the same `getActiveProvider()` / `chat()` interface is used everywhere.
5. **Phased delivery.** Each sub-phase is independently reviewable and testable.

---

## 2. Sub-phases (stop-and-review after each)

### Phase 1.1 — Foundation & task templates
- Database schema (3 new tables, no existing table changes).
- Task-template CRUD UI + API.
- Sidebar navigation + new permission `ai_tasks.manage`.
- **No AI calls yet.**

### Phase 1.2 — AI generation & daily caching
- Ollama provider added to `ai-provider.ts`.
- `ai-task.service.ts` generation logic.
- Daily generation endpoint + background scheduler.
- Manager approval/edit UI + employee “My tasks” view.
- Strict caching: one generated-task row per `(companyId, employeeId, date)`.

### Phase 1.3 — Team chat
- Socket.IO server-side handler attached to the existing Express server.
- Simple chat-room model: company-scoped rooms, last-N message persistence.
- Lazy-loaded chat panel component in the AI Tasks page.

### Phase 1.4 — Jitsi Meet integration
- New `JitsiMeet` React component that embeds an external Jitsi room via iframe.
- “Start video call” button creates a room slug based on `companyId` and current user.
- No backend changes beyond a simple URL helper.

---

## 3. Database schema (new tables only)

### `task_templates`
Reusable task patterns by department / role. AI customizes these rather than inventing tasks from scratch.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | integer | `companyScope()` filtering. FK to `companies` (optional, no cascade behavior changes). |
| `department` | text | e.g. `Sales`, `Warehouse`, `Customer Support`. |
| `roleKey` | text | Optional finer-grained selector. Defaults to `*` for all roles. |
| `titleTemplate` | text | `Review pending orders for {{department}}` |
| `descriptionTemplate` | text | Plain-text or markdown template. |
| `priority` | text | `low` \| `medium` \| `high` |
| `estimatedMinutes` | integer | Optional. |
| `recurrence` | text | `daily` \| `weekly` \| `once` |
| `isActive` | boolean | Soft-disable without deleting. |
| `createdAt` / `updatedAt` | timestamp | |

### `generated_tasks`
One row per employee per generation date. Acts as the daily cache.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | integer | Company scope. |
| `employeeId` | integer | FK to `employees.id`. |
| `templateId` | integer | Nullable. Links to originating template. |
| `generatedDate` | date | `YYYY-MM-DD`. Partial unique index on `(companyId, employeeId, generatedDate, templateId)` where `templateId IS NOT NULL`. |
| `title` | text | Final task title. |
| `description` | text | Final description. |
| `priority` | text | `low` \| `medium` \| `high` |
| `status` | text | `draft` \| `approved` \| `rejected` \| `assigned` \| `completed` |
| `source` | text | `template` \| `ai_customized` |
| `aiCustomizations` | jsonb | What the AI changed from the template (title, description, etc.). |
| `dueDate` | date | Defaults to generated date + 1 day. |
| `completedAt` | timestamp | |
| `approvedBy` | integer | Manager user id. |
| `approvedAt` | timestamp | |
| `createdAt` / `updatedAt` | timestamp | |

### `task_generation_jobs`
Idempotency guard so the daily run does not duplicate work.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | integer | |
| `runDate` | date | Unique per company. |
| `status` | text | `running` \| `completed` \| `failed` |
| `startedAt` | timestamp | |
| `completedAt` | timestamp | |
| `requesterId` | integer | User who triggered it. |
| `error` | text | Failure reason. |

### Indexes
- `task_templates(companyId, department, roleKey, isActive)` — fast template lookup.
- `generated_tasks(companyId, employeeId, generatedDate)` — employee daily view.
- `generated_tasks(companyId, generatedDate, status)` — manager approval queue.
- `task_generation_jobs(companyId, runDate)` — unique daily run guard.

---

## 4. AI provider changes

Extend `artifacts/api-server/src/lib/ai-provider.ts`:

1. Add Ollama provider.
   - Reads `OLLAMA_BASE_URL` env var (default `http://localhost:11434`).
   - Reads `OLLAMA_MODEL` env var (default `llama3.2`).
   - Uses OpenAI-compatible `/v1/chat/completions` endpoint so it reuses the `makeFetchProvider` factory.
   - No API key required for local Ollama.
2. Add `ollama` to the `providers` map and `getActiveProviderName()` options.
3. Default order for this module: try Ollama first if `OLLAMA_BASE_URL` is reachable; otherwise fall back to the active TBOS provider (`gemini` by default).
4. The task-generation service calls the provider through the existing `AiProvider.chat(messages, systemPrompt)` interface, so swapping providers is one config change.

**Environment variables required**
- `OLLAMA_BASE_URL` (optional)
- `OLLAMA_MODEL` (optional)
- Existing `AI_INTEGRATIONS_GEMINI_*` / `GEMINI_API_KEY` remain unchanged for Gemini fallback.

---

## 5. Backend services

All new files under `artifacts/api-server/src/lib/ai-tasks/`.

### `task-template.service.ts`
- `listTemplates(companyId, filters)`
- `createTemplate(data)`
- `updateTemplate(id, data)`
- `deleteTemplate(id)` — hard delete (templates are admin data, not user records).

### `task-cache.service.ts`
- `hasRunForDate(companyId, date)` → checks `task_generation_jobs`.
- `getTasksForDate(companyId, employeeId, date)` → reads `generated_tasks`.
- `markRunStarted(companyId, date, requesterId)` → INSERT job row with `status = running`.
- `markRunCompleted(companyId, date, error?)` → UPDATE job row.

### `ai-task.service.ts`
- `generateDailyTasks(companyId, requesterId, options)`
  1. Look up active employees for the company (filters: `status = active`).
  2. Group employees by department.
  3. For each department, load templates where `department = *` or matches.
  4. For each group, build one prompt that asks for N customized tasks (N = number of employees in group, or one per template per employee).
  5. Call AI provider once per department batch.
  6. Map results back to employees, insert rows into `generated_tasks` with `status = draft`.
  7. Manager reviews in UI and approves/rejects/edits.
- `approveTask(id, managerUserId, edits?)`
- `completeTask(id, employeeUserId)`

**Prompt strategy** (cost control)
- System prompt includes the template title/description and employee designation.
- Response format: strict JSON array of `{ title, description, priority, estimatedMinutes, reasonForCustomization }`.
- If no templates exist for a department, the service skips that department with a warning rather than calling AI with zero context.

### `task-ai-prompt.builder.ts`
- Builds the batched prompt and parses the JSON response.
- Handles malformed JSON gracefully: log warning, fall back to template text.

---

## 6. API routes

New file `artifacts/api-server/src/routes/ai-tasks.ts`.

| Method | Route | Auth / Permission | Purpose |
|---|---|---|---|
| GET | `/api/ai-tasks/templates` | `ai_tasks.read` | List templates. |
| POST | `/api/ai-tasks/templates` | `ai_tasks.manage` | Create template. |
| PATCH | `/api/ai-tasks/templates/:id` | `ai_tasks.manage` | Update template. |
| DELETE | `/api/ai-tasks/templates/:id` | `ai_tasks.manage` | Delete template. |
| POST | `/api/ai-tasks/generate` | `ai_tasks.manage` | Trigger daily generation. Returns job id. |
| GET | `/api/ai-tasks/generate/:jobId/status` | `ai_tasks.manage` | Poll generation status. |
| GET | `/api/ai-tasks/my-tasks` | any auth | Employee view for today (self-scoped). |
| GET | `/api/ai-tasks/pending-approval` | `ai_tasks.manage` | Manager approval queue. |
| PATCH | `/api/ai-tasks/:id` | `ai_tasks.manage` or owner | Approve / edit / complete / reject. |
| DELETE | `/api/ai-tasks/:id` | `ai_tasks.manage` | Remove generated task. |

All company-scoped routes use the existing `companyScope()` helper and require `canAccessCompany`.

---

## 7. Background jobs / scheduling

No external job queue. Use an in-process scheduler inside the API server:

1. Add `node-cron` dependency to `artifacts/api-server`.
2. New file `artifacts/api-server/src/lib/scheduler.ts`.
   - Registers a cron `0 8 * * *` (8:00 AM server time) to call `generateDailyTasks` for every company that has templates and at least one active employee.
   - Each company gets its own `task_generation_jobs` row so a failure in one company does not block others.
3. Generation is **async**; the API endpoint immediately returns a `jobId` and the manager can poll for status.

If the API server restarts mid-generation, the in-progress row can be detected and optionally resumed on next boot.

---

## 8. Frontend pages & components

### New route
- `/ai-tasks` added to `App.tsx` lazy-loaded routes.

### New sidebar entry
- In `layout.tsx`: `Team Tasks` with `CheckSquare` or `Bot` icon, placed under `HR & People`.

### New files
- `artifacts/tapashub/src/pages/ai-tasks.tsx` — main page with tabs:
  - **My Tasks** (employee self-view)
  - **Pending Approval** (manager)
  - **Templates** (manager)
  - **Team Chat** (lazy panel)
  - **Video Call** (Jitsi launcher)
- `artifacts/tapashub/src/components/ai-task-card.tsx` — task card with approve/edit/complete actions.
- `artifacts/tapashub/src/components/ai-task-template-form.tsx` — template create/edit form.
- `artifacts/tapashub/src/components/team-chat.tsx` — Socket.IO client.
- `artifacts/tapashub/src/components/jitsi-meet.tsx` — iframe wrapper for Jitsi.

### Mobile considerations
- Tabs collapse to a dropdown on small screens.
- Chat input uses 44px+ touch target.
- Task cards stack vertically.

---

## 9. Real-time chat architecture

### Server
- New file `artifacts/api-server/src/lib/chat-socket.ts`.
- Uses `socket.io` attached to the existing HTTP server.
- Rooms are company-scoped: `company:<companyId>`.
- Authentication: read the existing Clerk session cookie on `socket.handshake.headers.cookie`, verify via `requireAuth` middleware wrapper, and reject unauthenticated sockets.
- Last 100 messages per room are persisted in a new table `chat_messages` (see below) and replayed on join.
- Events: `join`, `message`, `typing`, `leave`.

### New table: `chat_messages`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | integer | Room scope. |
| `userId` | integer | Local TBOS user id (from Clerk mapping). |
| `displayName` | text | First name + last initial. |
| `content` | text | Plain text. |
| `createdAt` | timestamp | |

Index: `chat_messages(companyId, createdAt DESC)`.

### Client
- Socket connects only when the Team Chat tab is active (lazy connection).
- Messages are optimistic-updated and reconciled with the server broadcast.
- No video/audio inside Socket.IO — that is handled by Jitsi.

---

## 10. Jitsi Meet integration

### Approach
- Jitsi is hosted externally (e.g. `meet.jit.si`). No server installation.
- New component `JitsiMeet({ roomName, displayName })` renders an iframe to `https://meet.jit.si/<roomName>` with `configOverwrite` and `interfaceConfigOverwrite` to hide unnecessary chrome.
- Room name: `tbos-<companyId>-<date>` for daily standups, or a custom slug from a “Start call” button.
- **Security:** random room suffix appended to prevent guessing; displayed in the UI for invitees.

### No backend changes required
- The URL is constructed client-side using the company id and Clerk user name.

---

## 11. Permissions & authorization

New permission keys registered in the existing RBAC system:

- `ai_tasks.read` — view own tasks and team chat.
- `ai_tasks.manage` — create templates, trigger generation, approve tasks.

Implementation:
- Add the two strings to the super-admin role seed / default role definitions if needed.
- All routes use `requirePermission("ai_tasks.read")` / `requirePermission("ai_tasks.manage")`.
- Manager approval routes additionally check the user belongs to the same company via `companyScope()`.

---

## 12. Performance & caching strategy

1. **Daily cache is the DB.** One row per employee per day; no AI regeneration unless explicitly requested.
2. **Department batching.** One AI call per department group rather than one per employee.
3. **Template-first.** AI only customizes existing templates; if no template exists, no AI call is made.
4. **Lazy chat.** Socket connection is established only when the chat tab is opened.
5. **Lazy Jitsi.** Jitsi iframe is mounted only when a call is started.
6. **Query optimization.** List endpoints use `LIMIT`/`OFFSET` and the new indexes described above.
7. **Frontend code splitting.** The AI Tasks page is lazy-loaded; chat and Jitsi components are lazy-loaded within it.

---

## 13. Cost & token control strategy

| Rule | Implementation |
|---|---|
| No AI on page load | AI is only called by the `POST /api/ai-tasks/generate` endpoint or the cron job. |
| Ollama first | `ai-task.service.ts` tries Ollama provider first; falls back to Gemini only if Ollama is not configured or unreachable. |
| Templates first | Prompts include the template; AI only customizes. |
| Batch generation | One prompt per department group. |
| Daily caching | `generated_tasks` rows act as the cache; no duplicate generation for the same date. |
| Manager approval | Generated tasks are `draft` until approved, preventing accidental assignment spam. |

---

## 14. Testing plan

- **Unit tests** for `task-ai-prompt.builder.ts` (JSON parsing, fallback behavior).
- **API tests** for template CRUD and generation using the existing Vitest + mocked AI provider pattern.
- **Frontend tests** for the AI Tasks page using the existing `@clerk/react` mock pattern.
- **Integration test** for Socket.IO chat: connect, send message, verify persistence.
- **Smoke test** for Jitsi iframe URL construction.
- **Security test:** verify a user from company A cannot see company B tasks or chat messages.

---

## 15. Open questions / decisions needed before Phase 1.1

1. **Default permission assignment.** Should every existing role get `ai_tasks.read` automatically, or only super-admin plus explicit assignment?
2. **Task approval workflow.** Should generated tasks go directly to `approved` if no manager is configured, or always stay `draft` until approved?
3. **Ollama availability.** Do you have a running Ollama instance, or should Gemini be the default initially and Ollama be added as a config option?
4. **Jitsi host.** Use the free `meet.jit.si` host, or do you have a self-hosted Jitsi URL?
5. **Chat retention.** Should chat messages be retained indefinitely, or purged after N days?

Once you confirm the answers above, I will begin Phase 1.1 (foundation + task templates).
