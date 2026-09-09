# Image for the agent-message writer ONLY.
#
# This exists so the writer comes up and goes down with the voice agent, which is the only time it
# has anything to do — it turns the messages the assistant took into rows in the TEST spreadsheet.
# It is built from openai-agent-app/docker-compose.yml, which is where it is deployed from.
#
# The LIVE voicemail poller does NOT run from this image. It runs under systemd from a checkout
# (deploy/transcribe-poller.service), against .env and the client's sheet, and nothing here changes
# that. The default command below is the writer for exactly that reason: an image whose default is
# the writer cannot be started by accident and start polling a client's mailbox.
#
# Configuration is MOUNTED, not baked in. .env.test supplies every setting that decides where rows
# land; .env is mounted read-only purely so the writer can refuse to run if the two point at the
# same sheet. Neither belongs in an image layer.

FROM python:3.12-slim

WORKDIR /app

# Dependencies first so this layer caches across code edits.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY scripts ./scripts

# The package is imported from ./src, the way the scripts expect when run from the project root.
ENV PYTHONPATH=/app/src

# Watch mode: check for new messages on an interval, forever. A misconfiguration exits 1 on the
# first pass with the reason on stdout, rather than running and writing somewhere unintended.
CMD ["python", "scripts/write_agent_messages.py", "--watch"]
