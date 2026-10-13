# Screenshot harness

Runs the real FACSUM UI on your own machine with a simulated TCS behind it, so
manual figures can be captured without Observer1, the telescope, or PHP.

## Run it

```bash
python3 "User_Manual/screenshot_harness/mock_server.py"
```

Then open <http://127.0.0.1:8765/>. Nothing needs installing — Python 3 (which
macOS ships) is the only requirement, and the server touches no production file.

Useful variants:

```bash
python3 mock_server.py --port 9000     # different port
python3 mock_server.py --real-clock    # real time instead of a simulated night
python3 mock_server.py --no-open       # don't launch a browser
```

Page URL options: `?zoom=1.0` sets the interface zoom before the app starts,
`?real` disables the simulated clock.

## What it fakes

| Endpoint | Behaviour |
|---|---|
| `api.php` `connect` / `disconnect` / `daemon_status` | reports a healthy daemon |
| `api.php` `telemetry` | synthetic frame: LST, HA, airmass and apparent RA/Dec computed for Palomar from the simulated clock |
| `api.php` `coords` | accepts the COORDS command and slews the simulated telescope to those coordinates |
| `api.php` `local_list` / `local_get` / `local_save` | serves `targets/` in this folder, presented to the UI as `/observer/observer/targets` |
| `allsky.php` | serves `data/allsky_cache.jpg` from the app directory |
| `simbad_proxy.php` | small offline catalog (M 13, M 57, M 27, NGC 6543, Vega, HZ Her) |

The clock is pinned to 40 % of the way through the nearest observing night and
then ticks in real time. The same simulated time is injected into the page as a
`Date` shim, so the browser's night selection, NOW marker and solar-system
positions agree with the fake telemetry. `index.php`, `app.js` and `style.css`
are served **unmodified** — only the clock shim is added, and only by this
server.

## Sample target lists

`targets/` holds one file per supported format, all verified against the real
parsers in `app.js`:

- `demo_targets.csv` — 17 objects, comma-delimited, airmass 1.0–6.6 at the
  simulated LST. Includes `S233-D` (Dec −35°), whose reachable HA range is
  bound by the P200's mechanical pointing limit well before the horizon does
  — useful for the pointing-limit figures.
- `standards.ptic` — fixed-width PTIC, including a `pm=` non-sidereal entry
- `ngps_demo.list` — space-delimited NGPS with Priority / Magnitude / Exptime
- `archive/` — a subdirectory, so the file browser listing shows one

## Capturing figures

`POST /_capture` with `{"name": "panel_sky.png", "png": "<base64 data URL>"}`
writes straight into `../manual_assets/`. Only the filenames already used by the
manual are accepted, so a stray capture can't litter the folder.

After replacing any image, rebuild the PDF:

```bash
python3 User_Manual/build_pdf.py
```
