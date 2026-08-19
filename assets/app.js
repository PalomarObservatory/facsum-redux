'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(id)        { return document.getElementById(id); }
function set(id, text) { const e = el(id); if (e) e.textContent = text; }

function api(params, signal) {
  // Always POST so credentials and data stay in the request body, never the URL.
  return fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: signal || null,
  }).then(r => r.json());
}

function truncName(s, max = 12) {
  if (!s || s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function fmtSex(s) {
  if (!s || s === '—') return s;
  const sign = /^[+-]/.test(s) ? s[0] : '';
  const bare = sign ? s.slice(1) : s;
  const parts = bare.split(':');
  if (parts.length < 2) return s;
  parts[0] = parts[0].padStart(2, '0');
  parts[1] = parts[1].padStart(2, '0');
  if (parts[2] !== undefined) parts[2] = parts[2].padStart(2, '0');
  return sign + parts.join(':');
}

function fmtEquinox(eq) {
  if (!eq) return '—';
  const s = String(eq).trim();
  if (/^[JjBb]/i.test(s)) return s.toUpperCase(); // already prefixed: J2000 → J2000
  const yr = parseFloat(s);
  if (isNaN(yr)) return s;
  const prefix = yr >= 1984 ? 'J' : 'B'; // Besselian epoch ended ~1984
  return prefix + (s.includes('.') ? s : s + '.0');
}

function humanSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}


// ── Connect / Disconnect ──────────────────────────────────────────────────────

let _connected          = false;
let _pollTimer          = null;
let _renderTimer        = null;
let _latestTelemetry    = null;
let _lastSeq            = -1;
let _manualDisconnect   = false;  // true only when user explicitly disconnects
let _reconnecting       = false;
let _reconnectAttempts  = 0;
let _reconnectTimer     = null;
let _consecutiveFailures = 0;
const MAX_RECONNECT     = 5;
const RECONNECT_DELAY   = 5000;
const FAILURES_BEFORE_RECONNECT = 50;  // 5s at 100ms poll — gives daemon time to recover TCS

// Grace period before surfacing a TCS-level disconnect to the operator.
// The daemon reconnects in ~5s; keep the display frozen for up to 12s first.
let _tcsDownSince = null;
const TCS_GRACE_MS = 12000;

// Equinox of the last target successfully sent to the TCS via COORDS.
// Cannot be read back from the TCS — tracked client-side only.
let _sentEquinox = null;

// ── All-sky camera ────────────────────────────────────────────────────────────
let _allSkyImg   = null;   // latest Image object from proxy
let _allSkyTimer = null;
let _remapCanvas = null;   // offscreen canvas for fisheye-corrected image
let _remapKey    = '';     // cache key: imageSrc|rotation

function fetchAllSky() {
  const img = new Image();
  img.onload  = () => { _allSkyImg = img; drawSky(); };
  img.onerror = () => {};            // camera unreachable — keep last image
  img.src = 'allsky.php?t=' + Date.now();  // cache-bust each fetch
}

function startAllSky() {
  fetchAllSky();
  _allSkyTimer = setInterval(fetchAllSky, 30000);  // 30 s — matches original FACSUM
}
// ─────────────────────────────────────────────────────────────────────────────
// ── Instant tooltip (replaces native title delay) ────────────────────────────
let _tipEl = null;
function _tip() {
  if (!_tipEl) {
    _tipEl = document.createElement('div');
    _tipEl.id = 'instant-tip';
    document.body.appendChild(_tipEl);
  }
  return _tipEl;
}
function attachTooltip(el, text) {
  el.addEventListener('mouseenter', () => { _tip().textContent = text; _tip().classList.add('visible'); });
  el.addEventListener('mousemove',  e  => { _tip().style.left = (e.clientX + 14) + 'px'; _tip().style.top = (e.clientY + 14) + 'px'; });
  el.addEventListener('mouseleave', () => { _tip().classList.remove('visible'); });
}

let _targets     = [];        // parsed target list, used by sky display
let _ngpsMode    = false;     // true when loaded file is NGPS format
let _ngpsCols    = [];        // column names from NGPS header (uppercase)
let _failedLines = [];        // raw lines that failed to parse
let _sortCol          = null;  // currently sorted column key, or null
let _sortDir          = 1;    // 1 = ascending, -1 = descending
let _selectedTargetIdx = null; // index into _targets of the selected row, or null
let _skyTargetMode = 'all';    // 'all' = show every target, 'selected' = show only the selected target
let _sftpEntries  = [];        // current SFTP directory listing
let _sftpSortCol  = 'name';   // SFTP sort column
let _sftpSortDir  = 1;        // 1 = asc, -1 = desc
// In-memory (not persisted) on purpose: remembers the last-browsed directory
// across modal opens within this page load, but a page refresh should feel
// like a reset to defaults, so it must not survive a reload the way
// sessionStorage would.
let _sftpLastDir  = null;
let _amCursorX    = null;     // canvas-pixel x of mouse over airmass plot, or null
let _amCursorY    = null;     // canvas-pixel y of mouse over airmass plot, or null
let _amPanHours   = 0;        // airmass plot horizontal pan in UT hours
let _tcsNowJD     = null;     // JD derived from TCS UTC string; more reliable than new Date() on client
let _amPW         = 1;        // last drawn plot pixel width (for drag-to-pan scaling)
let _amNightSpan  = 12;       // last night duration in hours (for drag-to-pan scaling)
let _amDragStartX = null;     // x pixel at mousedown (null when not pressed)
let _amDragPanAt  = 0;        // _amPanHours value at drag start
let _amDragging   = false;    // true once drag threshold exceeded
let _skyZoom      = 1.0;      // sky display zoom factor (1 = full view)
let _skyPanX      = 0.0;      // sky pan, x, in units of base R
let _skyPanY      = 0.0;      // sky pan, y, in units of base R

function toggleConnection() {
  if (_connected) {
    disconnect();
  } else {
    connect();
  }
}

function connect() {
  _manualDisconnect    = false;
  _reconnecting        = false;
  _reconnectAttempts   = 0;
  _consecutiveFailures = 0;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  setConnBtn('connecting');
  _doConnect(0);
}

function _doConnect(attempt) {
  if (_manualDisconnect) return;
  if (attempt >= 15) { setConnBtn('disconnected'); updateConnStatus('error'); return; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);

  fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'connect' }),
    signal: controller.signal,
  }).then(r => r.json()).then(d => {
    clearTimeout(timer);
    if (_manualDisconnect) return;
    if (d.running) {
      _connected = true;
      setConnBtn('connected');
      setTimeout(startPolling, 1000);
    } else {
      setTimeout(() => _doConnect(attempt + 1), 500);
    }
  }).catch(() => {
    clearTimeout(timer);
    if (!_manualDisconnect) setTimeout(() => _doConnect(attempt + 1), 500);
  });
}

function disconnect() {
  _manualDisconnect = true;
  _reconnecting     = false;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  stopPolling();
  _connected = false;
  setConnBtn('disconnected');
  updateConnStatus('disconnected', '');
  api({ action: 'disconnect' });
}

// ── Auto-reconnect ────────────────────────────────────────────────────────────

function handleConnectionLoss() {
  if (_manualDisconnect || _reconnecting) return;
  _connected = false;
  stopPolling();
  _reconnecting      = true;
  _reconnectAttempts = 0;
  scheduleReconnect();
}

function scheduleReconnect() {
  _reconnectAttempts++;
  if (_reconnectAttempts > MAX_RECONNECT) {
    _reconnecting = false;
    setConnBtn('disconnected');
    updateConnStatus('disconnected', '');
    el('status-text').textContent = 'Reconnection failed — click Connect to try again.';
    return;
  }
  // Show yellow pulsing "Reconnecting…" state
  const dot  = el('conn-dot');
  const text = el('conn-text');
  ['green', 'red', 'yellow', 'dim'].forEach(c => { dot.classList.remove(c); text.classList.remove(c); });
  dot.classList.add('yellow');
  text.classList.add('yellow');
  dot.textContent  = '●';
  text.textContent = 'Reconnecting…';
  setConnBtn('connecting');
  el('status-text').textContent =
    `Connection lost — reconnecting (attempt ${_reconnectAttempts} of ${MAX_RECONNECT})…`;
  _reconnectTimer = setTimeout(attemptReconnect, RECONNECT_DELAY);
}

function attemptReconnect() {
  if (_manualDisconnect) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'connect' }),
    signal: controller.signal,
  }).then(r => r.json()).then(d => {
    clearTimeout(timer);
    if (_manualDisconnect) return;
    if (d.running) {
      _reconnecting      = false;
      _reconnectAttempts = 0;
      _connected         = true;
      setConnBtn('connected');
      updateConnStatus('connected', '');
      el('status-text').textContent = 'Reconnected successfully.';
      setTimeout(startPolling, 1000);
    } else {
      scheduleReconnect();
    }
  }).catch(() => {
    clearTimeout(timer);
    if (!_manualDisconnect) scheduleReconnect();
  });
}

function setConnBtn(state) {
  const btn = el('conn-btn');
  btn.classList.remove('connected', 'connecting');
  if (state === 'connected') {
    btn.textContent = 'Disconnect';
    btn.classList.add('connected');
  } else if (state === 'connecting') {
    btn.textContent = 'Connecting…';
    btn.classList.add('connecting');
  } else {
    btn.textContent = 'Connect';
  }
}

// ── Telemetry polling ─────────────────────────────────────────────────────────

// ── Fetch loop — runs as fast as the server responds, just caches data ────────

function startPolling() {
  stopPolling();
  _latestTelemetry = null;
  _lastSeq = -1;
  _tcsDownSince = null;
  // Redraw the airmass plot on a 60-second wall-clock timer so the NOW marker
  // stays current even when the TCS sequence number isn't changing.
  _renderTimer = setInterval(drawAirmassPlt, 60000);
  (function poll() {
    if (!_connected) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    api({ action: 'telemetry' }, controller.signal)
      .then(d => { _consecutiveFailures = 0; cacheTelemetry(d); })
      .catch(() => {
        _consecutiveFailures++;
        if (_consecutiveFailures >= FAILURES_BEFORE_RECONNECT) {
          _consecutiveFailures = 0;
          handleConnectionLoss();
        }
      })
      .finally(() => { clearTimeout(timer); if (_connected) _pollTimer = setTimeout(poll, 100); });
  })();
}

function stopPolling() {
  if (_pollTimer)  { clearTimeout(_pollTimer);   _pollTimer  = null; }
  if (_renderTimer){ clearInterval(_renderTimer); _renderTimer = null; }
}

// Store incoming data and detect connection loss after several consecutive failures.
function cacheTelemetry(d) {
  _latestTelemetry = d;
  // Only re-render when the daemon has written genuinely new data
  const seq = d._seq ?? -1;
  if (seq !== _lastSeq) {
    _lastSeq = seq;
    renderTelemetry();
  }
}

// ── Render loop — fires on a fixed 250 ms clock, independent of fetch latency ─

function renderTelemetry() {
  const d = _latestTelemetry;
  if (!d || !_connected) return;

  // Position / target
  set('target',   truncName(d.target) || '—');
  set('ra',       d.ra        || '—');
  set('dec',      d.dec       || '—');
  set('equinox',  _sentEquinox || '—');
  set('ha',       d.ha        || '—');
  set('airmass',  d.airmass   || '—');
  set('lst',      d.lst       || '—');
  set('utc',      d.utc       || '—');

  // Derive an accurate JD from the TCS-provided UTC string so the airmass plot
  // NOW marker uses observatory time rather than the client workstation's clock.
  if (d.utc && d.utc !== '—') {
    const utcH = sexDec(d.utc);
    if (utcH !== null) {
      // Use new Date() only for the calendar date; the fractional hour comes from TCS.
      const clientJD = new Date().getTime() / 86400000 + 2440587.5;
      const jd0      = Math.floor(clientJD - 0.5) + 0.5;
      _tcsNowJD      = jd0 + utcH / 24;
    }
  }

  // Corrections & optics
  const raOff  = d.ra_off  != null ? parseFloat(d.ra_off)  : null;
  const decOff = d.dec_off != null ? parseFloat(d.dec_off) : null;
  const fmtOff = (v, pos, neg) => {
    if (v === null) return '—';
    const dir = v > 0 ? pos : v < 0 ? neg : '—';
    const abs = Math.abs(v);
    return abs >= 1000
      ? (abs / 3600).toFixed(3) + '° ' + dir
      : abs.toFixed(2) + '" ' + dir;
  };
  set('ra-off',  fmtOff(raOff,  'E', 'W'));
  set('dec-off', fmtOff(decOff, 'N', 'S'));
  set('ra-rate',  d.ra_rate  ? d.ra_rate  + '"/hr' : '0.0"/hr');
  set('dec-rate', d.dec_rate ? d.dec_rate + '"/hr' : '0.0"/hr');
  set('focus',    d.focus    ? d.focus + ' mm' : '—');
  set('cassring', d.cassring ? ((parseFloat(d.cassring) % 360 + 360) % 360).toFixed(2) + '°' : '—');

  // TCS-level drops (daemon 'disconnected'/'connecting') are suppressed for up to TCS_GRACE_MS.
  // The daemon reconnects in ~5s; freeze the display rather than alarming the operator.
  const isTcsDown = d._status === 'disconnected' || d._status === 'connecting';
  if (isTcsDown) {
    if (!_tcsDownSince) _tcsDownSince = Date.now();
    if (Date.now() - _tcsDownSince < TCS_GRACE_MS) return; // silent freeze
    // Grace period expired — show the warning, but keep field values frozen
    updateConnStatus('tcs_reconnecting', '');
    drawSky();
    updateAirmass();
    drawAirmassPlt();
    return;
  }
  _tcsDownSince = null; // reconnected — cancel any pending grace period

  const displayStatus = d._status || 'connected';
  updateConnStatus(displayStatus, d._updated || '');
  drawSky();
  updateAirmass();
  drawAirmassPlt();
}

function updateConnStatus(status, updated) {
  const dot  = el('conn-dot');
  const text = el('conn-text');
  const bar  = el('status-text');

  const map = {
    connected:          { color: 'green',  label: 'Connected' },
    connecting:         { color: 'yellow', label: 'TCS Reconnecting…' },
    tcs_reconnecting:   { color: 'yellow', label: 'TCS Reconnecting…' },
    disconnected:       { color: 'red',    label: 'Disconnected' },
    stopped:            { color: 'red',    label: 'Daemon stopped' },
    daemon_not_running: { color: 'red',    label: 'Daemon not running' },
    no_data:            { color: 'red',    label: 'No data' },
    error:              { color: 'red',    label: 'Error' },
  };

  // handle "error: ..." strings from daemon
  const key = Object.keys(map).find(k => status.startsWith(k)) || 'error';
  const { color, label } = map[key] || map.error;

  // Remove old colour classes
  ['green', 'red', 'yellow', 'dim'].forEach(c => {
    dot.classList.remove(c);
    text.classList.remove(c);
  });
  dot.classList.add(color);
  text.classList.add(color);

  dot.textContent  = '●';
  text.textContent = label;

  if (status === 'daemon_not_running') {
    bar.textContent = 'Daemon not running — start with: python3 tcs_daemon.py';
  } else if (status === 'connected') {
    bar.textContent = '';
  } else {
    bar.textContent = status;
  }

  if (updated) {
    set('last-updated', `updated ${updated}`);
  }
}


// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));

  document.querySelectorAll('.tab-content').forEach(c =>
    c.classList.add('hidden'));

  el('tab-' + tab).classList.remove('hidden');

  if (tab === 'table') parseTextToTable();
  if (tab === 'edit')  highlightTargetText();
}


// ── Target text / table ───────────────────────────────────────────────────────

