# Form

The client-facing web form a lead fills in to request a callback — collecting their
language, name, email, phone number, purpose, and preferred date/time, and submitting it to
the shared **[`backend-app/`](../backend-app/)** (`POST /intake`).

Built with **React + [Vite](https://vitejs.dev/)** (TypeScript). Deploys to Vercel.

## Structure

The UI and the backend communication are kept separate:

```
form-app/
  index.html            # Vite entry HTML
  src/
    main.tsx            # React entry — mounts <App/>
    App.tsx             # the intake form (the frontend UI)
    index.css           # styles
    api/                # ← everything that talks to the backend lives here
      backend.ts        #    typed client: submitIntake(), error handling, base URL
      types.ts          #    request/response shapes (kept in sync with backend-app)
  vite.config.ts  tsconfig.json  package.json  .env.example
```

The form never builds URLs or parses responses itself — it calls functions from
`src/api/`, so swapping/extending the backend contract happens in one place.

## Setup

Requires **[Bun](https://bun.sh/)** (or Node) for tooling.

```bash
cd form-app
bun install
cp .env.example .env          # then set VITE_BACKEND_URL
```

Set **`VITE_BACKEND_URL`** to the backend's base URL (no trailing slash) — your deployed
Vercel backend in production, or `http://localhost:8000` when running the backend locally.
Vite only exposes vars prefixed with `VITE_` to the browser.

## Running it

```bash
bun run dev        # dev server at http://localhost:5173
bun run build      # typecheck + production build to dist/
bun run preview    # serve the production build locally
```

## Deploying to Vercel

Import the repo as its **own** Vercel project (separate from the backend):

1. **Root Directory → `form-app`**
2. Framework preset: **Vite** (auto-detected)
3. Environment variable: **`VITE_BACKEND_URL`** = your deployed backend URL
4. Deploy

Remember to add this app's deployed origin to the backend's **`CORS_ORIGIN`** so the browser
is allowed to call the API.

See the workspace [root README](../README.md) for how the apps fit together.
