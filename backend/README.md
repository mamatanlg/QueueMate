# QueueMate Backend

Independent Express API for QueueMate. This package is separate from the legacy root application and connects the cashier web app, public display, and mobile app to one PostgreSQL database.

## Stack

- Node.js with JavaScript ES modules
- Express for the versioned HTTP API
- PostgreSQL through `pg`
- Socket.IO attached to the same HTTP server
- Helmet, CORS, and rate limiting for the HTTP boundary
- Zod request validation
- bcrypt password hashing and revocable JWT cashier sessions

## Setup

From this directory:

```powershell
npm install
Copy-Item .env.example .env
```

Set `DATABASE_URL` to the Supabase PostgreSQL connection string before checking database connectivity. Never commit `.env` or expose its contents. Supabase connections use TLS with certificate verification; local loopback database connections do not use TLS.

`CLIENT_ORIGINS` is a comma-separated allowlist of browser origins. In development, the default allowlist is `localhost:3000` and `localhost:3002` (including their `127.0.0.1` equivalents). Add the exact LAN origins used by local web clients when testing on other devices. Requests without an Origin header, such as native mobile requests, are allowed by CORS; CORS is not authentication.

### Database setup

For a fresh database, apply these migrations in order from the repository root:

1. [`database/migrations/000_operational_baseline.sql`](../database/migrations/000_operational_baseline.sql) creates the eight operational tables and inserts the four cashier windows, three transaction types, and three system settings.
2. [`database/migrations/001_auth_sessions.sql`](../database/migrations/001_auth_sessions.sql) creates the cashier authentication session table and its indexes.
3. Run the cashier seed script below to create any missing cashier accounts.

The operational baseline is for a fresh database only. Do not replay it against an existing populated QueueMate database: it creates tables and inserts reference records. Check an existing installation against the baseline definitions and reconcile differences separately; do not recreate its tables or records. Apply the auth-session migration to an existing database only after verifying that its objects are not already present.

Set `SESSION_SECRET` to a cryptographically random value of at least 32 characters. Do not use the example placeholder as a production secret.

Create missing cashier accounts from an interactive terminal:

```powershell
npm run seed:cashiers
```

The script first checks that Windows 1–4 exist and are active, and that any existing expected accounts have the cashier role, are active, and are assigned to their matching window. It stops with an error on conflicting usernames or window assignments and does not modify existing staff. If accounts are missing, it prompts once for a shared password without echoing input; use a password with 12–72 UTF-8 bytes. The password is hashed with bcrypt and the hash is reused only for newly created accounts. Creation and final verification run in a transaction, and any insertion or verification error rolls back all new accounts. Re-running the command leaves already-correct accounts unchanged.

## Run

```powershell
npm run dev
```

Or run without file watching:

```powershell
npm start
```

The server listens on port 4000 by default and binds to network interfaces so LAN devices can connect. Set `PORT` to change it. Health endpoints:

- `GET /api/v1/health` — backend process health.
- `GET /api/v1/health/database` — executes `SELECT 1`; returns `503` if the database is unconfigured or unavailable.

## API

All responses use JSON except logout (`204 No Content`). Cashier routes require `Authorization: Bearer <accessToken>`. Login tokens expire after eight hours and are checked against the session table on every authenticated request; logout revokes the current token. Ticket access tokens are returned only when issuing a ticket and must be sent in the `X-Ticket-Token` header when looking up that ticket. Store them securely; they cannot be recovered from the database.

### Authentication

`POST /api/v1/auth/login`

```json
{ "username": "cashier1", "password": "<cashier password>" }
```

Sanitized response:

```json
{
  "accessToken": "<JWT>",
  "tokenType": "Bearer",
  "expiresIn": 28800,
  "cashier": {
    "username": "cashier1",
    "displayName": "Cashier 1",
    "window": { "number": 1, "name": "Window 1" }
  }
}
```

`POST /api/v1/auth/logout` — authenticated; revokes the current session.

### Public queue and tickets

- `GET /api/v1/public/queue` — business date, latest daily number, waiting count, and active window statuses/current numbers.
- `POST /api/v1/public/tickets` — issues a ticket; limited to 10 requests per IP per minute.
- `GET /api/v1/public/tickets/{ticketId}` — fetches ticket status using its ticket access token header.

Issue request:

```json
{ "transactionType": "SOA" }
```

Supported `transactionType` values are `SOA`, `Payment`, and `Other Transactions`.

Sanitized issue response:

```json
{
  "ticketId": "<UUID>",
  "ticketNumber": "001",
  "transactionType": "SOA",
  "businessDate": "2026-11-13",
  "status": "waiting",
  "issuedAt": "<timestamp>",
  "ticketAccessToken": "<one-time secret>"
}
```

For status lookup, send `X-Ticket-Token: <one-time secret>`. The window number is omitted until the ticket has been called.

### Cashier operations

All routes below are restricted to the authenticated cashier's assigned window. The server derives the staff and window IDs from the active session; clients cannot select another window.

- `GET /api/v1/cashier/me` — cashier, assigned window, availability, and current ticket.
- `GET /api/v1/cashier/queue` — shared waiting queue, ordered oldest first.
- `PATCH /api/v1/cashier/window/status` — set `{"availabilityStatus":"available"}` or `"unavailable"`.
- `POST /api/v1/cashier/queue/next` — atomically claims the oldest waiting ticket if the window is available and has no current ticket.
- `POST /api/v1/cashier/current/complete` — completes the current ticket.
- `POST /api/v1/cashier/current/skip` — skips the current ticket.

Calling another ticket while one is serving returns `409`. Queue claims use a PostgreSQL transaction and row lock without `SKIP LOCKED`, so a locked older ticket is not bypassed. Daily numbers are generated atomically using the Manila business date. Near-turn notifications are created only when the N-5 ticket is called, not when it is skipped.

Socket.IO broadcasts `ticket:issued`, `ticket:called`, `ticket:completed`, `ticket:skipped`, `window:updated`, and `notification:created`. Public events contain no staff identity, ticket access token, or token hash.

## Test

Run the backend unit tests from `backend/`:

```powershell
npm test
```

The database health check never returns connection details or credentials. In production, set a `DATABASE_URL` and a `SESSION_SECRET` of at least 32 characters before starting the service. Tests do not apply migrations, seed accounts, or mutate the configured database.