// Try every format/delimiter combination and return the one that successfully
// parses the most data lines.  Sets the ftype/delim radio controls to the
// winner so that parseTextToTable() will use the right settings automatically.
// Returns the human-readable detection label (e.g. "auto-detected: CSV tab
// (12/12 lines)") so the caller can restore it after parseTextToTable()
// overwrites parse-detected with its own generic message.
function detectAndApplyBestFormat(content) {
  const dataLines = content.split('\n').filter(l => {
    const t = l.trim();
    return t && !t.startsWith('#') && !t.startsWith('!');
  });
  if (dataLines.length === 0) return null;

  // NGPS detection: look for a header line before trying other formats
  const ngpsHeaderLine = dataLines.find(l => isNGPSHeader(l));
  if (ngpsHeaderLine) {
    const useComma   = ngpsHeaderLine.includes(',');
    _ngpsCols        = (useComma
      ? ngpsHeaderLine.split(',')
      : ngpsHeaderLine.trim().split(/\s+/)
    ).map(s => s.trim().toUpperCase());
    _ngpsMode = true;
    const dataCount  = dataLines.filter(l => !isNGPSHeader(l) && parseNGPS(l, _ngpsCols)).length;
    const total      = dataLines.filter(l => !isNGPSHeader(l)).length;
    return `auto-detected: NGPS (${dataCount}/${total} lines)`;
  }
  _ngpsMode = false;
  _ngpsCols = [];

  // Every combination, ordered so that earlier entries win ties.
  // PTIC is listed first so it is preferred when scores are equal.
  const candidates = [
    { isPTIC: true,  delim: null,  ftype: 'ptic', delimRadio: 'auto', delimOther: '',  label: 'PTIC'          },
    { isPTIC: false, delim: ',',   ftype: 'csv',  delimRadio: ',',    delimOther: '',  label: 'CSV comma'      },
    { isPTIC: false, delim: ';',   ftype: 'csv',  delimRadio: ';',    delimOther: '',  label: 'CSV semicolon'  },
    { isPTIC: false, delim: /\t/,  ftype: 'csv',  delimRadio: '\t',   delimOther: '',  label: 'CSV tab'        },
    { isPTIC: false, delim: /\s+/, ftype: 'csv',  delimRadio: ' ',    delimOther: '',  label: 'CSV space'      },
    { isPTIC: false, delim: '|',   ftype: 'csv',  delimRadio: 'other',delimOther: '|', label: 'CSV pipe'       },
  ];

  let best = null, bestScore = -1;
  for (const c of candidates) {
    let score = 0;
    for (const line of dataLines) {
      if (c.isPTIC ? parsePTIC(line) : parseCSV(line, c.delim)) score++;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }

  if (!best || bestScore === 0) return null;

  // Apply the winner to the UI controls
  document.querySelector(`input[name="ftype"][value="${best.ftype}"]`).checked = true;
  document.querySelector(`input[name="delim"][value="${best.delimRadio}"]`).checked = true;
  if (best.delimOther) el('delim-other').value = best.delimOther;

  return `auto-detected: ${best.label} (${bestScore}/${dataLines.length} lines)`;
}

function loadTargetText(content, filename) {
  el('targets-text').value = content;
  if (filename) {
    _lastLoadedFilename = filename;
    el('list-name-file').textContent = filename;
  }
  el('save-target-btn').disabled = false;
  el('clear-target-btn').disabled = false;
  const detected = detectAndApplyBestFormat(content);
  parseTextToTable();
  // parseTextToTable → getFormatInfo overwrites parse-detected with a generic
  // label; restore the specific auto-detection message if we have one.
  if (detected) el('parse-detected').textContent = detected;
  switchTab('table');
}

function clearTargetList() {
  _targets           = [];
  _failedLines       = [];
  _ngpsMode          = false;
  _ngpsCols          = [];
  _selectedTargetIdx = null;
  _lastLoadedFilename = '';
  el('targets-text').value         = '';
  el('parse-detected').textContent = '';
  el('list-name-file').textContent = '—';
  el('save-target-btn').disabled          = true;
  el('clear-target-btn').disabled         = true;
  el('delete-single-target-btn').disabled = true;
  el('load-tcs-btn').disabled = true;
  _sftpLastDir = null;
  renderTargetRows();
  drawSky();
  drawAirmassPlt();
  updateSelectedDisplay();
}

// Strip inline ! comment; return { data: string, notes: string }
function stripComment(line) {
  const idx = line.indexOf('!');
  if (idx === -1) return { data: line, notes: '' };
  return { data: line.substring(0, idx), notes: line.substring(idx + 1).trim() };
}

// Detect format and delimiter from user options + content.
// Returns { isPTIC: bool, delim: string|RegExp|null }
function getFormatInfo(content) {
  const ftypeEl = document.querySelector('input[name="ftype"]:checked');
  const delimEl = document.querySelector('input[name="delim"]:checked');
  const ftype   = ftypeEl ? ftypeEl.value : 'auto';
  const delim   = delimEl ? delimEl.value : 'auto';

  if (ftype === 'ptic') {
    el('parse-detected').textContent = 'PTIC format';
    return { isPTIC: true, delim: null };
  }

  if (ftype === 'csv') {
    let d = ',';
    if (delim === 'other') d = el('delim-other').value || '|';
    else if (delim !== 'auto') d = delim;
    el('parse-detected').textContent = 'CSV format';
    return { isPTIC: false, delim: d === '\t' ? /\t/ : d };
  }

  // Auto ftype — respect explicit delimiter selection first
  if (delim === 'other') {
    const custom = el('delim-other').value || '|';
    el('parse-detected').textContent = `delimiter: "${custom}"`;
    return { isPTIC: false, delim: custom };
  }

  if (delim !== 'auto') {
    const labels = { ',': 'comma', ';': 'semicolon', '\t': 'tab', ' ': 'space' };
    el('parse-detected').textContent = `delimiter: ${labels[delim] || delim}`;
    // Space delimiter explicitly chosen → space-delimited CSV (RA/Dec must use
    // colons internally per the spec; name must contain no spaces)
    if (delim === ' ') return { isPTIC: false, delim: /\s+/ };
    return { isPTIC: false, delim: delim === '\t' ? /\t/ : delim };
  }

  // Auto-detect delimiter from sample lines
  const sample = content.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('!'))
    .slice(0, 10);

  const candidates = [
    { re: /,/g,  label: 'comma',     ch: ',' },
    { re: /;/g,  label: 'semicolon', ch: ';' },
    { re: /\t/g, label: 'tab',       ch: '\t' },
    { re: /\|/g, label: 'pipe',      ch: '|' },
  ];

  let best = null, bestCount = 0;
  for (const c of candidates) {
    const count = sample.reduce((n, l) => n + (l.match(c.re) || []).length, 0);
    if (count > bestCount) { bestCount = count; best = c; }
  }

  if (best && bestCount > 0) {
    el('parse-detected').textContent = `auto-detected: ${best.label}`;
    return { isPTIC: false, delim: best.ch === '\t' ? /\t/ : best.ch };
  }

  // Default: PTIC (fixed-width name, space-tokenized coordinates)
  el('parse-detected').textContent = 'auto-detected: PTIC';
  return { isPTIC: true, delim: null };
}

function splitLine(line, delim) {
  if (delim instanceof RegExp) return line.split(delim);
  // CSV comma: handle double-quoted fields
  if (delim === ',') {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    fields.push(cur.trim());
    return fields;
  }
  return line.split(delim);
}

// True only for bare numbers (integers or decimals, optional leading sign).
// Used to distinguish a PM motion value from a comment/note field.
function looksNumeric(s) {
  return s !== '' && /^[+-]?\d+(\.\d*)?$/.test(s);
}

// True for valid epoch strings: 2000, 2000.0, J2000, B1950, etc.
function looksLikeEpoch(s) {
  return /^[JB]?\d{4}(\.\d+)?$/i.test(s);
}

// True if a string looks like the start of a coordinate value.
// Coordinates always begin with a digit or a sign character; header labels
// (e.g. "RA", "Dec", "Right Ascension") do not.
function looksLikeCoord(s) {
  return /^[+-]?\d/.test(s.trim());
}

// True if a token is already a complete colon-separated sexagesimal value
// (e.g. "10:08:22.4" or "+11:58:02"). False for a bare component like "10".
function looksLikeSexagesimal(s) {
  return /^[+-]?\d+:\d{1,2}:\d{1,2}(\.\d*)?$/.test(s.trim());
}

// ── NGPS format support ───────────────────────────────────────────────────────

// True if line looks like the NGPS header row (NAME RA DECL …)
function isNGPSHeader(line) {
  const t = line.trim();
  if (!t) return false;
  const delim = t.includes(',') ? ',' : /\s+/;
  const cols = (typeof delim === 'string' ? t.split(delim) : t.split(delim))
    .map(s => s.trim().toUpperCase()).filter(Boolean);
  return cols[0] === 'NAME' && cols[1] === 'RA' && cols[2] === 'DECL';
}

