# Admin Dashboard

The web dashboard the **Admin** uses to monitor the system — clients and their booking
status, a booking calendar, and the agent's current prompt/scenario.

Built with **React + [Vite](https://vitejs.dev/)** (TypeScript). Reads everything from the
shared **[`backend-app/`](../backend-app/)**. Deploys to Vercel.

## Sections

1. **Clients** (`/`) — a table of every client and the info they submitted (name, contact,
   language, purpose, requested time) plus their **booking status** (new / contacted /
   booked / unreachable / canceled) and the agent's post-call notes. Filter by status +
   search. Backed by `GET /intake`.
2. **Calendar** (`/calendar`) — a month grid where each day shows a count of **booked**
   appointments; click a day → `/calendar/:date` lists that day's appointments (time,
   client, purpose, notes). Backed by `GET /intake?status=booked`.
3. **Agent Prompt** (`/prompt`) — read-only view of the agent's current system prompt +
   call scenario. Backed by `GET /prompt`. (Editing is intended for a later update.)

## Structure

```
admin-dashboard-app/
  index.html
  src/
    main.tsx            # React entry + <BrowserRouter>
    App.tsx             # layout shell + nav + routes
    index.css           # styles
    lib.ts              # date/time formatting (Pacific), status labels
    ui.tsx              # StatusBadge, loading/error helper
    api/                # ← everything that talks to the backend
      backend.ts        #    typed client: listIntakes(), getPrompt()
      types.ts          #    request/response shapes (kept in sync with backend-app)
    pages/
      ClientsPage.tsx   # section 1
      CalendarPage.tsx  # section 2 (month grid)
      DayPage.tsx       # section 2 (one day's appointments)
      PromptPage.tsx    # section 3
  vite.config.ts  tsconfig.json  package.json  .env.example
```

## Setup

Requires **[Bun](https://bun.sh/)** (or Node) for tooling.

```bash
cd admin-dashboard-app
bun install
cp .env.example .env          # then set VITE_BACKEND_URL
```

Set **`VITE_BACKEND_URL`** to the backend's base URL (no trailing slash) — your deployed
Vercel backend in production, or `http://localhost:8000` when running the backend locally.

## Running it

```bash
bun run dev        # dev server at http://localhost:5173
bun run build      # typecheck + production build to dist/
bun run preview    # serve the production build locally
```

## Deploying to Vercel

Import the repo as its **own** Vercel project (separate from the form + backend):

1. **Root Directory → `admin-dashboard-app`**
2. Framework preset: **Vite** (auto-detected)
3. Environment variable: **`VITE_BACKEND_URL`** = your deployed backend URL
4. Deploy

Then add this app's deployed origin to the backend's **`CORS_ORIGIN`** so the browser can
call the API. The **`GET /prompt`** endpoint (section 3) must be deployed on the backend
first.

See the workspace [root README](../README.md) for how the apps fit together.
