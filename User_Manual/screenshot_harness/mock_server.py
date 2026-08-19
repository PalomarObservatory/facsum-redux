#!/usr/bin/env python3
"""
mock_server.py — run the FACSUM UI locally with a simulated TCS behind it.

Purpose: capture documentation screenshots without Observer1, the TCS, or PHP.
It serves the real index.php / assets/app.js / assets/style.css unmodified and
emulates every endpoint app.js talks to:

    api.php   connect · disconnect · daemon_status · telemetry ·
              coords · local_list · local_get · local_save
    allsky.php        (serves data/allsky_cache.jpg)
    simbad_proxy.php  (small offline catalog)

The telemetry is synthetic but self-consistent: LST, hour angle and airmass are
computed for Palomar from a simulated clock that is pinned to the middle of an
observing night, so the sky display and airmass plot look like a real session.
The same simulated clock is injected into the page (a Date shim in <head>), so
the browser and the fake TCS agree on the time.

Usage:
    python3 mock_server.py                 # http://127.0.0.1:8765
    python3 mock_server.py --port 9000
    python3 mock_server.py --no-open       # don't launch a browser

Query parameters on the page URL:
    ?zoom=1.0     set the interface zoom before app.js starts (default: leave as-is)
    ?real         use the real clock instead of the simulated night

Nothing here is used by FACSUM in production; it exists only to produce the
figures in the user manual.
"""

import argparse
import base64
import json
import math
import os
import re
import sys
import time
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))     # FACSUM_Observer1/
TARGET_DIR = os.path.join(HERE, 'targets')
ASSET_DIR = os.path.abspath(os.path.join(HERE, '..', 'manual_assets'))

LAT = 33.356111          # Palomar Mountain
LON = -116.8650

# Files the /_capture endpoint is allowed to overwrite.
CAPTURE_WHITELIST = {
    'main_connected.png', 'panel_targets.png', 'panel_sky.png',
    'panel_telemetry.png', 'tab_edit.png', 'airmass_plot.png',
    'markers_dropdown.png', 'modal_browser_crop.png',
    'telemetry_header_connected.png', 'telemetry_header_disconnected.png',
}


# ── Astronomy helpers (mirrors the maths in app.js / tcs_daemon.py) ───────────
def jd_of(dt):
    return dt.replace(tzinfo=timezone.utc).timestamp() / 86400.0 + 2440587.5


def gmst_hours(jd):
    jd0 = math.floor(jd - 0.5) + 0.5
    gm0 = (6.697375 + 0.0657098242 * (jd0 - 2451545.0)) % 24
    ut = (jd - jd0) * 24
    return (gm0 + 1.00274 * ut) % 24


def lst_hours(jd):
    return (gmst_hours(jd) + LON / 15.0) % 24


def solar_noon(jd):
    n = math.floor(jd - 2451545.0 + 0.0008)
    j_star = n - LON / 360.0
    m_deg = (357.5291 + 0.98560028 * j_star) % 360
    m = math.radians(m_deg)
    c = 1.9148 * math.sin(m) + 0.0200 * math.sin(2 * m) + 0.0003 * math.sin(3 * m)
    lam = math.radians((m_deg + c + 180 + 102.9372) % 360)
    j_transit = 2451545.0 + j_star + 0.0053 * math.sin(m) - 0.0069 * math.sin(2 * lam)
    sin_dec = math.sin(lam) * math.sin(math.radians(23.4397))
    return j_transit, sin_dec, math.cos(math.asin(sin_dec))


def night_bounds(jd):
    """(sunset_jd, sunrise_jd) for the night that starts on jd's date."""
    j_transit, sin_dec, cos_dec = solar_noon(jd)
    cos_omega = ((math.sin(math.radians(-0.833)) - math.sin(math.radians(LAT)) * sin_dec)
                 / (math.cos(math.radians(LAT)) * cos_dec))
    cos_omega = max(-1.0, min(1.0, cos_omega))
    omega = math.acos(cos_omega) / (2 * math.pi)
    sunset = j_transit + omega
    _, sd2, cd2 = solar_noon(jd + 1)
    co2 = ((math.sin(math.radians(-0.833)) - math.sin(math.radians(LAT)) * sd2)
           / (math.cos(math.radians(LAT)) * cd2))
    om2 = math.acos(max(-1.0, min(1.0, co2))) / (2 * math.pi)
    sunrise = solar_noon(jd + 1)[0] - om2
    return sunset, sunrise