// Decimal degrees → sexagesimal RA string "H:MM:SS.ss"
function degToSexRA(deg) {
  const h = Math.abs(deg) / 15;
  const H = Math.floor(h);
  const m = (h - H) * 60;
  const M = Math.floor(m);
  const s = (m - M) * 60;
  return `${H}:${String(M).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

// Decimal degrees → sexagesimal Dec string "±DD:MM:SS.s"
function degToSexDec(deg) {
  const sign = deg < 0 ? '-' : '+';
  const abs  = Math.abs(deg);
  const D    = Math.floor(abs);
  const m    = (abs - D) * 60;
  const M    = Math.floor(m);
  const s    = (m - M) * 60;
  return `${sign}${D}:${String(M).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

// Parse a single NGPS data line given the parsed header column list.
// Returns standard target object + .ngps sub-object, or null if invalid.
function parseNGPS(rawLine, cols) {
  const { data, notes: inlineNotes } = stripComment(rawLine);
  if (!data.trim()) return null;

  // Detect delimiter from the line itself (comma > space)
  const useComma = data.includes(',');
  const fields   = useComma
    ? splitLine(data, ',').map(f => f.trim())
    : data.trim().split(/\s+/);

  const nameIdx = cols.indexOf('NAME');
  const raIdx   = cols.indexOf('RA');
  const declIdx = cols.indexOf('DECL');
  if (nameIdx < 0 || raIdx < 0 || declIdx < 0) return null;

  const name = fields[nameIdx] || '';
  if (!name || !looksNumeric(fields[raIdx])) return null;  // skip header rows

  const raDeg  = parseFloat(fields[raIdx]);
  const decDeg = parseFloat(fields[declIdx]);
  if (isNaN(raDeg) || isNaN(decDeg)) return null;

  const ra    = degToSexRA(raDeg);
  const dec   = degToSexDec(decDeg);
  const epoch = '2000';

  const get = (colName) => {
    const i = cols.indexOf(colName);
    return (i >= 0 && i < fields.length) ? fields[i].trim() : '';
  };

  let comment = '', priority = '', magnitude = '', magfilter = '', exptime = '';
  const offsetRA  = get('OFFSET_RA');
  const offsetDec = get('OFFSET_DEC');

  if (useComma) {
    // Unambiguous: each column maps directly to header index
    comment   = get('COMMENT');
    priority  = get('PRIORITY');
    magnitude = get('MAGNITUDE');
    magfilter = get('MAGFILTER');
    exptime   = get('EXPTIME');
  } else {
    // Space-delimited: COMMENT may span multiple tokens — tail-parse
    const commentStartIdx = Math.max(declIdx,
      cols.includes('OFFSET_DEC') ? cols.indexOf('OFFSET_DEC') : declIdx) + 1;
    const tail = fields.slice(commentStartIdx);

    // Pop structured fields from the tail (reverse order relative to header)
    const structured = ['PRIORITY','BINSPAT','BINSPECT','SLITANGLE','SLITWIDTH',
                        'AIRMASS_MAX','WRANGE_LOW','WRANGE_HIGH','CHANNEL',
                        'MAGNITUDE','MAGFILTER'];
    // Count how many structured columns appear after COMMENT in this file's header
    const afterCommentCols = cols.slice(cols.indexOf('COMMENT') < 0
      ? commentStartIdx : cols.indexOf('COMMENT') + 1);
    const structuredPresent = structured.filter(c => afterCommentCols.includes(c));

    let t = [...tail];
    // EXPTIME last: may be "SNR N" (two tokens) or one numeric
    if (cols.includes('EXPTIME')) {
      if (t.length >= 2 && t[t.length - 2].toUpperCase() === 'SNR') {
        const v = t.pop(); t.pop(); exptime = `SNR ${v}`;
      } else if (t.length > 0) {
        exptime = t.pop();
      }
    }
    // Pop remaining structured fields in reverse header order
    for (const colName of [...structuredPresent].reverse()) {
      if (colName === 'EXPTIME') continue;
      if (t.length > 0) {
        const v = t.pop();
        if (colName === 'PRIORITY')  priority  = v;
        if (colName === 'MAGNITUDE') magnitude = v;
        if (colName === 'MAGFILTER') magfilter = v;
      }
    }
    // Whatever remains is the COMMENT
    comment = t.join(' ');
  }

  const pmRA  = looksNumeric(offsetRA)  ? offsetRA  : '';
  const pmDec = looksNumeric(offsetDec) ? offsetDec : '';
  const notes = [inlineNotes, comment].filter(Boolean).join(' ');

  return {
    name, ra, dec, epoch, pmRA, pmDec, notes,
    ngps: { comment, priority, magnitude, magfilter, exptime },
    _fmt: { ftype: 'auto', delim: 'auto', label: 'NGPS' },
    _ngpsUseComma: useComma,
  };
}

// ── PTIC / CSV parsers ────────────────────────────────────────────────────────

// Parse PTIC format line (Section 10 spec).
// Columns 0–16 (17 chars) = fixed-width name; rest = space-separated tokens:
//   RA_h RA_m RA_s  Dec_d Dec_m Dec_s  [equinox]  [pm=pmRA,pmDec]
// Any unrecognised trailing tokens are collected as notes.
function parsePTIC(rawLine) {
  const { data, notes: inlineNotes } = stripComment(rawLine);
  if (!data.trim()) return null;

  const name   = data.substring(0, 17).trim();
  const tokens = data.substring(17).trim().split(/\s+/).filter(Boolean);

  if (tokens.length < 6) return null;
  if (!looksLikeCoord(tokens[0])) return null;   // header row

  const ra  = `${tokens[0]}:${tokens[1]}:${tokens[2]}`;
  const dec = `${tokens[3]}:${tokens[4]}:${tokens[5]}`;

  let epoch = '2000', pmRA = '', pmDec = '';
  const extra = [];
  for (let i = 6; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^pm=/i.test(t)) {
      const vals = t.slice(3).split(',');
      pmRA  = vals[0] || '';
      pmDec = vals[1] || '';
    } else if (looksLikeEpoch(t)) {
      epoch = t;
    } else {
      extra.push(t);   // free-text comment token
    }
  }

  const notes = [inlineNotes, extra.join(' ')].filter(Boolean).join(' ');
  return { name, ra, dec, epoch, pmRA, pmDec, notes };
}

// Parse CSV-format line (Section 10 spec).
// Required fields: [0]=name, [1]=RA, [2]=Dec
// Optional fields: equinox, PM_RA, PM_Dec
//
// Handles two internal sexagesimal formats automatically:
//   Colon-separated  "10:08:22"  "+11:58:02"  — single token per coordinate
//   Space-separated  "10 08 22"  "+11 58 02"  — three tokens per coordinate
//     (only unambiguous when the file delimiter is whitespace and names have no spaces)
//
// When the space-separated variant is detected (delimiter is /\s+/, at least 7
// tokens, and tokens[1] is a bare number rather than a full sexagesimal value),
// tokens 1–3 are consumed as RA H/M/S and tokens 4–6 as Dec D/M/S.
//
// Non-numeric PM fields are treated as free-text and placed in Notes.
function parseCSV(rawLine, delim) {
  const { data, notes: inlineNotes } = stripComment(rawLine);
  if (!data.trim()) return null;

  // Drop empty tokens caused by leading/trailing whitespace in space-delimited files.
  const tokens = splitLine(data, delim).map(f => f.trim()).filter(Boolean);
  if (tokens.length < 3) return null;
  if (!looksLikeCoord(tokens[1])) return null;   // header row

  let name, ra, dec, epoch;
  let i;   // index of first optional field (equinox already consumed)

  if (delim instanceof RegExp) {
    // For any regexp delimiter (tab or space), check for a multi-word name first:
    // find the first token (at index ≥ 1) that looks like sexagesimal RA.
    // If it's at index > 1, all preceding tokens form the name.
    const firstSexIdx = tokens.findIndex((t, k) => k >= 1 && looksLikeSexagesimal(t));
    if (firstSexIdx > 1 && firstSexIdx + 1 < tokens.length && looksLikeSexagesimal(tokens[firstSexIdx + 1])) {
      // Multi-word name (e.g. "M 57", "NGC 1234") — everything before firstSexIdx is the name.
      name = tokens.slice(0, firstSexIdx).join(' ');
      ra   = tokens[firstSexIdx];
      dec  = tokens[firstSexIdx + 1];
      if (looksLikeEpoch(tokens[firstSexIdx + 2])) { epoch = tokens[firstSexIdx + 2]; i = firstSexIdx + 3; }
      else                                          { epoch = '2000';                 i = firstSexIdx + 2; }
    } else if (tokens.length >= 7 && !looksLikeSexagesimal(tokens[1])) {
      // Space-delimited file with separate H M S tokens for RA and Dec.
      name = tokens[0];
      ra   = `${tokens[1]}:${tokens[2]}:${tokens[3]}`;
      dec  = `${tokens[4]}:${tokens[5]}:${tokens[6]}`;
      if (looksLikeEpoch(tokens[7])) { epoch = tokens[7]; i = 8; }
      else                           { epoch = '2000';    i = 7; }
    } else {
      // Standard sexagesimal single-field.
      name = tokens[0];
      ra   = tokens[1].replace(/\s+/g, ':');
      dec  = tokens[2].replace(/\s+/g, ':');
      if (looksLikeEpoch(tokens[3])) { epoch = tokens[3]; i = 4; }
      else                           { epoch = '2000';    i = 3; }
    }
  } else {
    // Non-regexp delimiter (comma, semicolon, pipe): standard single-field.
    name = tokens[0];
    ra   = tokens[1].replace(/\s+/g, ':');
    dec  = tokens[2].replace(/\s+/g, ':');
    if (looksLikeEpoch(tokens[3])) { epoch = tokens[3]; i = 4; }
    else                           { epoch = '2000';    i = 3; }
  }

  const _converted = {};

  // RA: auto-convert bare decimal to sexagesimal, reject incomplete sexagesimal
  if (!ra.includes(':')) {
    const v = parseFloat(ra);
    if (!isFinite(v) || v < 0 || v > 360) return null;
    const isDeg = v > 24;
    _converted.ra = { original: ra, label: isDeg ? `${ra}°` : `${ra}h` };
    ra = isDeg ? degToSexRA(v) : degToSexRA(v * 15);
  } else if (!looksLikeSexagesimal(ra)) {
    return null;
  }

  // Dec: auto-convert bare decimal degrees to sexagesimal, reject incomplete sexagesimal
  if (!dec.includes(':')) {
    const v = parseFloat(dec);
    if (!isFinite(v) || v < -90 || v > 90) return null;
    _converted.dec = { original: dec, label: `${dec}°` };
    dec = degToSexDec(v);
  } else if (!looksLikeSexagesimal(dec)) {
    return null;
  }

  // Greedily consume up to 4 numeric optional fields:
  //   [0] rateRA  [1] rateDec  [2] propRA (mas/yr)  [3] propDec (mas/yr)
  // Any non-numeric token stops consumption; everything from there is free-text.
  let pmRA = '', pmDec = '', propRA = '', propDec = '';
  let j = i;
  if (j < tokens.length && looksNumeric(tokens[j])) {
    pmRA = tokens[j++];
    if (j < tokens.length && looksNumeric(tokens[j])) {
      pmDec = tokens[j++];
      if (j < tokens.length && looksNumeric(tokens[j])) {
        propRA = tokens[j++];
        if (j < tokens.length && looksNumeric(tokens[j])) {
          propDec = tokens[j++];
        }
      }
    }
  }

  const notes = [inlineNotes, tokens.slice(j).join(' ')].filter(Boolean).join(' ');
  const result = { name, ra, dec, epoch, pmRA, pmDec, propRA, propDec, notes };
  if (Object.keys(_converted).length) result._converted = _converted;
  return result;
}

// Try every format in priority order and return the first successful parse.
// Preferred: PTIC → comma → tab → semicolon → pipe → space.
// Each result carries a ._fmt descriptor so the UI can reflect the method used.
function parseAny(rawLine) {
  const tag = (obj, fmt) => obj ? Object.assign(obj, { _fmt: fmt }) : null;
  return tag(parsePTIC(rawLine),       { ftype: 'ptic', delim: 'auto', label: 'PTIC'           })
      || tag(parseCSV(rawLine, ','),   { ftype: 'csv',  delim: ',',    label: 'CSV — comma'     })
      || tag(parseCSV(rawLine, /\t/),  { ftype: 'csv',  delim: '\t',   label: 'CSV — tab'       })
      || tag(parseCSV(rawLine, ';'),   { ftype: 'csv',  delim: ';',    label: 'CSV — semicolon' })
      || tag(parseCSV(rawLine, '|'),   { ftype: 'csv',  delim: 'other', delimOther: '|', label: 'CSV — pipe' })
      || tag(parseCSV(rawLine, /\s+/), { ftype: 'csv',  delim: ' ',    label: 'CSV — space'     })
      || null;
}

// Rate unit labels keyed by the <select> value.
// Each entry has labels for the RA-rate and Dec-rate table columns.
const RATE_UNITS = {
  pm:        { ra: 'PM RA (0.0001s/yr)',   dec: 'PM Dec (0.001"/yr)' },
  track_as:  { ra: 'Rate RA (arcsec/hr)',  dec: 'Rate Dec (arcsec/hr)' },
  track_s:   { ra: 'Rate RA (s/hr)',       dec: 'Rate Dec (arcsec/hr)' },
};

function updateRateHeaders() {
  if (_ngpsMode) return;   // headers managed by syncTableHeaders in NGPS mode
  const key = el('rate-units') ? el('rate-units').value : 'pm';
  const u   = RATE_UNITS[key] || RATE_UNITS.pm;
  const thRA  = el('th-rate-ra');
  const thDec = el('th-rate-dec');
  if (thRA)  thRA.textContent  = u.ra;
  if (thDec) thDec.textContent = u.dec;
}

function parseTextToTable() {
  const content = el('targets-text').value;
  const lines   = content.split('\n');
  _targets           = [];
  _failedLines       = [];
  _sortCol           = null;   // reset sort on new file load
  _selectedTargetIdx = null;
  updateLoadTcsBtn();
  updateSelectedDisplay();

  // NGPS detection: scan for header line before applying format heuristics
  const ngpsLine = lines.find(l => isNGPSHeader(l));
  if (ngpsLine) {
    const useComma = ngpsLine.includes(',');
    _ngpsCols = (useComma ? ngpsLine.split(',') : ngpsLine.trim().split(/\s+/))
      .map(s => s.trim().toUpperCase());
    _ngpsMode = true;
  } else {
    _ngpsMode = false;
    _ngpsCols = [];
  }

  if (_ngpsMode) {
    lines.forEach((rawLine, lineIdx) => {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return;
      if (isNGPSHeader(rawLine)) return;  // skip header line
      const parsed = parseNGPS(rawLine, _ngpsCols);
      if (parsed) { parsed._lineNum = lineIdx; _targets.push(parsed); }
      else _failedLines.push(rawLine);
    });
  } else {
    getFormatInfo(content);   // updates the UI "detected format" label
    lines.forEach((rawLine, lineIdx) => {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return;
      const parsed = parseAny(rawLine);
      if (parsed) { parsed._lineNum = lineIdx; _targets.push(parsed); }
      else _failedLines.push(rawLine);
    });
  }

  renderTargetRows();
  drawSky();
  highlightTargetText();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightTargetText() {
  const ta = el('targets-text');
  const hl = el('targets-highlight');
  if (!ta || !hl) return;

  const content = ta.value;
  if (!_ngpsMode) getFormatInfo(content);   // updates the UI "detected format" label

  const html = content.split('\n').map(rawLine => {
    const trimmed = rawLine.trim();
    const esc     = escapeHtml(rawLine);
    if (!trimmed) return '';
    if (trimmed.startsWith('#') || trimmed.startsWith('!'))
      return '<span class="hl-comment">' + esc + '</span>';
    if (_ngpsMode && isNGPSHeader(rawLine))
      return '<span class="hl-comment">' + esc + '</span>';  // header row
    const parsed = _ngpsMode
      ? parseNGPS(rawLine, _ngpsCols)
      : parseAny(rawLine);
    return parsed
      ? '<span class="hl-ok">'  + esc + '</span>'
      : '<span class="hl-err">' + esc + '</span>';
  }).join('\n');

  hl.innerHTML  = html;
  hl.scrollTop  = ta.scrollTop;
  hl.scrollLeft = ta.scrollLeft;
}

// Compute airmass for a target given LST in decimal hours.
// Returns Infinity when below horizon or data missing.
function computeAirmass(t, lst_h) {
  if (lst_h === null) return Infinity;
  const ra_h  = sexDec(t.ra);
  const dec_d = sexDec(t.dec);
  if (ra_h === null || dec_d === null) return Infinity;
  let ha_h = lst_h - ra_h;
  while (ha_h >  12) ha_h -= 24;
  while (ha_h < -12) ha_h += 24;
  const { alt } = haDecToAltAz(ha_h, dec_d);
  if (alt <= 6.5) return Infinity;
  return 1 / Math.sin(alt * Math.PI / 180);
}

// Rebuild tbody rows from _targets in current sort order.
// Sync the target table headers and optional NGPS-specific extra columns.
function syncTableHeaders() {
  const thRA    = el('th-rate-ra');
  const thDec   = el('th-rate-dec');
  const thNotes = document.querySelector('#targets-tbl th[data-col="notes"]');

  if (_ngpsMode) {
    if (thRA)    { thRA.textContent   = 'Offset RA';  thRA.dataset.col   = 'pmRA'; }
    if (thDec)   { thDec.textContent  = 'Offset Dec'; thDec.dataset.col  = 'pmDec'; }
    if (thNotes) { thNotes.textContent = 'Comment'; }

    const theadTr = document.querySelector('#targets-tbl thead tr');
    if (theadTr && !el('th-ngps-priority')) {
      const makeTh = (id, col, label) => {
        const th = document.createElement('th');
        th.id           = id;
        th.dataset.col  = col;
        th.textContent  = label;
        th.addEventListener('click', () => {
          if (_sortCol === col) {
            _sortDir === -1 ? (_sortCol = null) : (_sortDir = -1);
          } else { _sortCol = col; _sortDir = 1; }
          renderTargetRows();
        });
        return th;
      };
      theadTr.appendChild(makeTh('th-ngps-priority', 'ngpsPriority', 'Priority'));
      theadTr.appendChild(makeTh('th-ngps-mag',      'ngpsMag',      'Mag / Filter'));
    }
  } else {
    updateRateHeaders();
    if (thNotes) thNotes.textContent = 'Notes';
    el('th-ngps-priority')?.remove();
    el('th-ngps-mag')?.remove();
  }
}

function renderTargetRows() {
  const tbody = el('targets-tbody');
  tbody.innerHTML = '';
  el('targets-tbl')?.classList.toggle('no-observed', _targets.length === 0);
  syncTableHeaders();

  // Failed lines — pinned to top, red, non-interactive
  for (const raw of _failedLines) {
    const tr = document.createElement('tr');
    tr.className = 'parse-error';
    const td = document.createElement('td');
    td.colSpan = 99;
    td.textContent = 'Failed to Parse: ' + raw;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // Table is genuinely empty — show a second, larger "+ Load Target List"
  // invite in place of the (now-shrunk) scrollable table area, easier to
  // notice than the small header button. Lives outside .tbl-wrap so it's
  // centered on the pane itself, not on the table's scrollable content
  // width (the header alone is wider than the pane, hence the horizontal
  // scrollbar). Keyed off actual content (not _lastLoadedFilename, which
  // only tracks named-file loads — typing text and hitting "Parse Text", or
  // "+ Add Single Target" from a blank list, populate _targets without ever
  // setting a filename) so it disappears whenever the table stops being
  // empty, regardless of how that happened.
  const isEmpty = _targets.length === 0 && _failedLines.length === 0;
  el('tbl-wrap')?.classList.toggle('shrink', isEmpty);
  el('no-targets-placeholder')?.classList.toggle('hidden', !isEmpty);

  // Build a sorted index list
  const indices = _targets.map((_, i) => i);
  if (_sortCol) {
    const lstStr = (el('lst')?.textContent || '').trim();
    const lst_h  = (lstStr && lstStr !== '—') ? sexDec(lstStr) : null;
    indices.sort((ia, ib) => {
      const a = _targets[ia], b = _targets[ib];
      let va, vb;
      switch (_sortCol) {
        case 'name':         va = a.name  || ''; vb = b.name  || ''; break;
        case 'ra':           va = sexDec(a.ra)    ?? Infinity; vb = sexDec(b.ra)    ?? Infinity; break;
        case 'dec':          va = sexDec(a.dec)   ?? Infinity; vb = sexDec(b.dec)   ?? Infinity; break;
        case 'epoch':        va = parseFloat(a.epoch)  || 0;  vb = parseFloat(b.epoch)  || 0;  break;
        case 'pmRA':         va = parseFloat(a.pmRA)   || 0;  vb = parseFloat(b.pmRA)   || 0;  break;
        case 'pmDec':        va = parseFloat(a.pmDec)  || 0;  vb = parseFloat(b.pmDec)  || 0;  break;
        case 'notes':        va = a.notes || ''; vb = b.notes || ''; break;
        case 'airmass':      va = computeAirmass(a, lst_h); vb = computeAirmass(b, lst_h); break;
        case 'ngpsPriority': va = parseFloat(a.ngps?.priority) || Infinity;
                             vb = parseFloat(b.ngps?.priority) || Infinity; break;
        case 'ngpsMag':      va = parseFloat(a.ngps?.magnitude) || Infinity;
                             vb = parseFloat(b.ngps?.magnitude) || Infinity; break;
        default:             va = 0; vb = 0;
      }
      if (typeof va === 'string') return _sortDir * va.localeCompare(vb);
      return _sortDir * (va - vb);
    });
  }

  for (const idx of indices) {
    const { name, ra, dec, epoch, pmRA, pmDec, notes } = _targets[idx];
    const conv = _targets[idx]._converted || {};
    const tr = document.createElement('tr');

    // Observed? cell — toggled manually or auto-set when target is loaded to TCS
    const obsTd = document.createElement('td');
    obsTd.className        = 'obs-cell' + (_targets[idx]._observed ? ' checked' : '');
    obsTd.textContent      = _targets[idx]._observed ? '✓' : '';
    obsTd.dataset.obsIdx   = idx;
    obsTd.addEventListener('click', e => {
      e.stopPropagation();
      _targets[idx]._observed = !_targets[idx]._observed;
      obsTd.textContent = _targets[idx]._observed ? '✓' : '';
      obsTd.classList.toggle('checked', _targets[idx]._observed);
      tr.classList.toggle('observed', _targets[idx]._observed);
    });
    tr.appendChild(obsTd);

    // Name and Epoch — plain cells
    const nameTd = document.createElement('td');
    nameTd.textContent = name || '';
    nameTd.dataset.col = 'name';
    bindCellEdit(nameTd, idx, 'name');
    tr.appendChild(nameTd);

    // RA — italic + tooltip if auto-converted from decimal
    const raTd = document.createElement('td');
    raTd.textContent = fmtSex(ra, false) || '';
    raTd.dataset.col = 'ra';
    if (conv.ra)  { raTd.style.fontStyle  = 'italic'; attachTooltip(raTd,  `Parsed as ${conv.ra.label}`);  }
    bindCellEdit(raTd, idx, 'ra');
    tr.appendChild(raTd);

    // Dec — italic + tooltip if auto-converted from decimal
    const decTd = document.createElement('td');
    decTd.textContent = fmtSex(dec, true) || '';
    decTd.dataset.col = 'dec';
    if (conv.dec) { decTd.style.fontStyle = 'italic'; attachTooltip(decTd, `Parsed as ${conv.dec.label}`); }
    bindCellEdit(decTd, idx, 'dec');
    tr.appendChild(decTd);

    // Epoch
    const epochTd = document.createElement('td');
    epochTd.textContent = epoch || '';
    epochTd.dataset.col = 'epoch';
    bindCellEdit(epochTd, idx, 'epoch');
    tr.appendChild(epochTd);
    // Airmass cell — after Epoch; keyed by original _targets index (computed — not editable)
    const amCell = document.createElement('td');
    amCell.className         = 'airmass-val dim';
    amCell.textContent       = '—';
    amCell.dataset.targetIdx = idx;
    tr.appendChild(amCell);
    // Standard trailing columns (pmRA, pmDec = Offset RA/Dec in NGPS mode; notes = Comment)
    [['pmRA', pmRA], ['pmDec', pmDec], ['notes', notes]].forEach(([col, val]) => {
      const td = document.createElement('td');
      td.textContent = val || '';
      td.dataset.col = col;
      bindCellEdit(td, idx, col);
      tr.appendChild(td);
    });
    // NGPS-specific extra columns
    if (_ngpsMode) {
      const ng = _targets[idx].ngps || {};
      const magStr = [ng.magnitude, ng.magfilter].filter(Boolean).join(' ');
      [['ngpsPriority', ng.priority || ''], ['ngpsMag', magStr]].forEach(([col, val]) => {
        const td = document.createElement('td');
        td.textContent = val;
        td.dataset.col = col;
        bindCellEdit(td, idx, col);
        tr.appendChild(td);
      });
    }
    if (idx === _selectedTargetIdx)   tr.classList.add('selected');
    if (_targets[idx]._observed)      tr.classList.add('observed');
    tr.addEventListener('click', e => {
      // e.detail is the native click-count for this event; ignore the two
      // leading clicks of a double-click so cell-edit (dblclick) doesn't
      // also toggle row selection off right as editing starts.
      if (e.detail > 1) return;
      _selectedTargetIdx = (_selectedTargetIdx === idx) ? null : idx;
      document.querySelectorAll('#targets-tbody tr').forEach(r => r.classList.remove('selected'));
      if (_selectedTargetIdx !== null) {
        document.querySelectorAll('#targets-tbody .airmass-val').forEach(cell => {
          if (parseInt(cell.dataset.targetIdx, 10) === _selectedTargetIdx)
            cell.closest('tr').classList.add('selected');
        });
      }
      applyTargetFormat(_selectedTargetIdx);
      updateLoadTcsBtn();
      updateDeleteBtn();
      drawSky();
      drawAirmassPlt();
    });
    tbody.appendChild(tr);
  }

  updateSortIndicators();
  updateAirmass();
  updateDeleteBtn();
}

function updateDeleteBtn() {
  const btn = el('delete-single-target-btn');
  if (btn) btn.disabled = (_selectedTargetIdx === null);
}

function updateSelectedDisplay() {
  const t = (_selectedTargetIdx !== null) ? _targets[_selectedTargetIdx] : null;
  set('sel-target',  t ? (truncName(t.name) || '—') : '—');
  set('sel-ra',      t ? fmtSex(t.ra)           : '—');
  set('sel-dec',     t ? fmtSex(t.dec)          : '—');
  set('sel-equinox', t ? fmtEquinox(t.epoch)    : '—');
}

function deleteSelectedTarget() {
  if (_selectedTargetIdx === null) return;
  const lineNum = _targets[_selectedTargetIdx]._lineNum;
  if (lineNum === undefined) return;
  const ta    = el('targets-text');
  const lines = ta.value.split('\n');
  lines.splice(lineNum, 1);
  ta.value = lines.join('\n');
  loadTargetText(ta.value, _lastLoadedFilename);
}

// ── Inline cell editing (Targets Table) ───────────────────────────────────────
// Double-click a cell to quick-edit it in place, without switching to the raw
// "Edit Text" tab. #targets-text stays the single source of truth: a commit
// re-serializes just the edited line (in its own original format — CSV/PTIC/
// NGPS lines can coexist in one file) and splices it back in, then runs the
// normal full-reparse pipeline so the table and the raw text can never drift.

let _activeCellEdit = null;   // { idx, col, td, input, original } while a cell is being edited

function bindCellEdit(td, idx, col) {
  td.addEventListener('dblclick', e => {
    e.stopPropagation();
    startCellEdit(td, idx, col);
  });
}

function startCellEdit(td, idx, col) {
  // Blurring the previously-active input (from clicking/dbl-clicking elsewhere)
  // already resolves it synchronously before this fires; this is just a guard
  // against the pathological case where that somehow didn't happen.
  if (_activeCellEdit) {
    if (_activeCellEdit.td === td) return;
    _activeCellEdit.input.focus();
    return;
  }

  const target = _targets[idx];
  if (!target) return;

  let raw;
  if (col === 'ngpsPriority') raw = (target.ngps && target.ngps.priority) || '';
  else if (col === 'ngpsMag') raw = [target.ngps && target.ngps.magnitude, target.ngps && target.ngps.magfilter]
                                       .filter(Boolean).join(' ');
  else                        raw = target[col] || '';

  const input = document.createElement('input');
  input.type      = 'text';
  input.id        = 'cell-edit-input';
  input.className = 'cell-edit-input';
  input.value     = raw;

  td.textContent = '';
  td.appendChild(input);
  _activeCellEdit = { idx, col, td, input, original: raw };
  input.focus();
  input.select();

  const validate = () => {
    const result = cellValidate(col, input.value.trim(), target);
    _atfMark('cell-edit-input', result);
    return result;
  };
  validate();

  input.addEventListener('input', validate);
  input.addEventListener('mouseenter', () => _atfShowTooltip(input));
  input.addEventListener('mouseleave', _atfHideTooltip);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryCommitCellEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input._cancelled = true;
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    if (input._cancelled) { cancelCellEdit(); return; }
    tryCommitCellEdit();
  });
}

// Per-column validation. RA/Dec/Epoch/rates reuse the Add-Target-modal's
// validators verbatim; Name additionally enforces PTIC's fixed 17-char field
// (the only place that constraint has ever mattered — Add Target always
// emits CSV). Notes and NGPS Priority/Mag are free text.
function cellValidate(col, value, target) {
  if (col === 'ra')    return _atfValidateRA(value);
  if (col === 'dec')   return _atfValidateDec(value);
  if (col === 'epoch') return _atfValidateEpoch(value);
  if (col === 'pmRA' || col === 'pmDec') return _atfValidateRate(value);
  if (col === 'name') {
    if (!value) return 'Name is required';
    const isPTIC = !_ngpsMode && target._fmt && target._fmt.ftype === 'ptic';
    if (isPTIC && value.length > 17) return 'Name too long for PTIC format (max 17 chars)';
    return true;
  }
  return true;
}

function tryCommitCellEdit() {
  if (!_activeCellEdit) return;
  const { idx, col, input, original } = _activeCellEdit;
  const target = _targets[idx];
  const value  = input.value.trim();

  const result = cellValidate(col, value, target);
  if (result !== true) {
    _atfMark('cell-edit-input', result);
    if (typeof result === 'string') _atfShowTooltip(input);
    setTimeout(() => input.focus(), 0);   // refuse to commit — keep editing
    return;
  }

  _activeCellEdit = null;
  _atfHideTooltip();
  if (value === original) { renderTargetRows(); return; }   // unchanged — just redraw
  commitCellEdit(idx, col, value);
}

function cancelCellEdit() {
  if (!_activeCellEdit) return;
  _activeCellEdit = null;
  _atfHideTooltip();
  renderTargetRows();
}

// Apply the edit, re-serialize just this line in its original format, splice
// it into #targets-text at the same line number, then run the existing
// full-reparse pipeline (same path used by add/delete) so the textarea (the
// actual save payload) and _targets can never disagree. Sort/selection are
// explicitly restored since parseTextToTable() resets both unconditionally.
function commitCellEdit(idx, col, value) {
  const target = _targets[idx];
  if (!target) return;
  const lineNum = target._lineNum;
  if (lineNum === undefined) return;

  if (col === 'ngpsPriority') {
    target.ngps = target.ngps || {};
    target.ngps.priority = value;
  } else if (col === 'ngpsMag') {
    target.ngps = target.ngps || {};
    const parts = value.split(/\s+/).filter(Boolean);
    target.ngps.magnitude = parts[0] || '';
    target.ngps.magfilter = parts.slice(1).join(' ');
  } else {
    target[col] = value;
  }

  const newLine = serializeTargetLine(target);

  const savedSortCol = _sortCol, savedSortDir = _sortDir;
  const ta    = el('targets-text');
  const lines = ta.value.split('\n');
  lines[lineNum] = newLine;
  ta.value = lines.join('\n');

  loadTargetText(ta.value, _lastLoadedFilename);   // full reparse

  _sortCol = savedSortCol;
  _sortDir = savedSortDir;
  const restored = _targets.findIndex(t => t._lineNum === lineNum);
  _selectedTargetIdx = restored >= 0 ? restored : null;

  renderTargetRows();
  applyTargetFormat(_selectedTargetIdx);
  updateSelectedDisplay();
  updateLoadTcsBtn();
  updateDeleteBtn();
  drawSky();
  drawAirmassPlt();
}

// ── Line serializers — rewrite one target back into raw text, in its
//    original format, without disturbing any other line in the file ─────────

function serializeTargetLine(target) {
  if (_ngpsMode) return serializeNGPSLine(target, _ngpsCols);
  const ftype = (target._fmt && target._fmt.ftype) || 'csv';
  return ftype === 'ptic' ? serializePTICLine(target) : serializeCSVLine(target);
}

function serializePTICLine(target) {
  const name = (target.name || '').padEnd(17);
  const ra   = (target.ra  || '').split(':');
  const dec  = (target.dec || '').split(':');
  const tokens = [ra[0], ra[1], ra[2], dec[0], dec[1], dec[2]].map(t => t ?? '');
  tokens.push(target.epoch || '2000');
  if (target.pmRA || target.pmDec) tokens.push(`pm=${target.pmRA || '0'},${target.pmDec || '0'}`);
  let line = name + tokens.join(' ');
  if (target.notes) line += ' !' + target.notes;
  return line;
}

function _csvDelimChar(fmt) {
  const d = fmt && fmt.delim;
  if (d === ',' || d === ';') return d;
  if (d === 'other') return fmt.delimOther || '|';
  if (d instanceof RegExp) return d.source === '\\t' ? '\t' : ' ';
  return ',';
}

// Mirrors _atfFormatLine()'s field order/quoting, but honors the specific
// line's own delimiter (app.js ~2671) rather than always emitting comma.
function serializeCSVLine(target) {
  const d    = _csvDelimChar(target._fmt);
  const name = target.name && target.name.includes(d) ? `"${target.name}"` : (target.name || '');
  const parts = [name, target.ra || '', target.dec || '', target.epoch || '2000'];
  if (target.pmRA || target.pmDec || target.propRA || target.propDec) {
    parts.push(target.pmRA || '0', target.pmDec || '0');
    if (target.propRA || target.propDec) parts.push(target.propRA || '0', target.propDec || '0');
  }
  let line = parts.join(d);
  if (target.notes) line += ' !' + target.notes;
  return line;
}

// NGPS stores RA/Dec on disk as decimal degrees (sexDec() gives decimal hours
// for RA, so ×15; Dec is already degrees — the inverse of degToSexRA/Dec used
// at parse time). Notes are always re-emitted as a trailing !comment rather
// than split back across a structured COMMENT column — see plan notes: once
// parsed, the inline-!-vs-structured-comment split can no longer be
// recovered, so any line the editor touches settles on the simpler form.
// COMMENT is still emitted as an empty field (not omitted) so column count
// stays correct for _ngpsCols-driven positional parsing.
function serializeNGPSLine(target, cols) {
  const raDeg  = sexDec(target.ra)  * 15;
  const decDeg = sexDec(target.dec);
  const ng = target.ngps || {};
  const fieldFor = col => ({
    NAME:       target.name || '',
    RA:         isFinite(raDeg)  ? raDeg.toFixed(6)  : '',
    DECL:       isFinite(decDeg) ? decDeg.toFixed(6) : '',
    OFFSET_RA:  target.pmRA  || '0',
    OFFSET_DEC: target.pmDec || '0',
    PRIORITY:   ng.priority   || '',
    MAGNITUDE:  ng.magnitude  || '',
    MAGFILTER:  ng.magfilter  || '',
    EXPTIME:    ng.exptime    || '',
    COMMENT:    '',
  }[col] ?? '');

  const d = target._ngpsUseComma ? ',' : ' ';
  let line = cols.map(fieldFor).join(d);
  if (target.notes) line += ' !' + target.notes;
  return line;
}

function updateSortIndicators() {
  document.querySelectorAll('#targets-tbl th[data-col]').forEach(th => {
    if (th.dataset.col === _sortCol) {
      th.dataset.sort = _sortDir === 1 ? 'asc' : 'desc';
    } else {
      delete th.dataset.sort;
    }
  });
}

// ── Load to Telescope ─────────────────────────────────────────────────────────

function updateLoadTcsBtn() {
  const btn = el('load-tcs-btn');
  if (!btn) return;
  // The bar itself always stays visible/in-flow (disabling just the button
  // rather than hiding the bar) — toggling the bar in and out of layout used
  // to shift every row below it, which could make a real double-click land
  // on the wrong cell if it happened between the two clicks.
  btn.disabled = _selectedTargetIdx === null;
}

// Reflect the parse format of the selected target in the radio buttons + label.
function applyTargetFormat(idx) {
  const t = (idx !== null) ? _targets[idx] : null;
  const fmt = t?._fmt;
  if (!fmt) return;

  const ftypeEl = document.querySelector(`input[name="ftype"][value="${fmt.ftype}"]`);
  if (ftypeEl) ftypeEl.checked = true;

  // Iterate to avoid CSS-selector issues with special delimiter chars (e.g. \t)
  let matched = false;
  document.querySelectorAll('input[name="delim"]').forEach(r => {
    if (r.value === fmt.delim) { r.checked = true; matched = true; }
  });
  if (!matched)
    document.querySelector('input[name="delim"][value="auto"]').checked = true;

  if (fmt.delimOther) {
    const otherEl = el('delim-other');
    if (otherEl) otherEl.value = fmt.delimOther;
  }

  const label = el('parse-detected');
  if (label) label.textContent = fmt.label;
}

function loadToTelescope() {
  if (_selectedTargetIdx === null) return;
  const t = _targets[_selectedTargetIdx];
  if (!t) return;

  const ra_h  = sexDec(t.ra);
  const dec_d = sexDec(t.dec);
  if (ra_h === null || dec_d === null) {
    alert('Cannot load: invalid RA/Dec for this target.');
    return;
  }

  const epoch     = parseFloat((t.epoch || '2000').replace(/^[JB]/i, '')) || 2000;
  const applyRates = el('apply-rates')?.checked;
  const rateUnits  = el('rate-units')?.value || 'pm';
  const pmRA_raw   = parseFloat(t.pmRA)  || 0;
  const pmDec_raw  = parseFloat(t.pmDec) || 0;

  const useRates = applyRates && (pmRA_raw !== 0 || pmDec_raw !== 0) && rateUnits !== 'pm';

  // MFLAG: 1 = arcsec/hr both axes, 2 = RA in sec/hr / Dec in arcsec/hr
  const mflag = rateUnits === 'track_s' ? 2 : 1;

  const ra_str   = ra_h.toFixed(6);
  const dec_str  = dec_d.toFixed(6);
  const pmRA_str = pmRA_raw.toFixed(4);
  const pmDec_str= pmDec_raw.toFixed(4);
  const name     = (t.name || '').replace(/'/g, '');   // strip any single-quotes

  let cmd;
  if (useRates) {
    cmd = `COORDS ${ra_str} ${dec_str} ${epoch} ${pmRA_str} ${pmDec_str} ${mflag} '${name}'`;
  } else {
    cmd = `COORDS ${ra_str} ${dec_str} ${epoch} 0.0 0.0 '${name}'`;
  }

  const btn = el('load-tcs-btn');
  btn.disabled   = true;
  btn.textContent = 'Sending…';

  api({ action: 'coords', command: cmd })
    .then(d => {
      if (d.ok) {
        _sentEquinox = fmtEquinox(t.epoch);
        updateSelectedDisplay();
        // Auto-mark as observed
        _targets[_selectedTargetIdx]._observed = true;
        const obsCell = document.querySelector(`.obs-cell[data-obs-idx="${_selectedTargetIdx}"]`);
        if (obsCell) {
          obsCell.textContent = '✓';
          obsCell.classList.add('checked');
          obsCell.closest('tr')?.classList.add('observed');
        }
        btn.textContent = 'Target Loaded!';
        btn.classList.add('success');
        setTimeout(() => {
          btn.textContent = 'Load to Telescope';
          btn.classList.remove('success');
          btn.disabled    = false;
        }, 2000);
      } else {
        btn.textContent = 'Error';
        btn.disabled    = false;
        console.error('COORDS error:', d.error);
        setTimeout(() => { btn.textContent = 'Load to Telescope'; }, 2500);
      }
    })
    .catch(() => {
      btn.textContent = 'Error';
      btn.disabled    = false;
      setTimeout(() => { btn.textContent = 'Load to Telescope'; }, 2500);
    });
}


function updateAirmass() {
  const lstStr = (el('lst')?.textContent || '').trim();
  const lst_h  = (lstStr && lstStr !== '—') ? sexDec(lstStr) : null;

  document.querySelectorAll('#targets-tbody .airmass-val').forEach(cell => {
    const t = _targets[parseInt(cell.dataset.targetIdx, 10)];
    if (!t || lst_h === null) {
      cell.textContent = '—';
      cell.className   = 'airmass-val dim';
      return;
    }
    const am = computeAirmass(t, lst_h);
    if (am === Infinity) {
      cell.textContent = 'Down';
      cell.className   = 'airmass-val dim';
      return;
    }
    cell.textContent = am.toFixed(2);
    if      (am < 1.5) cell.className = 'airmass-val green';
    else if (am < 2.0) cell.className = 'airmass-val yellow';
    else if (am < 3.0) cell.className = 'airmass-val orange';
    else               cell.className = 'airmass-val red';
  });
}


// ── Moon Position (Meeus simplified, accurate to ~1°) ────────────────────────
// Returns { ra_h, dec_d } (J2000, hours / degrees) for the given Julian Date.
function moonPos(jd) {
  const T = (jd - 2451545.0) / 36525.0;   // Julian centuries from J2000

  // Mean longitude / anomaly / argument of latitude (degrees)
  const Lp = (218.3164477 + 481267.88123421 * T) % 360;
  const D  = (297.8501921 + 445267.1114034  * T) % 360;
  const M  = (357.5291092 +  35999.0502909  * T) % 360;  // Sun's mean anomaly
  const Mp = (134.9633964 + 477198.8675055  * T) % 360;  // Moon's mean anomaly
  const F  = (93.2720950  + 483202.0175233  * T) % 360;  // Argument of latitude

  const r  = Math.PI / 180;

  // Longitude correction (degrees, only the largest terms)
  let dLon = 6.289 * Math.sin(Mp * r)
            - 1.274 * Math.sin((2 * D - Mp) * r)
            + 0.658 * Math.sin(2 * D * r)
            - 0.186 * Math.sin(M * r)
            - 0.059 * Math.sin((2 * Mp - 2 * D) * r)
            - 0.057 * Math.sin((Mp - 2 * D + M) * r)
            + 0.053 * Math.sin((Mp + 2 * D) * r)
            + 0.046 * Math.sin((2 * D - M) * r)
            + 0.041 * Math.sin((Mp - M) * r)
            - 0.035 * Math.sin(D * r)
            - 0.031 * Math.sin((Mp + M) * r)
            - 0.015 * Math.sin((2 * F - 2 * D) * r)
            + 0.011 * Math.sin((Mp - 4 * D) * r);

  // Latitude correction (degrees)
  let dLat = 5.128 * Math.sin(F * r)
            + 0.280 * Math.sin((Mp + F) * r)
            + 0.277 * Math.sin((Mp - F) * r)
            + 0.173 * Math.sin((2 * D - F) * r)
            + 0.055 * Math.sin((2 * D - Mp + F) * r)
            - 0.046 * Math.sin((2 * D - Mp - F) * r)
            + 0.033 * Math.sin((2 * D + F) * r)
            + 0.017 * Math.sin((2 * Mp + F) * r);

  const lambda = (Lp + dLon) * r;   // ecliptic longitude (radians)
  const beta   = dLat * r;           // ecliptic latitude (radians)

  // Obliquity of ecliptic (degrees → radians)
  const eps = (23.439291111 - 0.013004167 * T) * r;

  // Convert ecliptic → equatorial
  const ra_r  = Math.atan2(Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
                            Math.cos(lambda));
  const dec_r = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda));

  const ra_h  = ((ra_r * 180 / Math.PI) / 15 % 24 + 24) % 24;
  const dec_d = dec_r * 180 / Math.PI;
  return { ra_h, dec_d };
}

