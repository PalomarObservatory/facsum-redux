(app-a)=
# Appendix A: Target File Formats

FACSUM supports three plain-text target list formats. All three accept **comment lines** beginning with `#` or `!`, and **inline comments** after a `!` on any data line. Text after the `!` is treated as notes and is shown in the Notes column of the table.

Lines are parsed *independently*: a file may mix CSV and PTIC lines, and each row remembers which format it came from so that later edits are written back in the same style ([A.4](app-a-4)).

(app-a-1)=
## A.1 CSV Format

Tabular data with consistent column separators (comma, semicolon, tab, space, pipe, or a custom character). Fields are positional and parsed left-to-right:

| # | Field | Required? | Format | Example |
|---|---|---|---|---|
| 1 | Name | Yes | Any string; quote it if it contains the delimiter | `HZ Her` |
| 2 | RA | Yes | `HH:MM:SS.s`, `HH MM SS`, or a decimal value | `18:10:28.1` |
| 3 | Dec | Yes | `±DD:MM:SS`, `DD MM SS`, or decimal degrees | `+30:48:22` |
| 4 | Epoch | No | J2000, B1950, or a numeric year (defaults to 2000) | `2000` |
| 5 | Rate RA | No | Numeric; units set by the Rate Units control | `0.00` |
| 6 | Rate Dec | No | Numeric | `0.00` |
| 7 | PM RA | No | Numeric, mas/yr; only read if fields 5 and 6 are also numeric | `-1.234` |
| 8 | PM Dec | No | Numeric, mas/yr | `3.456` |
| 9+ | Notes | No | Any remaining text, or text after `!` | `Flux std` |

The four optional numeric fields are consumed greedily and in order: the first non-numeric token stops the sequence, and everything from that point onward becomes Notes. So a line with a rate pair followed by a comment works, but a line with a comment between the rates and the proper motions does not.

### Coordinate flexibility

- **Decimal coordinates** are accepted and converted to sexagesimal on load. An RA of 24 or less is read as *hours*; anything larger (up to 360) is read as *degrees*. Dec is always degrees, −90 to +90. Converted cells are shown in italics, and hovering one reveals what was in the file (e.g. *Parsed as 272.617°*).
- **Sexagesimal values must be complete:** `10:08:22.4` parses, `10:08` does not.
- **Space-delimited files** may split coordinates into separate tokens (`HZ_Her 18 10 28.1 +30 48 22 2000`); FACSUM recognizes this when there are at least seven tokens and the second is a bare number.
- **Multi-word names** are supported in whitespace-delimited files provided the coordinates are written with colons (`M 57 18:53:35.1 +33:01:45`); everything before the first sexagesimal token is taken as the name.

**Example (comma-separated):**

```text
# Name,         RA,          Dec,        Epoch
HZ Her,       18:10:28.1,  +30:48:22,  2000
NGC 6543,     17:58:33.4,  +66:37:59,  2000   ! Cat Eye Nebula
Feige 110,    23:19:58.4,  -05:09:56,  2000   ! Flux standard
```

(app-a-2)=
## A.2 PTIC Format

Fixed-width format used by the original FACSUM and the Palomar TCS catalog system. The target name occupies the first 17 characters (space-padded); the remainder of the line is split into space-separated tokens.

| Columns | Field | Notes |
|---|---|---|
| 0 – 16 | Name (17 chars) | Space-padded to the right |
| 17+ | RA | Three tokens: `HH MM SS.s` (required) |
| | Dec | Three tokens: `±DD MM SS` (required) |
| | Epoch (optional) | Any later token that looks like an epoch (`2000`, `J2000`, `B1950`). Defaults to 2000 if absent. |
| | Rates (optional) | A single token of the form `pm=<rateRA>,<rateDec>`. Units are set by the Rate Units control. |
| | Notes (optional) | Any remaining tokens, plus anything after a `!` |

:::{admonition} PTIC rates need the pm= prefix
:class: warning

Unlike CSV, bare numbers after the epoch are *not* read as rates; they are collected into Notes. Write `pm=12.4,-3.1` to specify tracking rates on a PTIC line.
:::

**Example:**

```text
# Name              RA                 Dec             Epoch
HZ Her            18 10 28.1  +30 48 22   2000
NGC 6543          17 58 33.4  +66 37 59   2000  ! Cat Eye Nebula
BD+28 4211        21 51 11.0  +28 51 50   2000
Encke             08 44 12.0  +18 22 05   2000  pm=41.7,-12.3  ! comet
```

:::{admonition} Auto-detection preference
:class: note

When PTIC and a CSV variant parse a file equally well, PTIC wins. If auto-detection picks the wrong format, select the correct one explicitly with the File Type radio buttons.
:::

(app-a-3)=
## A.3 NGPS Format

