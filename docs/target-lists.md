(sec-4)=
# 4 Target Lists Panel

(sec-4-1)=
## 4.1 Loading a Target File

There are three ways to get targets into FACSUM:

- **From Observer1:** Click **+ Load Target List** in the panel header. This opens the file browser ([§7](sec-7)), which lists the Observer1 target directory. Navigate to your file and click **Open** (or double-click it). FACSUM reads and parses the file automatically. When the table is empty, a second, larger **+ Load Target List** button appears in the middle of the pane and does the same thing.
- **By pasting text:** Click the **Edit Text** tab, paste or type your target list, and click **↺ Parse Text**. This is useful for quickly trying a short list without saving a file.
- **One target at a time:** Click **+ Add Single Target** at the bottom of the panel and fill in the form, optionally letting SIMBAD resolve the coordinates from the object name ([§4.5](sec-4-5)).

The filename of the currently loaded list is always shown in the upper-right corner of the panel header (e.g., [targets123.csv]{.clr-orange}); it reads *—* when no list is loaded. Opening a file (or adding, editing or deleting a target) activates the **Save Target List** and **✕ Clear List** buttons.

:::{note}
Pasting text and pressing **↺ Parse Text** populates the table but does not by itself activate *Save Target List*. Adding or editing any target afterwards activates it, and the save then writes the full text including your pasted lines.
:::

FACSUM supports three file formats (**CSV**, **PTIC**, and **NGPS**) and auto-detects the format of any file you open. See [Appendix A](app-a) for the full format specification.

(sec-4-2)=
## 4.2 Parsing Options

Below the tab bar is a collapsible **Parsing Options** section. Click the summary line to expand or collapse it. In most cases the defaults work without adjustment, and the section can be left closed.

:::{list-table}
:header-rows: 1
:widths: 15 30 55

* - Option
  - Choices
  - Notes
* - **File Type**
  - Auto-detect · CSV · PTIC
  - Auto-detect scores every format/delimiter combination against the file and picks the best match, showing a summary such as *"auto-detected: CSV comma (12/12 lines)"*. Override only if auto-detection picks the wrong format. NGPS is recognized from its header row and does not need (or have) a radio button.
* - **Delimiter**
  - Auto · Comma · Semicolon · Tab · Space · Other
  - Applies to CSV files only. *Auto* examines up to ten sample lines and picks the most frequent separator among comma, semicolon, tab and pipe. Choose *Other* and type a character (e.g. `|`) for anything else; typing in that box selects the *Other* radio for you.