// Returns the Moon's elongation from the Sun in degrees (0=new, 90=first quarter,
// 180=full, 270=last quarter).  Uses the same longitude terms as moonPos above.
function moonElongation(jd) {
  const T = (jd - 2451545.0) / 36525.0, r = Math.PI / 180;
  const Lp = (218.3164477 + 481267.88123421 * T) % 360;
  const D  = (297.8501921 + 445267.1114034  * T) % 360;
  const M  = (357.5291092 +  35999.0502909  * T) % 360;
  const Mp = (134.9633964 + 477198.8675055  * T) % 360;
  const F  = (93.2720950  + 483202.0175233  * T) % 360;
  const dLon = 6.289*Math.sin(Mp*r)          - 1.274*Math.sin((2*D-Mp)*r)
             + 0.658*Math.sin(2*D*r)          - 0.186*Math.sin(M*r)
             - 0.059*Math.sin((2*Mp-2*D)*r)   - 0.057*Math.sin((Mp-2*D+M)*r)
             + 0.053*Math.sin((Mp+2*D)*r)     + 0.046*Math.sin((2*D-M)*r)
             + 0.041*Math.sin((Mp-M)*r)       - 0.035*Math.sin(D*r)
             - 0.031*Math.sin((Mp+M)*r)       - 0.015*Math.sin((2*F-2*D)*r)
             + 0.011*Math.sin((Mp-4*D)*r);
  const moonLon = (Lp + dLon + 720) % 360;
  const Ms  = (357.529 + 35999.054 * T) % 360;
  const sunLon = (280.459 + 36000.772*T + 1.914*Math.sin(Ms*r) + 0.020*Math.sin(2*Ms*r) + 720) % 360;
  return (moonLon - sunLon + 360) % 360;
}

// Draw the outline of the moon's lit region centred at (cx,cy) with radius r.
// elongDeg: 0=new moon, 90=first quarter, 180=full, 270=last quarter.
// The shape is: lit-side semicircle arc + terminator half-ellipse (width = |cos E| · r).
function drawMoonPhase(ctx, cx, cy, r, elongDeg) {
  const E      = ((elongDeg % 360) + 360) % 360;
  const waxing = E < 180;
  const b      = Math.cos(E * Math.PI / 180);   // signed; |b|·r = terminator x semi-axis
  const absB   = Math.abs(b);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#f8e45c';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';

  ctx.beginPath();
  // Lit-side arc from top (0,−r) to bottom (0,r):
  //   waxing → CW (anticlockwise=false) = right semicircle
  //   waning → CCW (anticlockwise=true) = left semicircle
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, !waxing);

  // Terminator arc from bottom (0,r) back to top (0,−r):
  if (absB < 0.02) {
    ctx.lineTo(0, -r);                          // quarter moon → straight line
  } else {
    // goRight: terminator curves toward the lit side (crescent) when true,
    //          toward the dark side (gibbous) when false.
    const goRight = (b >= 0) === waxing;
    ctx.ellipse(0, 0, absB * r, r, 0, Math.PI / 2, -Math.PI / 2, goRight);
  }

  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// ── Solar System Positions (Meeus Table 31.a, ~1-2° accuracy) ────────────────
// Keplerian elements at J2000.0 and their Julian-century rates.
// Columns: [a, e, I, L, W(lon.peri), Om(asc.node)]
const _PLANET_ELEMS = {
  _Earth:  [[1.00000261, 0.01671123,-0.00001531, 100.46457166, 102.93768193,   0.0        ],
            [0.00000562,-0.00004392,-0.01294668,  35999.37244981,  0.32327364,  0.0        ]],
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350,  77.45779628,  48.33076593],
            [0.00000037, 0.00001906,-0.00594749, 149472.67411175,  0.16047689, -0.12534081]],
  Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718,  76.67984255],
            [0.00000390,-0.00004107,-0.00078890,  58517.81538729,  0.00268329, -0.27769418]],
  Mars:    [[1.52371034, 0.09339410, 1.84969142,  -4.55343205, -23.94362959,  49.55953891],
            [0.00001847, 0.00007882,-0.00813131,  19140.30268499,  0.44441088, -0.29257343]],
  Jupiter: [[5.20288700, 0.04838624, 1.30439695,  34.39644051,  14.72847983, 100.47390909],
            [-0.00011607,-0.00013253,-0.00183714,  3034.74612775,  0.21252668,   0.20469106]],
  Saturn:  [[9.53667594, 0.05386179, 2.48599187,  49.95424423,  92.59887831, 113.66242448],
            [-0.00125060,-0.00050991, 0.00193609,  1222.49362201, -0.41897216, -0.28867794]],
  Uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630,  74.01692503],
            [-0.00196176,-0.00004397,-0.00242939,   428.48202785,  0.40805281,  0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969,  44.96476227, 131.78422574],
            [ 0.00026291, 0.00005105, 0.00035372,   218.45945325, -0.32241464, -0.00508664]],
};

