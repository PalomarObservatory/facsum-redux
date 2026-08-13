<?php require_once __DIR__ . '/includes/config.php'; ?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Palomar Observatory FACSUM</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>

<div class="left-col">

<!-- ═══════════════════════════════════════════════════════════════════════════
     TELEMETRY PANEL
════════════════════════════════════════════════════════════════════════════ -->
<div class="panel" id="telemetry-panel">

  <div class="panel-hdr">
    <span class="panel-title">P200 TELEMETRY</span>
    <button id="conn-btn" class="btn-connect" style="margin-right:auto">Connect</button>
    <div class="zoom-ctrl">
      <button id="zoom-out-btn" class="zoom-btn" title="Zoom out">−</button>
      <span id="zoom-label" class="zoom-label">100%</span>
      <button id="zoom-in-btn" class="zoom-btn" title="Zoom in">+</button>
    </div>
    <span id="last-updated" class="dim small"></span>
    <span id="conn-dot"  class="conn-dot red">●</span>
    <span id="conn-text" class="conn-text red">Disconnected</span>
  </div>

  <!-- Hero: OBJECT / RA / DEC stacked left, HA / AIRMASS / LST / UT right -->
  <div class="hero">
    <div class="hero-main">

      <!-- Loaded target block (last sent to TCS) -->
      <div class="hero-pos">
        <div class="field-lbl">LOADED TARGET</div>
        <div class="field-val orange pos-val" id="sel-target">—</div>
        <div class="field-lbl">LOADED RA</div>
        <div class="field-val orange pos-val" id="sel-ra">—</div>
        <div class="field-lbl">LOADED DEC</div>
        <div class="field-val orange pos-val" id="sel-dec">—</div>
        <div class="field-lbl">LOADED EQUINOX</div>
        <div class="field-val orange pos-val pos-val-sm" id="sel-equinox">—</div>
      </div>

      <div class="hero-vsep"></div>

      <!-- Current TCS position block -->
      <div class="hero-pos">
        <div class="field-lbl">CURRENT TARGET</div>
        <div class="field-val cyan pos-val" id="target">—</div>
        <div class="field-lbl">CURRENT RA</div>
        <div class="field-val cyan pos-val" id="ra">—</div>
        <div class="field-lbl">CURRENT DEC</div>
        <div class="field-val cyan pos-val" id="dec">—</div>
        <div class="field-lbl">CURRENT EQUINOX</div>
        <div class="field-val cyan pos-val pos-val-sm" id="equinox">—</div>
      </div>

      <div class="hero-vsep"></div>

      <!-- offsets / rates / focus / cass ring -->
      <div class="hero-r2">
        <div class="key-block">
          <div class="field-lbl">RA OFFSET</div>
          <div class="field-val cyan key-val" id="ra-off">—</div>
        </div>
        <div class="key-block">
          <div class="field-lbl">DEC OFFSET</div>
          <div class="field-val cyan key-val" id="dec-off">—</div>
        </div>
        <div class="key-block">
          <div class="field-lbl">RA RATE</div>
          <div class="field-val cyan key-val" id="ra-rate">—</div>
        </div>
        <div class="key-block">
          <div class="field-lbl">DEC RATE</div>
          <div class="field-val cyan key-val" id="dec-rate">—</div>
        </div>
        <div class="key-block">
          <div class="field-lbl">CASS RING</div>
          <div class="field-val cyan key-val" id="cassring">—</div>
        </div>
        <div class="key-block">
          <div class="field-lbl">FOCUS</div>
          <div class="field-val cyan key-val" id="focus">—</div>
        </div>
      </div><!-- /hero-r2 -->

    </div><!-- /hero-main -->
  </div><!-- /hero -->

  <!-- Time strip: HA / AIRMASS / LST / UT -->
  <div class="corr-strip">
    <div class="corr-accent"></div>
    <div class="corr-inner">
      <div class="corr-block">
        <div class="field-lbl">UT</div>
        <div class="field-val cyan key-val" id="utc">—</div>
      </div>
      <div class="corr-block">
        <div class="field-lbl">LST</div>
        <div class="field-val cyan key-val" id="lst">—</div>
      </div>
      <div class="corr-vsep"></div>
      <div class="corr-block">
        <div class="field-lbl">HA</div>
        <div class="field-val cyan key-val" id="ha">—</div>
      </div>
      <div class="corr-block">
        <div class="field-lbl">AIRMASS</div>
        <div class="field-val cyan key-val" id="airmass">—</div>
      </div>
    </div>
  </div>

  <div class="status-bar">
    <span id="status-text">Starting…</span>
  </div>

