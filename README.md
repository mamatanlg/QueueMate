<div align="center">

# QueueMate

**Web-Based Real-Time Queue Monitoring and Notification System**

For the Business Office of San Isidro College, Malaybalay City, Bukidnon.

</div>

---

## Target architecture

QueueMate has three client applications, one backend, and one shared PostgreSQL database. The backend is the source of truth for queue numbering, assignment, status transitions, and notifications; client applications must not implement independent queue logic.

```text
Cashier web (Next.js) ─┐
Public TV (Next.js) ───┼── HTTPS / Socket.IO ── Node.js + Express backend ── PostgreSQL
Mobile app (Expo) ─────┘
```

| Component | Planned technology | Responsibility |
|-----------|--------------------|----------------|
| `cashier-web/` | Next.js, JavaScript | Authenticated cashier interface; operates only the cashier's assigned window |
| `public-display/` | Next.js, JavaScript | Public TV display for all four windows, latest issued number, and QR code |
| `mobile-app/` | Expo / React Native, JavaScript | QR scanning, transaction selection, ticket display, queue tracking, sound and vibration alerts |
| `backend/` | Node.js, Express, Socket.IO | Authentication, queue rules, API, and real-time updates |
| `database/` | PostgreSQL schema and migrations | Persistent shared queue and application data |
| `docs/` | Project documentation | Architecture and implementation notes |

The repository also retains a root-level Vite/React and Express application (`src/`, `server/`, and root package files). Its existing `/cashier` portal is the PC login surface for the current cashier/admin integration; `/admin` is the protected administrator workspace. The separate `cashier-web/`, `public-display/`, and `mobile-app/` projects remain distinct from that root application.

### Queue rules the backend must enforce

- Issue one global, sequential queue; issuing a number does not assign it to a window.
- Keep all issued customers in one shared waiting queue, including when all four windows are unavailable.
- Keep the cashier assignments fixed: Cashier 1 → Window 1, Cashier 2 → Window 2, Cashier 3 → Window 3, and Cashier 4 → Window 4. Each cashier can operate only their assigned window.
- When a cashier calls next, the backend assigns the oldest waiting number to that cashier's window. The operation must be atomic so two cashiers cannot call the same number or skip an older waiting number.
- An unavailable window cannot receive a new assignment. When it becomes available, its cashier may call the next waiting number.
- For ticket 010, calling 005 triggers the approaching alert; calling 010 triggers the called alert with the assigned window. Trigger each alert once per ticket, using sound and vibration when supported and permitted.
- Students and parents do not need accounts. Cashier and administrator functions require authentication.
- On mobile, show the customer's number and status plus all four current serving numbers. Do not show an assigned window until that customer's ticket has been called.

### Device access and deployment

All clients use the same backend address. During local development, a device must use the development computer's LAN IP (and the backend must listen on a network interface reachable from the LAN); `localhost` on a phone or TV refers to that device, not the developer's computer. In production, clients use the deployed public HTTPS address, with Socket.IO over the secure connection.

This is an independent prototype: it does not connect to the school's existing queue system and does not process payments or generate official SOAs.

## Project structure

```text
QueueMate/
  backend/
  cashier-web/
  public-display/
  mobile-app/
  database/
  docs/
  README.md
  .gitignore
  # Preserved legacy files: src/, server/, public/, package.json, and others
```

## Development roadmap

1. **Backend and database foundation:** Define the PostgreSQL schema, four fixed cashier assignments, authentication boundary, queue state transitions, and atomic sequential issue/call operations.
2. **Queue API and real-time events:** Implement backend endpoints and Socket.IO updates; verify concurrent calls, oldest-first behavior, unavailable windows, and once-per-ticket alerts.
3. **Cashier web:** Build authenticated cashier sign-in and assigned-window queue controls against the shared backend.
4. **Public display:** Build the TV view for all four windows, latest issued number, statuses, and public QR code.
5. **Mobile app:** Build QR scanning, transaction selection, ticket tracking, and permitted sound/vibration alerts.
6. **Integration and deployment:** Test all clients against the same backend/database, validate LAN development access, then configure the public HTTPS deployment.

