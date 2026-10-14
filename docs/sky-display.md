(sec-5)=
# 5 Sky Display

:::{figure} ../User_Manual/manual_assets/panel_sky.png
:alt: Sky display showing two selected targets' full-night path traces in distinct colors, each with red/green pointing-limit crossing markers
:width: 90%

Figure 5: Sky Display with two targets selected from the demo list ([§4.3](sec-4-3)), each drawn in its own color with a full-night path trace ([§5.7](sec-5-7)). *M 13* (cyan, top) only meets the P200's mechanical HA limit at extreme hour angles, long after it would have set. *S233-D* (pink, bottom), a low-declination demonstration target, is cut off by that same limit (the red/green dots) well before the horizon would bind. The dashed orange ring is the 6.5° altitude limit; the heavier red line is the meridian. The all-sky overlay and planet markers are switched off here to keep the paths legible.
:::

The panel header carries four controls: the **AllSky** and **Labels** checkboxes, and the **Markers** and **Cam Align** dropdowns. Clicking anywhere outside an open dropdown closes it.

(sec-5-1)=
## 5.1 Sky Projection & Grid

The sky canvas uses an **azimuthal equidistant projection** looking straight up from Palomar Mountain. The zenith is at the center; objects closer to the horizon appear closer to the edge of the circle.

Orientation follows standard astronomical convention: **North is up, East is to the left**. The grid is fixed in hour-angle/declination space, so an object transiting the meridian appears on the meridian line, and objects at large hour angles appear toward the east or west edges.

| Element | Appearance | Meaning |
|---|---|---|
| Declination circles | Faint blue rings every 10° | Lines of constant declination; labeled every 20° where they cross the meridian |
| Hour angle lines & Meridian | [Red]{.clr-red} lines at ±2 h, ±4 h, ±6 h; the meridian (HA = 0 h) drawn thicker and brighter | Lines of constant HA, labeled at their Dec +30° crossing (west of the meridian positive); objects cross the meridian at their highest elevation |
| Altitude limit | [Orange]{.clr-orange} dashed ring, labeled *6.5°* | The P200 elevation limit; avoid pointing inside this ring |
| Horizon circle | Cyan outer ring | The horizon (altitude = 0°) |
| Cardinal labels | N, E, S, W outside the ring | Compass directions |
| Telescope crosshair | [Cyan]{.clr-cyan} circle + lines + square, labeled *P200* | Current telescope pointing from live TCS telemetry. Always rendered on top of target dots and body labels. |
| Target dots | [Orange]{.clr-orange} dots with name labels | Parsed targets above the horizon; each selected target has a larger, paler dot plus a crosshair and a full-night path trace ([§5.7](sec-5-7)), in its own color when several targets are selected at once |

Unchecking **Labels** hides the declination and hour-angle values, target names, and body names, leaving the geometry uncluttered. The cardinal letters and the *6.5°* ring label are always drawn.

:::{note}
Targets, solar-system bodies and the telescope crosshair all require LST from the telemetry stream. With the TCS disconnected the grid is still drawn, but nothing is plotted on it.
:::

:::{note}
The dashed *6.5°* ring is the horizon limit only. A target can also become unreachable at a higher elevation because of the P200's mechanical hour-angle/declination pointing envelope. See [§5.7](sec-5-7) and [§6.1](sec-6-1), where both limits are combined into a single availability check.
:::

(sec-5-2)=
## 5.2 All-Sky Camera Overlay

Check **AllSky** in the panel header to overlay the live Palomar all-sky camera image on the sky projection. The image is fetched every 30 seconds through a server-side proxy on Observer1 (which caches it for 30 seconds so many browsers can share one camera fetch) and composited at 55 % opacity.

The overlay is not simply pasted on: FACSUM remaps the fisheye image pixel by pixel, using the lens distortion coefficients from the original FACSUM `telescope.cfg`, so that features in the camera image land on their true altitude and azimuth in the equidistant grid. If the browser cannot read the image pixels, it silently falls back to a plain crop-and-rotate, which is close but not geometrically exact.

The radius treated as the horizon is calibrated against the Moon's known altitude. One visible consequence: the outermost ring of the display is partly blank, because the camera's circular image is clipped top and bottom by its own sensor and the overlay extends out to the true horizon, reaching into that clipped region. Nothing is lost that the camera ever recorded.

If the camera is unreachable (daytime, dome closed, network outage), the most recent successful image is retained and served until a new one arrives.

(sec-5-3)=
## 5.3 Camera Alignment (Cam Align)

Click **Cam Align** in the panel header for two calibration fields that fine-tune how the all-sky image sits on the grid. Adjust them while watching a recognizable feature (the Moon, a bright planet, or the dome slit) and the overlay redraws live as you type.

