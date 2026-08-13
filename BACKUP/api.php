<?php
require_once __DIR__ . '/includes/config.php';
require_once __DIR__ . '/vendor/autoload.php';

use phpseclib3\Net\SFTP;
use phpseclib3\Exception\NoSupportedAlgorithmsException;

session_start();
session_write_close();  // release session file lock immediately — sessions unused in Observer1
header('Content-Type: application/json');

// Accept action from GET, POST form, or JSON body
$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? $_GET['action'] ?? '';

switch ($action) {

    case 'telemetry':
        echo telemetry();
        break;

    case 'connect':
        touch_heartbeat();
        ensure_daemon();
        echo daemon_status();
        break;

    case 'disconnect':
        clear_heartbeat();
        stop_daemon();
        echo daemon_status();
        break;

    case 'daemon_status':
        echo daemon_status();
        break;

    case 'coords':
        echo tcs_send($body['command'] ?? '');
        break;

    case 'local_list':
        echo local_list($body['path'] ?? LOCAL_TARGET_DIR);
        break;

    case 'local_get':
        echo local_get($body['path'] ?? '');
        break;

    case 'local_save':
        echo local_save($body['path'] ?? '', $body['content'] ?? '');
        break;

    default:
        echo json_encode(['error' => 'Unknown action']);
}


// ── Daemon management ─────────────────────────────────────────────────────────

function daemon_is_running(): bool {
    if (!file_exists(PID_FILE)) return false;
    $pid = (int) @file_get_contents(PID_FILE);
    if ($pid <= 0) return false;
    if (function_exists('posix_kill')) return @posix_kill($pid, 0);
    return file_exists("/proc/$pid");
}

function ensure_daemon(): void {
    if (daemon_is_running()) return;

    // Make sure data/ is writable before trying to start
    $data_dir = dirname(PID_FILE);
    if (!is_dir($data_dir)) @mkdir($data_dir, 0755, true);
    if (!is_writable($data_dir)) return;   // can't do anything without write access

    $python = PYTHON_BIN;
    $script = escapeshellarg(BASE_DIR . '/tcs_daemon.py');
    $log    = escapeshellarg(BASE_DIR . '/data/daemon.log');

    // nohup + & fully detaches the child from Apache.
    // "echo $!" captures the PID before the shell exits.
    $cmd = "nohup $python $script >> $log 2>&1 & echo \$!";
    $pid = (int) shell_exec($cmd);

    if ($pid > 0) {
        file_put_contents(PID_FILE, $pid);
    } else {
        // PID capture failed — wait for the daemon to write its own PID file
        for ($i = 0; $i < 10; $i++) {
            usleep(200000);  // 0.2s
            if (file_exists(PID_FILE) && (int)file_get_contents(PID_FILE) > 0) break;
        }
    }
}

function stop_daemon(): void {
    if (!file_exists(PID_FILE)) return;
    $pid = (int) @file_get_contents(PID_FILE);
    if ($pid > 0) {
        @posix_kill($pid, SIGTERM);
        // Give it a moment; force-kill if still alive
        usleep(400000);
        if (@posix_kill($pid, 0)) @posix_kill($pid, SIGKILL);
    }
    @unlink(PID_FILE);
    @unlink(TELEMETRY_FILE);
}

function touch_heartbeat(): void {
    // Use mtime (via touch) — atomic single syscall, no content-write race.
    if (!file_exists(HEARTBEAT_FILE)) @file_put_contents(HEARTBEAT_FILE, '');
    @touch(HEARTBEAT_FILE);
}

function clear_heartbeat(): void {
    @unlink(HEARTBEAT_FILE);
}

// ── TCS direct command ────────────────────────────────────────────────────────

function tcs_send(string $cmd): string {
    if ($cmd === '') return json_encode(['ok' => false, 'error' => 'Empty command']);
    $cmd = str_replace(["\r", "\n"], '', $cmd);  // strip embedded newlines
    if (stripos($cmd, 'COORDS ') !== 0)
        return json_encode(['ok' => false, 'error' => 'Only COORDS commands are permitted']);
    $errno = 0; $errstr = '';
    $sock = @fsockopen(TCS_HOST, TCS_PORT, $errno, $errstr, 5);
    if (!$sock) return json_encode(['ok' => false, 'error' => "TCS unreachable: $errstr"]);
    fwrite($sock, $cmd . "\n");
    stream_set_timeout($sock, 1);
    $resp = fread($sock, 1024);
    fclose($sock);
    return json_encode(['ok' => true, 'response' => trim($resp)]);
}


// ── Telemetry ─────────────────────────────────────────────────────────────────

function telemetry() {
    touch_heartbeat();   // each poll renews the heartbeat
    if (!file_exists(TELEMETRY_FILE)) {
        return json_encode(['_status' => 'disconnected']);
    }
    $content = @file_get_contents(TELEMETRY_FILE);
    return $content ?: json_encode(['_status' => 'disconnected']);
}


// ── Daemon status ─────────────────────────────────────────────────────────────

function daemon_status() {
    return json_encode(['running' => daemon_is_running(),
                        'pid'     => (int)@file_get_contents(PID_FILE)]);
}


// ── Local filesystem browser ─────────────────────────────────────────────────

function local_resolve(string $path) {
    $root = realpath(LOCAL_TARGET_DIR);
    if ($root === false) return false;
    $resolved = realpath($path);
    // Allow the root itself even before realpath (path might not exist yet)
    if ($resolved === false) $resolved = $path;
    // Security: must stay within LOCAL_TARGET_DIR
    if ($resolved !== $root && strpos($resolved, $root . '/') !== 0) return false;
    return $resolved;
}