def alt_az(ha_h, dec_deg):
    h = math.radians(ha_h * 15)
    d = math.radians(dec_deg)
    lat = math.radians(LAT)
    sin_alt = math.sin(lat) * math.sin(d) + math.cos(lat) * math.cos(d) * math.cos(h)
    alt = math.asin(max(-1.0, min(1.0, sin_alt)))
    cos_az = ((math.sin(d) - math.sin(lat) * sin_alt)
              / (math.cos(lat) * math.cos(alt) + 1e-12))
    az = math.acos(max(-1.0, min(1.0, cos_az)))
    if math.sin(h) > 0:
        az = 2 * math.pi - az
    return math.degrees(alt), math.degrees(az)


def sex_to_hours(text):
    text = text.strip()
    sign = -1 if text.startswith('-') else 1
    parts = text.lstrip('+-').split(':')
    v = float(parts[0]) + float(parts[1]) / 60 + float(parts[2]) / 3600
    return sign * v


def hours_to_sex(h, places=2):
    h %= 24
    hh = int(h)
    mf = (h - hh) * 60
    mm = int(mf)
    ss = (mf - mm) * 60
    return f'{hh:02d}:{mm:02d}:{ss:0{places+3}.{places}f}'


def deg_to_sex(d, places=1):
    sign = '+' if d >= 0 else '-'
    d = abs(d)
    dd = int(d)
    mf = (d - dd) * 60
    mm = int(mf)
    ss = (mf - mm) * 60
    return f'{sign}{dd:02d}:{mm:02d}:{ss:0{places+3}.{places}f}'


# ── Simulated observatory state ──────────────────────────────────────────────
class Sim:
    def __init__(self, use_real_clock=False):
        self.offset = 0.0                    # seconds added to the real clock
        self.seq = 0
        self.daemon_running = False
        self.pointing = None                 # (ra_hours, dec_deg, name)
        if not use_real_clock:
            self.offset = self._offset_to_mid_night()

    @staticmethod
    def _offset_to_mid_night():
        """Shift the clock to 40 % through the nearest observing night."""
        now = datetime.now(timezone.utc)
        jd_now = jd_of(now)
        sunset, sunrise = night_bounds(jd_now)
        if jd_now < sunset:                  # before tonight's sunset → use last night
            sunset, sunrise = night_bounds(jd_now - 1)
        target = sunset + 0.40 * (sunrise - sunset)
        return (target - jd_now) * 86400.0

    def now(self):
        return datetime.now(timezone.utc) + timedelta(seconds=self.offset)

    def sim_epoch_ms(self):
        return int((time.time() + self.offset) * 1000)

    def telemetry(self):
        self.seq += 1
        now = self.now()
        jd = jd_of(now)
        lst = lst_hours(jd)

        if self.pointing is None:
            self.pointing = self._default_pointing(lst)
        ra_h, dec_d, name = self.pointing

        ha = lst - ra_h
        while ha > 12:
            ha -= 24
        while ha < -12:
            ha += 24
        alt, _az = alt_az(ha, dec_d)
        airmass = 1 / math.sin(math.radians(alt)) if alt > 3 else None

        ha_str = ('W' if ha >= 0 else 'E') + hours_to_sex(abs(ha), 0)[:8]
        return {
            'target':   name,
            'ra':       hours_to_sex(ra_h, 2),
            'dec':      deg_to_sex(dec_d, 1),
            'ha':       ha_str,
            'airmass':  f'{airmass:.3f}' if airmass else '—',
            'lst':      hours_to_sex(lst, 2),
            'utc':      hours_to_sex((jd - (math.floor(jd - 0.5) + 0.5)) * 24, 2),
            'ra_off':   '2.40',
            'dec_off':  '-1.10',
            'ra_rate':  '0.00',
            'dec_rate': '0.00',
            'focus':    '36.42',
            'cassring': '89.31',
            'tel_az':   f'{_az:.2f}',
            'tel_el':   f'{alt:.2f}',
            '_seq':     self.seq,
            '_status':  'connected',
            '_updated': now.strftime('%H:%M:%S UTC'),
            '_raws':    {},
        }

    @staticmethod
    def _default_pointing(lst):
        """Point the telescope at something high in the sky right now."""
        best, best_alt = None, -90
        for name, ra, dec in DEFAULT_POINTINGS:
            ha = lst - ra
            while ha > 12:
                ha -= 24
            while ha < -12:
                ha += 24
            alt, _ = alt_az(ha, dec)
            if alt > best_alt:
                best, best_alt = (ra, dec, name), alt
        return best


DEFAULT_POINTINGS = [
    ('M 13',      16.694778, 36.4600),
    ('M 57',      18.893083, 33.0292),
    ('NGC 6543',  17.975944, 66.6331),
    ('M 15',      21.499528, 12.1670),
    ('M 27',      19.993417, 22.7211),
]

SIMBAD_CATALOG = {
    'm13':       (250.421700, 36.459900, -3.18, -2.56),
    'm57':       (283.396200, 33.029100, 2.78, -1.68),
    'm27':       (299.901600, 22.721100, -2.10, -6.60),
    'ngc 6543':  (269.639100, 66.633100, -1.10, 0.30),
    'vega':      (279.234735, 38.783689, 200.94, 286.23),
    'hz her':    (254.457500, 35.342200, -1.60, -0.60),
}


