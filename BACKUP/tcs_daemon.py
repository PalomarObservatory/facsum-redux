#!/usr/bin/env python3
"""
FACSUM TCS Daemon
Polls the P200 TCS continuously and writes parsed telemetry to data/telemetry.json.
Reconnects automatically on connection loss.

Usage:
  python3 tcs_daemon.py          # foreground
  python3 tcs_daemon.py &        # background
  ./start_daemon.sh              # managed start with logging
"""

import socket, time, re, json, os, signal, sys, datetime, traceback, math, glob

# Palomar Observatory latitude (used to convert Az/El → apparent Dec)
_PALOMAR_LAT_RAD = math.radians(33.356111)

# ── Config ────────────────────────────────────────────────────────────────────
TCS_HOST     = '198.202.125.194'
TCS_PORT     = 49200
CYCLE_S        = 0.25
RECV_TIMEOUT   = 0.8
RECONNECT_S    = 2
HEARTBEAT_TTL  = 120  # seconds — must match config.php HEARTBEAT_TTL

BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE     = os.path.join(BASE_DIR, 'data', 'telemetry.json')
PID_FILE        = os.path.join(BASE_DIR, 'data', 'daemon.pid')
HEARTBEAT_FILE  = os.path.join(BASE_DIR, 'data', 'heartbeat')


# ── Parsers ───────────────────────────────────────────────────────────────────

def _kv(text, key):
    m = re.search(rf'{re.escape(key)}\s*=\s*(.+)', text, re.I)
    return m.group(1).strip() if m else ''


def parse_reqpos(raw):
    d = {}
    m = re.search(r'UTC\s*=\s*([\d]+\s+[\d:\.]+)', raw, re.I)
    if m:
        d['utc'] = m.group(1).strip().split()[-1]
    m = re.search(r'LST\s*=\s*([\d:\.]+)', raw, re.I)
    if m:
        d['lst'] = m.group(1).strip()
    m = re.search(r'\bRA\s*=\s*([\d:\.]+)', raw, re.I)
    if m:
        d['ra'] = m.group(1).strip()
    m = re.search(r'\bDEC\s*=\s*([+-]?[\d:\.]+)', raw, re.I)
    if m:
        d['dec'] = m.group(1).strip()
    m = re.search(r'\bHA\s*=\s*([EW]?[+-]?[\d:\.]+)', raw, re.I)
    if m:
        d['ha'] = m.group(1).strip()
    m = re.search(r'air\s*mass\s*=\s*([\d\.]+)', raw, re.I)
    if m:
        d['airmass'] = m.group(1).strip()
    m = re.search(r'Equinox\s*=\s*(\S+)', raw, re.I)
    if m:
        d['equinox'] = m.group(1).strip()
    return d


def parse_reqstat(raw):
    d = {}
    m = re.search(r'focus\s*=\s*([+-]?[\d\.]+)\s*mm', raw, re.I)
    if m:
        d['focus'] = m.group(1).strip()
    m = re.search(
        r'^\s*offset\s+RA\s*=\s*([+-]?[\d\.]+)\s*arcsec\s*,\s*DEC\s*=\s*([+-]?[\d\.]+)\s*arcsec',
        raw, re.I | re.MULTILINE)
    if m:
        d['ra_off']  = m.group(1).strip()
        d['dec_off'] = m.group(2).strip()
    else:
        m = re.search(r'^\s*offset\s+RA\s*=\s*([+-]?[\d\.]+)\s*arcsec', raw, re.I | re.MULTILINE)
        if m:
            d['ra_off'] = m.group(1).strip()
        m = re.search(r'^\s*offset\s+DEC\s*=\s*([+-]?[\d\.]+)\s*arcsec', raw, re.I | re.MULTILINE)
        if m:
            d['dec_off'] = m.group(1).strip()
    m = re.search(r'rate\s+RA\s*=\s*([+-]?[\d\.]+)\s*arcsec', raw, re.I)
    if m:
        d['ra_rate'] = m.group(1).strip()
    m = re.search(
        r'rate\s+RA\s*=\s*[+-]?[\d\.]+\s*arcsec/hr\s*,\s*DEC\s*=\s*([+-]?[\d\.]+)',
        raw, re.I)
    if m:
        d['dec_rate'] = m.group(1).strip()
    m = re.search(r'Cass\s+ring\s+angle\s*=\s*([+-]?[\d\.]+)', raw, re.I)
    if m:
        d['cassring'] = m.group(1).strip()
    return d


