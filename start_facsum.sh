#!/bin/bash

OBSERVER1_USER="user1"
OBSERVER1_HOST="observer1.palomar.caltech.edu"
OBSERVER1_DIR="~/imw/FACSUM"
# 8080 is a very common default port for unrelated software; Observer1's
# data/daemon.log shows something else (not our own php -S -- no such
# process was found running) has been intermittently squatting on it for
# weeks ("Address already in use"), well before any FACSUM script changes.
# Moved off it entirely rather than continuing to contest it.
LOCAL_PORT=18080
REMOTE_PORT=18080
SSH_SOCKET="${HOME}/.facsum_ssh_ctl"
SSH_MASTER_LOG="${HOME}/.facsum_ssh_master.log"

cleanup() {
    echo "Cleaning up..."
    # BatchMode=yes on every call below: these are best-effort teardown steps
    # over a control socket that may already be dead. Without BatchMode, ssh
    # silently falls back to a brand-new *interactive* connection whenever the
    # control socket isn't cleanly alive — i.e. exactly a surprise password
    # prompt during shutdown, which is not something cleanup() should ever do.
    # -x (exact match): "-f" alone matches against the FULL command line of
    # every process, including our own wrapping "bash -c '...'" invocation --
    # whose command line literally contains this same pattern text, since
    # it's quoted right here. Without -x, pkill kills that wrapper itself
    # before it ever reaches the rm/echo below it in this same command.
    ssh -o BatchMode=yes -S ${SSH_SOCKET} ${OBSERVER1_USER}@${OBSERVER1_HOST} \
        "pkill -9 -f tcs_daemon 2>/dev/null; pkill -f -x 'php -S 127.0.0.1:${REMOTE_PORT}' 2>/dev/null; rm -f ${OBSERVER1_DIR}/data/daemon.pid ${OBSERVER1_DIR}/data/heartbeat; echo '{\"_status\":\"disconnected\",\"_updated\":\"\",\"_raws\":{}}' > ${OBSERVER1_DIR}/data/telemetry.json" 2>/dev/null
    pkill -f "ssh.*-L ${LOCAL_PORT}" 2>/dev/null
    ssh -o BatchMode=yes -S ${SSH_SOCKET} -O exit ${OBSERVER1_USER}@${OBSERVER1_HOST} 2>/dev/null
    echo "Done."
}

trap cleanup EXIT INT TERM

# A session is safe to reuse (skip the password prompt) only if BOTH:
#   1. our own multiplexed SSH master (this exact control socket) is still
#      alive — not just "something" bound to LOCAL_PORT. A leftover,
#      unrelated, or half-dead process would satisfy a bare port check too
#      easily, and that's exactly what let facsum3 silently skip the
#      password on a stale session and hand back a dead backend.
#   2. the remote FACSUM server actually answers through the tunnel — the
#      SSH master can be alive while the remote php -S has crashed.
session_is_healthy() {
    ssh -o BatchMode=yes -S "${SSH_SOCKET}" -O check "${OBSERVER1_USER}@${OBSERVER1_HOST}" >/dev/null 2>&1 || return 1
    curl -sf --max-time 3 "http://127.0.0.1:${LOCAL_PORT}/api.php?action=daemon_status" >/dev/null 2>&1
}

# Truncates any oversized webserver log in place. Safe to run against a file
# php -S still has open for append: truncating (not deleting/renaming) resets
# the length the kernel tracks for that open fd, so the process's very next
# write starts the file over from empty instead of orphaning growth under a
# path no script is watching anymore.
#
# This is a backstop, not the primary control — see the stderr filter on the
# php -S launch below, which is what actually keeps these files small.
#
# It scans every webserver_*.log rather than just today's. The log filename is
# fixed when php -S starts, and the "reuse if healthy" fast path keeps that
# same process (and the same open fd) alive for days, so the file still being
# appended to is usually named for some earlier date. An earlier version
# checked only data/webserver_$(date +%Y-%m-%d).log, which on any day after
# the server started matched a file that did not exist — so the cap never
# fired on the file that was actually growing. Combined with the age prune
# below being unable to help (a continuously-appended file's mtime is always
# "now"), that is how three logs reached 489 MB between them.
WEBSERVER_LOG_MAX_BYTES=$((20 * 1024 * 1024))  # 20 MB — generous for a single-observer tool's error log
cap_remote_log_size() {
    ssh -o BatchMode=yes -S "${SSH_SOCKET}" "${OBSERVER1_USER}@${OBSERVER1_HOST}" \
        "cd ${OBSERVER1_DIR} || exit 0; \
         for log in data/webserver_*.log; do \
             [ -f \"\$log\" ] || continue; \
             if [ \$(wc -c < \"\$log\") -gt ${WEBSERVER_LOG_MAX_BYTES} ]; then \
                 : > \"\$log\"; echo \"  (truncated \$log — exceeded ${WEBSERVER_LOG_MAX_BYTES} bytes)\"; \
             fi; \
         done" 2>/dev/null
}

