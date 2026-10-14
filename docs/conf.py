# Sphinx configuration for the FACSUM user manual.
#
# Build locally:
#     pip install -r docs/requirements.txt
#     sphinx-build -b html docs docs/_build/html

project = "FACSUM"
author = "Palomar Observatory, California Institute of Technology"
copyright = "2026, Palomar Observatory, California Institute of Technology"
release = "1.5"
version = release

extensions = ["myst_parser"]
myst_enable_extensions = ["colon_fence", "attrs_inline"]

exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

# Keep " as a straight quote — the manual uses it for arcseconds.
smartquotes = False

html_theme = "furo"
html_title = "FACSUM User Manual"
html_static_path = ["_static"]
html_css_files = ["custom.css"]
html_theme_options = {
    "light_css_variables": {
        "color-brand-primary": "#2b7fa3",
        "color-brand-content": "#2b7fa3",
    },
    "dark_css_variables": {
        "color-brand-primary": "#5aafcf",
        "color-brand-content": "#5aafcf",
    },
}
