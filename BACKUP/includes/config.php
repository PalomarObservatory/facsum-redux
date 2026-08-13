<?php
// ── TCS ───────────────────────────────────────────────────────────────────────
define('TCS_HOST', '198.202.125.194');
define('TCS_PORT', 49200);

// ── Local target directory ────────────────────────────────────────────────────
define('LOCAL_TARGET_DIR', '/observer/observer/targets');

// ── SFTP (legacy — credentials modal label only; local_list/local_get/local_save
//    are what's actually used on Observer1, see api.php) ─────────────────────────
define('SFTP_HOST',       'observer1.palomar.caltech.edu');
define('SFTP_START_PATH', LOCAL_TARGET_DIR);

// ── Paths ─────────────────────────────────────────────────────────────────────
define('BASE_DIR',         dirname(__DIR__));
define('TELEMETRY_FILE',   BASE_DIR . '/data/telemetry.json');
define('PID_FILE',         BASE_DIR . '/data/daemon.pid');
define('SFTP_SCRIPT',      BASE_DIR . '/sftp_browse.py');
define('PYTHON_BIN',       '/usr/bin/python3');
define('HEARTBEAT_FILE',   BASE_DIR . '/data/heartbeat');
define('HEARTBEAT_TTL',    120);  // seconds before daemon idles