if session_is_healthy; then
    echo "Reusing existing Observer1 session."
    cap_remote_log_size
else
    echo "No healthy Observer1 session found -- starting fresh."
    # Tear down anything stale first: a dangling control socket from a
    # crashed run, or a local port-forward left over from a session whose
    # cleanup() never ran. Without this, a leftover remote php -S can keep
    # squatting on REMOTE_PORT and the new one below fails to bind silently
    # (only visible in data/webserver_*.log), leaving the tunnel pointed at
    # the old, possibly degraded process. BatchMode=yes so a dead/missing socket
    # just fails immediately instead of ssh silently opening a fresh
    # interactive (password-prompting) connection just to tear it down.
    ssh -o BatchMode=yes -S "${SSH_SOCKET}" -O exit "${OBSERVER1_USER}@${OBSERVER1_HOST}" >/dev/null 2>&1
    pkill -f "ssh.*-L ${LOCAL_PORT}" 2>/dev/null
    rm -f "${SSH_SOCKET}"

    echo "Connecting to Observer1 (enter password)..."
    # ControlPersist=yes is what actually keeps this master answering LATER,
    # separate ssh -S-only calls (our health check, diagnostics, cleanup) --
    # without it, the master isn't reliably reusable by other invocations
    # once this initiating command backgrounds. This was silently missing
    # before, which is why every -S-only call was falling back to a doomed
    # brand-new BatchMode connection ("Permission denied ...").
    #
    # -N (no remote command) is deliberate: giving -M/-f a remote command to
    # run AND asking it to become a persistent background multiplexer at the
    # same time is exactly what was breaking every attempt before this --
    # confirmed by testing the identical startup command via a plain `ssh -f`
    # (no -M, no -L), where it worked fine every time, versus via the full
    # -M/-S/-L combination, where the remote command's channel never got far
    # enough to run anything past `cd`. Splitting "establish the persistent
    # tunnel" from "run the startup command" into two separate steps avoids
    # that transition entirely.
    # Once backgrounded, this master keeps running (and forwarding) for the
    # rest of the session -- any connection-refused noise from our own
    # health-check loop racing php -S's startup would otherwise print to
    # this terminal indefinitely, since -f backgrounds the process without
    # detaching its inherited stdout/stderr. Redirecting to a log file avoids
    # that; the password prompt itself goes via /dev/tty and is unaffected.
    ssh -M -S ${SSH_SOCKET} -f -N \
        -o ControlPersist=yes \
        -o ServerAliveInterval=20 \
        -o ServerAliveCountMax=6 \
        -L ${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT} \
        ${OBSERVER1_USER}@${OBSERVER1_HOST} \
        >> "${SSH_MASTER_LOG}" 2>&1

    # A separate, ordinary session multiplexed through the master above --
    # runs to completion and exits normally; no `sleep infinity` needed since
    # nohup+disown already keeps php -S alive independently of this session.
    # 127.0.0.1 explicitly, not "localhost", on both this and the -L target
    # above and the remote php -S bind address: Observer1 resolves
    # "localhost" to the IPv6 loopback (::1) first, so `php -S localhost:PORT`
    # binds IPv6-only -- then a forward whose remote target resolves/connects
    # via IPv4 gets "Connection refused" even though the server is genuinely
    # up and healthy. Pinning both sides to the same explicit address removes
    # the ambiguity instead of depending on how this box's resolver is ordered.
    # data/webserver_YYYY-MM-DD.log (dated + 14-day-pruned, same convention
    # as tcs_daemon.py's own log) -- date computed remotely (via the escaped
    # \$(...)) so it reflects Observer1's own clock, not portal's.
    #
    # php -S writes BOTH its access log and its error output to stderr; stdout
    # gets nothing at all. An earlier version here had that backwards -- it
    # sent stdout to /dev/null believing that was the access log, and stderr
    # to the file "so only genuine errors land there". The effect was the
    # opposite: every request logged three lines (Accepted / [200]: GET /
    # Closing, ~184 bytes), and with the browser polling telemetry every
    # 100 ms that is ~1.8 KB/s, ~159 MB/day of pure noise while connected.
    #
    # So stderr is filtered rather than redirected wholesale. Dropped:
    # Accepted/Closing and any 2xx/3xx response line. Kept: the startup
    # banner, "Failed to listen ..." (which the diagnostics below tail for),
    # PHP warnings/fatals, and 4xx/5xx responses -- i.e. everything with
    # diagnostic value. Measured: 63 requests -> 4 lines, 455 bytes.
    #
    # The filter runs inside one nohup'd sh so php and grep share a lifetime
    # and survive this ssh session exiting; process substitution would be
    # tied to the invoking shell and die with it. `exec` keeps php's command
    # line exactly 'php -S 127.0.0.1:PORT' so the pkill -f -x above, the
    # health check, and the ps diagnostics all still match it unchanged.
    echo "Starting Observer1 server..."
    WEBSERVER_LOG_FILTER='(Accepted|Closing)$|\[(2[0-9][0-9]|3[0-9][0-9])\]: '
    ssh -o BatchMode=yes -S ${SSH_SOCKET} ${OBSERVER1_USER}@${OBSERVER1_HOST} \
        "cd ${OBSERVER1_DIR} && { pkill -f -x 'php -S 127.0.0.1:${REMOTE_PORT}' 2>/dev/null; sleep 1; find data -maxdepth 1 -name 'webserver_*.log' -mtime +14 -delete 2>/dev/null; nohup sh -c \"exec php -S 127.0.0.1:${REMOTE_PORT} 2>&1 >/dev/null | grep --line-buffered -vE '${WEBSERVER_LOG_FILTER}' >> data/webserver_\\\$(date +%Y-%m-%d).log\" >/dev/null 2>&1 & disown; }"

    echo "Waiting for Observer1 server to come up..."
    server_up=0
    for i in $(seq 1 15); do
        curl -sf --max-time 2 "http://127.0.0.1:${LOCAL_PORT}/api.php?action=daemon_status" >/dev/null 2>&1 && { server_up=1; break; }
        sleep 1
    done
    if [[ "$server_up" -ne 1 ]]; then
        echo "WARNING: Observer1 server did not respond after 15s. Diagnostics:"
        echo "--- can we cd into ${OBSERVER1_DIR}? ---"
        ssh -o BatchMode=yes -S ${SSH_SOCKET} ${OBSERVER1_USER}@${OBSERVER1_HOST} \
            "cd ${OBSERVER1_DIR} 2>&1 && pwd" || echo "  cd FAILED"
        echo "--- is a php -S process running on Observer1? ---"
        ssh -o BatchMode=yes -S ${SSH_SOCKET} ${OBSERVER1_USER}@${OBSERVER1_HOST} \
            "ps ax 2>/dev/null | grep 'php -S' | grep -v grep" || echo "  (none found / ps failed)"
        echo "--- what's listening on port ${REMOTE_PORT} on Observer1? ---"
        ssh -o BatchMode=yes -S ${SSH_SOCKET} ${OBSERVER1_USER}@${OBSERVER1_HOST} \
            "(netstat -tln 2>/dev/null || ss -tln 2>/dev/null) | grep ':${REMOTE_PORT} '" || echo "  (nothing found / no netstat or ss)"
        echo "--- last 20 lines of today's ${OBSERVER1_DIR}/data/webserver_*.log ---"
        ssh -o BatchMode=yes -S ${SSH_SOCKET} ${OBSERVER1_USER}@${OBSERVER1_HOST} \
            "cd ${OBSERVER1_DIR} && tail -n 20 data/webserver_\$(date +%Y-%m-%d).log 2>&1" || echo "  (log not found / unreadable)"
        echo "--- end diagnostics ---"
        echo "Opening the browser anyway, but it will likely fail to load."
    fi
fi

echo "Clearing stale session data..."
ssh -o BatchMode=yes -S ${SSH_SOCKET} ${OBSERVER1_USER}@${OBSERVER1_HOST} \
    "pkill -9 -f tcs_daemon 2>/dev/null; sleep 1; rm -f ${OBSERVER1_DIR}/data/daemon.pid ${OBSERVER1_DIR}/data/heartbeat; echo '{\"_status\":\"disconnected\",\"_updated\":\"\",\"_raws\":{}}' > ${OBSERVER1_DIR}/data/telemetry.json" 2>/dev/null

echo "Opening browser..."
firefox http://127.0.0.1:${LOCAL_PORT} 2> >(grep -Ev "VIDEO_OVERLAY|safebrowsing\.googleapis\.com|Channel closing: too late" >&2)