* - **Rate Units**
  - Proper Motion (0.0001s/yr, 0.001"/yr)\
    Non-sid Tracking (arcsec/hr, arcsec/hr)\
    Non-sid Tracking (sec/hr, arcsec/hr)
  - Tells FACSUM how to interpret the rate columns of your file, and therefore what motion flag to send to the TCS. *Non-sid Tracking (arcsec/hr, arcsec/hr)* is the default and covers most solar-system target lists. The table's rate column headers update to match the chosen unit mode.
* - **Apply Rates**
  - Checkbox (checked by default)
  - When checked, non-sidereal tracking rates are included in the `COORDS` command sent to the TCS. Uncheck for sidereal targets whose file rates should be ignored.
:::

:::{admonition} Format follows the row
:class: note

A single file may mix formats, and FACSUM parses each line independently. When you select a row, the File Type / Delimiter controls and the detection label update to reflect the format of *that* line.
:::

(sec-4-3)=
## 4.3 Targets Table

:::{figure} ../User_Manual/manual_assets/panel_targets.png
:alt: Target list panel with a loaded list, showing table controls and column headers
:width: 90%

Figure 3: Target Lists panel with *WIRC_Photometric_Standards.csv* loaded (filename shown in the header). S754-C is selected (orange highlight) and marked as observed (✓). The **Load to Telescope** button is active. The bottom bar shows the Add, Delete, and Clear List controls.
:::

| Column | Description |
|---|---|
| **✓** *(Observed)* | Only visible when the table holds at least one target. See [§4.8](sec-4-8). |
| **Name** | Object name from the target file |
| **RA** | Right Ascension (HH:MM:SS.s). Shown in *italics* if FACSUM converted it from a decimal value; hover for the original. |
| **Dec** | Declination (±DD:MM:SS), with the same italic/hover convention |
| **Epoch** | Coordinate epoch (e.g. 2000) |
| **Airmass** | Current airmass, computed from LST telemetry and updated continuously. Shows *Down* when the object is at or below the P200 altitude limit (6.5°, airmass ≈ 8.8), and "—" when LST is unavailable. This column is computed and cannot be edited. |
| **PM RA / Rate RA** | Proper motion or tracking rate in RA. The header label changes with the Rate Units setting: `PM RA (0.0001s/yr)`, `Rate RA (arcsec/hr)` or `Rate RA (s/hr)`. |
| **PM Dec / Rate Dec** | Proper motion or tracking rate in Dec. |
| **Prop RA (mas/yr)** | True proper motion in RA, in milliarcseconds per year. Unlike PM RA / Rate RA above, this column's meaning never changes with the Rate Units setting; it is always proper motion, for target lists that carry both a tracking/offset rate and a separate proper motion figure. |
| **Prop Dec (mas/yr)** | True proper motion in Dec, in milliarcseconds per year. |
| **Notes** | Any trailing text from the source line (text after a `!` character, plus unrecognized trailing tokens) |

NGPS files add two further columns, **Priority** and **Mag / Filter**, and rename the rate columns to **Offset RA** / **Offset Dec** and Notes to **Comment** ([Appendix A.3](app-a-3)). NGPS lines have no separate proper-motion field, so their Prop RA / Prop Dec cells are shown dimmed and blank.

### Lines that fail to parse

Any line FACSUM cannot interpret is listed in red at the top of the table as *"Failed to Parse: …"*, with the raw text shown. These rows are informational only; they cannot be selected or sent. Fix them in the **Edit Text** tab ([§4.6](sec-4-6)), where the same lines are highlighted red as you type.

### Filtering

The search box above the table filters rows live by name as you type. Matching is a simple case-insensitive substring match, with no wildcards needed. Clear the box to show every target again. Filtering never edits or reorders the underlying list; it only hides non-matching rows, and range-selection (Shift+click, below) is aware of which rows are currently visible.

### Reordering columns

Drag a column header left or right to reorder it; drop it where you want it to sit. The new order is remembered in the browser and applies the next time FACSUM is opened on that workstation. The leading **✓** (Observed) column cannot be moved.

### Sorting

Click any column header to sort by that column: click once for ascending, again for descending, and a third time to restore the original file order. An arrow (▲ / ▼) marks the active sort column. Sorting by **Airmass** is a quick way to find the most observable target right now. Sorting is reset whenever the list is re-parsed.

### Selecting a target

Click a row to select it (it highlights in orange), replacing any previous selection. Click the same row again to deselect it. Selecting a target:

- Draws a larger dot, crosshair and full-night path trace for that target on the sky display ([§5.7](sec-5-7))
- Draws that target's airmass curve in the Airmass Plot, and puts its name in the plot's header bar
- Enables the **− Delete Selected** button, and **Load to Telescope** for a single selection only ([§4.7](sec-4-7))
- Updates the Parsing Options controls to reflect that line's own format

### Selecting multiple targets

Hold **Ctrl** (or **⌘ Cmd**) and click additional rows to add or remove them from the selection one at a time, without disturbing the rest. Hold **Shift** and click a row to select every row visually between it and the last row you clicked. The anchor for the range is the most recent plain, Ctrl, or Cmd click, and repeating Shift+click re-draws the range from that same anchor. Combine **Shift+Ctrl** (or **Shift+Cmd**) to add a whole range to an existing selection instead of replacing it. Range selection follows whatever is currently visible on screen, so it respects the active sort order and search filter.

Each selected target is drawn in its own color, consistent across the sky display, the Airmass Plot, *and* that target's own row highlight in the table, so a curve, a path, or a row can always be traced back to the other two at a glance. With two or more targets selected, **Load to Telescope** is disabled (the TCS can only be sent one target's coordinates at a time) but **− Delete Selected** removes all selected targets together.

