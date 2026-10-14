# FACSUM

FACSUM (Facility Summary) is a browser-based observing tool for the Palomar
Observatory 200-inch Hale Telescope (P200). A single page shows:

- live TCS telemetry (pointing, time, offsets, rates, Cass ring and focus)
- observer target lists, with live airmass and one-click `COORDS` loading
- a sky display with the all-sky camera overlay, Moon and planets
- a nightly airmass plot

**User manual:** <https://palomarobservatory.github.io/facsum-redux/>
(source in [docs/](docs/); PDF in [User_Manual/](User_Manual/)).

## Running FACSUM

FACSUM runs on Observer1 and is used from the Portal workstation. On Portal:

```bash
./start_facsum.sh
```

The script opens an SSH tunnel to Observer1, starts the PHP web server there if
needed, and opens FACSUM in Firefox. The page then starts the TCS daemon
(`tcs_daemon.py`) automatically. See the manual's
[Quick Start](https://palomarobservatory.github.io/facsum-redux/quick-start.html)
and [Appendix C](https://palomarobservatory.github.io/facsum-redux/appendix-c-troubleshooting.html)
for day-to-day use and troubleshooting.

## Repository layout

| Path | Contents |
|---|---|
| `index.php`, `assets/` | Page markup, `app.js` and `style.css` |
| `api.php` | Backend endpoints: daemon control, telemetry, `COORDS`, target files |
| `allsky.php`, `simbad_proxy.php` | All-sky camera and SIMBAD proxies |
| `includes/config.php` | TCS address, target directory and paths |
| `tcs_daemon.py`, `start_daemon.sh` | TCS polling daemon and its manager |
| `start_facsum.sh` | Launcher run from Portal |
| `data/` | Runtime files (telemetry, heartbeat, logs) |
| `vendor/` | Composer dependencies |
| `docs/` | Sphinx source for the online manual |
| `User_Manual/` | HTML/PDF manual, figures and the screenshot harness |

## Trying it without the telescope

The screenshot harness serves the real UI against a simulated TCS, with only
Python 3 required:

```bash
python3 User_Manual/screenshot_harness/mock_server.py
```

Then open <http://127.0.0.1:8765/>. See
[User_Manual/screenshot_harness/README.md](User_Manual/screenshot_harness/README.md).

## Building the docs

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r docs/requirements.txt
python -m sphinx -b html docs docs/_build/html
```

Open `docs/_build/html/index.html`. Pushes to `main` that touch `docs/` or
`User_Manual/` are built and published to GitHub Pages by
[.github/workflows/docs.yml](.github/workflows/docs.yml).
