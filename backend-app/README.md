# Backend

The shared backend / API service. It is the single place that owns the system's data and
business logic, exposed over an API.

> **Status:** placeholder — directory scaffolding only. Tech stack not chosen yet.

## Role in the workspace

- **Consumers:** the **[`admin-dashboard-app/`](../admin-dashboard-app/)** uses it now, and
  the **[`voice-agent-app/`](../voice-agent-app/)** will use it eventually (today the voice
  agent talks to Cal.com / Sheets / Gemini directly; over time that moves behind this API).
- Runs and deploys independently of the other apps, with its own configuration.

## Not set up yet

This directory is intentionally a stub. When the stack is chosen (e.g. Python/FastAPI to
share code with the voice agent, or Node/Express), scaffold the project here and replace
this README with real setup/run docs. Fill in [`.env.example`](.env.example) as the config
surface becomes known.

See the workspace [root README](../README.md) for how apps fit together and how to add one.