(sec-4-4)=
## 4.4 Editing the Table Directly

**Double-click any editable cell** to change its value in place, without switching to the Edit Text tab. The cell becomes a text field; press **Enter** to commit, **Escape** to cancel. Clicking elsewhere also commits. The Airmass column is computed and the ✓ column is a toggle, so neither is editable.

Values are validated as you type, and an invalid value *refuses to commit*: the field stays open with a red outline and an explanatory tooltip:

| Field | Accepted | Example message |
|---|---|---|
| Name | Any non-empty string; at most 17 characters on a PTIC-format line | *Name too long for PTIC format (max 17 chars)* |
| RA | `HH:MM:SS[.ss]`, hours 0–23 | *Impossible RA — minutes must be 0–59* |
| Dec | `±DD:MM:SS[.s]`, magnitude ≤ 90° | *Invalid syntax — expected ±DD:MM:SS.s* |
| Epoch | `2000`, `2000.0`, `J2000`, `B1950` | *Invalid epoch — expected e.g. 2000, J2000, B1950* |
| Rates | A signed number | *Invalid rate — expected a numeric value* |
| Notes, Priority, Mag / Filter | Free text | None |

On commit, FACSUM rewrites only the edited line in the raw text, in that line's own original format ([Appendix A.4](app-a-4)), and then re-parses the whole list, so the table and the text you would save can never drift apart. Your sort order and row selection are preserved across the edit.

(sec-4-5)=
## 4.5 Adding, Deleting & Clearing Targets

### Adding a single target manually

Click **+ Add Single Target** at the bottom of the panel to open a data-entry form. **Name**, **RA** and **Dec** are required (the **Add Target** button stays disabled until all three are valid) and fields are validated exactly as in [§4.4](sec-4-4), with a green outline for good input and a red outline plus tooltip for bad. The form separates *Non-sidereal Rates* (arcsec/hr) from *Proper Motion* (mas/yr), and has a free-text Notes field. Pressing **Enter** anywhere in the form submits it when the required fields are valid.

The new target is appended to the list as a comma-delimited line and is immediately available for selection and sending. This is the quickest way to add a target of opportunity.

### SIMBAD name resolution

Type an object name and click the **🔍** button beside it to look the object up in **SIMBAD** (via the CDS Sesame name resolver, proxied through Observer1). The form is replaced by a result card:

- **Object matched:** shows the resolved Name, RA, Dec, Epoch (J2000) and proper motions in mas/yr. Click **Add Target ✓** to add it directly, or **← Edit** to copy the values back into the form for adjustment before adding.
- **Not found:** shows a short explanation (*Target not found*, *Could not reach SIMBAD*, *Server error*) with an expandable *Details* section carrying the technical response. Click **← Back** to return to the form.

:::{note}
The lookup requires outbound network access from Observer1 to `cdsweb.u-strasbg.fr` and times out after 15 seconds. It resolves coordinates and proper motions only, never rates, magnitudes or exposure times.
:::

### Deleting a target

Select one or more rows ([§4.3](sec-4-3)), then click **− Delete Selected** to remove them. The corresponding line(s) are deleted from the raw text and the list is re-parsed. The deletion cannot be undone from the table view; use the Edit Text tab ([§4.6](sec-4-6)) and its Undo button if needed.

### Clearing the target list

Click **✕ Clear List** (separated by a `|` from the Delete button) to unload everything. This removes all rows, clears the Edit Text area and the detected-format label, hides the Observed column, resets the filename display to *—*, disables Save and Load to Telescope, and resets the file browser back to `/observer/observer/targets` so the next **Load Target List** opens there. The sky display and airmass plot clear immediately. This action cannot be undone.

(sec-4-6)=
## 4.6 Edit Text Tab

