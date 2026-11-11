# QueueMate Backend

Independent Express API for QueueMate. This package is separate from the legacy root application and connects the cashier web app, public display, and mobile app to one PostgreSQL database.

## Stack

- Node.js with JavaScript ES modules
- Express for the versioned HTTP API
- PostgreSQL through `pg`
- Socket.IO attached to the same HTTP server
- Helmet, CORS, and rate limiting for the HTTP boundary
- Zod for environment and future request validation
- bcrypt and jsonwebtoken are included for the planned staff-authentication phase; authentication routes are not implemented yet

## Setup

From this directory:

```powershell
npm install
Copy-Item .env.example .env
```

Set `DATABASE_URL` to the Supabase PostgreSQL connection string before checking database connectivity. Never commit `.env` or expose its contents. Supabase connections use TLS with certificate verification; local loopback database connections do not use TLS.

`CLIENT_ORIGINS` is a comma-separated allowlist of browser origins. In development, the default allowlist is `localhost:3000` and `localhost:3002` (including their `127.0.0.1` equivalents). Add the exact LAN origins used by local web clients when testing on other devices. Requests without an Origin header, such as native mobile requests, are allowed by CORS; CORS is not authentication.

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

## Current scope

This phase provides backend, HTTP, database-connection, and Socket.IO foundations only. No queue endpoints, queue behavior, database schema/migrations, staff authentication routes, or private ticket events are implemented yet. Socket.IO currently registers connections only and does not broadcast queue or ticket data.

The database health check never returns connection details or credentials. In production, set a `DATABASE_URL` and a `SESSION_SECRET` of at least 32 characters before starting the service.