Do not install packages or initialize these applications until the setup plan is approved. No new application code has been added as part of this structure preparation.

## Legacy application reference

The following sections describe the pre-existing Vite/React queue application retained in this repository. They are historical reference only and are not instructions for setting up the QueueMate target architecture above.

## Features

### Core Queue Management
- **Multi-counter support** — unlimited counters, each operated independently
- **Service categories** — General, Payments, Inquiries, Accounts (fully customizable)
- **Custom ticket prefixes** — `G-001`, `P-002`, `A-003` per category
- **Ticket hold/park** — put a ticket on hold and serve the next person
- **Transfer between categories** — move tickets mid-service
- **Smart routing** — auto-assign tickets to the least busy counter
- **Operator notes** — add notes to any ticket

### Display Screen (23 Layouts)
| Layout | Style |
|--------|-------|
| Classic | Counter grid with animated numbers |
| Minimal | Single large centered number |
| Ticker | Horizontal counter cards |
| List | Split view: serving + full queue |
| Spotlight | Hero number + sidebar queue |
| Dual | Serving left, upcoming right |
| Board | Airport departure board |
| Cards | Floating 3D cards with depth |
| Stadium | Scoreboard matrix grid |
| Terminal | Retro green DOS console |
| News | TV news channel layout |
| Table | Spreadsheet with all details |
| Orbit | Numbers rotating in a ring |
| Bubble | Floating circles with drift |
| Tower | Vertical stack with perspective |
| Mosaic | Color-coded tile grid |
| Split | Big top number + strip below |
| Sidebar | Queue list left, hero right |
| Zen | Just the number, nothing else |
| Banner | Horizontal continuous scroll |
| Hospital | Room/doctor card layout |
| Bank | LED dot-matrix red display |
| Restaurant | Order ready / preparing |

### Voice Announcements
- **Google Translate TTS** — HD quality, natural-sounding
- **4 languages** — English, Arabic, Urdu, French
- **5 sound themes** — Default, Bell, Chime, Ding, Dual
- **Voice test panel** — preview any language from settings

### Customer Kiosk
- Category selection with estimated wait times
- Printable tickets with QR code (thermal printer compatible)
- Real-time "people waiting" count
- Bilingual interface

### Ticket Tracking
- Scan QR code or enter ticket number at `/track`
- Live position updates every 10 seconds
- Sound alert when your turn is near
- Status indicators: waiting, serving, served, skipped

### Analytics Dashboard
- **Daily stats** — served, waiting, skipped, avg wait/service time
- **Peak hours** — 24-hour bar chart
- **Weekly & monthly trends** — 7-day and 30-day charts
- **Busiest day of week** — all-time distribution
- **Operator performance** — tickets served & avg time per operator
- **Service time by category** — compare category efficiency
- **Wait time histogram** — distribution buckets
- **CSV export** — download full ticket history
- **PDF report** — print-ready formatted report
- **Auto-refresh** — updates every 30 seconds

### Admin & Management
- **Role-based access** — operators see Queue tab only, admins see everything
- **Admin password protection** — configurable from settings
- **Category management** — add, edit, delete, set prefixes and colors
- **Counter management** — add, rename, delete counters
- **Audit log** — every action logged with timestamp, actor, details
- **Shift management** — auto clock-in/out tracking
- **Multi-branch support** — add and switch between locations
- **Webhook notifications** — POST to external URLs on queue events
- **Session persistence** — operators stay logged in on page refresh

### Customization
- **Light / Dark theme** — system-wide toggle
- **10 accent colors + custom hex** — change the primary color
- **4 animated backgrounds** — Particles, Waves, Gradient, Aurora
- **Custom CSS injection** — full control for advanced styling
- **Custom logo** — URL-based branding on display and kiosk
- **Digital signage** — rotate images/videos on display screen
- **Scrolling announcements** — custom messages on display banner
- **Floor map** — visual counter layout overlay
- **Multi-language UI** — English, Arabic, Urdu, French interface