:::{figure} ../User_Manual/manual_assets/tab_edit.png
:alt: Edit Text tab with syntax-highlighted PTIC target list

Figure 4: Edit Text tab. Lines are colored in real time: valid targets in green, unparseable lines in red, and comments/blanks dimmed.
:::

The **Edit Text** tab shows the raw text of the loaded target list and lets you edit it directly. It is the single source of truth: everything the table shows is parsed from this text, and it is exactly what gets written when you save. A live syntax-highlighting overlay colors each line as you type:

- [Green]{.clr-green}: line was successfully parsed as a target
- [Red]{.clr-red}: line could not be parsed (check format or delimiter settings)
- [Dimmed]{.dimmed}: comment line (starts with `#` or `!`), blank line, or an NGPS header row

Three action buttons appear at the bottom of the Edit Text pane:

- **↩ Undo** / **↪ Redo**: step backward or forward through the editing history (equivalent to Ctrl+Z / Ctrl+Y)
- **↺ Parse Text**: apply the current text and switch back to the table view

Switching to the **Targets Table** tab also re-parses the text, so you can move between the two views freely.

(sec-4-7)=
## 4.7 Sending a Target to the Telescope

The **Load to Telescope** button sits in its own bar between the Parsing Options and the table. It is always visible but stays disabled until exactly one table row is selected. With two or more targets selected ([§4.3](sec-4-3)) it stays disabled, since the TCS can only be sent one target's coordinates at a time. Clicking it sends a `COORDS` command to the P200 TCS over a direct network connection (see [Appendix B](app-b) for the command format).

The button shows a brief status as the command is processed:

- **Sending…**: command is in flight; button is temporarily disabled
- **Target Loaded!**: TCS acknowledged the coordinates; the [Loaded]{.clr-orange} block in the Telemetry panel updates, and a [✓]{.clr-orange} is placed in the target's Observed column ([§4.8](sec-4-8)). Reverts to normal after 2 s.
- **Error**: command failed; check the network connection or the server log (reverts after 2.5 s). The detailed error is written to the browser console.

If the selected row has an RA or Dec that cannot be interpreted, FACSUM refuses to send and shows an alert instead.

:::{admonition} Two things to check before sending
:class: warning

- Rates are only included when *Apply Rates* is checked, *Rate Units* is one of the two Non-sid Tracking modes, **and** at least one of the target's two rate values is non-zero. Otherwise zero rates are sent regardless of what the file contains.
- COORDS loads coordinates but **does not slew** the telescope. Issue a separate slew command in the TCS software after sending.
:::

(sec-4-8)=
## 4.8 Observed Column

When the table holds at least one target, its first column shows a [✓]{.clr-orange} for each target that has been observed during the session. The column is hidden when the table is empty.

- **Automatic marking:** when a target is successfully sent to the telescope via **Load to Telescope** and the TCS acknowledges the command, its row is marked automatically.
- **Manual toggle:** click the [✓]{.clr-orange} cell of any row to add or remove the mark by hand. This is useful for correcting the record or marking targets observed by other means.
- **Row highlight:** observed rows are tinted faint orange to make them visually distinct from unobserved targets at a glance.
- **Session only:** the observed state is held in memory and is never written to the target file. It survives sorting, but is cleared whenever the list is re-parsed: loading a list, parsing edited text, editing a cell, or adding or deleting a target.

(sec-4-9)=
## 4.9 Saving a Target List

Click **Save Target List** in the panel header to open the file browser in save mode ([§7](sec-7)). A *Filename* field appears, pre-filled with the name of the currently loaded list, and the action button reads **Save Here**. Navigate to the directory you want, adjust the filename, and click **Save Here** to write the current text (including any edits, additions and deletions) either over the original file or to a new one. Clicking an existing file copies its name into the field, so overwriting is deliberate rather than accidental.

:::{note}
Saves are confined to the Observer1 target directory tree. Some older target lists are owned by stale accounts and cannot be written in place; in that case FACSUM replaces the file rather than failing, which also transfers ownership going forward.
:::
