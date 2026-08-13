<?php
// ── TCS ───────────────────────────────────────────────────────────────────────
define('TCS_HOST', '198.202.125.194');
define('TCS_PORT', 49200);

// ── Local target directory ────────────────────────────────────────────────────
// The app runs directly on Observer1 now, so target-list access goes through
// local_list/local_get/local_save (plain filesystem calls in api.php) rather
// than any remote-login path — there is no SFTP/SSH-credential step.
define('LOCAL_TARGET_DIR', '/observer/observer/targets');

// ── Paths ─────────────────────────────────────────────────────────────────────
define('BASE_DIR',         dirname(__DIR__));
define('TELEMETRY_FILE',   BASE_DIR . '/data/telemetry.json');
define('PID_FILE',         BASE_DIR . '/data/daemon.pid');
define('PYTHON_BIN',       '/usr/bin/python3');
define('HEARTBEAT_FILE',   BASE_DIR . '/data/heartbeat');
define('HEARTBEAT_TTL',    120);  // seconds before daemon idles
