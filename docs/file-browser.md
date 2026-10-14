(sec-7)=
# 7 Target File Browser

:::{figure} ../User_Manual/manual_assets/modal_sftp_crop.png
:alt: Target file browser modal showing a directory listing
:width: 80%

Figure 9: The file browser opened at `/observer/observer/targets`. Directories are listed first in orange; the selected file is highlighted.
:::

The file browser gives you access to the target-list directory on **observer1.palomar.caltech.edu**. It opens when you click **+ Load Target List** (open mode) or **Save Target List** (save mode) in the Target Lists panel header.

## Navigating and opening files

| Action | How |
|---|---|
| Enter a directory | Double-click any [\[dir\]]{.clr-orange} row |
| Go up one level | Click **↑ Up** in the modal header (disabled at the root) |
| Filter the listing | Type in the *Filter by name…* box (case-insensitive; resets on navigation). The status line shows the number of matches. |
| Sort the listing | Click a column header (Name, Size, or Modified) to sort; click again to reverse. Directories always sort before files. |
| Select a file | Click a file row to highlight it |
| Open a file | Double-click a file row, or click a row and press **Open** |
| Save to a file | In save mode, navigate to the directory, type or confirm the *Filename*, and press **Save Here**. Clicking an existing file copies its name into the field. |
| Cancel | Click **Cancel**, the ✕ button, or outside the dialog. Nothing is loaded or written. |

The browser opens at `/observer/observer/targets` and, within a single page load, reopens wherever you last were. Reloading the page (or clicking **✕ Clear List**) returns it to the default directory.

Access is confined to that directory and its subdirectories: **↑ Up** stops at the root and any path outside the tree is rejected by the server. The status line at the bottom of the dialog reports the number of files and folders in the current directory, or an error if a directory cannot be read.

FACSUM accepts any plain-text target file in CSV, PTIC or NGPS format (see [Appendix A](app-a)). File extensions (`.csv`, `.ptic`, `.list`, `.txt`, etc.) are not significant; the format is detected from the file content automatically.
