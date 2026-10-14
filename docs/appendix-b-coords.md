(app-b)=
# Appendix B: TCS COORDS Command Reference

When **Load to Telescope** is clicked, FACSUM sends a `COORDS` command from Observer1 to the TCS over a direct TCP connection on port **49200**. The full command format is:

```text
COORDS  <RA_h>  <Dec_deg>  <epoch>  <rate_RA>  <rate_Dec>  [mflag]  '<name>'
```

| Argument | Type | Description |
|---|---|---|
| `RA_h` | Float | Right Ascension in decimal hours (6 decimal places) |
| `Dec_deg` | Float | Declination in decimal degrees, negative = south (6 decimal places) |
| `epoch` | Float | Coordinate epoch (e.g. `2000`); any `J`/`B` prefix in the file is stripped |
| `rate_RA` | Float | RA rate (4 decimal places); `0.0` if rates are not applied |
| `rate_Dec` | Float | Dec rate (4 decimal places); `0.0` if rates are not applied |
| `mflag` | Integer (optional) | Motion flag: *absent* = proper motion / no rates; *1* = arcsec/hr on both axes; *2* = RA in sec/hr, Dec in arcsec/hr |
| `name` | String | Target name in single quotes; any single quotes in the name itself are stripped |

The `mflag` argument is emitted only when rates are actually being sent: when *Apply Rates* is checked, *Rate Units* is one of the Non-sid Tracking modes, and at least one rate is non-zero. Otherwise the command carries `0.0 0.0` and no flag.

## Examples

**Sidereal target, no rates:**

```text
COORDS 18.174472 30.806167 2000 0.0 0.0 'HZ Her'
```

**Non-sidereal target with arcsec/hr rates (mflag 1):**

```text
COORDS 10.884722 14.235000 2000 12.4000 -3.1000 1 'Mars'
```

**Non-sidereal target with sec/hr RA rate (mflag 2):**

```text
COORDS 10.884722 14.235000 2000 0.8300 -3.1000 2 'Mars'
```

:::{admonition} Safety
:class: note

The FACSUM server accepts *only* `COORDS` commands from the browser; anything else is rejected before a socket is opened, and embedded newlines are stripped. FACSUM cannot slew, offset, focus or otherwise move the telescope.
:::

:::{warning}
**Reminder:** COORDS loads coordinates into the TCS but does not move the telescope. Always issue a separate slew command in the TCS software after sending.
:::
