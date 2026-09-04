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

For Magica tools, media upload, and R2 mirroring also set `MAGICA_*`,
`TRANSLOADIT_*`, `R2_*`, and `APP_PUBLIC_URL` (see `.env.example`). The app
boots without them; helpers like `env.requireMagicaApiKey()` fail only when a
code path needs the integration.

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
  → POST /api/v1/chats/:id/messages  (Clerk auth, Zod, model allowlist, attachmentIds)
  → Postgres tx: user Message + AgentRun + CAS Chat.activeRunId + credit reservation
  → Trigger.dev tasks.trigger (idempotencyKey = runId)
  ← { chatId, messageId, runId, realtime: { runId, streamId, publicAccessToken } }

Trigger agent-run task
  → restore context from Postgres
  → provider-neutral agent loop (OpenRouter adapter today)
  → tool calls → Magica estimate-credits → progressive ensureReservation
  → wait.createToken + Magica run (webhook) + magica-poll fallback
  → wait.forToken → mirror outputs to R2 → settle CHARGE once
  → streams.define("agent") parts for Realtime
  → checkpoint Message content blocks
  → finalize: run status, release unused reservation, clear chat lock

Media
  → POST /api/v1/attachments → Transloadit params+signature (browser → R2)
  → POST /api/webhooks/transloadit → Attachment COMPLETED
  → Magica tool outputs mirrored under generated/{userId}/{toolInvocationId}/…
```

| Layer | Role |
| --- | --- |
| `src/app/api/v1` | HTTP: chats, messages, runs, tools, credits, attachments |
| `src/app/api/webhooks` | Magica (Svix) + Transloadit assembly notifications |
| `src/services` | Transactions, dispatch, progressive credits, media |
| `src/repositories` | Prisma Next data access |
| `src/agent` | Context restore, turn loop, finalize |
| `src/providers/llm` | Pluggable chat providers (`ChatProvider`) |
| `src/providers/magica` | Inference client, estimate/run, microcredit conversion |
| `src/providers/storage` | Cloudflare R2 put helpers |
| `src/providers/transloadit` | Direct-upload signature + webhook verify |
| `src/tools` | Registry: `crop_image`, `gpt_image_2`, `merge_videos` |
| `src/trigger` | `agent-run`, `magica-poll`, reconcile sweeper, Realtime stream |

**Auth:** Clerk session → local `User` (JIT-created). Client-supplied `userId`
is never trusted. Missing or foreign resources return **404**, never 403.

**Model policy:** only `openrouter/free` is allowed (no paid fallback). Token
usage is recorded on `AgentRun`; application credit cost for OpenRouter is 0.

**Concurrency:** `Chat.activeRunId` is a nullable unique lock claimed with an
atomic compare-and-set. Trigger also serializes with `concurrencyKey: chatId`.

**Progressive credits:** send-time minimum reservation, then mid-run top-ups via
conditional `tryDebitBalance` (402 / `insufficient_credits` interrupt when the
balance cannot cover the next tool or model hold). Completed tools settle with
an idempotent `CHARGE` (`charge:tool:{toolInvocationId}`); finalize releases
`reservedCredits - settledCredits`.

**Async Magica tools:** each node run uses a Trigger waitpoint token, Magica
webhook completion, and a `magica-poll` fallback (required for local dev when
Magica cannot reach `APP_PUBLIC_URL`). Tool output URLs returned to the model
are durable R2 URLs when mirroring succeeds.

## Trade-offs

- **Postgres is truth; Trigger Realtime is a projection.** Clients must be able
  to reconcile via `GET /api/v1/runs/:id` and message history if the socket drops.
- **Rejected `@trigger.dev/sdk/ai` `chat.agent`.** It couples to the Vercel AI
  SDK and treats Trigger as the conversation store. We use plain `schemaTask`
  with payload = `agentRunId` only so retries re-read durable state.
- **Progressive reservation, not per-token settlement.** Magica estimate → app
  credits (ceil + markup) drive top-ups; OpenRouter stays free via policy so a
  paid model later needs no loop changes. Sub-cent Magica tools bill 1 credit;
  exact microcredits stay on `ToolInvocation` for auditability.
- **Waitpoint + poll, not long-polling in the agent task.** The agent suspends
  on `wait.forToken`; webhook and poller race safely (`completeToken` is a
  no-op when already completed).
- **Browser → Transloadit → R2.** Upload bytes never pass through Next.js;
  Magica output mirroring falls back to the provider URL if R2 copy fails so a
  paid tool call still succeeds.
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
| `POST` | `/api/v1/chats/:chatId/messages` | Send + start run (`Idempotency-Key`, optional `attachmentIds`) |
| `GET` | `/api/v1/runs/:runId` | Durable run status |
| `POST` | `/api/v1/runs/:runId/cancel` | Cancel via Trigger / local finalize |
| `GET` | `/api/v1/tools` | Registered tools + Magica catalog/pricing metadata |
| `POST` | `/api/v1/tools/:name/estimate` | Validate input → `{ microcredits, credits }` |
| `GET` | `/api/v1/credits` | Current balance |
| `GET` | `/api/v1/credits/usage` | Ledger usage summary |
| `POST` | `/api/v1/attachments` | Create PENDING attachment + Transloadit upload signature |
| `GET` | `/api/v1/attachments/:id` | Attachment status poll |
| `POST` | `/api/webhooks/magica` | Svix-signed Magica run terminal events → complete wait token |
| `POST` | `/api/webhooks/transloadit` | Signed assembly notification → Attachment COMPLETED |
