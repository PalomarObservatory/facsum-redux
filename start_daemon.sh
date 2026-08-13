#!/usr/bin/env bash
# start_daemon.sh — start the FACSUM TCS daemon
# Usage:  ./start_daemon.sh [stop|restart|status]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/data/daemon.pid"
LOG_DIR="$SCRIPT_DIR/data"
PYTHON="${PYTHON:-python3}"

mkdir -p "$SCRIPT_DIR/data"

stop_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping daemon (PID $pid)…"
            kill "$pid"
            sleep 1
            kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
            echo "Stopped."
        else
            echo "Daemon not running (stale PID file)."
        fi
        rm -f "$PID_FILE"
    else
        echo "Daemon not running."
    fi
}

status_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Daemon running (PID $pid)."
        else
            echo "Daemon not running (stale PID file)."
        fi
    else
        echo "Daemon not running."
    fi
}

case "${1:-start}" in
    stop)
        stop_daemon
        ;;
    restart)
        stop_daemon
        sleep 1
        exec "$0" start
        ;;
    status)
        status_daemon
        ;;
    start)
        if [[ -f "$PID_FILE" ]]; then
            pid=$(cat "$PID_FILE")
            if kill -0 "$pid" 2>/dev/null; then
                echo "Daemon already running (PID $pid)."
                exit 0
            fi
            rm -f "$PID_FILE"
        fi
        echo "Starting TCS daemon…"
        # Dated + pruned like tcs_daemon.py's own operational log -- this
        # file only ever catches a raw traceback if it crashes before its
        # own logger is ready, so it should stay small, but gets the same
        # 14-day retention for consistency.
        find "$LOG_DIR" -maxdepth 1 -name 'daemon_launch_*.log' -mtime +14 -delete 2>/dev/null
        LOG_FILE="$LOG_DIR/daemon_launch_$(date +%Y-%m-%d).log"
        nohup "$PYTHON" "$SCRIPT_DIR/tcs_daemon.py" >> "$LOG_FILE" 2>&1 &
        sleep 0.5
        if [[ -f "$PID_FILE" ]]; then
            echo "Daemon started (PID $(cat "$PID_FILE")). Log: $LOG_FILE"
        else
            echo "Daemon may have failed to start. Check: $LOG_FILE"
        fi
        ;;
    *)
        echo "Usage: $0 [start|stop|restart|status]"
        exit 1
        ;;
esac
