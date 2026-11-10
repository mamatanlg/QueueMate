<div align="center">

# Queue System

**A modern, real-time queue management system built for businesses of any size.**

Manage walk-in customers with multi-counter support, bilingual voice announcements, live displays, printed tickets with QR tracking, analytics dashboards, and 23 display layouts.

[![Built with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)](https://socket.io)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

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