</div><!-- /telemetry-panel -->

<div id="resize-y-handle" class="resize-y-handle"></div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TARGET LISTS
════════════════════════════════════════════════════════════════════════════ -->
<div class="panel" id="targets-panel">

  <div class="panel-hdr">
    <span class="panel-title">TARGET LISTS</span>
    <button id="add-target-btn" class="btn-remote">+ Load Target List</button>
    <button id="save-target-btn" class="btn-remote" disabled>Save Target List</button>
    <span id="list-name-display" class="list-name-display">Target List: <span id="list-name-file">—</span></span>
  </div>

  <div class="tab-row">
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="table">Targets Table</button>
      <button class="tab-btn"        data-tab="edit">Edit Text</button>
    </div>
  </div>

  <!-- Parse options strip -->
  <div class="parse-strip" id="parse-strip">

    <fieldset class="parse-group">
      <legend>FILE TYPE</legend>
      <label class="parse-radio"><input type="radio" name="ftype" value="auto" checked> Auto-detect</label>
      <label class="parse-radio"><input type="radio" name="ftype" value="csv"> CSV</label>
      <label class="parse-radio"><input type="radio" name="ftype" value="ptic"> PTIC</label>
    </fieldset>

    <fieldset class="parse-group">
      <legend>DELIMITER</legend>
      <label class="parse-radio"><input type="radio" name="delim" value="auto" checked> Auto</label>
      <label class="parse-radio"><input type="radio" name="delim" value=","> Comma</label>
      <label class="parse-radio"><input type="radio" name="delim" value=";"> Semicolon</label>
      <label class="parse-radio"><input type="radio" name="delim" value="\t"> Tab</label>
      <label class="parse-radio"><input type="radio" name="delim" value=" "> Space</label>
      <label class="parse-radio"><input type="radio" name="delim" value="other"> Other
        <input type="text" id="delim-other" class="delim-other-input" maxlength="3" placeholder="|">
      </label>
    </fieldset>

    <fieldset class="parse-group">
      <legend>RATE UNITS</legend>
      <select id="rate-units" class="rate-units-select">
        <option value="pm">Proper Motion (0.0001s/yr, 0.001"/yr)</option>
        <option value="track_as" selected>Non-sid Tracking (arcsec/hr, arcsec/hr)</option>
        <option value="track_s">Non-sid Tracking (sec/hr, arcsec/hr)</option>
      </select>
      <label class="parse-radio apply-rates-label" id="apply-rates-label">
        <input type="checkbox" id="apply-rates" checked>
        Apply Rates
      </label>
    </fieldset>

    <span id="parse-detected" class="parse-detected"></span>
  </div>

  <div id="load-tcs-bar" class="hidden">
    <button id="load-tcs-btn">Load to Telescope</button>
  </div>

  <div class="tab-content" id="tab-table">
    <div class="tbl-wrap">
      <table id="targets-tbl" class="no-observed">
        <thead>
          <tr>
            <th class="obs-col" title="Mark as observed">✓</th>
            <th data-col="name">Name</th>
            <th data-col="ra">RA</th>
            <th data-col="dec">Dec</th>
            <th data-col="epoch">Epoch</th>
            <th data-col="airmass">Airmass</th>
            <th data-col="pmRA"  id="th-rate-ra">PM RA</th>
            <th data-col="pmDec" id="th-rate-dec">PM Dec</th>
            <th data-col="notes">Notes</th>
          </tr>
        </thead>
        <tbody id="targets-tbody"></tbody>
      </table>
    </div>
  </div>

  <div class="tab-content hidden" id="tab-edit">
    <div class="edit-wrap">
      <div id="targets-highlight" class="targets-highlight" aria-hidden="true"></div>
      <textarea id="targets-text" spellcheck="false" autocomplete="off" placeholder="# Target list will appear here after loading from observer1"></textarea>
    </div>
    <div class="edit-footer">
      <button id="undo-text-btn" class="btn-remote" title="Undo (Ctrl+Z)">↩ Undo</button>
      <button id="redo-text-btn" class="btn-remote" title="Redo (Ctrl+Y)">↪ Redo</button>
      <span class="edit-sep">|</span>
      <button id="parse-text-btn" class="btn-remote">↺ Parse Text</button>
    </div>
  </div>


  <div class="target-add-bar">
    <button id="add-single-target-btn" class="btn-remote">+ Add Single Target</button>
    <button id="delete-single-target-btn" class="btn-remote" disabled>− Delete Selected</button>
    <span class="edit-sep">|</span>
    <button id="clear-target-btn" class="btn-remote btn-clear" disabled>✕ Clear List</button>
  </div>

</div><!-- /targets-panel -->

</div><!-- /left-col -->

<div id="resize-handle" class="resize-x-handle"></div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SKY DISPLAY PANEL
════════════════════════════════════════════════════════════════════════════ -->
<div class="panel" id="sky-panel">

  <div class="panel-hdr">
    <span class="panel-title">SKY DISPLAY</span>
<label class="parse-radio" style="margin-left:auto">
      <input type="checkbox" id="sky-show-allsky" checked> AllSky
    </label>
    <label class="parse-radio">
      <input type="checkbox" id="sky-show-labels" checked> Labels
    </label>
    <details class="sky-bodies-details">
      <summary class="sky-bodies-btn">Markers</summary>
      <div class="sky-bodies-drop">
        <label class="parse-radio"><input type="checkbox" id="sky-show-moon"    checked> Moon</label>
        <label class="parse-radio"><input type="checkbox" id="sky-show-planets" checked> Sun &amp; Planets</label>
      </div>
    </details>
    <details class="sky-bodies-details">
      <summary class="sky-bodies-btn">Cam Align</summary>
      <div class="sky-bodies-drop" style="min-width:175px;padding:6px 10px;display:flex;flex-direction:column;gap:5px">
        <label class="parse-radio" style="display:flex;align-items:center;gap:6px;white-space:nowrap">
          Rotation&nbsp;
          <input type="number" id="allsky-rotation" value="-13" step="0.5" min="-180" max="180"
                 style="width:54px;background:#1a1a2e;border:1px solid #444;color:#ccc;border-radius:3px;padding:1px 4px;font-size:11px">
          °&nbsp;CW
        </label>
        <label class="parse-radio" style="display:flex;align-items:center;gap:6px;white-space:nowrap">
          Scale&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
          <input type="number" id="allsky-scale" value="1.0" step="0.005" min="0.5" max="2.0"
                 style="width:54px;background:#1a1a2e;border:1px solid #444;color:#ccc;border-radius:3px;padding:1px 4px;font-size:11px">
        </label>
      </div>
    </details>
  </div>

  <div class="sky-wrap">
    <canvas id="sky-canvas"></canvas>
    <div class="sky-zoom-ctrl">
      <button id="sky-zoom-out"  title="Zoom out">−</button>
      <button id="sky-zoom-home" title="Reset view">⌂</button>
      <button id="sky-zoom-in"   title="Zoom in">+</button>
    </div>
    <div class="sky-target-toggle" id="sky-target-toggle">
      <div class="stt-label">Display Targets</div>
      <div class="stt-row">
        <span class="stt-opt active" data-mode="all" id="stt-opt-all">All</span>
        <button class="stt-switch" id="stt-switch" role="switch" aria-checked="false"
                title="Toggle between showing all targets or only the selected target">
          <span class="stt-switch-thumb"></span>
        </button>
        <span class="stt-opt" data-mode="selected" id="stt-opt-selected">Selected</span>
      </div>
    </div>
  </div>

  <div id="resize-am-handle" class="resize-y-handle"></div>

  <details id="airmass-section" class="airmass-section" open>
    <summary class="airmass-summary">AIRMASS PLOT<span id="airmass-target-name" class="airmass-target-name"></span><span id="airmass-date" class="airmass-date"></span></summary>
    <div class="airmass-wrap">
      <canvas id="airmass-canvas"></canvas>
      <button id="am-home-btn" class="am-home-btn" title="Reset to current night">⌂</button>
    </div>
  </details>

</div><!-- /sky-panel -->


<!-- ═══════════════════════════════════════════════════════════════════════════
     SFTP BROWSER MODAL
════════════════════════════════════════════════════════════════════════════ -->
<div id="sftp-modal" class="modal-overlay hidden">
  <div class="modal-box">

    <div class="modal-hdr">
      <button id="sftp-up-btn" class="btn-sm">↑ Up</button>
      <span id="sftp-path" class="sftp-path orange"></span>
      <div class="flex-1"></div>
      <button class="modal-close" onclick="closeSftpModal()">✕</button>
    </div>

    <div class="sftp-search-bar">
      <input type="text" id="sftp-search" placeholder="Filter by name…" autocomplete="off" spellcheck="false">
    </div>

    <div class="sftp-list-wrap">
      <table id="sftp-tbl">
        <thead>
          <tr><th data-col="name">Name</th><th data-col="size" class="right">Size</th><th data-col="mtime">Modified</th></tr>
        </thead>
        <tbody id="sftp-tbody"></tbody>
      </table>
    </div>

    <div id="sftp-save-bar" class="sftp-save-bar hidden">
      <label class="dim small">Filename:</label>
      <input type="text" id="sftp-filename" placeholder="targets.list" autocomplete="off" spellcheck="false">
    </div>

    <div class="modal-footer">
      <span id="sftp-status" class="dim small"></span>
      <div class="flex-1"></div>
      <button class="btn-secondary" onclick="closeSftpModal()">Cancel</button>
      <button class="btn-primary" id="sftp-open-btn">Open</button>
    </div>

  </div>
</div>


<!-- ═══════════════════════════════════════════════════════════════════════════
     CREDENTIALS MODAL
════════════════════════════════════════════════════════════════════════════ -->
<div id="creds-modal" class="modal-overlay hidden">
  <div class="modal-box modal-sm">

    <div class="modal-hdr">
      <span>SSH Login — <?= htmlspecialchars(SFTP_HOST) ?></span>
      <div class="flex-1"></div>
      <button class="modal-close" onclick="closeCredsModal()">✕</button>
    </div>

    <div class="creds-form">
      <label>Username</label>
      <input id="creds-user" type="text" autocomplete="username">
      <label>Password</label>
      <input id="creds-pass" type="password" autocomplete="current-password">
      <p id="creds-error" class="creds-error hidden">Incorrect username or password.</p>
    </div>

    <div class="modal-footer">
      <div class="flex-1"></div>
      <button class="btn-secondary" onclick="closeCredsModal()">Cancel</button>
      <button class="btn-primary" id="creds-connect-btn">Connect</button>
    </div>

  </div>
</div>


<!-- ═══════════════════════════════════════════════════════════════════════════
     ADD SINGLE TARGET MODAL
════════════════════════════════════════════════════════════════════════════ -->
<div id="add-target-modal" class="modal-overlay hidden">
  <div class="modal-box modal-sm">

    <div class="modal-hdr">
      <span>Add Single Target</span>
      <div class="flex-1"></div>
      <button class="modal-close" onclick="closeAddTargetModal()">✕</button>
    </div>

    <div class="add-target-form" id="add-target-form">
      <div class="atf-row">
        <label>Name <span class="atf-req">*</span></label>
        <div class="atf-name-wrap">
          <input id="atf-name" type="text" placeholder="Target name" autocomplete="off" spellcheck="false">
          <button id="atf-simbad-btn" class="atf-simbad-btn" disabled title="SIMBAD Query">🔍</button>
        </div>
      </div>
      <div class="atf-row">
        <label>RA <span class="atf-req">*</span></label>
        <input id="atf-ra" type="text" placeholder="HH:MM:SS.ss" autocomplete="off" spellcheck="false">
      </div>
      <div class="atf-row">
        <label>Dec <span class="atf-req">*</span></label>
        <input id="atf-dec" type="text" placeholder="±DD:MM:SS.s" autocomplete="off" spellcheck="false">
      </div>
      <div class="atf-row">
        <label>Epoch</label>
        <input id="atf-epoch" type="text" placeholder="2000" value="2000" autocomplete="off" spellcheck="false">
      </div>
      <div class="atf-section-sep">Non-sidereal Rates</div>
      <div class="atf-row">
        <label>RA Rate</label>
        <input id="atf-pmra" type="text" placeholder="arcsec/hr" autocomplete="off" spellcheck="false">
      </div>
      <div class="atf-row">
        <label>Dec Rate</label>
        <input id="atf-pmdec" type="text" placeholder="arcsec/hr" autocomplete="off" spellcheck="false">
      </div>
      <div class="atf-section-sep">Proper Motion</div>
      <div class="atf-row">
        <label>PM RA</label>
        <input id="atf-prop-ra" type="text" placeholder="mas/yr" autocomplete="off" spellcheck="false">
      </div>
      <div class="atf-row">
        <label>PM Dec</label>
        <input id="atf-prop-dec" type="text" placeholder="mas/yr" autocomplete="off" spellcheck="false">
      </div>
      <div class="atf-row">
        <label>Notes</label>
        <input id="atf-notes" type="text" placeholder="" autocomplete="off" spellcheck="false">
      </div>
    </div>

    <div class="modal-footer" id="atf-edit-footer">
      <div class="flex-1"></div>
      <button class="btn-secondary" onclick="closeAddTargetModal()">Cancel</button>
      <button class="btn-primary" id="atf-submit-btn" disabled>Add Target</button>
    </div>

    <!-- SIMBAD result card — shown in place of the form after a successful query -->
    <div class="atf-result hidden" id="atf-result">
      <div class="atf-result-hdr">
        <span class="atf-result-badge">SIMBAD</span>
        <span id="atfr-hdr-text">Object matched</span>
      </div>
      <div class="atf-result-grid" id="atfr-grid">
        <span class="atf-rlbl">Name</span>   <span class="atf-rval" id="atfr-name">—</span>
        <span class="atf-rlbl">RA</span>     <span class="atf-rval mono" id="atfr-ra">—</span>
        <span class="atf-rlbl">Dec</span>    <span class="atf-rval mono" id="atfr-dec">—</span>
        <span class="atf-rlbl">Epoch</span>  <span class="atf-rval mono" id="atfr-epoch">—</span>
        <span class="atf-rlbl">PM RA</span>  <span class="atf-rval mono" id="atfr-prop-ra">—</span>
        <span class="atf-rlbl">PM Dec</span> <span class="atf-rval mono" id="atfr-prop-dec">—</span>
      </div>
      <div class="atf-err-block hidden" id="atfr-err-block">
        <p class="atf-err-msg" id="atfr-err-msg"></p>
        <details class="atf-err-details" id="atfr-err-details">
          <summary>Details</summary>
          <code id="atfr-err-raw"></code>
        </details>
      </div>
    </div>
    <div class="modal-footer hidden" id="atf-result-footer">
      <div class="flex-1"></div>
      <button class="btn-secondary" id="atfr-edit-btn">← Edit</button>
      <button class="btn-primary"   id="atfr-accept-btn">Add Target ✓</button>
    </div>

  </div>
</div>
<div id="atf-tooltip" class="atf-tooltip hidden"></div>

<script src="assets/app.js"></script>
</body>
</html>