function _helioEcliptic([a0,e0,I0,L0,W0,Om0], [da,de,dI,dL,dW,dOm], T) {
  const a  = a0 + da * T;
  const e  = e0 + de * T;
  const I  = ((I0  + dI  * T) % 360) * Math.PI / 180;
  const Om = (((Om0 + dOm * T) % 360) + 360) % 360 * Math.PI / 180;
  const W  = (((W0  + dW  * T) % 360) + 360) % 360;
  const L  = (((L0  + dL  * T) % 360) + 360) % 360;
  const M  = (((L - W) % 360) + 360) % 360 * Math.PI / 180;
  const om = (((W - ((Om0 + dOm * T) % 360)) % 360) + 360) % 360 * Math.PI / 180;
  let E = M;
  for (let i = 0; i < 12; i++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r  = a * (1 - e * Math.cos(E));
  return {
    x: r*(Math.cos(Om)*Math.cos(om+nu) - Math.sin(Om)*Math.sin(om+nu)*Math.cos(I)),
    y: r*(Math.sin(Om)*Math.cos(om+nu) + Math.cos(Om)*Math.sin(om+nu)*Math.cos(I)),
    z: r* Math.sin(om+nu)*Math.sin(I),
  };
}

function _geoRaDec(gx, gy, gz, eps) {
  const lon   = Math.atan2(gy, gx);
  const lat   = Math.atan2(gz, Math.sqrt(gx*gx + gy*gy));
  const ra_r  = Math.atan2(Math.sin(lon)*Math.cos(eps) - Math.tan(lat)*Math.sin(eps), Math.cos(lon));
  const dec_r = Math.asin(Math.sin(lat)*Math.cos(eps) + Math.cos(lat)*Math.sin(eps)*Math.sin(lon));
  return { ra_h: ((ra_r*180/Math.PI/15) % 24 + 24) % 24, dec_d: dec_r*180/Math.PI };
}

// Returns geocentric { ra_h, dec_d } for the Sun and all planets.
function solarSystemPos(jd) {
  const T   = (jd - 2451545.0) / 36525.0;
  const eps = (23.439291111 - 0.013004167 * T) * Math.PI / 180;
  const e   = _helioEcliptic(_PLANET_ELEMS._Earth[0], _PLANET_ELEMS._Earth[1], T);
  const out = { Sun: _geoRaDec(-e.x, -e.y, -e.z, eps) };
  for (const name of ['Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune']) {
    const h = _helioEcliptic(_PLANET_ELEMS[name][0], _PLANET_ELEMS[name][1], T);
    out[name] = _geoRaDec(h.x-e.x, h.y-e.y, h.z-e.z, eps);
  }
  return out;
}


// ── Sky Display ───────────────────────────────────────────────────────────────

const SKY_LAT_R = 33.3563 * Math.PI / 180;   // Palomar Mountain latitude

// All-sky camera rotation offset (CW degrees) and zoom scale.  Both are persisted
// to localStorage so empirical calibration survives page reloads.
// ALLSKY_SCALE<1 zooms the camera FOV in (canvas edge is beyond camera horizon).
let ALLSKY_ROTATION_DEG = parseFloat(localStorage.getItem('allsky_rotation') ?? '-13');
let ALLSKY_SCALE        = parseFloat(localStorage.getItem('allsky_scale')    ?? '1.0');

// Calibration constants from original FACSUM telescope.cfg
// Forward mapping (camera px → overlay px): corrR = A·r + B·r² + C
const _ASK_CX    = 349;      // fisheye centre column in 640×480 JPEG
const _ASK_CY    = 249.5;    // fisheye centre row
const _ASK_R_CAM = 270;      // mask radius in camera pixels (RAW_MASK_DIAMETER/2)
const _ASK_A = 1.1337, _ASK_B = 0.0009, _ASK_C = 0.1887;
// Overlay radius at alt=0 (horizon): A·270 + B·270² + C ≈ 371.9
const _ASK_R_OVL = _ASK_A * _ASK_R_CAM + _ASK_B * _ASK_R_CAM * _ASK_R_CAM + _ASK_C;

// Build (or return cached) a 512×512 fisheye-corrected canvas from _allSkyImg.
// Returns true if the canvas is ready, false if getImageData failed (CORS).
function _buildRemappedAllSky() {
  if (!_allSkyImg || !_allSkyImg.complete || !_allSkyImg.naturalWidth) return false;

  const key = _allSkyImg.src + '|' + ALLSKY_ROTATION_DEG + '|' + ALLSKY_SCALE;
  if (_remapKey === key && _remapCanvas) return true;

  // Draw the raw image into a same-sized offscreen canvas to read its pixels.
  const srcW = _allSkyImg.naturalWidth, srcH = _allSkyImg.naturalHeight;
  const srcOff = document.createElement('canvas');
  srcOff.width = srcW; srcOff.height = srcH;
  const srcCtx = srcOff.getContext('2d');
  srcCtx.drawImage(_allSkyImg, 0, 0);

  let srcData;
  try { srcData = srcCtx.getImageData(0, 0, srcW, srcH).data; }
  catch (e) { return false; }   // CORS blocked — fall back to simple drawImage

  // Output canvas: 512×512, sky circle radius = 256, centre at (256, 256).
  const SZ = 512, outR = SZ / 2;
  if (!_remapCanvas) { _remapCanvas = document.createElement('canvas'); _remapCanvas.width = _remapCanvas.height = SZ; }
  const outCtx  = _remapCanvas.getContext('2d');
  const imgData = outCtx.createImageData(SZ, SZ);
  const out     = imgData.data;

  const theta = ALLSKY_ROTATION_DEG * Math.PI / 180;
  const cosT  = Math.cos(theta), sinT = Math.sin(theta);
  const scale = _ASK_R_OVL / outR / ALLSKY_SCALE;  // ALLSKY_SCALE<1 zooms camera in

  for (let py = 0; py < SZ; py++) {
    for (let px = 0; px < SZ; px++) {
      const dx = px - outR, dy = py - outR;
      if (dx * dx + dy * dy > outR * outR) continue;

      // Canvas → overlay coordinates.  N=top and E=left in both spaces — no axis flip.
      const ov_dx = dx * scale, ov_dy = dy * scale;
      const corrR = Math.sqrt(ov_dx * ov_dx + ov_dy * ov_dy);

      // Inverse quadratic: B·r² + A·r + (C − corrR) = 0
      const disc  = _ASK_A * _ASK_A - 4 * _ASK_B * (_ASK_C - corrR);
      if (disc < 0) continue;
      const uncR  = Math.max(0, (-_ASK_A + Math.sqrt(disc)) / (2 * _ASK_B));
      if (uncR > _ASK_R_CAM * 1.02) continue;   // outside camera mask

      // Direction angle (same atan2 convention as original Java code).
      const phi   = Math.atan2(ov_dx, ov_dy);

      // Inverse camera rotation to get raw camera coordinates.
      const rotX  = uncR * Math.sin(phi), rotY = uncR * Math.cos(phi);
      const camX  =  rotX * cosT + rotY * sinT;
      const camY  = -rotX * sinT + rotY * cosT;

      // Camera pixel (column j, row i) in the 640×480 JPEG.
      const imgJ  = camX + _ASK_CX, imgI = camY + _ASK_CY;
      const j0    = imgJ | 0, i0 = imgI | 0;
      const j1    = j0 + 1,   i1 = i0 + 1;
      if (j0 < 0 || i0 < 0 || j1 >= srcW || i1 >= srcH) continue;

      // Bilinear sample.
      const fj = imgJ - j0, fi = imgI - i0;
      const w00 = (1-fj)*(1-fi), w10 = fj*(1-fi), w01 = (1-fj)*fi, w11 = fj*fi;
      const o00 = (i0*srcW + j0)*4, o10 = (i0*srcW + j1)*4;
      const o01 = (i1*srcW + j0)*4, o11 = (i1*srcW + j1)*4;
      const oi  = (py*SZ + px)*4;
      out[oi]   = srcData[o00]*w00 + srcData[o10]*w10 + srcData[o01]*w01 + srcData[o11]*w11;
      out[oi+1] = srcData[o00+1]*w00 + srcData[o10+1]*w10 + srcData[o01+1]*w01 + srcData[o11+1]*w11;
      out[oi+2] = srcData[o00+2]*w00 + srcData[o10+2]*w10 + srcData[o01+2]*w01 + srcData[o11+2]*w11;
      out[oi+3] = 255;
    }
  }
  outCtx.putImageData(imgData, 0, 0);
  _remapKey = key;
  return true;
}

function _skyRad(d) { return d * Math.PI / 180; }
function _skyDeg(r) { return r * 180 / Math.PI; }

// Format a sexagesimal string with leading zeros on each component.
// forceSign=true always prepends + or - (use for Dec).
function fmtSex(str, forceSign) {
  if (!str) return str;
  const s = str.trim();
  if (!s || s === '—') return s;
  const neg    = s.startsWith('-');
  const bare   = s.replace(/^[+-]/, '');
  const padded = bare.split(':').map(p => {
    const i = p.indexOf('.');
    return i < 0 ? p.padStart(2, '0') : p.slice(0, i).padStart(2, '0') + p.slice(i);
  }).join(':');
  return (neg ? '-' : forceSign ? '+' : '') + padded;
}

// Parse "HH:MM:SS.s" or "DD:MM:SS.s" (with optional leading ±) → decimal.
function sexDec(str) {
  if (!str) return null;
  str = str.trim();
  if (str === '—' || str === '') return null;
  const neg  = str.charAt(0) === '-';
  const abs  = str.replace(/^[+-]/, '');
  const p    = abs.split(':');
  const val  = (parseFloat(p[0]) || 0) + (parseFloat(p[1]) || 0) / 60 + (parseFloat(p[2]) || 0) / 3600;
  return neg ? -val : val;
}

// Parse TCS hour angle string: "E02:59:50" → negative (east), "W00:02:30" → positive (west).
function parseHAstr(str) {
  if (!str || str === '—') return null;
  str = str.trim();
  const east = /^E/i.test(str);
  const val  = sexDec(str.replace(/^[EeWw]/, ''));
  if (val === null) return null;
  return east ? -val : val;   // east of meridian = negative HA
}

// Compute altitude and azimuth (degrees) from hour angle (hours) and Dec (degrees).
function haDecToAltAz(ha_h, dec_deg) {
  const H      = _skyRad(ha_h * 15);
  const D      = _skyRad(dec_deg);
  const sinAlt = Math.sin(SKY_LAT_R) * Math.sin(D) + Math.cos(SKY_LAT_R) * Math.cos(D) * Math.cos(H);
  const alt    = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz  = (Math.sin(D) - Math.sin(SKY_LAT_R) * sinAlt) / (Math.cos(SKY_LAT_R) * Math.cos(alt));
  let   az     = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (Math.sin(H) > 0) az = 2 * Math.PI - az;   // west side: az > 180
  return { alt: _skyDeg(alt), az: _skyDeg(az) };
}

// Azimuthal equidistant projection → canvas pixel.
// N = top, E = left  (standard astronomer chart: looking UP at the sky).
function skyProject(alt, az, cx, cy, R) {
  if (alt < -2) return null;
  const r = (1 - alt / 90) * R;
  const t = _skyRad(az);
  return { x: cx - r * Math.sin(t), y: cy - r * Math.cos(t) };
}

function drawSky() {
  const canvas = el('sky-canvas');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const size = Math.min(wrap.clientWidth, wrap.clientHeight) - 4;
  if (size < 80) return;

  canvas.width  = size;
  canvas.height = size;
  canvas.style.cursor = _skyZoom > 1 ? 'grab' : '';
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const R  = size / 2 - 22;    // 22 px margin for cardinal labels

  // Zoom / pan — ecx/ecy is the projection centre, eR is the effective radius
  const ecx = cx + _skyPanX * R;
  const ecy = cy + _skyPanY * R;
  const eR  = R  * _skyZoom;

  // Background
  ctx.fillStyle = '#020208';
  ctx.fillRect(0, 0, size, size);

  // Clip everything inside to the (zoomed) sky circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(ecx, ecy, eR, 0, 2 * Math.PI);
  ctx.clip();

  const grad = ctx.createRadialGradient(ecx, ecy, 0, ecx, ecy, eR);
  grad.addColorStop(0,    '#030312');
  grad.addColorStop(0.75, '#030312');
  grad.addColorStop(1,    '#07070f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // ── All-sky camera overlay ────────────────────────────────────────────────
  const showAllSky = el('sky-show-allsky')?.checked !== false;
  if (showAllSky && _allSkyImg && _allSkyImg.complete && _allSkyImg.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    if (_buildRemappedAllSky()) {
      // Per-pixel fisheye-corrected image: the 512×512 canvas has its sky circle
      // centred at (256,256) with radius 256, so scaling it to 2eR × 2eR at (ecx,ecy)
      // aligns perfectly with the equidistant projection.
      ctx.drawImage(_remapCanvas, ecx - eR, ecy - eR, eR * 2, eR * 2);
    } else {
      // Fallback (CORS blocked): simple crop + rotate, no fisheye correction.
      const SRC_X = 21, SRC_Y = 11, SRC_W = 618, SRC_H = 468;
      ctx.translate(ecx, ecy);
      if (ALLSKY_ROTATION_DEG !== 0) ctx.rotate(ALLSKY_ROTATION_DEG * Math.PI / 180);
      ctx.drawImage(_allSkyImg, SRC_X, SRC_Y, SRC_W, SRC_H, -eR, -eR, eR * 2, eR * 2);
    }
    ctx.restore();
  }

  // ── Declination circles (every 10°, stationary in HA/Dec space) ──────────
  const showLabels = el('sky-show-labels')?.checked !== false;

  function drawDecCircle(dec, strokeStyle, lineWidth) {
    ctx.beginPath();
    let penDown = false;
    for (let ha = 0; ha <= 24; ha += 0.2) {
      const { alt, az } = haDecToAltAz(ha, dec);
      const pt = skyProject(alt, az, ecx, ecy, eR);
      if (pt) {
        if (!penDown) { ctx.moveTo(pt.x, pt.y); penDown = true; }
        else            ctx.lineTo(pt.x, pt.y);
      } else { penDown = false; }
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth   = lineWidth;
    ctx.stroke();
  }

  for (let dec = -80; dec <= 80; dec += 10) {
    drawDecCircle(dec, 'rgba(80,110,170,0.28)', 0.6);
    if (showLabels && dec % 20 === 0) {
      const { alt: mAlt, az: mAz } = haDecToAltAz(0, dec);
      const mp = skyProject(mAlt, mAz, ecx, ecy, eR);
      if (mp) {
        ctx.fillStyle    = 'rgba(100,140,200,0.55)';
        ctx.font         = '9px sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${dec >= 0 ? '+' : ''}${dec}°`, mp.x + 3, mp.y);
      }
    }
  }


  // ── Hour-angle limit lines (±2, ±4, ±6h + meridian) ─────────────────────
  // ha values 2,4,6 = west (past meridian); 22,20,18 = east (before meridian).
  // Labels use +/- convention where east = positive (hours until transit).
  const HA_LINES = [
    { ha:  0, label: null    },
    { ha:  2, label: '+2h'  },
    { ha:  4, label: '+4h'  },
    { ha:  6, label: '+6h'  },
    { ha: 18, label: '−6h'  },
    { ha: 20, label: '−4h'  },
    { ha: 22, label: '−2h'  },
  ];
  for (const { ha, label } of HA_LINES) {
    ctx.beginPath();
    let penDown = false;
    for (let dec = -89; dec <= 89; dec += 1) {
      const { alt, az } = haDecToAltAz(ha, dec);
      const pt = skyProject(alt, az, ecx, ecy, eR);
      if (pt) {
        if (!penDown) { ctx.moveTo(pt.x, pt.y); penDown = true; }
        else            ctx.lineTo(pt.x, pt.y);
      } else { penDown = false; }
    }
    const meridian = (ha === 0);
    ctx.strokeStyle = meridian ? 'rgba(210,70,70,0.80)' : 'rgba(180,50,50,0.45)';
    ctx.lineWidth   = meridian ? 1.3 : 0.8;
    ctx.stroke();

    // Label at Dec=0° crossing
    if (showLabels && label) {
      const { alt: lAlt, az: lAz } = haDecToAltAz(ha, 30);
      const lp = skyProject(lAlt, lAz, ecx, ecy, eR);
      if (lp) {
        ctx.font         = 'bold 9px sans-serif';
        ctx.fillStyle    = 'rgba(220,110,110,0.85)';
        ctx.textAlign    = lp.x < ecx ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lp.x + (lp.x < cx ? -4 : 4), lp.y);
      }
    }
  }

  // ── Horizon elevation limit at 6.5° ──────────────────────────────────────
  {
    const limitAlt = 6.5;
    const limitR   = (1 - limitAlt / 90) * eR;
    ctx.beginPath();
    ctx.arc(ecx, ecy, limitR, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,160,50,0.70)';
    ctx.lineWidth   = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle    = 'rgba(255,160,50,0.65)';
    ctx.font         = '10px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('6.5°', ecx, ecy + limitR + 2);
  }

  // ── Moon, Sun & Planets ───────────────────────────────────────────────────
  {
    const _lstStr = (el('lst')?.textContent || '').trim();
    const _lst_h  = sexDec(_lstStr);
    if (_lst_h !== null) {
      const jdNow = new Date().getTime() / 86400000 + 2440587.5;

      // Moon
      if (el('sky-show-moon')?.checked !== false) {
        const { ra_h: mRa, dec_d: mDec } = moonPos(jdNow);
        let mHa = _lst_h - mRa;
        while (mHa >  12) mHa -= 24;
        while (mHa < -12) mHa += 24;
        const { alt: mAlt, az: mAz } = haDecToAltAz(mHa, mDec);
        if (mAlt > 0) {
          const mp = skyProject(mAlt, mAz, ecx, ecy, eR);
          if (mp) {
            const moonR = 8;
            // Faint disc silhouette so the moon's position is always visible.
            ctx.beginPath();
            ctx.arc(mp.x, mp.y, moonR, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(248,228,92,0.25)';
            ctx.lineWidth   = 1;
            ctx.stroke();
            // Phase outline on top.
            drawMoonPhase(ctx, mp.x, mp.y, moonR, moonElongation(jdNow));
            if (showLabels) {
              ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(248,228,92,0.9)';
              ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
              ctx.fillText('Moon', mp.x + moonR + 4, mp.y);
            }
          }
        }
      }

      // Sun and planets
      if (el('sky-show-planets')?.checked !== false) {
        const bodies = solarSystemPos(jdNow);
        const BODY_STYLE = {
          Sun:     { r:  2.5, fill: '#ffe566', stroke: '#c8a800' },
          Mercury: { r:  1,   fill: '#ffe566', stroke: '#c8a800' },
          Venus:   { r:  1.5, fill: '#ffe566', stroke: '#c8a800' },
          Mars:    { r:  1.5, fill: '#ffe566', stroke: '#c8a800' },
          Jupiter: { r:  2,   fill: '#ffe566', stroke: '#c8a800' },
          Saturn:  { r:  1.5, fill: '#ffe566', stroke: '#c8a800' },
          Uranus:  { r:  1.5, fill: '#ffe566', stroke: '#c8a800' },
          Neptune: { r:  1.5, fill: '#ffe566', stroke: '#c8a800' },
        };
        for (const [name, pos] of Object.entries(bodies)) {
          let bHa = _lst_h - pos.ra_h;
          while (bHa >  12) bHa -= 24;
          while (bHa < -12) bHa += 24;
          const { alt: bAlt, az: bAz } = haDecToAltAz(bHa, pos.dec_d);
          if (bAlt <= 0) continue;
          const bp = skyProject(bAlt, bAz, ecx, ecy, eR);
          if (!bp) continue;
          const st = BODY_STYLE[name];
          ctx.beginPath();
          ctx.arc(bp.x, bp.y, st.r, 0, 2 * Math.PI);
          ctx.fillStyle = st.fill;
          ctx.fill();
          ctx.strokeStyle = st.stroke;
          ctx.lineWidth   = 1;
          ctx.stroke();
          if (showLabels) {
            ctx.font = '10px sans-serif'; ctx.fillStyle = st.fill;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(name, bp.x + st.r + 4, bp.y);
          }
        }
      }
    }
  }

  // ── Target list (needs LST to convert RA → HA) ────────────────────────────
  const lstStr = (el('lst')?.textContent || '').trim();
  const lst_h  = sexDec(lstStr);

  if (lst_h !== null && _targets.length > 0) {
    for (let i = 0; i < _targets.length; i++) {
      if (_skyTargetMode === 'selected' && i !== _selectedTargetIdx) continue;
      const t = _targets[i];
      const ra_h  = sexDec(t.ra);
      const dec_d = sexDec(t.dec);
      if (ra_h === null || dec_d === null) continue;
      let ha_h = lst_h - ra_h;
      while (ha_h >  12) ha_h -= 24;
      while (ha_h < -12) ha_h += 24;
      const { alt, az } = haDecToAltAz(ha_h, dec_d);
      if (alt < 0) continue;
      const pt = skyProject(alt, az, ecx, ecy, eR);
      if (!pt) continue;
      const isSel = (i === _selectedTargetIdx);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isSel ? 5 : 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = isSel ? '#ffe0aa' : '#ffb86c';
      ctx.fill();
      if (showLabels) {
        ctx.font         = '10px monospace';
        ctx.fillStyle    = isSel ? 'rgba(255,224,170,0.95)' : 'rgba(255,184,108,0.9)';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.name, pt.x + 6, pt.y);
      }
    }

    // Selected target crosshair (drawn on top of all dots)
    if (_selectedTargetIdx !== null) {
      const t = _targets[_selectedTargetIdx];
      if (t) {
        const ra_h  = sexDec(t.ra);
        const dec_d = sexDec(t.dec);
        if (ra_h !== null && dec_d !== null) {
          let ha_h = lst_h - ra_h;
          while (ha_h >  12) ha_h -= 24;
          while (ha_h < -12) ha_h += 24;
          const { alt, az } = haDecToAltAz(ha_h, dec_d);
          if (alt > 0) {
            const pt = skyProject(alt, az, ecx, ecy, eR);
            if (pt) {
              const s = 11;
              ctx.strokeStyle = '#ffe0aa';
              ctx.lineWidth   = 1.5;
              ctx.beginPath();
              ctx.moveTo(pt.x - s, pt.y); ctx.lineTo(pt.x + s, pt.y);
              ctx.moveTo(pt.x, pt.y - s); ctx.lineTo(pt.x, pt.y + s);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 7, 0, 2 * Math.PI);
              ctx.stroke();
            }
          }
        }
      }
    }
  }

  // ── Telescope crosshair (drawn last so it is always on top) ─────────────────
  // Compute HA from LST − RA (same formula as targets) so both markers share
  // the same time reference and agree when the telescope is on a target.
  {
    const telRaStr  = (el('ra')?.textContent  || '').trim();
    const decStr    = (el('dec')?.textContent || '').trim();
    const telLstStr = (el('lst')?.textContent || '').trim();
    const tel_ra_h  = sexDec(telRaStr);
    const tel_lst_h = sexDec(telLstStr);
    const tel_dec   = sexDec(decStr);
    let   tel_ha    = (tel_ra_h !== null && tel_lst_h !== null) ? tel_lst_h - tel_ra_h : null;
    if (tel_ha !== null) { while (tel_ha >  12) tel_ha -= 24; while (tel_ha < -12) tel_ha += 24; }

    if (tel_ha !== null && tel_dec !== null && telRaStr !== '—' && decStr !== '—') {
      const { alt, az } = haDecToAltAz(tel_ha, tel_dec);
      const pt = skyProject(alt, az, ecx, ecy, eR);
      if (pt) {
        const s = 11;
        ctx.strokeStyle = '#8be9fd';   // cyan
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(pt.x - s, pt.y); ctx.lineTo(pt.x + s, pt.y);
        ctx.moveTo(pt.x, pt.y - s); ctx.lineTo(pt.x, pt.y + s);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.strokeRect(pt.x - s, pt.y - s, s * 2, s * 2);
        // Size "P200" so it spans 80% of the square width
        ctx.font = '10px sans-serif';
        const p200W = ctx.measureText('P200').width;
        const p200Fs = Math.max(6, Math.round(10 * (s * 2 * 0.8) / p200W));
        ctx.font         = `${p200Fs}px sans-serif`;
        ctx.fillStyle    = '#8be9fd';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('P200', pt.x, pt.y - s - 1);
      }
    }
  }

  ctx.restore();   // remove clip

  // ── Horizon circle ─────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(ecx, ecy, eR, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(130,220,255,0.55)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // ── Cardinal labels ────────────────────────────────────────────────────────
  ctx.font         = 'bold 12px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, az] of [['N',0],['E',90],['S',180],['W',270]]) {
    const t = _skyRad(az);
    ctx.fillStyle = 'rgba(200,235,255,0.85)';
    ctx.fillText(label,
      ecx - (eR + 14) * Math.sin(t),
      ecy - (eR + 14) * Math.cos(t));
  }
}


