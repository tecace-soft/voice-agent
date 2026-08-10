# TecAce AX — Applications

This repository is a **workspace** that houses the TecAce voice agent and the companion
applications being built alongside it. Each application lives in its own top-level
directory and is **self-contained** (its own dependencies, configuration, and virtual
environment), so they can be developed, run, and deployed independently while sharing
one git history.

---

## Applications

| App | Directory | Status | What it is |
|---|---|---|---|
| **Voice Intake Agent** | [`voice-agent-app/`](voice-agent-app/) | Active | A phone agent that collects a lead's details from a Google Form, calls them back, and books a consultation by voice (English/Korean), with live Cal.com availability. See its [README](voice-agent-app/README.md). |
| **Admin Dashboard** | [`admin-dashboard-app/`](admin-dashboard-app/) | In progress | The web dashboard the Admin uses to monitor the system — clients + booking status, a booking calendar, and the agent's prompt. Reads from the shared backend. **React + Vite** (TypeScript). See its [README](admin-dashboard-app/README.md). |
| **Form** | [`form-app/`](form-app/) | In progress | The client-facing web form a lead fills in to request a callback (language, name, email, phone, purpose, date/time). Submits to the shared backend; intended to replace the Google Form. **React + Vite** (TypeScript). See its [README](form-app/README.md). |
| **Backend** | [`backend-app/`](backend-app/) | In progress | The shared API service owning the system's data and logic — used by the Admin Dashboard, and eventually by the voice agent. **Elysia + Bun** (TypeScript). See its [README](backend-app/README.md). |
| **Transcribe** | [`transcribe-app/`](transcribe-app/) | In progress | A batch pipeline that reads voicemail `.wav` attachments from email, transcribes them (Whisper), extracts the caller's details (Claude), and appends a row per voicemail to a Google Sheet. **Python**. See its [README](transcribe-app/README.md). |

---

## Repository layout

```
voice-agent/                  ← repo root (this README, the shared git history)
├── voice-agent-app/          ← the voice intake agent (Active; see its own README)
│   ├── src/  scripts/  docs/  data/
│   ├── pyproject.toml  requirements.txt
│   └── README.md  .env  .env.example
├── admin-dashboard-app/      ← Admin dashboard — React + Vite (in progress)
│   ├── src/  (App.tsx, pages/, api/)
│   ├── index.html  vite.config.ts  package.json  tsconfig.json
│   └── README.md  .env.example
├── form-app/                 ← client-facing intake form — React + Vite (in progress)
│   ├── src/  (App.tsx, api/)
│   ├── index.html  vite.config.ts  package.json  tsconfig.json
│   └── README.md  .env.example
├── backend-app/              ← shared API service — Elysia + Bun (in progress)
│   ├── src/  (index.ts, app.ts, routes/, config/)
│   ├── package.json  tsconfig.json
│   └── README.md  .env.example
├── transcribe-app/           ← voicemail → text → Google Sheet pipeline — Python (in progress)
│   ├── src/transcribe_app/  (config/, tools/, pipeline.py)
│   ├── scripts/  (run_transcribe.py, checks/)
│   ├── pyproject.toml  requirements.txt
│   └── README.md  .env.example
├── .gitignore                ← shared; patterns are non-anchored so they apply in every app
└── .claude/                  ← workspace-level tooling settings
```

The **form** and **admin dashboard** are React + Vite apps; the **backend** is Elysia + Bun.
Each has its own README with setup/run/deploy steps.

**What lives where**
- **Per app** (inside each app directory): source code, `pyproject.toml`/dependencies,
  `.env` (git-ignored, per-machine), runtime `data/`, and the app's own README.
- **Shared at the root**: the git repository, the `.gitignore` (its non-anchored patterns
  ignore `.env`, `data/`, `__pycache__`, `.venv/` in every app), and `.claude/`.

---

## Working in an app

Each app is a standalone project — `cd` into it, then follow that app's README.

```bash
cd voice-agent-app          # or another app directory
python -m venv .venv        # each app gets its own virtual environment
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .            # editable install from that app's pyproject.toml
```

Because each app has its own `pyproject.toml` and `.venv`, their dependencies never
collide. The `.env` for an app lives **inside that app's directory** and is created per
machine (it is not committed).

---

## Adding a new application

1. Create a new top-level directory (e.g. `some-new-app/`) — keep app code out of the root.
2. Give it its own `pyproject.toml`/dependencies, `README.md`, and `.env.example`.
3. Add a row to the **Applications** table above and a node to the **Repository layout**.
4. The root `.gitignore` already covers common patterns (`.env`, `data/`, `.venv/`,
   `__pycache__/`) at any depth — only add app-specific ignores if needed.

---

## Notes

- **`.env` files never travel with `git pull`** — they are git-ignored and must be created
  on each machine, in each app's directory.
- Keep this README's **Applications** table and **layout** current as apps are added,
  renamed, or retired — it's the map of the workspace.
