# deploy

Host-level units for the VPS — things that belong to the machine rather than to one app. (The
transcribe poller's own unit lives in [transcribe-app/deploy/](../transcribe-app/deploy/).)

## docker-container-stats

Samples per-container CPU and memory every 10 seconds into
`/var/log/docker-container-stats.log`. This is the systemd version of the ad-hoc
`while true; do docker stats ...; done | tee -a` loop.

```bash
sudo install -m 755 deploy/docker-container-stats.sh /usr/local/bin/docker-container-stats.sh
sudo cp deploy/docker-container-stats.service /etc/systemd/system/
sudo cp deploy/docker-container-stats.logrotate /etc/logrotate.d/docker-container-stats
sudo systemctl daemon-reload
sudo systemctl enable --now docker-container-stats
```

Check it: `systemctl status docker-container-stats` · `tail -f /var/log/docker-container-stats.log`

Change the interval without editing the unit:

```bash
sudo systemctl edit docker-container-stats     # [Service] \n Environment=INTERVAL=30
sudo systemctl restart docker-container-stats
```

### What differs from the shell loop, and why

- **No `tee`.** systemd appends stdout to the file itself (`StandardOutput=append:`), so there's no
  pipeline — which also means a failure can't be swallowed by `tee`'s exit status. Errors go to the
  journal instead, so a broken sampler shows up in `systemctl status` rather than only in the file.
- **Log rotation.** The loop appends forever: ~8,600 sample blocks a day, one line per container
  each. Left alone it fills the disk and takes the box with it. The logrotate config keeps 7 daily
  files, rotating early if one passes 50 MB, with `copytruncate` so the running service keeps
  writing to the same handle.
- **Survives docker restarting.** `docker stats` failing is logged and sampling continues, so a
  daemon restart leaves a visible gap rather than stopping the monitoring. The unit uses `Wants=`
  rather than `Requires=` for the same reason.
- **Stops promptly.** The sleep runs in the background with a `TERM` trap, so
  `systemctl stop/restart` returns immediately instead of waiting out the interval.

### If you'd rather have a timer

A `systemd.timer` with `OnUnitActiveSec=10s` is the more idiomatic answer for periodic work, but at
this interval it means ~8,600 unit activations a day cluttering the journal. A single long-running
sampler is quieter, which is why it's built this way.

### Note on the format

Each block is a UTC header followed by one CSV line per container, exactly like the original loop.
If you plan to graph or grep this, putting the timestamp on every row instead is far easier to
parse — a one-line change in the script.