// ── Airmass Plot ──────────────────────────────────────────────────────────────

const AM_LON = -116.8650;   // Palomar longitude, degrees (West = negative)
// Latitude reuses SKY_LAT_R already defined above (33.3563° in radians)

// Integer Julian Day Number for a UTC calendar date
function amJulianDay(date) {
  const y  = date.getUTCFullYear();
  const m  = date.getUTCMonth() + 1;
  const d  = date.getUTCDate();
  const a  = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy +
    Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

// Solar transit JD + sin/cos of solar declination for a given Date.
// Adapted from sun.js (USNO algorithm with equation of time).
function amSolarNoon(date) {
  const jd    = amJulianDay(date);
  const n     = jd - 2451545.0 + 0.0008;
  const jStar = n - AM_LON / 360;
  const M_deg = ((357.5291 + 0.98560028 * jStar) % 360 + 360) % 360;
  const M_rad = M_deg * Math.PI / 180;
  const C     = 1.9148 * Math.sin(M_rad)
              + 0.0200 * Math.sin(2 * M_rad)
              + 0.0003 * Math.sin(3 * M_rad);
  const lam   = ((M_deg + C + 180 + 102.9372) % 360 + 360) % 360;
  const lamR  = lam * Math.PI / 180;
  const jTrans = 2451545.0 + jStar
               + 0.0053 * Math.sin(M_rad)
               - 0.0069 * Math.sin(2 * lamR);
  const sinDec = Math.sin(lamR) * Math.sin(23.4397 * Math.PI / 180);
  const cosDec = Math.cos(Math.asin(sinDec));
  return { jTrans, sinDec, cosDec };
}

// Sunrise / sunset as JD values for the given Date.
// Returns null if sun never sets (polar).
function amNightBounds(date) {
  const { jTrans, sinDec, cosDec } = amSolarNoon(date);
  const latR   = SKY_LAT_R;
  const cosOm  = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(latR) * sinDec)
               / (Math.cos(latR) * cosDec);
  if (cosOm < -1 || cosOm > 1) return null;
  const omega = Math.acos(cosOm);         // radians
  return {
    jSunrise: jTrans - omega / (2 * Math.PI),
    jSunset:  jTrans + omega / (2 * Math.PI),
  };
}

// GMST at 0h UT (hours) for a given JD at midnight UT
function amGMST0(jd0) {
  return ((6.697375 + 0.0657098242 * (jd0 - 2451545.0)) % 24 + 24) % 24;
}

// LST at Palomar for a given offset-UT-hour (may be > 24) and GMST at 0h
function amLST(utOff, gm0) {
  return ((gm0 + 1.00274 * utOff + AM_LON / 15) % 24 + 24) % 24;
}

// Airmass of a target at utOff hours past today's midnight UT; null = below horizon
function amForTarget(target, utOff, gm0) {
  const ra_h  = sexDec(target.ra);
  const dec_d = sexDec(target.dec);
  if (ra_h === null || dec_d === null) return null;
  const lst = amLST(utOff, gm0);
  let ha = lst - ra_h;
  while (ha >  12) ha -= 24;
  while (ha < -12) ha += 24;
  const { alt } = haDecToAltAz(ha, dec_d);
  if (alt <= 0) return null;
  return 1 / Math.sin(alt * Math.PI / 180);
}

// Smooth colour for a given airmass value — interpolated between the same stops
// used in the sky display (green → yellow → orange → red)
function amColor(am) {
  const stops = [
    [1.0,  80, 250, 123],   // #50fa7b  green
    [1.5, 241, 250, 140],   // #f1fa8c  yellow
    [2.0, 255, 184, 108],   // #ffb86c  orange
    [3.0, 255,  85,  85],   // #ff5555  red
  ];
  if (am <= stops[0][0]) {
    const [, r, g, b] = stops[0];
    return `rgb(${r},${g},${b})`;
  }
  const last = stops[stops.length - 1];
  if (am >= last[0]) return `rgb(${last[1]},${last[2]},${last[3]})`;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a0, r0, g0, b0] = stops[i];
    const [a1, r1, g1, b1] = stops[i + 1];
    if (am >= a0 && am <= a1) {
      const t = (am - a0) / (a1 - a0);
      return `rgb(${Math.round(r0 + t*(r1-r0))},${Math.round(g0 + t*(g1-g0))},${Math.round(b0 + t*(b1-b0))})`;
    }
  }
}

// Pacific Time offset from UT: returns -7 (PDT) or -8 (PST)
function amPTOffset() {
  const now   = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(now);
  const h   = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const m   = parseInt(parts.find(p => p.type === 'minute').value, 10);
  let off   = (h + m / 60) - (now.getUTCHours() + now.getUTCMinutes() / 60);
  if (off >  12) off -= 24;
  if (off < -12) off += 24;
  return Math.round(off);
}

function drawAirmassPlt() {
  const canvas = el('airmass-canvas');
  if (!canvas) return;
  const section = el('airmass-section');
  if (section && !section.open) return;

  // Match canvas pixel resolution to CSS layout width
  const W = canvas.offsetWidth  || canvas.parentElement.clientWidth  || 400;
  const H = canvas.parentElement.clientHeight || 168;
  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#020208';
  ctx.fillRect(0, 0, W, H);

  // Margins: left needs room for airmass labels, bottom for time labels
  const PL = 44, PR = 8, PT = 10, PB = 52;
  const pw = W - PL - PR;
  const ph = H - PT - PB;

  // Solar / time setup.
  // Use new Date() for calendar-date calculations (sunrise/sunset, night bounds).
  // For the NOW marker, prefer TCS-derived JD so the position reflects observatory
  // time rather than the client workstation's clock, which may be unsynchronised.
  const now      = new Date();
  const clientJD = now.getTime() / 86400000 + 2440587.5;
  const jdNow    = _tcsNowJD ?? clientJD;
  const jd0      = Math.floor(clientJD - 0.5) + 0.5;  // calendar date from client (accurate enough)
  const gm0      = amGMST0(jd0);

  // Exact UT offset from jd0's midnight — works correctly across the UTC day boundary
  const markerUT = (jdNow - jd0) * 24;

  const boundsToday = amNightBounds(now);
  if (!boundsToday) return;

  // Choose which night to display:
  //   Before today's sunrise → we're still in last night (yesterday's sunset → today's sunrise)
  //   Otherwise (daytime or post-sunset evening) → show tonight (today's sunset → tomorrow's sunrise)
  let ssUT, srUT;
  if (jdNow < boundsToday.jSunrise) {
    // Early morning — still observing last night
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const boundsYest = amNightBounds(yesterday);
    if (!boundsYest) return;
    ssUT = (boundsYest.jSunset   - jd0) * 24;
    srUT = (boundsToday.jSunrise - jd0) * 24;
  } else {
    // Daytime or evening — show the upcoming/current night
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const boundsTmr = amNightBounds(tomorrow);
    if (!boundsTmr) return;
    ssUT = (boundsToday.jSunset - jd0) * 24;
    srUT = (boundsTmr.jSunrise  - jd0) * 24;
  }

  const xMin = ssUT - 0.5;   // 30 min before sunset
  const xMax = srUT + 0.5;   // 30 min after sunrise
  _amPW        = pw;
  _amNightSpan = xMax - xMin;
  const vMin   = xMin + _amPanHours;
  const vMax   = xMax + _amPanHours;

  canvas.style.cursor = 'grab';

  // Label the night by its UT date (the date on which sunset falls)
  {
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const ssDate = new Date((jd0 + ssUT / 24 - 2440587.5) * 86400000);
    const dateSpan = el('airmass-date');
    if (dateSpan) {
      dateSpan.textContent =
        ssDate.getUTCDate() + ' ' + MONTHS[ssDate.getUTCMonth()] + ' ' + ssDate.getUTCFullYear() + ' UT';
    }
  }

  const AM_MIN = 1.0, AM_MAX = 4.5;

  function xPx(t)  { return PL + (t - vMin) / (vMax - vMin) * pw; }
  function yPx(am) { return PT + (am - AM_MIN) / (AM_MAX - AM_MIN) * ph; }

  // ── Twilight shading (30-min buffers at each end = pre-sunset / post-sunrise) ──
  const xSS = xPx(ssUT), xSR = xPx(srUT);
  ctx.fillStyle = 'rgba(28,28,55,0.65)';
  if (xSS > PL)      ctx.fillRect(PL, PT, xSS - PL, ph);         // left of sunset
  if (xSR < PL + pw) ctx.fillRect(xSR, PT, PL + pw - xSR, ph);  // right of sunrise

  // ── Y grid lines (airmass) ────────────────────────────────────────────────
  ctx.font = '12px monospace';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (const am of [1.0, 1.5, 2.0, 2.5, 3.0, 4.0]) {
    const y = yPx(am);
    ctx.strokeStyle = 'rgba(55,55,95,0.8)';
    ctx.lineWidth   = 0.6;
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + pw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(120,120,175,0.9)';
    ctx.fillText(am.toFixed(1), PL - 3, y);
  }

  // ── X grid lines (every 2 hours, dual UT / PT labels) ───────────────────
  const ptOff   = amPTOffset();
  const ptLabel = ptOff === -7 ? 'PDT' : 'PST';
  ctx.font      = '12px monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  const xTick0 = Math.ceil(vMin / 2) * 2;
  for (let t = xTick0; t <= vMax + 0.01; t += 2) {
    const x = xPx(t);
    if (x < PL - 1 || x > PL + pw + 1) continue;
    ctx.strokeStyle = 'rgba(55,55,95,0.8)';
    ctx.lineWidth   = 0.6;
    ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); ctx.stroke();
    // UT row
    const hUT = ((Math.round(t) % 24) + 24) % 24;
    ctx.fillStyle = 'rgba(110,110,165,0.9)';
    ctx.fillText(String(hUT).padStart(2, '0') + 'h', x, PT + ph + 18);
    // PT row (12-hour)
    const hPT  = ((hUT + ptOff) % 24 + 24) % 24;
    const h12  = hPT % 12 || 12;
    const ampm = hPT < 12 ? 'a' : 'p';
    ctx.fillStyle = 'rgba(110,110,165,0.9)';
    ctx.fillText(h12 + ':00' + ampm, x, PT + ph + 32);
  }
  // Axis-row labels at left margin
  ctx.textAlign    = 'right';
  ctx.font         = '11px sans-serif';
  ctx.fillStyle    = 'rgba(110,110,165,0.7)';
  ctx.fillText('UT', PL - 4, PT + ph + 18);
  ctx.fillStyle    = 'rgba(110,110,165,0.7)';
  ctx.fillText(ptLabel, PL - 4, PT + ph + 32);

  // ── Sunrise / sunset dashed lines ─────────────────────────────────────────
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(240,190,60,0.45)';
  ctx.lineWidth   = 1;
  for (const x of [xSR, xSS]) {
    if (x >= PL && x <= PL + pw) {
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // ── "Now" marker ──────────────────────────────────────────────────────────
  if (markerUT >= vMin && markerUT <= vMax) {
    const x = xPx(markerUT);
    ctx.strokeStyle = 'rgba(139,233,253,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle    = 'rgba(139,233,253,0.85)';
    ctx.font         = '11px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('NOW', x, PT + ph + 4);
  }

  // Clip curves to the plot area so panned content doesn't overflow the margins
  ctx.save();
  ctx.beginPath();
  ctx.rect(PL, PT, pw, ph);
  ctx.clip();

  // ── Moon airmass curve (dashed yellow, drawn before target so target is on top) ──
  if (el('sky-show-moon')?.checked !== false) {
    const steps = Math.ceil((vMax - vMin) * 12);
    const moonPts = [];
    for (let i = 0; i <= steps; i++) {
      const utOff = vMin + (i / steps) * (vMax - vMin);
      const jd    = jd0 + utOff / 24;
      const { ra_h: mRa, dec_d: mDec } = moonPos(jd);
      const lst = amLST(utOff, gm0);
      let ha = lst - mRa;
      while (ha >  12) ha -= 24;
      while (ha < -12) ha += 24;
      const { alt } = haDecToAltAz(ha, mDec);
      const am = alt > 0 ? 1 / Math.sin(alt * Math.PI / 180) : null;
      moonPts.push({ t: utOff, am });
    }

    ctx.strokeStyle = 'rgba(248,228,92,0.70)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    let penDown = false;
    for (const p of moonPts) {
      if (p.am === null || p.am > AM_MAX) { penDown = false; continue; }
      const x = xPx(p.t), y = yPx(Math.min(p.am, AM_MAX));
      if (!penDown) { ctx.moveTo(x, y); penDown = true; }
      else          { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Label "Moon" near the first visible point, clamped to stay inside the plot area
    const first = moonPts.find(p => p.am !== null && p.am <= AM_MAX);
    if (first) {
      ctx.fillStyle = 'rgba(248,228,92,0.80)';
      ctx.font      = '12px sans-serif';
      ctx.textAlign = 'left';
      const moonLabelW = ctx.measureText('Moon').width;
      const moonLabelX = Math.max(PL, Math.min(xPx(first.t) + 3, PL + pw - moonLabelW));
      const curveY     = yPx(Math.min(first.am, AM_MAX));
      // Flip below the curve if there isn't room above it
      if (curveY - 2 >= PT + 14) {
        ctx.textBaseline = 'bottom';
        ctx.fillText('Moon', moonLabelX, curveY - 2);
      } else {
        ctx.textBaseline = 'top';
        ctx.fillText('Moon', moonLabelX, curveY + 2);
      }
    }
  }

  // ── Airmass curve ──────────────────────────────────────────────────────────
  const target = (_selectedTargetIdx !== null) ? _targets[_selectedTargetIdx] : null;
  const _nameSpan = el('airmass-target-name');
  if (_nameSpan) _nameSpan.textContent = target ? (target.name || '') : '';

  if (!target) {
    ctx.fillStyle    = 'rgba(130,130,185,0.55)';
    ctx.font         = '14px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select a target to view its airmass curve',
                 PL + pw / 2, PT + ph / 2);
  } else {
    // Sample every 5 minutes across the plot range
    const steps = Math.ceil((vMax - vMin) * 12);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t  = vMin + (i / steps) * (vMax - vMin);
      pts.push({ t, am: amForTarget(target, t, gm0) });
    }

    // Gradient curve — each segment blends smoothly between its endpoint colours
    ctx.lineWidth = 2.5;
    ctx.lineCap   = 'round';
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      if (p0.am === null || p1.am === null) continue;
      if ((p0.am + p1.am) / 2 > AM_MAX) continue;
      const x0 = xPx(p0.t), y0 = yPx(Math.min(p0.am, AM_MAX));
      const x1 = xPx(p1.t), y1 = yPx(Math.min(p1.am, AM_MAX));
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, amColor(Math.min(p0.am, AM_MAX)));
      grad.addColorStop(1, amColor(Math.min(p1.am, AM_MAX)));
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // White dot + airmass value at current time
    if (markerUT >= vMin && markerUT <= vMax) {
      const amNow = amForTarget(target, markerUT, gm0);
      if (amNow !== null && amNow <= AM_MAX) {
        const x = xPx(markerUT), y = yPx(amNow);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fillStyle   = '#ffffff'; ctx.fill();
        ctx.strokeStyle = '#bd93f9'; ctx.lineWidth = 1.5; ctx.stroke();
        const rSide  = x > PL + pw - 46;
        const labelX = rSide ? x - 9 : x + 9;
        ctx.fillStyle = '#ffffff';
        ctx.font      = 'bold 12px monospace';
        ctx.textAlign = rSide ? 'right' : 'left';
        // Flip below the dot when drawing above would clip the top margin
        if (y - 14 >= PT) {
          ctx.textBaseline = 'bottom';
          ctx.fillText(amNow.toFixed(2), labelX, y - 2);
        } else {
          ctx.textBaseline = 'top';
          ctx.fillText(amNow.toFixed(2), labelX, y + 6);
        }
      }
    }
  }

  ctx.restore(); // end curve clip

  // ── Plot border ────────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(65,65,110,0.9)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(PL, PT, pw, ph);

  // ── Y-axis label ───────────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(9, PT + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle    = 'rgba(110,110,165,0.75)';
  ctx.font         = '12px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AIRMASS', 0, 0);
  ctx.restore();

  // ── Cursor hairline ───────────────────────────────────────────────────────
  if (_amCursorX !== null) {
    const cx = _amCursorX;
    if (cx >= PL && cx <= PL + pw) {
      const t = vMin + (cx - PL) / pw * (vMax - vMin);

      // Vertical hairline
      ctx.strokeStyle = 'rgba(200,200,255,0.50)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, PT);
      ctx.lineTo(cx, PT + ph);
      ctx.stroke();
      ctx.setLineDash([]);

      // UT time label inside plot bottom edge
      const tMod = ((t % 24) + 24) % 24;
      const hh   = Math.floor(tMod);
      const mm   = Math.floor((tMod - hh) * 60);
      const timeLabel = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ' UT';
      const onLeft = cx < PL + pw / 2;
      ctx.fillStyle    = 'rgba(200,200,255,0.75)';
      ctx.font         = '12px monospace';
      ctx.textAlign    = onLeft ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(timeLabel, onLeft ? cx + 3 : cx - 3, PT + ph - 4);

      // Airmass dot + label for selected target
      if (target) {
        const amC = amForTarget(target, t, gm0);
        if (amC !== null && amC <= AM_MAX) {
          const y = yPx(Math.min(amC, AM_MAX));
          ctx.beginPath();
          ctx.arc(cx, y, 4, 0, 2 * Math.PI);
          ctx.fillStyle   = amColor(amC);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth   = 1;
          ctx.stroke();
          // Airmass readout — follows cursor x, floats above the dot
          // (flips below if the dot is too close to the top edge)
          const amStr = amC.toFixed(2);
          ctx.font    = 'bold 12px monospace';
          const amPad = 4;
          const amBW  = ctx.measureText(amStr).width + amPad * 2;
          const amBH  = 16 + amPad * 2;
          const amBX  = Math.max(PL, Math.min(cx - amBW / 2, PL + pw - amBW));
          const amBY  = (y - amBH - 8 >= PT) ? y - amBH - 8 : y + 8;
          ctx.fillStyle   = 'rgba(15,12,30,0.82)';
          ctx.fillRect(amBX, amBY, amBW, amBH);
          ctx.strokeStyle = amColor(amC);
          ctx.lineWidth   = 1;
          ctx.strokeRect(amBX, amBY, amBW, amBH);
          ctx.fillStyle    = amColor(amC);
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(amStr, amBX + amBW / 2, amBY + amBH / 2);
        }
      }
    }
  }
}