def parse_weather(raw):
    d = {}
    az = _kv(raw, 'Azimuth')
    if az:
        try:
            d['tel_az'] = f'{float(az):.2f}'
        except ValueError:
            d['tel_az'] = az
    zen = _kv(raw, 'Zenith angle')
    if zen:
        try:
            d['tel_el'] = f'{90.0 - float(zen):.2f}'
        except ValueError:
            d['tel_el'] = zen
    dome = _kv(raw, 'Dome Azimuth')
    if dome:
        d['dome_az'] = dome
    shutter = _kv(raw, 'Dome Shutter')
    if shutter:
        d['dome_shutter'] = shutter
    wind = _kv(raw, 'Windscreen position')
    if wind:
        d['windscr'] = wind
    inst = _kv(raw, 'Instrument')
    if inst:
        d['instrument'] = inst
    return d


def parse_name(raw):
    name = raw.strip()
    return {'target': name} if name else {}


# ── Apparent coordinate computation ──────────────────────────────────────────

def _sex_to_h(s):
    """Sexagesimal string HH:MM:SS.s → decimal hours."""
    try:
        parts = s.strip().split(':')
        return float(parts[0]) + float(parts[1])/60 + float(parts[2])/3600
    except Exception:
        return None

def _ha_to_h(ha_str):
    """Parse HA string (e.g. 'E00:12:34.5' or 'W01:00:00.0') → signed decimal hours.
    West-of-meridian is positive; East-of-meridian is negative."""
    s = ha_str.strip()
    sign = 1
    if s.startswith('E'):   sign = -1; s = s[1:]
    elif s.startswith('W'): sign =  1; s = s[1:]
    elif s.startswith('-'): sign = -1; s = s[1:]
    elif s.startswith('+'): s = s[1:]
    v = _sex_to_h(s)
    return sign * v if v is not None else None

def _h_to_hms(h):
    """Decimal hours → HH:MM:SS.ss string."""
    h = h % 24
    hh = int(h);  m_f = (h - hh) * 60
    mm = int(m_f); ss = (m_f - mm) * 60
    return f'{hh:02d}:{mm:02d}:{ss:05.2f}'

def _deg_to_dms(d):
    """Decimal degrees → ±DD:MM:SS.s string."""
    sign = '+' if d >= 0 else '-'
    d = abs(d);  dd = int(d);  m_f = (d - dd) * 60
    mm = int(m_f);  ss = (m_f - mm) * 60
    return f'{sign}{dd:02d}:{mm:02d}:{ss:04.1f}'

def compute_apparent(fields):
    """Replace J2000 catalog RA/Dec from REQPOS with apparent coordinates
    derived directly from TCS encoder data, matching the TCS console display.

    Apparent RA  = LST - HA          (exact, from TCS encoders)
    Apparent Dec = f(Tel Az, Tel El)  (from ?WEATHER alt/az + Palomar latitude)
    """
    # Apparent RA from LST and HA
    try:
        lst_h = _sex_to_h(fields.get('lst', ''))
        ha_h  = _ha_to_h(fields.get('ha', ''))
        if lst_h is not None and ha_h is not None:
            fields['ra'] = _h_to_hms((lst_h - ha_h) % 24)
    except Exception:
        pass

    # Apparent Dec from telescope azimuth and elevation
    try:
        az_rad = math.radians(float(fields['tel_az']))
        el_rad = math.radians(float(fields['tel_el']))
        sin_dec = (math.sin(_PALOMAR_LAT_RAD) * math.sin(el_rad) +
                   math.cos(_PALOMAR_LAT_RAD) * math.cos(el_rad) * math.cos(az_rad))
        fields['dec'] = _deg_to_dms(math.degrees(math.asin(max(-1.0, min(1.0, sin_dec)))))
    except Exception:
        pass

    return fields


# ── JSON writer ───────────────────────────────────────────────────────────────

_seq = 0

def write_telemetry(fields, raws, status):
    global _seq
    _seq += 1
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    payload = {
        **fields,
        '_seq':     _seq,
        '_status':  status,
        '_updated': datetime.datetime.utcnow().strftime('%H:%M:%S UTC'),
        '_raws':    raws,
    }
    tmp = OUTPUT_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(payload, f)
    os.replace(tmp, OUTPUT_FILE)   # atomic


# ── TCS poller ────────────────────────────────────────────────────────────────