# ── Injected clock shim ──────────────────────────────────────────────────────
CLOCK_SHIM = """<script>
/* screenshot harness — simulated observatory clock (not part of FACSUM) */
(function () {
  var SIM_MS = %SIM_MS%;
  if (SIM_MS > 0) {
    var Real = Date;
    var off  = SIM_MS - Real.now();
    var Fake = class extends Real {
      constructor() {
        if (arguments.length === 0) { super(Real.now() + off); }
        else { super(...arguments); }
      }
      static now()   { return Real.now() + off; }
      static parse() { return Real.parse.apply(Real, arguments); }
      static UTC()   { return Real.UTC.apply(Real, arguments); }
    };
    window.Date = Fake;
  }
  var zoom = new URLSearchParams(location.search).get('zoom');
  if (zoom) { localStorage.setItem('facsum_zoom', zoom); }
})();
</script>
"""


# ── HTTP handler ─────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = 'FACSUM-screenshot-harness'
    sim = None                                   # set in main()

    # quieter log
    def log_message(self, fmt, *args):
        if '--verbose' in sys.argv:
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    # ── helpers ──
    def _send(self, code, body, ctype='application/json', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _static(self, rel):
        path = os.path.normpath(os.path.join(APP_ROOT, rel.lstrip('/')))
        if not path.startswith(APP_ROOT) or not os.path.isfile(path):
            self._send(404, {'error': 'not found'})
            return
        ext = os.path.splitext(path)[1].lower()
        ctype = {'.js': 'application/javascript', '.css': 'text/css',
                 '.png': 'image/png', '.jpg': 'image/jpeg',
                 '.json': 'application/json'}.get(ext, 'text/plain')
        with open(path, 'rb') as fh:
            self._send(200, fh.read(), ctype)

    def _index(self, query):
        with open(os.path.join(APP_ROOT, 'index.php'), encoding='utf-8') as fh:
            html = fh.read()
        html = re.sub(r'^<\?php.*?\?>\s*', '', html, flags=re.S)   # drop the require
        sim_ms = 0 if 'real' in query else self.sim.sim_epoch_ms()
        shim = CLOCK_SHIM.replace('%SIM_MS%', str(sim_ms))
        html = html.replace('<head>', '<head>\n' + shim, 1)
        self._send(200, html, 'text/html; charset=utf-8')

    def _allsky(self):
        for candidate in (os.path.join(APP_ROOT, 'data', 'allsky_cache.jpg'),
                          os.path.join(HERE, 'allsky_sample.jpg')):
            if os.path.isfile(candidate):
                with open(candidate, 'rb') as fh:
                    self._send(200, fh.read(), 'image/jpeg')
                return
        self._send(502, b'', 'image/jpeg')

    def _simbad(self, query):
        name = (query.get('name', [''])[0] or '').strip().lower()
        hit = SIMBAD_CATALOG.get(name)
        if not hit:
            self._send(404, {'friendly': 'Target not found',
                             'error': 'No coordinates in Sesame response',
                             'raw': 'harness catalog has no entry for %r' % name})
            return
        ra, dec, pmra, pmdec = hit
        self._send(200, {'ra_deg': ra, 'dec_deg': dec, 'pmra': pmra, 'pmdec': pmdec})

    # ── target directory ──
    def _resolve(self, path):
        root = os.path.realpath(TARGET_DIR)
        cand = os.path.realpath(path or root)
        # Accept the production path as an alias for the harness directory
        if path.startswith('/observer/observer/targets'):
            tail = path[len('/observer/observer/targets'):].lstrip('/')
            cand = os.path.realpath(os.path.join(root, tail))
        if cand != root and not cand.startswith(root + os.sep):
            return None
        return cand

    def _display(self, real_path):
        root = os.path.realpath(TARGET_DIR)
        rel = os.path.relpath(real_path, root)
        return '/observer/observer/targets' + ('' if rel == '.' else '/' + rel)

    def _local_list(self, path):
        target = self._resolve(path) or os.path.realpath(TARGET_DIR)
        if not os.path.isdir(target):
            target = os.path.realpath(TARGET_DIR)
        entries = []
        for name in sorted(os.listdir(target)):
            if name.startswith('.'):
                continue
            full = os.path.join(target, name)
            is_dir = os.path.isdir(full)
            entries.append({
                'name': name,
                'is_dir': is_dir,
                'size': 0 if is_dir else os.path.getsize(full),
                'mtime': datetime.fromtimestamp(os.path.getmtime(full)).strftime('%Y-%m-%d %H:%M'),
            })
        entries.sort(key=lambda e: (not e['is_dir'], e['name'].lower()))
        self._send(200, {'ok': True, 'path': self._display(target), 'entries': entries})

    def _local_get(self, path):
        target = self._resolve(path)
        if not target or not os.path.isfile(target):
            self._send(200, {'ok': False, 'error': 'File not found or not accessible'})
            return
        with open(target, encoding='utf-8') as fh:
            self._send(200, {'ok': True, 'content': fh.read()})

    def _local_save(self, path, content):
        target = self._resolve(path)
        if not target:
            self._send(200, {'ok': False, 'error': 'Path not allowed'})
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w', encoding='utf-8') as fh:
            fh.write(content)
        self._send(200, {'ok': True})

    def _coords(self, command):
        m = re.match(r"COORDS\s+([\d.]+)\s+([-+]?[\d.]+)\s+\S+\s+\S+\s+\S+\s*(?:\d\s+)?'(.*)'",
                     command or '')
        if m:
            self.sim.pointing = (float(m.group(1)), float(m.group(2)), m.group(3))
            print(f'  [sim] telescope now holding {m.group(3)}')
        self._send(200, {'ok': True, 'response': 'OK'})

    def _capture(self, body):
        """Accept a base64 PNG from the page and write it into manual_assets/."""
        try:
            payload = json.loads(body or '{}')
            name = os.path.basename(payload.get('name', ''))
            data = payload.get('png', '')
            if name not in CAPTURE_WHITELIST:
                self._send(200, {'ok': False, 'error': f'name not allowed: {name}'})
                return
            raw = base64.b64decode(data.split(',', 1)[-1])
            os.makedirs(ASSET_DIR, exist_ok=True)
            out = os.path.join(ASSET_DIR, name)
            with open(out, 'wb') as fh:
                fh.write(raw)
            print(f'  [capture] wrote {out} ({len(raw) // 1024} KB)')
            self._send(200, {'ok': True, 'path': out, 'bytes': len(raw)})
        except Exception as exc:                       # noqa: BLE001
            self._send(200, {'ok': False, 'error': str(exc)})

    # ── routing ──
    def _api(self, params):
        action = params.get('action', '')
        if action == 'connect':
            self.sim.daemon_running = True
            self._send(200, {'running': True, 'pid': 4242})
        elif action == 'disconnect':
            self.sim.daemon_running = False
            self._send(200, {'running': False, 'pid': 0})
        elif action == 'daemon_status':
            self._send(200, {'running': self.sim.daemon_running, 'pid': 4242})
        elif action == 'telemetry':
            if not self.sim.daemon_running:
                self._send(200, {'_status': 'disconnected'})
            else:
                self._send(200, self.sim.telemetry())
        elif action == 'coords':
            self._coords(params.get('command', ''))
        elif action == 'local_list':
            self._local_list(params.get('path', ''))
        elif action == 'local_get':
            self._local_get(params.get('path', ''))
        elif action == 'local_save':
            self._local_save(params.get('path', ''), params.get('content', ''))
        else:
            self._send(200, {'error': 'Unknown action'})

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        route = unquote(url.path)
        if route in ('/', '/index.php'):
            self._index(query)
        elif route == '/api.php':
            self._api({k: v[0] for k, v in query.items()})
        elif route == '/allsky.php':
            self._allsky()
        elif route == '/simbad_proxy.php':
            self._simbad(query)
        else:
            self._static(route)

    def do_POST(self):
        url = urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length).decode('utf-8', 'replace') if length else ''
        route = unquote(url.path)
        if route == '/api.php':
            try:
                params = json.loads(body) if body else {}
            except json.JSONDecodeError:
                params = {}
            self._api(params)
        elif route == '/_capture':
            self._capture(body)
        else:
            self._send(404, {'error': 'not found'})


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--real-clock', action='store_true',
                    help='use the real time instead of a simulated night')
    ap.add_argument('--no-open', action='store_true', help='do not open a browser')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    if not os.path.isfile(os.path.join(APP_ROOT, 'index.php')):
        sys.exit(f'Cannot find index.php under {APP_ROOT}')

    Handler.sim = Sim(use_real_clock=args.real_clock)
    url = f'http://127.0.0.1:{args.port}/'

    sim_now = Handler.sim.now()
    print('FACSUM screenshot harness')
    print(f'  serving   {APP_ROOT}')
    print(f'  targets   {TARGET_DIR}')
    print(f'  captures  {ASSET_DIR}')
    print(f'  sim clock {sim_now:%Y-%m-%d %H:%M:%S} UT '
          f'(LST {hours_to_sex(lst_hours(jd_of(sim_now)), 0)[:8]})')
    print(f'  open      {url}')
    print('  Ctrl-C to stop.\n')

    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:                              # noqa: BLE001
            pass

    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