Column-based format used by the **Next Generation Palomar Spectrograph (NGPS)** observing tool. FACSUM recognizes it automatically from a header row whose first three columns are `NAME`, `RA`, and `DECL`. Detection takes precedence over CSV and PTIC, and the File Type radio buttons do not apply.

NGPS coordinates may be written either as **decimal degrees** (J2000) for both axes (the form the NGPS tool itself produces) or as ordinary **sexagesimal** values (`16:31:33.810`, `+30:08:46.40`), which some list generators emit instead. FACSUM detects which is in use line by line, so a file written either way loads without any setting to change. Coordinates are converted as needed for display and for sending to the TCS.

| Column | Required? | Description |
|---|---|---|
| **NAME** | Yes | Target name |
| **RA** | Yes | Right Ascension, J2000, as decimal degrees or `HH:MM:SS.s` |
| **DECL** | Yes | Declination, J2000, as decimal degrees or `±DD:MM:SS.s` |
| **OFFSET_RA** | No | RA offset (arcsec); shown in the *Offset RA* column |
| **OFFSET_DEC** | No | Dec offset (arcsec); shown in the *Offset Dec* column |
| **COMMENT** | No | Free-text comment, shown in the *Comment* column |
| **PRIORITY** | No | Integer priority; shown in an extra *Priority* column |
| **MAGNITUDE**, **MAGFILTER** | No | Object magnitude and its filter band; shown together in a *Mag / Filter* column |
| **EXPTIME** | No | Exposure time (seconds) or `SNR <value>` |

Both comma-separated and space-delimited NGPS files are supported. In space-delimited files the `COMMENT` column may contain spaces, so FACSUM parses the trailing structured columns from the end of the line inward and treats whatever is left as the comment. Other NGPS spectrograph columns (`BINSPAT`, `BINSPECT`, `SLITANGLE`, `SLITWIDTH`, `AIRMASS_MAX`, `WRANGE_LOW`, `WRANGE_HIGH`, `CHANNEL`) are recognized for that purpose but are not displayed.

**Example (space-delimited, decimal degrees):**

```text
# NGPS target list
NAME             RA         DECL       COMMENT          PRIORITY  MAGNITUDE  MAGFILTER  EXPTIME
HZ_Her           272.6170   30.8061    X-ray binary      1         8.9        V          600
NGC_6543         269.6392   66.6330    Cat Eye Nebula    2        11.2        V          300
```

**Example (comma-separated, sexagesimal):**

```text
NAME,RA,DECL,SLITWIDTH,EXPTIME,NEXP,AIRMASS_MAX,COMMENT
P330E,16:31:33.810,+30:08:46.40,SET 1.5,SET 60,2,1.8,CALSPEC standard
P2190,16:01:01.838,+36:56:19.70,SET 1.5,SET 300,2,1.5,visit 20:16-20:32 PDT
```

(app-a-4)=
## A.4 How Edits Are Written Back

Editing a cell ([§4.4](sec-4-4)), deleting a row, or adding a target rewrites the raw text (which is what a save actually writes to disk) and each touched line is re-serialised in its own format:

| Line format | Written back as |
|---|---|
| CSV | The same delimiter the line was read with; the name is quoted if it contains that delimiter. Rates are emitted as a pair (defaulting to `0`) if any rate or proper motion is set, followed by the proper-motion pair when present. |
| PTIC | 17-character padded name, six coordinate tokens, epoch, then `pm=<rateRA>,<rateDec>` when rates are set. |
| NGPS | The file's own column order and delimiter, with RA/Dec written back in the same notation the line was read in (decimal degrees to 6 dp, or sexagesimal), so one edited line does not end up in a different format from the rest of the file. |
| Added via the form | A comma-delimited CSV line. |
| Notes (any format) | Appended as a trailing `!comment`. |

Untouched lines (including comments, blank lines and lines that failed to parse) are preserved byte-for-byte. One consequence is worth noting for NGPS files: because a structured `COMMENT` column and an inline `!comment` are indistinguishable once parsed, an edited NGPS line settles on the trailing `!comment` form and leaves its COMMENT column empty.

:::{admonition} Editing an NGPS line discards its spectrograph columns
:class: warning

FACSUM reads and displays only `NAME`, `RA`, `DECL`, `OFFSET_RA`, `OFFSET_DEC`, `COMMENT`, `PRIORITY`, `MAGNITUDE`, `MAGFILTER` and `EXPTIME`. Any other column (`NEXP`, `SLITWIDTH`, `SLITANGLE`, `BINSPAT`, `BINSPECT`, `AIRMASS_MAX`, `NOTE`, and so on) is carried through untouched only for as long as you leave that line alone. Edit any cell on that row and save, and those columns are written back empty.

This matters only if you save over the original. Loading an NGPS list, selecting targets and sending them to the telescope never rewrites anything. If you need to edit an NGPS list that carries spectrograph settings, save it under a new name and keep the original for the instrument.
:::
