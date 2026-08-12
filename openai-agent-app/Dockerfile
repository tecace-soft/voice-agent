# Image for both the media-stream server and the poller (same code, different command).
FROM python:3.12-slim

WORKDIR /app

# Install the package (and its deps) first so this layer caches across code edits.
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

# Scripts are the process entrypoints (server / poller); the package is importable from the install.
COPY scripts ./scripts

# Default = the server. docker-compose overrides the command for the poller service.
CMD ["uvicorn", "openai_agent.telephony.server:app", "--host", "0.0.0.0", "--port", "5050"]