### Technical
- **Real-time sync** — Socket.IO WebSockets across all devices
- **REST API** — full API for third-party integration
- **Weather widget** — live temperature on display (Open-Meteo, no API key)
- **Android fullscreen** — wake lock + fullscreen API support
- **Thermal printer support** — 80mm receipt-optimized print layout

---

## Quick Start

```bash
# Clone
git clone https://github.com/krispx2811/Queue-System.git
cd Queue-System

# Install
npm install

# Configure Supabase
cp .env.example .env
# Edit .env with your Supabase credentials

# Run schema once in Supabase SQL Editor (server/schema.sql)

# Run (starts both server + frontend)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Deploy to Render (Free)

One-click deploy from GitHub:

1. Sign up at [render.com](https://render.com)
2. **New** → **Web Service** → connect your GitHub repo
3. Render auto-detects `render.yaml`
4. Add environment variables under "Environment":
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `SUPABASE_ANON_KEY`
5. Click **Create Web Service** — done in ~3 minutes

**Prevent spin-down:** Render free tier sleeps after 15 min idle. Set up a free monitor at [uptimerobot.com](https://uptimerobot.com) to ping `https://your-app.onrender.com/api/status` every 5 minutes.

---

## Architecture

```
queue-system/
  server/
    index.js          Express + Socket.IO server (port 3210)
    store.js          In-memory store with JSON persistence
  src/
    context/          Socket.IO React context
    components/       Shared UI components
    hooks/            Voice, formatting hooks
    pages/
      Landing/        Home page with live stats
      Dashboard/      Full overview with inline controls
      Admin/          Operator panel + admin settings
      Display/        TV/monitor screen (23 layouts)
      Kiosk/          Customer self-service
      Track/          Ticket position tracking
    utils/            i18n, CSV, sounds, formatters
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Queue status, counters, categories |
| `GET` | `/api/tickets` | All tickets |
| `GET` | `/api/ticket/:number` | Ticket position lookup |
| `POST` | `/api/ticket` | Create ticket `{ categoryId }` |
| `GET` | `/api/analytics` | Full analytics data |
| `GET` | `/api/audit` | Audit log |

Base URL: `http://localhost:3210`

## WebSocket Events

<details>
<summary>Click to expand all events</summary>

**Ticket Operations**
- `ticket:take` — issue new ticket
- `ticket:call` — call next for a counter
- `ticket:recall` — recall current ticket
- `ticket:skip` — skip current ticket
- `ticket:complete` — mark as served
- `ticket:hold` — put on hold
- `ticket:unhold` — resume held ticket
- `ticket:transfer` — transfer to another category
- `ticket:note` — add/edit note

**Counter Operations**
- `counter:register` — join a counter
- `counter:toggle` — open/close
- `counter:update` — rename, set categories
- `counter:add` — create new counter
- `counter:delete` — remove counter

**Admin Operations**
- `admin:reset` — clear all tickets
- `admin:announcement` — add/remove announcements
- `admin:analytics` — get today's analytics
- `admin:advancedAnalytics` — weekly trends, operator stats
- `admin:monthlyAnalytics` — 30-day trends, histogram
- `admin:export` — export ticket data

**Settings**
- `settings:update` — update any setting
- `auth:check` — validate password
- `auth:setPasswords` — set admin/operator passwords

</details>

## Configuration

All settings are configurable from the Admin panel at runtime — no config files needed. Settings persist to `server/data.json` automatically.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Framer Motion |
| Backend | Express 5, Socket.IO 4 |
| Voice | Google Translate TTS + Web Speech API |
| State | In-memory + JSON file persistence |
| Routing | React Router 7 |
| QR Codes | qrcode.react |
| Weather | Open-Meteo API (free, no key) |

## Browser Support

- Chrome / Edge (desktop + Android)
- Safari (desktop + iOS)
- Firefox

## License

MIT

---

<div align="center">
  <sub>Built for real-world queue management. No cloud dependencies. No subscriptions. Just run it.</sub>
</div>
# QueueMate