class TCSPoller:
    def __init__(self):
        self._sock    = None
        self._running = True

    def stop(self):
        self._running = False
        self._close()

    def _close(self):
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None

    def _connect(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # TCP keepalive: detects dead connections caused by intermediate
        # NAT/firewall silently dropping the TCP session table entry.
        s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        try:
            # Linux: start probes after 10s idle, every 5s, up to 3 times
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE,  10)
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL,  5)
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT,    3)
        except AttributeError:
            pass  # not all platforms expose fine-grained keepalive knobs
        s.settimeout(RECV_TIMEOUT)
        s.connect((TCS_HOST, TCS_PORT))
        self._sock = s

    def _send_recv(self, cmd):
        if not self._sock:
            return ''
        try:
            self._sock.sendall((cmd + '\n').encode())
            buf = b''
            deadline = time.monotonic() + RECV_TIMEOUT
            while time.monotonic() < deadline:
                try:
                    chunk = self._sock.recv(4096)
                except socket.timeout:
                    break
                if not chunk:
                    log(f'TCS closed connection cleanly during {cmd} (FIN received)')
                    self._close()
                    break
                buf += chunk
                if b'\n' in chunk:
                    self._sock.settimeout(0.08)
                    try:
                        extra = self._sock.recv(4096)
                        if extra:
                            buf += extra
                    except socket.timeout:
                        pass
                    finally:
                        self._sock.settimeout(RECV_TIMEOUT)
                    break
            return buf.decode(errors='replace')
        except Exception as exc:
            log(f'TCS send/recv error ({cmd}): {type(exc).__name__}: {exc}')
            self._close()
            return ''

    def run(self):
        while self._running:
            # ── Wait for browser heartbeat before touching the TCS ────────────
            if not self._heartbeat_alive():
                write_telemetry({}, {}, 'disconnected')
                while self._running and not self._heartbeat_alive():
                    time.sleep(1)
                if not self._running:
                    break
                log('Heartbeat detected — connecting to TCS…')

            # ── Connect ───────────────────────────────────────────────────────
            write_telemetry({}, {}, 'connecting')
            log(f'Connecting to {TCS_HOST}:{TCS_PORT}…')
            try:
                self._connect()
                log('Connected.')
            except Exception as exc:
                write_telemetry({}, {}, f'error: {exc}')
                log(f'Connection failed: {type(exc).__name__}: {exc}')
                time.sleep(RECONNECT_S)
                continue

            # ── Poll loop ─────────────────────────────────────────────────────
            heartbeat_close = False
            while self._running and self._sock:
                # Drop TCS connection if browser tab was closed
                if not self._heartbeat_alive():
                    log('Heartbeat expired — disconnecting from TCS.')
                    self._close()
                    write_telemetry({}, {}, 'disconnected')
                    heartbeat_close = True
                    break

                t0     = time.monotonic()
                fields = {}
                raws   = {}
                for cmd, parser in [
                    ('REQPOS',   parse_reqpos),
                    ('REQSTAT',  parse_reqstat),
                    ('?WEATHER', parse_weather),
                    ('?NAME',    parse_name),
                ]:
                    if not self._running:
                        break
                    raw = self._send_recv(cmd)
                    raws[cmd] = raw.strip()
                    if raw:
                        fields.update(parser(raw))

                compute_apparent(fields)
                status = 'connected' if self._sock else 'disconnected'
                write_telemetry(fields, raws, status)

                elapsed = time.monotonic() - t0
                time.sleep(max(0.0, CYCLE_S - elapsed))

            if self._sock is None and self._running and self._heartbeat_alive():
                if not heartbeat_close:
                    log(f'Lost TCS connection — reconnecting in {RECONNECT_S}s…')
                time.sleep(RECONNECT_S)

        write_telemetry({}, {}, 'stopped')
        log('Stopped.')

    @staticmethod
    def _heartbeat_alive() -> bool:
        # Read mtime rather than file contents — os.stat() is atomic, no write-race.
        try:
            return (time.time() - os.path.getmtime(HEARTBEAT_FILE)) < HEARTBEAT_TTL
        except Exception:
            return False


# ── Logging — daily rotating files ───────────────────────────────────────────

_log_date = None   # YYYY-MM-DD of the currently open log file
_log_fh   = None   # open file handle

def _rotate_log():
    """Open (or roll over to) today's log file; purge files older than 14 days."""
    global _log_date, _log_fh
    today = datetime.datetime.utcnow().strftime('%Y-%m-%d')
    if today == _log_date:
        return
    if _log_fh:
        try:
            _log_fh.close()
        except Exception:
            pass
    log_path = os.path.join(BASE_DIR, 'data', f'daemon_{today}.log')
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    _log_fh   = open(log_path, 'a', buffering=1)  # line-buffered
    _log_date = today
    # Purge logs older than 14 days
    cutoff = time.time() - 14 * 86400
    for old in glob.glob(os.path.join(BASE_DIR, 'data', 'daemon_*.log')):
        try:
            if os.path.getmtime(old) < cutoff:
                os.remove(old)
        except Exception:
            pass

def log(msg):
    _rotate_log()
    ts   = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    line = f'[{ts}] {msg}'
    try:
        _log_fh.write(line + '\n')
        _log_fh.flush()
    except Exception:
        pass


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))

    poller = TCSPoller()

    def handle_sig(sig, _frame):
        log(f'Signal {sig} — stopping…')
        poller.stop()
        try:
            os.remove(PID_FILE)
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sig)
    signal.signal(signal.SIGINT,  handle_sig)

    try:
        poller.run()
    except Exception:
        traceback.print_exc()
    finally:
        try:
            os.remove(PID_FILE)
        except Exception:
            pass
        if _log_fh:
            try:
                _log_fh.close()
            except Exception:
                pass


if __name__ == '__main__':
    main()
