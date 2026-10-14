(sec-3)=
# 3 Telemetry Panel

:::{figure} ../User_Manual/manual_assets/panel_telemetry.png
:alt: Telemetry panel in connected state showing Loaded and Current blocks and the hardware strip
:width: 70%

Figure 2: Telemetry panel in the connected state. The orange Loaded block shows the last target sent to the TCS; the cyan Current block shows the live telescope pointing. The time strip displays UT, LST, HA, and live airmass.
:::

(sec-3-1)=
## 3.1 Connecting to the TCS

FACSUM connects to the TCS automatically about half a second after the page loads. A background daemon on Observer1 (`tcs_daemon.py`) holds the TCP connection to the TCS, polls it four times a second, and writes parsed telemetry to a small JSON file; the browser reads that file roughly ten times a second and redraws only when the daemon has published new data.

If the connection is lost or was manually stopped, click **Connect** in the panel header to restart the daemon and resume polling. A status LED and label on the *right side* of the header reflect the current connection state, color-coded to match:

:::{figure} ../User_Manual/manual_assets/telemetry_header_connected.png
:alt: Header in connected state, with green LED and text on the right

Connected state
:::

:::{figure} ../User_Manual/manual_assets/telemetry_header_disconnected.png
:alt: Header in disconnected state, with red LED and text on the right

Disconnected state
:::

| LED color | Label | Meaning |
|---|---|---|
| [● Green]{.clr-green} (slow pulse) | Connected | Polling the TCS successfully; all fields update continuously |
| [● Yellow]{.clr-yellow} (fast pulse) | Reconnecting… | The browser lost contact with the Observer1 server and is retrying (the button reads *Connecting…*) |
| [● Yellow]{.clr-yellow} (fast pulse) | TCS Reconnecting… | The daemon is running but has lost its link to the TCS and is retrying |
| [● Red]{.clr-red} (static) | Disconnected | No TCS connection; the daemon is idle, stopped, or has published nothing yet |
| [● Red]{.clr-red} (static) | Daemon stopped | The daemon shut down cleanly, e.g. after **Disconnect** or a heartbeat timeout |
| [● Red]{.clr-red} (static) | Error | The daemon could not reach the TCS; the underlying message appears in the status bar |

The LED pulses slowly while connected and faster while connecting, providing a passive at-a-glance indication that the link is live. It is static when disconnected. To the left of the LED, a small *updated HH:MM:SS UTC* stamp shows when the daemon last published a telemetry frame, and a status bar along the bottom of the panel carries any message the daemon reports.

Click **Disconnect** to stop the daemon cleanly and release the TCS connection. Closing or navigating away from the tab also sends a disconnect request automatically.

:::{note}
Keep only one browser tab connected at a time. A second tab opening a connection will conflict with the daemon already started by the first. Switching to another application (TCS, a terminal) is safe; FACSUM deliberately keeps its connection alive when its tab is not visible.
:::

(sec-3-2)=
## 3.2 Connection Resilience

Brief network hiccups between Observer1 and the TCS are common and are handled without operator intervention. Two mechanisms are worth knowing about, because they explain why the display sometimes holds still instead of alarming.

| Mechanism | Behavior |
|---|---|
| **TCS grace period** | If the daemon reports that it has lost the TCS, the displayed values are frozen and no warning is shown for the first **12 seconds**. The daemon normally reconnects within a couple of seconds. Only if the outage outlasts the grace period does the header switch to [TCS Reconnecting…]{.clr-yellow}, and even then the last-known field values stay on screen rather than blanking. |
| **Browser auto-reconnect** | If the browser cannot reach the Observer1 web server for about **5 seconds** of continuous failures, FACSUM stops polling and retries the connection up to **5 times, 5 seconds apart**. Progress is reported in the status bar (*"Connection lost — reconnecting (attempt 2 of 5)…"*). If all attempts fail, the panel returns to *Disconnected* and the status bar invites you to click **Connect**. |
| **Heartbeat** | Every telemetry poll renews a heartbeat file. If the heartbeat goes stale for **120 seconds** (for example because the browser was closed without a clean disconnect) the daemon drops its TCS connection on its own and waits idle until a browser returns. This prevents an abandoned session from holding the TCS link open. |