| Field | Default | Range | Effect |
|---|---|---|---|
| **Rotation ° CW** | −10.5 | −180 to 180, 0.5° steps | Rotates the camera image clockwise about the zenith to align its north with the grid's north |
| **Scale** | 1.0 | 0.5 to 2.0, 0.005 steps | Scales the camera field of view. Values below 1 zoom the camera image in, pushing its horizon beyond the canvas edge. |

Both values are stored in the browser, so an alignment you establish once survives page reloads on that workstation. They affect only the overlay, never the projection, the grid, or any computed position.

:::{admonition} If the overlay looks mis-aligned, check the stored value
:class: warning

Because these fields are saved in the browser, a workstation that has ever had Cam Align adjusted keeps its own saved number rather than the default shown above. Type the default into the Rotation field once on that workstation (or clear the browser's site data) to restore it.
:::

The cardinal markers around the sky display deliberately do *not* rotate with the camera image. They mark the true sky frame that every other overlay (the coordinate grid, the target dots, the telescope crosshair) is drawn in, and they are the fixed reference you align the camera image *to*. If they moved with the image, there would be nothing to calibrate against.

(sec-5-4)=
## 5.4 Markers (Moon, Sun & Planets)

:::{figure} ../User_Manual/manual_assets/markers_dropdown.png
:alt: Markers dropdown showing Moon and Sun & Planets checkboxes
:width: 70%

Figure 6: The Markers dropdown in the Sky Display header.
:::

Click **Markers** in the panel header to open a small dropdown with two checkboxes, both enabled by default:

- **Moon**: draws a faint disc outline at the computed lunar position with the illuminated limb traced on top, so the marker reflects the current phase (crescent, quarter, gibbous, full). The phase comes from the Sun–Moon elongation. The position is computed from the full Meeus lunar theory and corrected for the observer's position on the Earth's surface, giving an accuracy better than 0.02°. This checkbox also controls the Moon's airmass curve in the plot below ([§6.1](sec-6-1)).
- **Sun & Planets**: draws yellow dots for the Sun, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, and Neptune, with marker radii scaled roughly by apparent brightness and size. Positions come from Keplerian elements (Meeus Table 31.a, accuracy ≈ ±1–2°). All calculations are done in the browser from the current time; no external ephemeris service is needed.

Bodies below the horizon are not drawn. Toggle **Labels** in the header to show or hide body name labels next to each marker.

(sec-5-5)=
## 5.5 Display Targets: All / Selected

A small **Display Targets** switch in the lower-left corner of the sky canvas controls how much of the target list is plotted:

- **All** (default): every target above the horizon is drawn, each with its name label.
- **Selected**: only the currently selected target(s) are drawn, each in its own color when more than one is selected ([§4.3](sec-4-3)).

Click the switch, or either of the two labels, to change modes. *Selected* is the practical choice with long lists, where dozens of labeled dots can bury the telescope crosshair and the all-sky image.

(sec-5-6)=
## 5.6 Zoom & Pan

Three buttons in the lower-right corner of the sky canvas control the view level:

| Button | Action |
|---|---|
| **−** (Zoom out) | Shrinks the sky circle within the pane (÷ 1.6 per click, no smaller than the full view) |
| **⌂** (Reset) | Returns to the default full view with no zoom or pan offset |
| **+** (Zoom in) | Enlarges the sky circle within the pane (× 1.6 per click, up to 20×) |

When zoomed in, **click and drag** on the canvas to pan; panning is clamped so the sky circle cannot be dragged entirely out of view. The cursor changes to a grab icon when panning is available. The entire sky circle (grid, markers, cardinal labels, and all-sky overlay) scales and pans together uniformly.

(sec-5-7)=
## 5.7 Target Path Trace

Every selected target ([§4.3](sec-4-3)) is drawn with its full rise-to-set path across the current observing night, extending well past dusk and dawn on each side so the whole arc is visible, not just the dark-time portion. With several targets selected, each path is drawn in that target's own color, matching its airmass curve ([§6.1](sec-6-1)).

- A **solid** segment means the target is both in dark time and within the P200's full pointing envelope (horizon and mechanical HA/Dec limits combined, [§6.1](sec-6-1)), i.e. genuinely observable right then.
- A **dim, dashed** segment means one of those conditions fails: daylight, or beyond a pointing limit.
- Small circular markers appear where the path crosses a boundary: [amber]{.clr-orange} for sunset/sunrise, and red/green where the target enters or clears a pointing limit, following the same convention as the Airmass Plot's crossing markers.

Hover over any of these markers to see a color-matched tooltip (*Sunset*, *Sunrise*, *Limit*, or *Available*) explaining what it means. The tooltip is colored to match the marker and appears above the cursor.

Hovering over the Airmass Plot ([§6.3](sec-6-3)) also drops a small hover dot onto each selected target's path here, at the sky position corresponding to that moment in the night. This is a quick way to see where a target will be at a specific time without leaving the sky display.
