# magica-backend

API and durable agent runtime for Magica chat. Postgres is the source of truth;
Trigger.dev runs the agent loop and projects Realtime streams to clients.

## Setup

### 1. Dependencies

```bash
npm install
```

### 2. Environment

```bash
cp .env.example .env
```

Fill in Clerk, OpenRouter, and Trigger.dev values. `DATABASE_URL` must point at
PostgreSQL 15+.

### 3. Database

```bash
docker compose up -d
npx prisma migration status   # optional: confirm pending migrations
# Apply migrations with your usual Prisma Next migration workflow for this repo.
```

### 4. App + worker

Run Next.js and the Trigger.dev worker side by side:

```bash
npm run dev
npx trigger.dev@latest dev
```

Without the Trigger worker, `POST /api/v1/chats/:id/messages` still commits the
user message and `AgentRun`, but the run stays `QUEUED` until a worker (or the
reconcile sweeper) dispatches it.

### 5. Tests

```bash
npm test
```

## Architecture

```
Client
  → POST /api/v1/chats/:id/messages  (Clerk auth, Zod, model allowlist)
  → Postgres tx: user Message + AgentRun + CAS Chat.activeRunId + credit reservation
  → Trigger.dev tasks.trigger (idempotencyKey = runId)
  ← { chatId, messageId, runId, realtime: { runId, streamId, publicAccessToken } }

Trigger agent-run task
  → restore context from Postgres
  → provider-neutral agent loop (OpenRouter adapter today)
  → streams.define("agent") parts for Realtime
  → checkpoint Message content blocks
  → finalize: run status, release credits, clear chat lock
```

| Layer | Role |
| --- | --- |
| `src/app/api/v1` | HTTP surface: chats, messages, runs |
| `src/services` | Transactions, dispatch, ownership checks |
| `src/repositories` | Prisma Next data access |
| `src/agent` | Context restore, turn loop, finalize |
| `src/providers/llm` | Pluggable chat providers (`ChatProvider`) |
| `src/tools` | Tool registry (empty until Magica tools land) |
| `src/trigger` | `agent-run` task + reconcile sweeper + Realtime stream |

**Auth:** Clerk session → local `User` (JIT-created). Client-supplied `userId`
is never trusted. Missing or foreign resources return **404**, never 403.

**Model policy:** only `openrouter/free` is allowed (no paid fallback).

**Concurrency:** `Chat.activeRunId` is a nullable unique lock claimed with an
atomic compare-and-set. Trigger also serializes with `concurrencyKey: chatId`.

## Trade-offs

- **Postgres is truth; Trigger Realtime is a projection.** Clients must be able
  to reconcile via `GET /api/v1/runs/:id` and message history if the socket drops.
- **Rejected `@trigger.dev/sdk/ai` `chat.agent`.** It couples to the Vercel AI
  SDK and treats Trigger as the conversation store. We use plain `schemaTask`
  with payload = `agentRunId` only so retries re-read durable state.
- **Credits are lean.** A fixed minimum reservation is taken at send time and
  released on finalize. OpenRouter free usage settles at zero application
  credits; per-tool charging comes with the tool registry.
- **Hand-rolled OpenRouter SSE parser.** Keep-alives, chunk boundaries, trailing
  usage events, and tool-call argument concatenation are provider quirks we own
  at the adapter boundary so the loop stays provider-neutral.
- **Reconcile sweeper.** Covers the post-commit / pre-dispatch crash window
  (`QUEUED` without `triggerRunId`) and stale `RUNNING` heartbeats.

## API sketch

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/v1/chats` | Create chat |
| `GET` | `/api/v1/chats` | Cursor-paginated list |
| `GET` | `/api/v1/chats/:chatId` | Chat detail |
| `GET` | `/api/v1/chats/:chatId/messages` | Newest-first keyset cursor |
| `POST` | `/api/v1/chats/:chatId/messages` | Send + start run (`Idempotency-Key` supported) |
| `GET` | `/api/v1/runs/:runId` | Durable run status |
| `POST` | `/api/v1/runs/:runId/cancel` | Cancel via Trigger / local finalize |