(sec-3-3)=
## 3.3 Position & Time Fields

The Telemetry panel shows pointing information in two side-by-side blocks, followed by a hardware strip and a time strip. The [Loaded]{.clr-orange} block changes only in response to your actions in the Target Lists panel. The [Current]{.clr-cyan} block reflects live TCS data and updates continuously while connected.

### [Loaded block]{.clr-orange}: last target sent to the TCS

Populated when **Load to Telescope** succeeds ([§4.7](sec-4-7)). All four fields show "—" until the first successful send in the current session.

:::{admonition} When the block resets
:class: note

The Loaded block is cleared back to "—" whenever the list is re-parsed (loading a list, pressing *Parse Text*, or adding or deleting a target) even if a target was sent earlier in the session. After an in-place cell edit ([§4.4](sec-4-4)) it shows the *currently selected* row rather than the last target actually sent. Treat the [Current]{.clr-cyan} block and the TCS console as authoritative for what the telescope is holding.
:::

| Field | Description |
|---|---|
| **LOADED TARGET** | Name of the last target sent to the TCS (truncated to 12 characters if longer) |
| **LOADED RA** | Right Ascension of that target (HH:MM:SS.s) |
| **LOADED DEC** | Declination of that target (±DD:MM:SS) |
| **LOADED EQUINOX** | Coordinate epoch of that target, normalized for display (e.g. `J2000.0`; epochs before 1984 are shown with a `B` prefix) |

### [Current block]{.clr-cyan}: live telescope pointing

| Field | Description |
|---|---|
| **CURRENT TARGET** | Target name currently set in the TCS (truncated to 12 characters if longer) |
| **CURRENT RA** | *Apparent* Right Ascension of the telescope, computed as LST − HA from TCS encoder data (HH:MM:SS.ss) |
| **CURRENT DEC** | *Apparent* Declination, derived from the reported telescope azimuth and elevation together with the Palomar latitude (±DD:MM:SS.s) |
| **CURRENT EQUINOX** | Coordinate epoch of the current pointing, sourced from the last target sent by FACSUM, as the TCS does not report this value in its telemetry stream. Reads "—" until the first successful send. |

:::{admonition} Why apparent coordinates?
:class: note

The TCS reports the catalog (J2000) position it was given, which drifts away from where the telescope is actually pointing once offsets and non-sidereal rates are applied. FACSUM instead derives the pointing from the encoders, so the Current block matches the TCS console display rather than the original catalog entry.
:::

### Hardware strip

| Field | Description |
|---|---|
| **RA OFFSET** | Current RA guide/offset correction, suffixed **E** or **W**. Shown in arcseconds, or in degrees once the magnitude reaches 1000″. |
| **DEC OFFSET** | Current Dec guide/offset correction, suffixed **N** or **S**, with the same unit switch. |
| **RA RATE** | Non-sidereal tracking rate in RA (arcsec/hr); reads `0.0"/hr` when not tracking |
| **DEC RATE** | Non-sidereal tracking rate in Dec (arcsec/hr) |
| **CASS RING** | Cassegrain ring rotation angle, normalized to 0–360° |
| **FOCUS** | Secondary mirror position (mm) |

### Time strip

| Field | Description |
|---|---|
| **UT** | Universal Time as reported by the TCS (HH:MM:SS) |
| **LST** | Local Sidereal Time at Palomar (HH:MM:SS) |
| **HA** | Hour Angle, prefixed E or W of meridian |
| **AIRMASS** | Airmass at the current telescope pointing, as reported by the TCS |

:::{note}
LST from the telemetry drives almost everything else on the page: the airmass column in the target table ([§4.3](sec-4-3)), target and solar-system positions on the sky display ([§5](sec-5)), and the telescope crosshair. If the TCS is disconnected, airmass cells show "—" and no targets or bodies are plotted on the sky. The UT field additionally sets the *NOW* marker in the airmass plot, so that marker follows observatory time rather than the workstation clock.
:::
