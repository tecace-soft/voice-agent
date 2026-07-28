# Backend

The shared backend / API service — the single place that owns the system's data and
business logic, exposed over an HTTP API.

Built with **[Elysia](https://elysiajs.com/)** on the **[Bun](https://bun.sh/)** runtime
(TypeScript, end-to-end type-safe).

## Role in the workspace

- **Consumers:** the **[`admin-dashboard-app/`](../admin-dashboard-app/)** uses it now, and
  the **[`voice-agent-app/`](../voice-agent-app/)** will use it eventually (today the voice
  agent talks to Cal.com / Sheets / Gemini directly; over time that moves behind this API).
- Runs and deploys independently, with its own configuration.

## Setup

Requires **[Bun](https://bun.sh/)** (1.3+). Install deps:

```bash
cd backend-app
bun install
cp .env.example .env          # then adjust (PORT, NODE_ENV)
```

## Running it

```bash
bun run dev        # watch mode — restarts on change
bun run start      # run once
```

The server starts on `PORT` (default **8000**):

```bash
curl http://localhost:8000/           # {"name":"backend-app","message":"Elysia is running"}
curl http://localhost:8000/health     # {"status":"ok","uptime":...}
```

Other scripts: `bun run typecheck` (tsc, no emit) · `bun run build` (bundle to `dist/`).

## Project layout

```
backend-app/
  src/
    index.ts           # entrypoint — starts the HTTP server (app.listen)
    app.ts             # composes the Elysia app from controllers (exported, testable)
    config/
      env.ts           # typed environment access (Bun auto-loads .env)
    routes/
      health.ts        # health/liveness controller
  package.json
  tsconfig.json
  .env.example
```

### Conventions

- **One `Elysia` instance per controller**, composed onto the app with `.use(...)` — the
  Elysia-recommended pattern (method chaining preserves end-to-end type inference).
- **`src/app.ts` builds the app without `.listen()`** so tests can drive it directly via
  `app.handle(new Request(...))`; **`src/index.ts` owns the server lifecycle**.
- Add a feature: create `src/routes/<feature>.ts` exporting an `Elysia` instance, then
  `.use()` it in `src/app.ts`.

See the workspace [root README](../README.md) for how the apps fit together.
