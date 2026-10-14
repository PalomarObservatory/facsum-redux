(sec-2)=
# 2 Quick Start

The following steps describe the typical workflow at the start of a night run.

1. **Launch FACSUM.** On the **Portal** workstation, run `start_facsum.sh`. The script reuses a healthy Observer1 session if one exists; otherwise it prompts once for the Observer1 password, opens the SSH tunnel, starts the web server, and opens FACSUM in Firefox. The interface loads and connects to the TCS automatically, and live telemetry begins updating within a few seconds.
2. **Verify the connection.** Confirm the green *Connected* indicator on the right of the Telemetry panel header. If it shows *Disconnected*, click **Connect** to re-establish.
3. **Load your target list.** Click **+ Load Target List** in the Target Lists panel header, or the large **+ Load Target List** button shown in the middle of the empty table. This opens the file browser ([§7](sec-7)) at the Observer1 target list directory, `/observer/observer/targets`, where you can navigate to and open your file. FACSUM parses it and populates the table automatically. See [§4.1](sec-4-1) for alternatives.
4. **Check target observability.** The Targets Table shows a live airmass for each object, updated as the night progresses. Sort the table by **Airmass** to find the best target for right now.
5. **Select a target.** Click any table row to select it. The selected target is highlighted on the sky display with a crosshair, and its airmass curve is drawn in the plot below.
6. **Send the target to the telescope.** With a row selected, click **Load to Telescope**. This sends a `COORDS` command to the TCS, loading the target's coordinates.

:::{warning}
**Important: COORDS does not slew.** Sending a target with *Load to Telescope* loads coordinates into the TCS but does not move the telescope. Initiate the slew separately in the TCS software before observing.
:::