// ── Add Single Target modal ───────────────────────────────────────────────────

function openAddTargetModal() {
  // Clear fields and validation state
  ['atf-name','atf-ra','atf-dec','atf-pmra','atf-pmdec','atf-prop-ra','atf-prop-dec','atf-notes'].forEach(id => {
    const inp = el(id);
    inp.value = '';
    inp.classList.remove('atf-valid', 'atf-invalid');
  });
  const epoch = el('atf-epoch');
  epoch.value = '2000';
  epoch.classList.remove('atf-valid', 'atf-invalid');
  el('atf-submit-btn').disabled = true;
  const sBtn = el('atf-simbad-btn');
  sBtn.disabled    = true;
  sBtn.textContent = '🔍';
  sBtn.style.color = '';
  // Ensure we start in edit mode (not result mode)
  _simbadPending = null;
  el('atf-result').classList.add('hidden');
  el('atf-result-footer').classList.add('hidden');
  el('add-target-form').classList.remove('hidden');
  el('atf-edit-footer').classList.remove('hidden');
  el('add-target-modal').classList.remove('hidden');
  el('atf-name').focus();
}

function closeAddTargetModal() {
  el('add-target-modal').classList.add('hidden');
  _simbadPending = null;
}

function _atfValidateRA(val) {
  if (!val) return null;
  const m = val.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d*)?)$/);
  if (!m)      return 'Invalid syntax — expected HH:MM:SS.ss';
  const h = +m[1], mn = +m[2], s = parseFloat(m[3]);
  if (h  > 23) return 'Impossible RA — hours must be 0–23';
  if (mn > 59) return 'Impossible RA — minutes must be 0–59';
  if (s  >= 60) return 'Impossible RA — seconds must be 0–59.9…';
  return true;
}

function _atfValidateDec(val) {
  if (!val) return null;
  const m = val.match(/^([+-]?)(\d{1,2}):(\d{2}):(\d{2}(?:\.\d*)?)$/);
  if (!m) return 'Invalid syntax — expected ±DD:MM:SS.s';
  const d = +m[2], mn = +m[3], s = parseFloat(m[4]);
  if (mn > 59)                     return 'Impossible Dec — minutes must be 0–59';
  if (s  >= 60)                    return 'Impossible Dec — seconds must be 0–59.9…';
  if (d + mn/60 + s/3600 > 90)    return 'Impossible Dec — magnitude cannot exceed 90°';
  return true;
}

function _atfValidateEpoch(val) {
  if (!val) return null;
  return /^[JB]?\d{4}(\.\d+)?$/.test(val)
    ? true : 'Invalid epoch — expected e.g. 2000, J2000, B1950';
}

function _atfValidateRate(val) {
  if (!val) return null;
  return /^[+-]?\d+(\.\d+)?$/.test(val)
    ? true : 'Invalid rate — expected a numeric value (e.g. 0.5, −1.2)';
}

function _atfMark(id, result) {
  const inp = el(id);
  inp.classList.toggle('atf-valid',   result === true);
  inp.classList.toggle('atf-invalid', typeof result === 'string');
  inp._atfError = typeof result === 'string' ? result : '';
}

function _atfShowTooltip(inp) {
  if (!inp._atfError) return;
  const tip  = el('atf-tooltip');
  const rect = inp.getBoundingClientRect();
  const zoom = parseFloat(localStorage.getItem('facsum_zoom') || '1.0');
  tip.textContent = inp._atfError;
  tip.style.left  = (rect.left  / zoom) + 'px';
  tip.style.top   = (rect.bottom / zoom + 4) + 'px';
  tip.classList.remove('hidden');
}

function _atfHideTooltip() {
  el('atf-tooltip').classList.add('hidden');
}

function _atfBindTooltips() {
  ['atf-name','atf-ra','atf-dec','atf-epoch','atf-pmra','atf-pmdec','atf-prop-ra','atf-prop-dec','atf-notes'].forEach(id => {
    const inp = el(id);
    inp.addEventListener('mouseenter', () => _atfShowTooltip(inp));
    inp.addEventListener('mouseleave', _atfHideTooltip);
  });
}

function _atfUpdateSubmit() {
  const nameOk  = el('atf-name').value.trim() !== '';
  const raOk    = _atfValidateRA(el('atf-ra').value.trim())   === true;
  const decOk   = _atfValidateDec(el('atf-dec').value.trim()) === true;
  el('atf-submit-btn').disabled = !(nameOk && raOk && decOk);
}

function _atfFormatLine(name, ra, dec, epoch, pmRA, pmDec, propRA, propDec, notes) {
  const n  = name.includes(',') ? `"${name}"` : name;
  const ep = epoch || '2000';
  const parts = [n, ra, dec, ep];
  if (pmRA || pmDec || propRA || propDec) {
    parts.push(pmRA || '0', pmDec || '0');
    if (propRA || propDec) parts.push(propRA || '0', propDec || '0');
  }
  let line = parts.join(',');
  if (notes) line += ' !' + notes;
  return line;
}

function _atfSubmit() {
  const name   = el('atf-name').value.trim();
  const ra     = el('atf-ra').value.trim();
  const dec    = el('atf-dec').value.trim();
  const epoch  = el('atf-epoch').value.trim();
  const pmRA   = el('atf-pmra').value.trim();
  const pmDec  = el('atf-pmdec').value.trim();
  const propRA = el('atf-prop-ra').value.trim();
  const propDec= el('atf-prop-dec').value.trim();
  const notes  = el('atf-notes').value.trim();

  // Final required-field validation
  if (!name || _atfValidateRA(ra) !== true || _atfValidateDec(dec) !== true) return;

  const line = _atfFormatLine(name, ra, dec, epoch, pmRA, pmDec, propRA, propDec, notes);
  const ta   = el('targets-text');
  const existing = ta.value.trimEnd();
  ta.value = existing ? existing + '\n' + line : line;
  loadTargetText(ta.value, _lastLoadedFilename);
  closeAddTargetModal();
}

// ── SIMBAD lookup ─────────────────────────────────────────────────────────────

let _simbadPending = null;   // result stored while the confirm card is visible

