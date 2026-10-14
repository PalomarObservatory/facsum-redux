(app-c)=
# Appendix C: Files, Logs & Troubleshooting

This appendix is for the observing assistant or support astronomer; ordinary use of FACSUM never requires it. All paths are relative to the FACSUM installation directory on Observer1.

(app-c-1)=
## C.1 Runtime files

:::{list-table}
:header-rows: 1
:widths: 30 70

* - Path
  - Purpose
* - `data/telemetry.json`
  - The current telemetry frame, rewritten atomically by the daemon about four times a second. Contains the parsed fields plus the raw TCS responses.
* - `data/daemon.pid`
  - PID of the running TCS daemon. Its absence means the daemon is not running.
* - `data/heartbeat`
  - Touched on every telemetry poll. If it goes stale for 120 s the daemon releases the TCS connection.
* - `data/allsky_cache.jpg`
  - Most recent all-sky camera frame, reused for 30 s and served if the camera is unreachable.
* - `data/daemon_YYYY-MM-DD.log`
  - Daemon operational log: connects, disconnects, TCS errors. Rotated daily, kept 14 days.
* - `data/daemon_launch_YYYY-MM-DD.log`
  - Captures a raw traceback if the daemon dies before its own logging starts. Normally empty.
* - `data/webserver_YYYY-MM-DD.log`
  - Diagnostic output from the PHP built-in web server, written by `start_facsum.sh`. The server sends *both* its access log and its error output to stderr, so `start_facsum.sh` filters that stream rather than redirecting it wholesale: per-request chatter (connection open/close, and every 2xx/3xx response) is dropped, while the startup banner, `Failed to listen …`, PHP warnings and fatals, and any 4xx/5xx response are kept. In normal operation the file grows by almost nothing; a healthy night may add only the one-line startup banner.

    The filename is fixed when the server starts, and the server is reused across sessions, so the file currently being appended to is usually named for an earlier date than today. Files are pruned after 14 days, and any that exceeds 20 MB is truncated in place as a safety net for a `php -S` process that stays alive (and keeps its log file open) for weeks at a time.
:::

(app-c-2)=
## C.2 Managing the daemon by hand

The browser starts and stops the daemon automatically, so this is only needed for diagnosis. On Observer1, in the FACSUM directory:

```bash
./start_daemon.sh            # start
./start_daemon.sh status     # is it running?
./start_daemon.sh restart    # stop, then start
./start_daemon.sh stop       # stop
```

The daemon can also be run in the foreground (`python3 tcs_daemon.py`), which is the fastest way to watch it negotiate with the TCS.

(app-c-3)=
## C.3 Troubleshooting

| Symptom | Likely cause and remedy |
|---|---|
| Browser opens but the page fails to load | The web server on Observer1 did not start. `start_facsum.sh` prints diagnostics in this case. Check whether a `php -S` process is running, what holds port 18080, and the tail of the most recently modified `data/webserver_*.log` (it is named for the day the server started, which is usually not today). Rerunning the script is usually enough. |
| Header stays *Disconnected*, or reconnection gives up after 5 attempts | The daemon could not be started, most often because `data/` is not writable by the web server. Check permissions, then `./start_daemon.sh status` on Observer1. |
| Header stuck on *TCS Reconnecting…* | The daemon is alive but cannot reach the TCS. Check today's `daemon_*.log` for connection errors, and confirm the TCS itself is up and accepting connections on port 49200. |
| Fields freeze but nothing turns red | Expected behavior during a short TCS outage: the display holds its last values for 12 s before it reports anything ([§3.2](sec-3-2)). |
| Airmass column shows "—" and the sky is empty | No LST is being received, i.e. there is no live TCS connection. Everything that depends on sidereal time is suppressed until it returns. |
| All-sky overlay is missing or misaligned | Missing: the camera is unreachable (common in daylight or with the dome closed); the last good frame is kept. Misaligned: adjust **Cam Align** ([§5.3](sec-5-3)). |
| A file's rows all show *Failed to Parse* | Auto-detection chose the wrong format. Expand **Parsing Options** and set File Type and Delimiter explicitly, then look at the Edit Text tab to see which lines are still red. |
| SIMBAD lookup always fails | Observer1 cannot reach `cdsweb.u-strasbg.fr`. Expand *Details* on the error card for the underlying message; coordinates can always be entered by hand. |
| Two browser tabs are fighting over the connection | Only one tab should be connected. Close the extra tab, then click **Connect** in the one you are keeping. |