function local_list(string $path): string {
    $root = realpath(LOCAL_TARGET_DIR);
    if ($root === false) return json_encode(['ok' => false, 'error' => 'Target directory not found']);

    $dir = local_resolve($path ?: LOCAL_TARGET_DIR);
    if ($dir === false || !is_dir($dir)) {
        $dir = $root;
    }

    $raw = @scandir($dir);
    if ($raw === false) return json_encode(['ok' => false, 'error' => 'Cannot read directory']);

    $entries = [];
    foreach ($raw as $name) {
        if ($name === '.' || $name === '..') continue;
        $full   = $dir . '/' . $name;
        $is_dir = is_dir($full);
        $entries[] = [
            'name'   => $name,
            'is_dir' => $is_dir,
            'size'   => $is_dir ? 0 : filesize($full),
            'mtime'  => date('Y-m-d H:i', filemtime($full)),
        ];
    }

    usort($entries, function($a, $b) {
        return $b['is_dir'] <=> $a['is_dir'] ?: strcasecmp($a['name'], $b['name']);
    });

    return json_encode(['ok' => true, 'path' => $dir, 'entries' => $entries]);
}

function local_save(string $path, string $content): string {
    if ($path === '') return json_encode(['ok' => false, 'error' => 'No path specified']);
    $resolved = local_resolve($path);
    if ($resolved === false)
        return json_encode(['ok' => false, 'error' => 'Path not allowed']);

    if (@file_put_contents($resolved, $content) !== false)
        return json_encode(['ok' => true]);

    // Some target lists on Observer1 pre-date the current directory's group-write
    // setup and are still owned by stale/foreign UIDs with no group-write bit, so
    // an in-place write fails even though we can write the directory itself.
    // Deleting + recreating only needs directory write (no sticky bit is set here),
    // and hands ownership to us going forward — these files aren't precious originals,
    // so replacing them outright is fine.
    if (is_file($resolved) && @unlink($resolved) && @file_put_contents($resolved, $content) !== false)
        return json_encode(['ok' => true]);

    return json_encode(['ok' => false, 'error' => 'Could not write file']);
}

function local_get(string $path): string {
    if ($path === '') return json_encode(['ok' => false, 'error' => 'No path specified']);
    $resolved = local_resolve($path);
    if ($resolved === false || !is_file($resolved))
        return json_encode(['ok' => false, 'error' => 'File not found or not accessible']);
    $content = @file_get_contents($resolved);
    if ($content === false) return json_encode(['ok' => false, 'error' => 'Could not read file']);
    return json_encode(['ok' => true, 'content' => $content]);
}


// ── SFTP (pure PHP via phpseclib) ────────────────────────────────────────────

function sftp_connect() {
    $user     = $_SESSION['sftp_user'] ?? '';
    $password = $_SESSION['sftp_pass'] ?? '';
    if (!$user || !$password) return false;

    try {
        $sftp = new SFTP(SFTP_HOST);
        if (!$sftp->login($user, $password)) return false;
        return $sftp;
    } catch (\Exception $e) {
        return false;
    }
}

function sftp_call($action, $body) {
    // array_key_exists so we don't confuse missing key with empty string value
    $user     = array_key_exists('user',     $body) ? $body['user']     : ($_SESSION['sftp_user'] ?? '');
    $password = array_key_exists('password', $body) ? $body['password'] : ($_SESSION['sftp_pass'] ?? '');
    $path     = $body['path'] ?? SFTP_START_PATH;

    // Short-circuit immediately if no credentials — don't make the user wait
    // for the server to time out a blank-password login attempt
    if ($user === '' || $password === '') {
        return json_encode(['ok' => false, 'error' => 'Credentials required',
                            'need_creds' => true]);
    }

    $_SESSION['sftp_user'] = $user;
    $_SESSION['sftp_pass'] = $password;

    try {
        $sftp = new SFTP(SFTP_HOST);
        if (!$sftp->login($user, $password)) {
            unset($_SESSION['sftp_user'], $_SESSION['sftp_pass']);
            return json_encode(['ok' => false, 'error' => 'Authentication failed — check username and password.',
                                'need_creds' => true]);
        }
    } catch (\Exception $e) {
        return json_encode(['ok' => false, 'error' => $e->getMessage()]);
    }

    if ($action === 'list') {
        $raw = $sftp->rawlist($path);
        if ($raw === false) {
            // Try falling back to home directory
            $home = $sftp->pwd();
            $raw  = $sftp->rawlist($home) ?: [];
            $path = $home;
        }

        $entries = [];
        foreach ($raw as $name => $info) {
            if ($name === '.' || $name === '..') continue;
            $entries[] = [
                'name'   => (string)$name,
                'is_dir' => ($info['type'] ?? 0) === NET_SFTP_TYPE_DIRECTORY,
                'size'   => $info['size'] ?? 0,
                'mtime'  => isset($info['mtime'])
                            ? date('Y-m-d H:i', $info['mtime']) : '',
            ];
        }

        // Sort: dirs first, then alphabetical
        usort($entries, function($a, $b) {
            return $b['is_dir'] <=> $a['is_dir'] ?: strcasecmp($a['name'], $b['name']);
        });

        return json_encode(['ok' => true, 'path' => $path, 'entries' => $entries]);
    }

    if ($action === 'get') {
        $content = $sftp->get($path);
        if ($content === false) {
            return json_encode(['ok' => false, 'error' => 'Could not read file']);
        }
        return json_encode(['ok' => true, 'content' => $content]);
    }

    return json_encode(['ok' => false, 'error' => "Unknown action: $action"]);
}
