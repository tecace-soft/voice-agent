#!/usr/bin/env bash
# Sample per-container CPU and memory every INTERVAL seconds, one block per sample.
#
# Installed at /usr/local/bin/docker-container-stats.sh and run by
# docker-container-stats.service. Output goes to stdout — systemd appends it to the log file, so
# there is no `tee` here and no pipeline to lose an exit status in.
set -uo pipefail

INTERVAL="${INTERVAL:-10}"
FORMAT='{{.Name}},{{.Container}},{{.CPUPerc}},{{.MemUsage}}'

# Report the reason rather than dying: docker restarting, or the daemon briefly unreachable, is a
# thing to see in the log — not a reason for the sampler to exit and get restarted in a loop.
sample() {
  if ! docker stats --no-stream --format "$FORMAT" 2>&1; then
    echo "docker stats failed (is the daemon running?)"
  fi
}

# systemd sends SIGTERM on stop; exit promptly instead of finishing the sleep.
trap 'exit 0' TERM INT

while true; do
  printf '\n=== %s ===\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  sample
  sleep "$INTERVAL" &
  wait $!   # sleeping in the background keeps SIGTERM responsive
done