function _degToRA(deg) {
  const h  = deg / 15;
  const hh = Math.floor(h);
  const r1 = (h - hh) * 60;
  const mm = Math.floor(r1);
  const ss = (r1 - mm) * 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${ss.toFixed(2).padStart(5,'0')}`;
}

function _degToDec(deg) {
  const sign = deg < 0 ? '-' : '+';
  const abs  = Math.abs(deg);
  const dd   = Math.floor(abs);
  const r1   = (abs - dd) * 60;
  const mm   = Math.floor(r1);
  const ss   = (r1 - mm) * 60;
  return `${sign}${String(dd).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${ss.toFixed(1).padStart(4,'0')}`;
}

function _atfShowResultCard(pending) {
  el('atfr-hdr-text').textContent = 'Object matched';
  el('atfr-accept-btn').classList.remove('hidden');
  el('atfr-edit-btn').textContent = '← Edit';

  el('atfr-grid').classList.remove('hidden');
  el('atfr-err-block').classList.add('hidden');

  el('atfr-name').textContent  = pending.name;
  el('atfr-ra').textContent    = pending.ra;
  el('atfr-dec').textContent   = pending.dec;
  el('atfr-epoch').textContent = pending.epoch;

  const pmRA  = el('atfr-prop-ra');
  const pmDec = el('atfr-prop-dec');
  if (pending.propRA) {
    pmRA.textContent = pending.propRA + ' mas/yr';
    pmRA.classList.remove('dim');
  } else {
    pmRA.textContent = '—';
    pmRA.classList.add('dim');
  }
  if (pending.propDec) {
    pmDec.textContent = pending.propDec + ' mas/yr';
    pmDec.classList.remove('dim');
  } else {
    pmDec.textContent = '—';
    pmDec.classList.add('dim');
  }

  el('add-target-form').classList.add('hidden');
  el('atf-edit-footer').classList.add('hidden');
  el('atf-result').classList.remove('hidden');
  el('atf-result-footer').classList.remove('hidden');
}

function _atfShowErrorCard(friendly, technical) {
  el('atfr-hdr-text').textContent = 'Not found';
  el('atfr-accept-btn').classList.add('hidden');
  el('atfr-edit-btn').textContent = '← Back';

  el('atfr-grid').classList.add('hidden');
  el('atfr-err-block').classList.remove('hidden');

  el('atfr-err-msg').textContent = friendly || 'Query failed';

  const details = el('atfr-err-details');
  if (technical) {
    el('atfr-err-raw').textContent = technical;
    details.classList.remove('hidden');
    details.removeAttribute('open');
  } else {
    details.classList.add('hidden');
  }

  el('add-target-form').classList.add('hidden');
  el('atf-edit-footer').classList.add('hidden');
  el('atf-result').classList.remove('hidden');
  el('atf-result-footer').classList.remove('hidden');

  _simbadPending = null;
}

function _atfAcceptResult() {
  if (!_simbadPending) return;
  const p    = _simbadPending;
  const line = _atfFormatLine(p.name, p.ra, p.dec, p.epoch, '', '', p.propRA, p.propDec, '');
  const ta   = el('targets-text');
  const existing = ta.value.trimEnd();
  ta.value = existing ? existing + '\n' + line : line;
  loadTargetText(ta.value, _lastLoadedFilename);
  _simbadPending = null;
  closeAddTargetModal();
}

function _atfEditResult() {
  if (_simbadPending) {
    const p = _simbadPending;
    el('atf-ra').value       = p.ra;
    el('atf-dec').value      = p.dec;
    el('atf-epoch').value    = p.epoch;
    el('atf-prop-ra').value  = p.propRA;
    el('atf-prop-dec').value = p.propDec;
    _atfMark('atf-ra',    _atfValidateRA(p.ra));
    _atfMark('atf-dec',   _atfValidateDec(p.dec));
    _atfMark('atf-epoch', true);
    _atfUpdateSubmit();
  }
  // Always restore the SIMBAD button (covers both success-edit and error-back paths).
  const sBtn = el('atf-simbad-btn');
  sBtn.disabled    = !el('atf-name').value.trim();
  sBtn.textContent = '🔍';
  sBtn.style.color = '';

  el('atf-result').classList.add('hidden');
  el('atf-result-footer').classList.add('hidden');
  el('add-target-form').classList.remove('hidden');
  el('atf-edit-footer').classList.remove('hidden');
}

async function _atfSimbadQuery() {
  const name = el('atf-name').value.trim();
  if (!name) return;

  const btn = el('atf-simbad-btn');
  btn.disabled    = true;
  btn.textContent = '…';
  btn.style.color = '';

  try {
    const resp = await fetch(`simbad_proxy.php?name=${encodeURIComponent(name)}`);
    const raw  = await resp.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      _atfShowErrorCard('Server error', `HTTP ${resp.status} — proxy returned non-JSON`);
      return;
    }

    if (data.error) {
      const technical = data.error + (data.raw ? '\n\n' + data.raw : '');
      _atfShowErrorCard(data.friendly || 'Target not found', technical);
      return;
    }

    _simbadPending = {
      name:    name,
      ra:      _degToRA(data.ra_deg),
      dec:     _degToDec(data.dec_deg),
      epoch:   '2000',
      propRA:  data.pmra  != null ? Number(data.pmra).toFixed(3)  : '',
      propDec: data.pmdec != null ? Number(data.pmdec).toFixed(3) : '',
    };

    _atfShowResultCard(_simbadPending);

  } catch (err) {
    _atfShowErrorCard('Connection error', err.message || 'network unreachable');
  }
}

// ── SFTP browser ──────────────────────────────────────────────────────────────

const SFTP_START = '/observer/observer/targets';

let _sftpCwd            = '';
let _sftpSelected       = null;
let _sftpMode           = 'open';   // 'open' | 'save'
let _lastLoadedFilename = '';

function openSftpModal() {
  _sftpMode = 'open';
  _sftpSelected = null;
  el('sftp-save-bar').classList.add('hidden');
  el('sftp-open-btn').textContent = 'Open';
  el('sftp-modal').classList.remove('hidden');
  el('sftp-search').focus();
  sftp_list(_sftpLastDir || SFTP_START);
}

function openSftpSaveModal() {
  _sftpMode = 'save';
  _sftpSelected = null;
  el('sftp-save-bar').classList.remove('hidden');
  el('sftp-open-btn').textContent = 'Save Here';
  el('sftp-filename').value = _lastLoadedFilename;
  el('sftp-modal').classList.remove('hidden');
  el('sftp-search').focus();
  sftp_list(_sftpLastDir || SFTP_START);
}

function closeSftpModal() {
  el('sftp-modal').classList.add('hidden');
}

function setSftpStatus(msg) {
  set('sftp-status', msg);
}

// Used only for in-browser navigation (Up, double-click dir) — creds are
// always in the session at this point, so no credential handling needed here.
function sftp_list(path) {
  setSftpStatus('Loading…');
  el('sftp-tbody').innerHTML = '';

  api({ action: 'local_list', path })
    .then(data => {
      if (!data.ok) {
        setSftpStatus('Error: ' + (data.error || 'Unknown error'));
        return;
      }
      renderSftpList(data.path, data.entries);
    })
    .catch(err => setSftpStatus('Request failed: ' + err));
}

function renderSftpList(path, entries) {
  _sftpCwd      = path;
  _sftpSelected = null;
  _sftpLastDir  = path;
  _sftpEntries  = entries;
  _sftpSortCol  = 'name';  // reset sort on new directory
  _sftpSortDir  = 1;
  set('sftp-path', path);
  el('sftp-search').value = '';  // reset filter on every navigation
  el('sftp-up-btn').disabled = (path === SFTP_START);
  renderSftpRows();
}

function renderSftpRows() {
  const sorted = [..._sftpEntries].sort((a, b) => {
    // Dirs always first regardless of sort column or direction
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let va, vb;
    switch (_sftpSortCol) {
      case 'size':  va = a.size || 0; vb = b.size || 0; break;
      case 'mtime': va = a.mtime || ''; vb = b.mtime || ''; break;
      default:      va = String(a.name ?? '').toLowerCase(); vb = String(b.name ?? '').toLowerCase(); break;
    }
    if (typeof va === 'string') return _sftpSortDir * va.localeCompare(vb);
    return _sftpSortDir * (va - vb);
  });

  const tbody = el('sftp-tbody');
  tbody.innerHTML = '';

  sorted.forEach(e => {
    const fullPath = _sftpCwd.replace(/\/$/, '') + '/' + e.name;
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = e.is_dir ? '[dir]  ' + e.name : e.name;
    if (e.is_dir) nameCell.classList.add('orange');

    const sizeCell = document.createElement('td');
    sizeCell.textContent = humanSize(e.size);
    sizeCell.className = 'right';

    const mtimeCell = document.createElement('td');
    mtimeCell.textContent = e.mtime;

    tr.appendChild(nameCell);
    tr.appendChild(sizeCell);
    tr.appendChild(mtimeCell);

    tr.addEventListener('click', () => {
      document.querySelectorAll('#sftp-tbody tr').forEach(r =>
        r.classList.remove('selected'));
      tr.classList.add('selected');
      _sftpSelected = { path: fullPath, isDir: e.is_dir };
      if (_sftpMode === 'save' && !e.is_dir) el('sftp-filename').value = e.name;
    });

    tr.addEventListener('dblclick', () => {
      if (e.is_dir) {
        sftp_list(fullPath);
      } else if (_sftpMode === 'save') {
        el('sftp-filename').value = e.name;
      } else {
        sftp_open(fullPath);
      }
    });

    tbody.appendChild(tr);
  });

  const nFiles = _sftpEntries.filter(e => !e.is_dir).length;
  const nDirs  = _sftpEntries.filter(e =>  e.is_dir).length;
  setSftpStatus(`${nFiles} file(s), ${nDirs} folder(s)`);
  updateSftpSortIndicators();
  filterSftpList();  // re-apply any active search filter
}

function updateSftpSortIndicators() {
  document.querySelectorAll('#sftp-tbl th[data-col]').forEach(th => {
    if (th.dataset.col === _sftpSortCol) {
      th.dataset.sort = _sftpSortDir === 1 ? 'asc' : 'desc';
    } else {
      delete th.dataset.sort;
    }
  });
}

function filterSftpList() {
  const query = el('sftp-search').value.toLowerCase();
  let shown = 0;
  document.querySelectorAll('#sftp-tbody tr').forEach(tr => {
    const name = (tr.querySelector('td')?.textContent || '').toLowerCase();
    const visible = !query || name.includes(query);
    tr.style.display = visible ? '' : 'none';
    if (visible) shown++;
    // Deselect items that become hidden
    if (!visible && tr.classList.contains('selected')) {
      tr.classList.remove('selected');
      _sftpSelected = null;
    }
  });
  if (query) setSftpStatus(`${shown} match(es)`);
}

function sftp_up() {
  if (_sftpCwd === SFTP_START) return;
  const parent = _sftpCwd.replace(/\/[^/]+\/?$/, '') || '/';
  sftp_list(parent.startsWith(SFTP_START) ? parent : SFTP_START);
}

function sftp_open(path) {
  setSftpStatus('Reading file…');
  api({ action: 'local_get', path }).then(data => {
    if (!data.ok) { setSftpStatus('Error: ' + data.error); return; }
    closeSftpModal();
    loadTargetText(data.content, path.split('/').pop());
  }).catch(err => setSftpStatus('Request failed: ' + err));
}

function sftp_save(dir, filename) {
  const path    = dir.replace(/\/$/, '') + '/' + filename;
  const content = el('targets-text').value;
  setSftpStatus('Saving…');
  api({ action: 'local_save', path, content }).then(data => {
    if (!data.ok) { setSftpStatus('Error: ' + data.error); return; }
    _lastLoadedFilename = filename;
    closeSftpModal();
  }).catch(err => setSftpStatus('Save failed: ' + err));
}


// ── Wire up events ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Parse controls — re-parse table whenever any option changes
  document.querySelectorAll('input[name="ftype"], input[name="delim"]').forEach(r =>
    r.addEventListener('change', parseTextToTable));

  // Rate units — update column headers (no re-parse needed; values don't change)
  el('rate-units').addEventListener('change', updateRateHeaders);
  updateRateHeaders();   // set headers on first load
  renderTargetRows();    // show the "+ Load Target List" empty-state invite on first load
  el('delim-other').addEventListener('input', () => {
    // Auto-select "Other" radio when user types in the custom field
    document.querySelector('input[name="delim"][value="other"]').checked = true;
    parseTextToTable();
  });

  // Target table — sortable column headers
  document.querySelectorAll('#targets-tbl th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (_sortCol === col) {
        if (_sortDir === -1) {
          _sortCol = null;        // third click → reset to original order
        } else {
          _sortDir = -1;          // second click → descending
        }
      } else {
        _sortCol = col;
        _sortDir = 1;             // new column → start ascending
      }
      renderTargetRows();
    });
  });

  // SFTP table — sortable column headers
  document.querySelectorAll('#sftp-tbl th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (_sftpSortCol === col) {
        _sftpSortDir *= -1;
      } else {
        _sftpSortCol = col;
        _sftpSortDir = 1;
      }
      renderSftpRows();
    });
  });

  // Load / Save / Add Target buttons
  el('add-target-btn').addEventListener('click', openSftpModal);
  el('no-targets-btn').addEventListener('click', openSftpModal);
  el('add-single-target-btn').addEventListener('click', openAddTargetModal);
  el('delete-single-target-btn').addEventListener('click', deleteSelectedTarget);
  el('clear-target-btn').addEventListener('click', clearTargetList);

  // Add Single Target modal — blur validation + submit
  el('atf-name').addEventListener('blur',  () => { const v = el('atf-name').value.trim(); _atfMark('atf-name', v ? true : 'Name is required'); _atfUpdateSubmit(); });
  el('atf-name').addEventListener('input', () => {
    el('atf-simbad-btn').disabled = !el('atf-name').value.trim();
    _atfUpdateSubmit();
  });
  el('atf-simbad-btn').addEventListener('click', _atfSimbadQuery);
  el('atfr-accept-btn').addEventListener('click', _atfAcceptResult);
  el('atfr-edit-btn').addEventListener('click',   _atfEditResult);
  el('atf-ra').addEventListener('blur',    () => { _atfMark('atf-ra',    _atfValidateRA(el('atf-ra').value.trim()));   _atfUpdateSubmit(); });
  el('atf-ra').addEventListener('input',   _atfUpdateSubmit);
  el('atf-dec').addEventListener('blur',   () => { _atfMark('atf-dec',   _atfValidateDec(el('atf-dec').value.trim())); _atfUpdateSubmit(); });
  el('atf-dec').addEventListener('input',  _atfUpdateSubmit);
  el('atf-epoch').addEventListener('blur', () => _atfMark('atf-epoch', _atfValidateEpoch(el('atf-epoch').value.trim())));
  el('atf-pmra').addEventListener('blur',     () => _atfMark('atf-pmra',     _atfValidateRate(el('atf-pmra').value.trim())));
  el('atf-pmdec').addEventListener('blur',    () => _atfMark('atf-pmdec',    _atfValidateRate(el('atf-pmdec').value.trim())));
  el('atf-prop-ra').addEventListener('blur',  () => _atfMark('atf-prop-ra',  _atfValidateRate(el('atf-prop-ra').value.trim())));
  el('atf-prop-dec').addEventListener('blur', () => _atfMark('atf-prop-dec', _atfValidateRate(el('atf-prop-dec').value.trim())));
  el('atf-submit-btn').addEventListener('click', _atfSubmit);
  el('add-target-modal').addEventListener('keyup', e => { if (e.key === 'Enter' && !el('atf-submit-btn').disabled) _atfSubmit(); });
  _atfBindTooltips();

  // Load to Telescope button
  el('load-tcs-btn').addEventListener('click', loadToTelescope);

  // Undo / Redo buttons for the text editor
  el('undo-text-btn').addEventListener('click', () => {
    el('targets-text').focus();
    document.execCommand('undo');
    highlightTargetText();
  });
  el('redo-text-btn').addEventListener('click', () => {
    el('targets-text').focus();
    document.execCommand('redo');
    highlightTargetText();
  });

  // Parse Text button — re-parse textarea and switch to table view
  el('parse-text-btn').addEventListener('click', () => {
    parseTextToTable();
    switchTab('table');
  });

  // Live syntax highlighting as user edits
  el('targets-text').addEventListener('input', highlightTargetText);

  // Keep highlight backdrop scrolled in sync with textarea
  el('targets-text').addEventListener('scroll', () => {
    el('targets-highlight').scrollTop  = el('targets-text').scrollTop;
    el('targets-highlight').scrollLeft = el('targets-text').scrollLeft;
  });

  // SFTP search — filter rows on every keystroke
  el('sftp-search').addEventListener('input', filterSftpList);

  // SFTP modal: Up button
  el('sftp-up-btn').addEventListener('click', sftp_up);

  // SFTP modal: Open / Save Here button
  el('sftp-open-btn').addEventListener('click', () => {
    if (_sftpMode === 'save') {
      const filename = el('sftp-filename').value.trim();
      if (filename) sftp_save(_sftpCwd, filename);
    } else if (_sftpSelected && !_sftpSelected.isDir) {
      sftp_open(_sftpSelected.path);
    }
  });

  // Add Target / Save Target buttons
  el('save-target-btn').addEventListener('click', openSftpSaveModal);

  // Close modals on overlay click
  el('sftp-modal').addEventListener('click', e => {
    if (e.target === el('sftp-modal')) closeSftpModal();
  });

  // Connect/disconnect button
  el('conn-btn').addEventListener('click', toggleConnection);

  // Zoom control
  (function () {
    const ZOOM_KEY  = 'facsum_zoom';
    const ZOOM_MIN  = 0.5;
    const ZOOM_MAX  = 2.0;
    const ZOOM_STEP = 0.1;

    function applyZoom(z) {
      z = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 10) / 10;
      localStorage.setItem(ZOOM_KEY, String(z));
      const h = document.documentElement;
      h.style.transform       = 'scale(' + z + ')';
      h.style.transformOrigin = '0 0';
      h.style.width           = (100 / z) + 'vw';
      h.style.height          = (100 / z) + 'vh';
      const lbl = document.getElementById('zoom-label');
      if (lbl) lbl.textContent = Math.round(z * 100) + '%';
    }

    applyZoom(parseFloat(localStorage.getItem(ZOOM_KEY) || '1.5'));

    const zIn  = document.getElementById('zoom-in-btn');
    const zOut = document.getElementById('zoom-out-btn');
    if (zIn)  zIn.addEventListener('click',  () => applyZoom(parseFloat(localStorage.getItem(ZOOM_KEY) || '1.0') + ZOOM_STEP));
    if (zOut) zOut.addEventListener('click', () => applyZoom(parseFloat(localStorage.getItem(ZOOM_KEY) || '1.0') - ZOOM_STEP));
  })();

  // Disconnect from TCS when tab is closed or navigated away
  window.addEventListener('beforeunload', () => {
    if (_connected) {
      navigator.sendBeacon('api.php?action=disconnect');
    }
  });

  // Intentionally no visibilitychange handler: observers routinely switch to other
  // apps (TCS, terminal) and must not lose their connection on tab switch.

  // Auto-connect on page load
  setTimeout(connect, 500);

  // Sky display — initial draw + resize observer + toggles
  drawSky();
  drawAirmassPlt();
  if (window.ResizeObserver) {
    new ResizeObserver(() => { drawSky(); drawAirmassPlt(); }).observe(el('sky-canvas').parentElement);
  }
  el('sky-show-labels').addEventListener('change', drawSky);
  el('sky-show-allsky').addEventListener('change', drawSky);
  el('sky-show-moon').addEventListener('change', () => { drawSky(); drawAirmassPlt(); });
  el('sky-show-planets').addEventListener('change', drawSky);
  function setSkyTargetMode(mode) {
    _skyTargetMode = mode;
    el('stt-switch').classList.toggle('on', mode === 'selected');
    el('stt-switch').setAttribute('aria-checked', mode === 'selected' ? 'true' : 'false');
    el('stt-opt-all').classList.toggle('active', mode === 'all');
    el('stt-opt-selected').classList.toggle('active', mode === 'selected');
    drawSky();
  }
  el('stt-switch').addEventListener('click', () =>
    setSkyTargetMode(_skyTargetMode === 'all' ? 'selected' : 'all'));
  el('stt-opt-all').addEventListener('click', () => setSkyTargetMode('all'));
  el('stt-opt-selected').addEventListener('click', () => setSkyTargetMode('selected'));
  // Sync input fields to whatever was loaded from localStorage (may differ from HTML defaults)
  el('allsky-rotation').value = ALLSKY_ROTATION_DEG;
  el('allsky-scale').value    = ALLSKY_SCALE;

  el('allsky-rotation').addEventListener('input', () => {
    ALLSKY_ROTATION_DEG = parseFloat(el('allsky-rotation').value) || 0;
    localStorage.setItem('allsky_rotation', ALLSKY_ROTATION_DEG);
    drawSky();
  });
  el('allsky-scale').addEventListener('input', () => {
    ALLSKY_SCALE = parseFloat(el('allsky-scale').value) || 1.0;
    localStorage.setItem('allsky_scale', ALLSKY_SCALE);
    drawSky();
  });
  document.addEventListener('click', e => {
    document.querySelectorAll('.sky-bodies-details').forEach(d => {
      if (d.open && !d.contains(e.target)) d.removeAttribute('open');
    });
  });
  el('airmass-section').addEventListener('toggle', () => {
    el('resize-am-handle').style.display = el('airmass-section').open ? '' : 'none';
    drawAirmassPlt();
  });

  // Sky zoom buttons
  function skyZoomApply(newZoom) {
    _skyZoom = Math.max(1, Math.min(20, newZoom));
    if (_skyZoom <= 1) { _skyPanX = 0; _skyPanY = 0; }
    else {
      const maxPan = _skyZoom - 1;
      _skyPanX = Math.max(-maxPan, Math.min(maxPan, _skyPanX));
      _skyPanY = Math.max(-maxPan, Math.min(maxPan, _skyPanY));
    }
    drawSky();
  }
  el('sky-zoom-in').addEventListener('click',   () => skyZoomApply(_skyZoom * 1.6));
  el('sky-zoom-out').addEventListener('click',  () => skyZoomApply(_skyZoom / 1.6));
  el('sky-zoom-home').addEventListener('click', () => { _skyZoom = 1; _skyPanX = 0; _skyPanY = 0; drawSky(); });

  // Sky canvas drag-to-pan (when zoomed in)
  {
    let dragActive = false, dragLastX = 0, dragLastY = 0;
    const skyCanvas = el('sky-canvas');
    skyCanvas.addEventListener('mousedown', e => {
      if (_skyZoom <= 1) return;
      dragActive = true;
      dragLastX  = e.clientX;
      dragLastY  = e.clientY;
      skyCanvas.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragActive) return;
      const R = skyCanvas.width / 2 - 22;
      const dx = (e.clientX - dragLastX) / R;
      const dy = (e.clientY - dragLastY) / R;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      _skyPanX += dx;
      _skyPanY += dy;
      const maxPan = _skyZoom - 1;
      _skyPanX = Math.max(-maxPan, Math.min(maxPan, _skyPanX));
      _skyPanY = Math.max(-maxPan, Math.min(maxPan, _skyPanY));
      drawSky();
    });
    document.addEventListener('mouseup', () => {
      if (!dragActive) return;
      dragActive = false;
      skyCanvas.style.cursor = _skyZoom > 1 ? 'grab' : '';
    });
  }

  // Airmass plot cursor tracking
  el('airmass-canvas').addEventListener('mousedown', e => {
    _amDragStartX = e.offsetX;
    _amDragPanAt  = _amPanHours;
    _amDragging   = false;
    e.preventDefault();
  });
  el('airmass-canvas').addEventListener('mousemove', e => {
    if (_amDragStartX !== null) {
      const dx = e.offsetX - _amDragStartX;
      if (!_amDragging && Math.abs(dx) > 4) _amDragging = true;
      if (_amDragging) {
        _amPanHours = _amDragPanAt - dx * (_amNightSpan / _amPW);
        _amCursorX  = null; _amCursorY = null;
        el('airmass-canvas').style.cursor = 'grabbing';
        drawAirmassPlt();
        return;
      }
    }
    _amCursorX = e.offsetX;
    _amCursorY = e.offsetY;
    drawAirmassPlt();
  });
  el('airmass-canvas').addEventListener('mouseleave', () => {
    _amCursorX = null;
    _amCursorY = null;
    if (!_amDragging) drawAirmassPlt();
  });
  window.addEventListener('mouseup', () => {
    if (_amDragStartX !== null) {
      _amDragStartX = null;
      _amDragging   = false;
      drawAirmassPlt();
    }
  });
  el('am-home-btn').addEventListener('click', () => {
    _amPanHours = 0;
    drawAirmassPlt();
  });

  // All-sky camera — start polling immediately (30 s interval)
  startAllSky();

  // ── Horizontal pane resize (left-col ↔ sky-panel) ────────────────────────
  const resizeHandle = el('resize-handle');
  const leftCol      = document.querySelector('.left-col');

  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const zoom       = parseFloat(localStorage.getItem('facsum_zoom') || '1.0');
    const startX     = e.clientX;
    const startWidth = leftCol.getBoundingClientRect().width / zoom;
    resizeHandle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'col-resize';

    function onMove(e) {
      const newWidth = Math.max(320, startWidth + (e.clientX - startX) / zoom);
      leftCol.style.flex  = 'none';
      leftCol.style.width = newWidth + 'px';
    }

    function onUp() {
      resizeHandle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Airmass plot resize ────────────────────────────────────────────────────
  const resizeAmHandle = el('resize-am-handle');
  const airmassWrap    = document.querySelector('.airmass-wrap');

  resizeAmHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const zoom        = parseFloat(localStorage.getItem('facsum_zoom') || '1.0');
    const startY      = e.clientY;
    const startHeight = airmassWrap.getBoundingClientRect().height / zoom;
    resizeAmHandle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'row-resize';

    function onMove(e) {
      const newHeight = Math.max(80, startHeight - (e.clientY - startY) / zoom);
      airmassWrap.style.height = newHeight + 'px';
      drawAirmassPlt();
    }

    function onUp() {
      resizeAmHandle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Hardware section collapse — clear manual height so targets panel expands
  el('hw-section')?.addEventListener('toggle', () => {
    el('telemetry-panel').style.height = '';
  });

  // ── Vertical pane resize (telemetry ↔ targets) ────────────────────────────
  const resizeYHandle = el('resize-y-handle');
  const telemPanel    = el('telemetry-panel');

  resizeYHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const zoom        = parseFloat(localStorage.getItem('facsum_zoom') || '1.0');
    const startY      = e.clientY;
    const startHeight = telemPanel.getBoundingClientRect().height / zoom;
    resizeYHandle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'row-resize';

    function onMove(e) {
      const newHeight = Math.max(80, startHeight + (e.clientY - startY) / zoom);
      telemPanel.style.flexShrink = '0';
      telemPanel.style.height     = newHeight + 'px';
    }

    function onUp() {
      resizeYHandle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
});
