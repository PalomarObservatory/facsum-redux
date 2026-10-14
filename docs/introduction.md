(sec-1)=
# 1 Introduction

(sec-1-1)=
## 1.1 Overview

**FACSUM** (Facility Summary) is a browser-based observing tool for the Palomar Observatory 200-inch Hale Telescope (P200). It brings four key observing-support functions together in a single page:

- Live monitoring of P200 Telescope Control System (TCS) telemetry: apparent pointing, time, guide offsets, tracking rates, Cassegrain ring angle and focus
- Loading, editing and managing observer target lists, with real-time airmass computation for each target
- A live sky display showing the azimuthal projection of the sky, telescope pointing, solar-system bodies, and the all-sky camera feed
- An airmass plot showing when each target is best observable across the night

FACSUM runs directly on **Observer1** (`observer1.palomar.caltech.edu`), where a PHP built-in web server listens on `127.0.0.1:18080`. It is used from the **Portal** workstation. The startup script `start_facsum.sh` (run on Portal) establishes an SSH tunnel to Observer1, starts the web server if it is not already running, and opens FACSUM in a Firefox window, so no manual browser navigation is required. FACSUM is not directly reachable from outside the Palomar network.

Because FACSUM now runs *on* Observer1, target lists are read and written through ordinary filesystem calls. There is no SFTP step and no login prompt inside the browser: the only password you may be asked for is the Observer1 SSH password requested by `start_facsum.sh` at launch, and only when a healthy session is not already open.

(sec-1-2)=
## 1.2 Interface Layout

:::{figure} ../User_Manual/manual_assets/main_connected.png
:alt: FACSUM main interface with TCS connected, all-sky camera active, and planets displayed
:width: 90%

Figure 1: FACSUM interface with a live TCS connection and a loaded target list. Left column: Telemetry (top) and Target Lists (bottom). Right column: Sky Display (top) with all-sky camera overlay, target dots, and planetary markers, and Airmass Plot (bottom).
:::

The interface is divided into four panels arranged in two columns. Each panel has a colored accent to help orient quickly:

| Panel | Position | Accent | Purpose |
|---|---|---|---|
| **P200 Telemetry** | Left, top | [Cyan]{.clr-cyan} | Live TCS data: apparent pointing, time, offsets, rates, Cass ring and focus |
| **Target Lists** | Left, bottom | [Orange]{.clr-orange} | Load, edit, save, and send targets to the telescope |
| **Sky Display** | Right, top | [Purple]{.clr-purple} | Real-time sky projection with all-sky camera overlay |
| **Airmass Plot** | Right, bottom | [Purple]{.clr-purple} | Target observability curve across the night |

**Resizing panels:** Three drag handles let you redistribute screen space to suit your workflow. Drag the *vertical bar* between the two columns to adjust their widths. Drag either *horizontal bar* (one between Telemetry and Target Lists, one between the Sky Display and the Airmass Plot) to adjust how space is split between the panels above and below it.

The **Airmass Plot** section can be collapsed by clicking its header bar, freeing additional vertical space when not needed. Its resize handle disappears while collapsed.

(sec-1-3)=
## 1.3 Interface Zoom

The Telemetry panel header contains a zoom control (**−**, a percentage readout, and **+**), which scales the entire FACSUM page. This is useful on the control-room displays, where the default browser text size can be uncomfortably small at a distance.

- Range **50 % to 200 %**, in 10 % steps.
- The chosen level is remembered in the browser and is reapplied on the next page load.
- On a browser profile that has never run FACSUM, the interface starts at **150 %**.

The panel drag handles and the input-validation tooltips compensate for the zoom factor, so resizing behaves identically at any zoom level. One exception: dragging to pan the sky canvas ([§5.6](sec-5-6)) moves the sky by the zoom factor, so at 150 % the view travels about 1.5× as far as the cursor.
