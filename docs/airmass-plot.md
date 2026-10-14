(sec-6)=
# 6 Airmass Plot

:::{figure} ../User_Manual/manual_assets/airmass_plot.png
:alt: Airmass plot showing a target's airmass curve dimming outside the P200 pointing limit, with red/green LIMIT and AVAILABLE crossing markers

Figure 7: Airmass Plot for *S233-D*, a demonstration target whose low declination (−35°) puts it out of the P200's mechanical pointing envelope well before it would otherwise set. The curve is color-graded green→yellow→orange→red by airmass while within limits, and dims to gray outside them; the green/red dots and *AVAILABLE*/*LIMIT* labels mark exactly where it crosses. The Moon's curve (yellow dashed) is shown for reference. The x-axis spans the observing night in UT (top row) and Pacific Time (bottom row).
:::

The Airmass Plot (below the sky canvas, collapsible) shows the observability of the selected target across the entire observing night. It updates as new telemetry arrives and is redrawn at least once a minute so the *NOW* marker stays current.

The section header doubles as a legend: it shows the name of the selected target and the **UT date of the night** being displayed (the date on which sunset falls), e.g. *17 AUG 2026 UT*.

:::{admonition} Night selection
:class: note

FACSUM determines which night to display automatically. Before sunrise it shows the night in progress (last sunset through this morning's sunrise); after sunrise it switches to the upcoming night (today's sunset through tomorrow's sunrise). The plot always extends 30 minutes beyond sunset and sunrise at each end.
:::

(sec-6-1)=
## 6.1 Reading the Plot

| Element | Description |
|---|---|
| **X-axis** | UT hours across the night, gridded every 2 hours (top label row), with Pacific Time equivalents below (labeled PDT or PST as appropriate) |
| **Y-axis** | Airmass from 1.0 (zenith) to 4.5, gridded at 1.0, 1.5, 2.0, 2.5, 3.0 and 4.0. Lower is better. A second axis appears along the right edge when **Parallactic** is enabled ([§6.5](sec-6-5)); the airmass scale is unaffected by it. |
| Dark blue shading | The 30-minute margins before sunset and after sunrise (daylight, not observing time) |
| [Amber dashed lines]{.clr-orange} | Exact sunset and sunrise times |
| Cyan dashed line | Current time, labeled **NOW** in the margin just below the plot. Derived from the TCS UT field, so it reflects observatory time rather than the workstation clock. |
| Yellow dashed curve | The Moon's airmass across the night, labeled *Moon*. Shown whenever the **Moon** marker is enabled in the Sky Display's Markers dropdown. |
| Color-graded target curve | For a single selected target, airmass graded continuously by value: [green]{.clr-green} at 1.0, [yellow]{.clr-yellow} at 1.5, [orange]{.clr-orange} at 2.0, [red]{.clr-red} at 3.0 and above. With several targets selected ([§4.3](sec-4-3)), each is drawn instead as a flat line in its own color, so distinct targets stay identifiable where a value gradient could not tell them apart. In both cases the curve breaks wherever the target is beyond airmass 4.5, and dims wherever it is below the P200's full pointing envelope (see below), even while still above the horizon. |
| Red / green crossing markers | A small dot marks every point where the target crosses into or out of the P200's pointing limits (the mechanical hour-angle/declination envelope combined with the 6.5° horizon, whichever binds first), [red]{.clr-red} entering a limit, [green]{.clr-green} clearing one. For a single selected target these are also labeled *LIMIT* / *AVAILABLE*; labels are omitted with several targets selected to avoid overlapping text. The same crossings appear on the target's path trace on the Sky Display ([§5.7](sec-5-7)). |
| White dot on curve | The target's airmass at the NOW line, with a numeric label for a single selection (ringed red if the target is presently beyond a limit); a smaller unlabeled ring per target when several are shown. |

If no target is selected, the plot area shows the message *"Select a target to view its airmass curve"*. The Moon curve, grid and twilight shading are still drawn.

(sec-6-2)=
## 6.2 Scrolling the Time Axis

The plot can be panned horizontally to inspect earlier or later parts of the night:

- **Drag left/right** inside the plot to scroll the time axis. The cursor changes to a grabbing hand while dragging.
- Click the **⌂ home button** (bottom-left of the plot) to snap back to the default view centered on the current night.

The NOW line, twilight shading, sunrise/sunset markers and all curves scroll together, so relative timing is always clear. Curves are clipped at the plot border rather than spilling into the axis margins.

(sec-6-3)=
## 6.3 Interactive Cursor

Hover the mouse over the plot to read off values at any time during the night:

- A dashed hairline follows the mouse horizontally
- A time label (e.g. *04:30 UT*) appears along the bottom inside edge of the plot
- A boxed airmass readout, outlined and colored to match the curve, floats beside the cursor with a dot marking the exact point on the selected target's curve. With several targets selected each gets a dot in its own color but no readout box, since overlapping boxes at one cursor position would be unreadable.
- When **Parallactic** is enabled ([§6.5](sec-6-5)), a second boxed readout gives the slit angle at the same instant. It steps aside automatically if it would otherwise land on the airmass readout, so both stay legible wherever the two curves cross.

Moving the mouse out of the plot area dismisses the cursor. Hovering does not interfere with drag-to-pan; a small drag threshold (4 px) distinguishes the two gestures.

(sec-6-4)=
## 6.4 Collapsing & Resizing

Click the **AIRMASS PLOT** header bar to collapse or expand the section; collapsing frees the vertical space for the sky display. Drag the handle just above the header to change the plot's height while it is open. The handle is hidden while the section is collapsed, and no drawing work is done for a collapsed plot.

(sec-6-5)=
## 6.5 Parallactic Angle

:::{figure} ../User_Manual/manual_assets/airmass_parallactic.png
:alt: Airmass Plot with the Parallactic trace enabled, showing the right-hand angle axis

Figure 8: The Airmass Plot with *Parallactic* enabled, for NGC 7331. The dashed orange trace is read against the new right-hand axis (0–360°); the solid graded curve and the left-hand airmass axis are unchanged. The near-vertical segment just after 05 h is not a break in the trace: NGC 7331 passes 1.1° from the zenith, and a target that close to overhead sweeps most of its parallactic range within minutes of transit.
:::

Tick **Parallactic**, next to the target name in the plot's header bar, to add a dashed trace of each selected target's parallactic angle across the night. The angle is read on a second axis that appears along the *right* edge of the plot, running from 0° at the bottom to 360° at the top; the airmass scale on the left is unchanged. The checkbox is off every time the page loads; switch it on when you need it. Like the Sky Display's own AllSky, Labels and Markers checkboxes, it is not remembered between sessions.

Angles are given in **0°–360°**, matching the range the TCS accepts for a ring angle, so the number shown can be typed in without first converting a negative value.

| Element | Meaning |
|---|---|
| Dashed trace | Parallactic angle over the night, in the target's own color (orange for a single selection). Dashed throughout, to distinguish it from the solid airmass curve on the left axis. |
| Dot at **NOW** | The angle at the current time. With one target selected, the value is printed beside it. This is the number to set the slit to. |
| Dot under the cursor | The angle at whatever time you hover, alongside the airmass readout ([§6.3](sec-6-3)), so you can read ahead to a planned exposure. |
| Faded trace | Same convention as the airmass curve: the target is below the practical horizon or outside the P200's pointing limits there ([§6.1](sec-6-1)). |
| Break in the trace | Not a gap in coverage; see the note below. |

:::{admonition} Why the trace sometimes jumps from one edge to the other
:class: note

For a target that passes *north* of the zenith (declination above Palomar's +33.4°) the angle passes smoothly through 180° at transit. For a target that passes *south* of the zenith, it instead runs down to 0° and reappears at 360° (or the reverse), because those are the same slit orientation and the plot does not draw a line across the wrap. Nothing is wrong, and no time is missing from the trace. The angle also swings fastest for targets passing close to the zenith, which is both when slit alignment matters most and when a fixed angle goes stale quickest. The effect is larger than it may look: NGC 7331 in Figure 8 passes 1.1° from the zenith and its parallactic angle moves about 125° in the quarter hour around transit, against roughly 1–2° per quarter hour several hours either side.
:::

:::{admonition} The angle is geometric only
:class: warning

FACSUM computes the parallactic angle from hour angle, declination and latitude. It does not know your instrument's slit position-angle convention or any rotator zero-point offset, and it applies no correction for flexure or for how a given instrument defines PA. Convert to your instrument's convention before dialling a number in, and confirm against the instrument's own display.
:::
