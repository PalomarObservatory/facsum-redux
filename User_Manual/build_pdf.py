#!/usr/bin/env python3
"""
build_pdf.py — render FACSUM_Web_User_Manual.html to a print-ready PDF.

The HTML manual is the source of truth; this script re-implements its visual
style with ReportLab so a PDF can be produced without a headless browser.

Usage:
    python3 build_pdf.py [input.html] [output.pdf]

Defaults to FACSUM_Web_User_Manual.html → FACSUM_User_Manual_Rev1.5.pdf in
this directory.  Requires: reportlab, beautifulsoup4, DejaVu fonts.
"""

import os
import re
import sys

from bs4 import BeautifulSoup, NavigableString, Tag
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, HRFlowable, Image,
                                CondPageBreak, KeepTogether, NextPageTemplate,
                                PageBreak,
                                PageTemplate, Paragraph, Preformatted, Spacer,
                                Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))

# ── Palette (mirrors the :root block in the HTML) ────────────────────────────
CYAN     = colors.HexColor('#4da6c8')
ORANGE   = colors.HexColor('#c97a2a')
PURPLE   = colors.HexColor('#7c5ca8')
GREEN    = colors.HexColor('#2e8b57')
RED      = colors.HexColor('#b03030')
YELLOW   = colors.HexColor('#a09010')
INK      = colors.HexColor('#222222')
DARK     = colors.HexColor('#1a1a2e')
NOTE_BG  = colors.HexColor('#f0f6fb')
WARN_BG  = colors.HexColor('#fff8ee')
CODE_BG  = colors.HexColor('#1a1a2e')
CODE_FG  = colors.HexColor('#8be9fd')
ROW_ALT  = colors.HexColor('#f8f8fc')
RULE     = colors.HexColor('#dddddd')

CLR_CLASS = {
    'clr-green':  '#2e8b57',
    'clr-yellow': '#a09010',
    'clr-orange': '#c97a2a',
    'clr-red':    '#b03030',
    'clr-cyan':   '#4da6c8',
    'clr-purple': '#7c5ca8',
}

# ── Fonts ────────────────────────────────────────────────────────────────────
# Where to look for the DejaVu family. Order matters: a copy vendored next to
# this script wins, then system locations, then matplotlib's bundled copy.
#
# This matters more than it looks. The manual uses ~45 UI glyphs — ✓ ● ▲ ▼ ⌂ ⌘
# ↩ ↪ ↺ ← ↑ → − ≈ ≤ ″ ✕ — none of which exist in the Helvetica/Courier fallback
# below, whose encoding is limited to Latin-1. When DejaVu is missing, every one
# of those renders as an empty box. macOS ships no DejaVu, so the fallback was
# being taken silently on any Mac; matplotlib bundles the whole family, which is
# what rescues it here.
FONT_DIRS = [
    os.path.join(HERE, 'fonts'),
    '/usr/share/fonts/truetype/dejavu',
    '/Library/Fonts',
    '/System/Library/Fonts',
]
try:
    import matplotlib
    FONT_DIRS.append(os.path.join(matplotlib.get_data_path(), 'fonts', 'ttf'))
except Exception:
    pass


def _find(name):
    for d in FONT_DIRS:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None


def register_fonts():
    faces = {
        'Body':   'DejaVuSans.ttf',
        'Body-B': 'DejaVuSans-Bold.ttf',
        'Body-I': 'DejaVuSans-Oblique.ttf',
        'Body-BI': 'DejaVuSans-BoldOblique.ttf',
        'Mono':   'DejaVuSansMono.ttf',
        'Mono-B': 'DejaVuSansMono-Bold.ttf',
    }
    ok = True
    for alias, fn in faces.items():
        path = _find(fn)
        if path is None:
            ok = False
            break
        pdfmetrics.registerFont(TTFont(alias, path))
    if not ok:                                    # fall back to built-ins
        sys.stderr.write(
            'build_pdf: WARNING - DejaVu fonts not found, falling back to Helvetica.\n'
            '  Symbols such as the check mark, bullet, triangles, house and Cmd key\n'
            '  cannot be encoded in that font and will render as empty boxes.\n'
            '  Fix: pip install matplotlib, or copy the six DejaVu*.ttf files\n'
            '  into %s\n' % os.path.join(HERE, 'fonts'))
        return 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier'
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='Body-B',
                                  italic='Body-I', boldItalic='Body-BI')
    pdfmetrics.registerFontFamily('Mono', normal='Mono', bold='Mono-B',
                                  italic='Mono', boldItalic='Mono-B')
    return 'Body', 'Body-B', 'Body-I', 'Mono'


F, FB, FI, FM = register_fonts()

# ── Paragraph styles ─────────────────────────────────────────────────────────
S_BODY = ParagraphStyle('body', fontName=F, fontSize=9.5, leading=14,
                        textColor=INK, spaceAfter=6, alignment=TA_LEFT)
S_LI = ParagraphStyle('li', parent=S_BODY, spaceAfter=3, leftIndent=14,
                      bulletIndent=3)
S_STEP = ParagraphStyle('step', parent=S_BODY, spaceAfter=7, leftIndent=20,
                        bulletIndent=0, bulletFontName=FB, bulletFontSize=10,
                        bulletColor=CYAN)
S_H2 = ParagraphStyle('h2', fontName=FB, fontSize=15, leading=19,
                      textColor=DARK, spaceBefore=0, spaceAfter=3)
S_H3 = ParagraphStyle('h3', fontName=FB, fontSize=11, leading=15,
                      textColor=colors.HexColor('#2a2a40'), leftIndent=7,
                      spaceBefore=2, spaceAfter=2)
S_H4 = ParagraphStyle('h4', fontName=FB, fontSize=10, leading=14,
                      textColor=colors.HexColor('#333333'), spaceBefore=8,
                      spaceAfter=2)
S_CAP = ParagraphStyle('cap', fontName=FI, fontSize=8, leading=11,
                       textColor=colors.HexColor('#555555'), alignment=TA_CENTER,
                       spaceBefore=5, spaceAfter=2)
S_TD = ParagraphStyle('td', fontName=F, fontSize=8.3, leading=11.5, textColor=INK)
S_TH = ParagraphStyle('th', fontName=FB, fontSize=8.3, leading=11.5,
                      textColor=colors.HexColor('#e0e0f0'))
S_CALL = ParagraphStyle('callout', parent=S_BODY, fontSize=8.8, leading=12.5,
                        spaceAfter=4)
S_CALL_LI = ParagraphStyle('callout-li', parent=S_CALL, leftIndent=13,
                           bulletIndent=3, spaceAfter=2)
S_PRE = ParagraphStyle('pre', fontName=FM, fontSize=7.6, leading=10.4,
                       textColor=CODE_FG)
S_FOOT = ParagraphStyle('foot', fontName=F, fontSize=7.5, leading=10,
                        textColor=colors.HexColor('#888888'), alignment=TA_CENTER)
S_TOC = [
    ParagraphStyle('toc1', fontName=FB, fontSize=9.5, leading=15,
                   textColor=DARK, spaceBefore=5),
    ParagraphStyle('toc2', fontName=F, fontSize=9, leading=13,
                   textColor=colors.HexColor('#444444'), leftIndent=18),
]

PAGE_W, PAGE_H = letter
M_L, M_R, M_T, M_B = 0.85 * inch, 0.85 * inch, 0.9 * inch, 0.85 * inch
CONTENT_W = PAGE_W - M_L - M_R


# ── Inline markup conversion ─────────────────────────────────────────────────
# Characters no embeddable text font carries, mapped to wording that reads the
# same. U+1F50D (magnifying glass) exists only in Apple Color Emoji, which is a
# colour-bitmap font ReportLab cannot embed as text — and DejaVu, like every
# other monochrome face here, has no emoji at all. The HTML keeps the real
# character, where a browser renders it correctly; only the PDF substitutes.
PDF_CHAR_SUBS = {'\U0001F50D': 'magnifier'}


def esc(text):
    for ch, rep in PDF_CHAR_SUBS.items():
        text = text.replace(ch, rep)
    return (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def inline(node, mono_color='#1a1a2e'):
    """Convert an element's children into ReportLab inline markup."""
    out = []
    for child in node.children:
        if isinstance(child, NavigableString):
            out.append(esc(str(child)))
            continue
        if not isinstance(child, Tag):
            continue
        name = child.name
        inner = inline(child, mono_color)
        if name in ('strong', 'b'):
            out.append(f'<b>{inner}</b>')
        elif name in ('em', 'i'):
            out.append(f'<i>{inner}</i>')
        elif name == 'code':
            out.append(f'<font face="{FM}" size="8" color="{mono_color}">{inner}</font>')
        elif name == 'br':
            out.append('<br/>')
        elif name == 'span':
            cls = ' '.join(child.get('class', []))
            style = child.get('style', '') or ''
            colr = None
            for k, v in CLR_CLASS.items():
                if k in cls:
                    colr = v
            m = re.search(r'color:\s*(#[0-9a-fA-F]{3,6})', style)
            if m:
                colr = m.group(1)
            if colr:
                out.append(f'<font color="{colr}"><b>{inner}</b></font>')
            else:
                out.append(inner)
        elif name == 'sup':
            out.append(f'<super>{inner}</super>')
        elif name == 'sub':
            out.append(f'<sub>{inner}</sub>')
        else:
            out.append(inner)
    text = ''.join(out)
    text = re.sub(r'[ \t]*\n[ \t]*', ' ', text)
    return re.sub(r'  +', ' ', text).strip()


def badge(label, color):
    """Small coloured section badge, e.g. the '1' before a chapter title."""
    return (f'<font face="{FB}" size="9" color="#ffffff" backColor="{color}">'
            f' {label} </font>&nbsp;')


# ── Block builders ───────────────────────────────────────────────────────────
def heading2(tag, story, toc_sink):
    # Sections flow into one another rather than each starting a page, so a
    # heading could otherwise land as the last thing on a page with its body
    # overleaf. Require enough room for the heading plus a few lines of text.
    story.append(CondPageBreak(110))
    span = tag.find('span', class_='sec-num')
    label = span.get_text(strip=True) if span else ''
    is_app = span is not None and 'app' in span.get('class', [])
    if span:
        span.extract()
    title = inline(tag)
    accent = PURPLE if is_app else CYAN
    badge_style = ParagraphStyle('badge', fontName=FB, fontSize=11, leading=15,
                                 textColor=colors.white, alignment=TA_CENTER)
    cells = [[Paragraph(label, badge_style), Paragraph(f'<b>{title}</b>', S_H2)]]
    bw = 22 if len(label) <= 1 else 26
    head = Table(cells, colWidths=[bw, CONTENT_W - bw], hAlign='LEFT')
    head.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), accent),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (0, 0), 0),
        ('RIGHTPADDING', (0, 0), (0, 0), 0),
        ('LEFTPADDING', (1, 0), (1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(head)
    story.append(HRFlowable(width='100%', thickness=1.6, color=accent,
                            spaceBefore=4, spaceAfter=9))
    plain = re.sub('<[^>]+>', '', title)
    toc_sink.append((0, f'{label} {plain}' if label else plain, head))


def heading3(tag, story, toc_sink):
    story.append(CondPageBreak(78))
    title = inline(tag)
    para = Paragraph(f'<b>{title}</b>', S_H3)
    bar = Table([[para]], colWidths=[CONTENT_W - 4])
    bar.setStyle(TableStyle([
        ('LINEBEFORE', (0, 0), (0, 0), 2.2, CYAN),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(Spacer(1, 7))
    story.append(bar)
    story.append(Spacer(1, 3))
    toc_sink.append((1, re.sub('<[^>]+>', '', title), bar))


def build_list(tag, style, bullet='•'):
    items = []
    for li in tag.find_all('li', recursive=False):
        nested = li.find(['ul', 'ol'], recursive=False)
        sub = None
        if nested:
            nested.extract()
            sub = build_list(nested, style, '–')
        items.append(Paragraph(inline(li), style, bulletText=bullet))
        if sub:
            for s in sub:
                s.style = ParagraphStyle('sub', parent=style,
                                         leftIndent=style.leftIndent + 14,
                                         bulletIndent=style.bulletIndent + 12)
                items.append(s)
    return items


def build_steps(tag):
    out = []
    for n, li in enumerate(tag.find_all('li', recursive=False), 1):
        holder = li.find('div') or li
        out.append(Paragraph(inline(holder), S_STEP, bulletText=str(n) + '.'))
    return out


def build_table(tag):
    head, body, widths = [], [], None
    thead = tag.find('thead')
    if thead:
        head = [Paragraph(inline(th), S_TH) for th in thead.find_all('th')]
    rows, dividers = [], []
    for tr in tag.find('tbody').find_all('tr') if tag.find('tbody') else []:
        cells = tr.find_all(['td', 'th'])
        rows.append([Paragraph(inline(td), S_TD) for td in cells])
        if 'divider' in (tr.get('class') or []):
            dividers.append(len(rows) - 1 + (1 if head else 0))
    data = ([head] if head else []) + rows
    ncols = max(len(r) for r in data)
    for r in data:
        while len(r) < ncols:
            r.append(Paragraph('', S_TD))

    # Column widths: first column narrower for 2-3 column reference tables
    if ncols == 2:
        widths = [CONTENT_W * 0.30, CONTENT_W * 0.70]
    elif ncols == 3:
        widths = [CONTENT_W * 0.24, CONTENT_W * 0.24, CONTENT_W * 0.52]
    elif ncols == 4:
        widths = [CONTENT_W * 0.20, CONTENT_W * 0.15, CONTENT_W * 0.13, CONTENT_W * 0.52]
    elif ncols == 5:
        widths = [CONTENT_W * 0.05, CONTENT_W * 0.16, CONTENT_W * 0.11,
                  CONTENT_W * 0.40, CONTENT_W * 0.28]
    else:
        widths = [CONTENT_W / ncols] * ncols

    t = Table(data, colWidths=widths, repeatRows=1 if head else 0, hAlign='LEFT')
    style = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 3.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
        ('LINEBELOW', (0, 1 if head else 0), (-1, -1), 0.4,
         colors.HexColor('#eeeeee')),
    ]
    if head:
        style += [('BACKGROUND', (0, 0), (-1, 0), DARK)]
    start = 1 if head else 0
    for i in range(start, len(data)):
        if (i - start) % 2 == 1:
            style.append(('BACKGROUND', (0, i), (-1, i), ROW_ALT))
    for d in dividers:
        style.append(('BACKGROUND', (0, d), (-1, d), colors.HexColor('#e8ecf4')))
    t.setStyle(TableStyle(style))
    return [Spacer(1, 5), t, Spacer(1, 9)]


def build_pre(tag):
    text = tag.get_text()
    text = text.replace(' ', ' ')
    inner = Preformatted(text.strip('\n'), S_PRE)
    t = Table([[inner]], colWidths=[CONTENT_W], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CODE_BG),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 9)]


def build_callout(tag, kind):
    bg, bar = (NOTE_BG, CYAN) if kind == 'note' else (WARN_BG, ORANGE)
    head_color = '#2a7090' if kind == 'note' else '#8a4a10'
    inner = []
    lists = tag.find_all('ul', recursive=False)
    for ul in lists:
        ul.extract()
    text = inline(tag, mono_color=head_color)
    if text:
        inner.append(Paragraph(text, S_CALL))
    for ul in lists:
        inner += build_list(ul, S_CALL_LI)
    t = Table([[inner]], colWidths=[CONTENT_W], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('LINEBEFORE', (0, 0), (0, 0), 3, bar),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 9)]


def _img_flowable(img_tag, max_w):
    src = img_tag['src']
    path = os.path.join(HERE, src)
    if not os.path.exists(path):
        return None
    from PIL import Image as PILImage
    with PILImage.open(path) as im:
        iw, ih = im.size
    w = min(max_w, iw * 0.75)          # 96 dpi screenshot → 72 dpi page
    h = w * ih / iw
    max_h = PAGE_H - M_T - M_B - 90
    if h > max_h:
        h = max_h
        w = h * iw / ih
    return Image(path, width=w, height=h)


def build_figure(tag, width_frac=1.0):
    img = tag.find('img')
    cap = tag.find('figcaption')
    flow = _img_flowable(img, CONTENT_W * width_frac) if img else None
    parts = []
    if flow:
        holder = Table([[flow]], colWidths=[CONTENT_W], hAlign='LEFT')
        holder.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('BOX', (0, 0), (-1, -1), 0, colors.white),
        ]))
        parts.append(holder)
    if cap:
        parts.append(Paragraph(inline(cap), S_CAP))
    if not parts:
        return []
    return [Spacer(1, 8), KeepTogether(parts), Spacer(1, 10)]


def build_two_col(tag):
    figs = tag.find_all('figure', recursive=False)
    if len(figs) != 2:
        out = []
        for f in figs:
            out += build_figure(f)
        return out
    # Gutter between the two columns. Each image fills its cell, so the gap a
    # reader actually sees is (col_w - image width); with no explicit allowance
    # the two screenshots butt together and read as a single picture.
    TWO_COL_GUTTER = 22
    col_w = (CONTENT_W - 14) / 2
    cells = []
    for f in figs:
        img = f.find('img')
        cap = f.find('figcaption')
        stack = []
        fl = _img_flowable(img, col_w - TWO_COL_GUTTER) if img else None
        if fl:
            stack.append(fl)
        if cap:
            stack.append(Paragraph(inline(cap), S_CAP))
        cells.append(stack)
    t = Table([cells], colWidths=[col_w, col_w], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    return [Spacer(1, 6), t, Spacer(1, 10)]


# Figure width as a fraction of the text column, keyed off the same size
# classes the HTML uses so both renderings stay in step.
FIG_WIDTHS = {'fig-narrow': 0.58, 'fig-mid': 0.72}


def width_fraction(tag):
    # An explicit data-w="0.63" on the <figure> or its <img> wins over the size
    # classes, so individual figures can be tuned to the page flow without
    # inventing a new class for each one.
    img = tag.find('img')
    for holder in (tag, img):
        if holder is not None:
            w = holder.get('data-w')
            if w:
                try:
                    return max(0.25, min(1.0, float(w)))
                except ValueError:
                    pass
    for src in (tag.get('class') or [],
                (img.get('class') or []) if img is not None else []):
        for cls, frac in FIG_WIDTHS.items():
            if cls in src:
                return frac
    return 1.0


# A figure taller than this effectively owns its page, so its heading should
# travel with it rather than being left behind at the foot of the previous one.
KEEP_WITH_HEADING_PT = 300


def _figure_height(fig_tag):
    """Rendered height in points of the image inside a <figure>, 0 if absent."""
    img = fig_tag.find('img')
    if img is None:
        return 0
    path = os.path.join(HERE, img['src'])
    if not os.path.exists(path):
        return 0
    from PIL import Image as PILImage
    with PILImage.open(path) as im:
        iw, ih = im.size
    w = min(CONTENT_W * width_fraction(fig_tag), iw * 0.75)
    return w * ih / iw


def render_section(sec, story, toc_sink):
    kids = [t for t in sec.children if isinstance(t, Tag)]
    consumed = set()
    for idx, tag in enumerate(kids):
        if idx in consumed:
            continue
        name = tag.name
        # Keep a heading with its figure ONLY when that figure is tall enough
        # that it could not share a page with much preceding text anyway. Doing
        # this for every heading costs two whole pages: a short figure that
        # would happily have filled the tail of a page gets dragged to the next
        # one along with its heading. Restricting it to the tall figures fixes
        # the stranded headings those actually cause, at no cost in pages.
        nxt = kids[idx + 1] if idx + 1 < len(kids) else None
        if (name in ('h2', 'h3') and nxt is not None and nxt.name == 'figure'
                and _figure_height(nxt) > KEEP_WITH_HEADING_PT):
            buf = []
            (heading2 if name == 'h2' else heading3)(tag, buf, toc_sink)
            buf += build_figure(nxt, width_fraction(nxt))
            story.append(KeepTogether(buf))
            consumed.add(idx + 1)
            continue
        cls = tag.get('class') or []
        if name == 'h2':
            heading2(tag, story, toc_sink)
        elif name == 'h3':
            heading3(tag, story, toc_sink)
        elif name == 'h4':
            story.append(Paragraph(f'<b>{inline(tag)}</b>', S_H4))
        elif name == 'p':
            style = S_FOOT if 'font-size:8.5pt' in (tag.get('style') or '') else S_BODY
            txt = inline(tag)
            if txt:
                story.append(Paragraph(txt, style))
        elif name == 'ul':
            story += build_list(tag, S_LI)
            story.append(Spacer(1, 5))
        elif name == 'ol':
            story += build_steps(tag) if 'steps' in cls else build_list(tag, S_LI)
            story.append(Spacer(1, 5))
        elif name == 'table':
            story += build_table(tag)
        elif name == 'pre':
            story += build_pre(tag)
        elif name == 'figure':
            story += build_figure(tag, width_fraction(tag))
        elif name == 'hr':
            story.append(HRFlowable(width='100%', thickness=0.7, color=RULE,
                                    spaceBefore=14, spaceAfter=10))
        elif name == 'div' and 'note' in cls:
            story += build_callout(tag, 'note')
        elif name == 'div' and 'warn' in cls:
            story += build_callout(tag, 'warn')
        elif name == 'div' and 'two-col' in cls:
            story += build_two_col(tag)


# ── Document template ────────────────────────────────────────────────────────
class Manual(BaseDocTemplate):
    def __init__(self, path, meta, **kw):
        BaseDocTemplate.__init__(self, path, pagesize=letter,
                                 leftMargin=M_L, rightMargin=M_R,
                                 topMargin=M_T, bottomMargin=M_B, **kw)
        self.meta = meta
        frame = Frame(M_L, M_B, CONTENT_W, PAGE_H - M_T - M_B, id='body',
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        full = Frame(0, 0, PAGE_W, PAGE_H, id='cover', leftPadding=0,
                     rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id='cover', frames=[full], onPage=self.draw_cover),
            PageTemplate(id='body', frames=[frame], onPage=self.draw_body),
        ])
        self._toc_entries = []

    # cover page — dark full-bleed panel
    def draw_cover(self, canv, doc):
        canv.saveState()
        canv.setFillColor(colors.HexColor('#0b0b1a'))
        canv.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        cx = PAGE_W / 2
        canv.setFillColor(colors.HexColor('#5aafcf'))
        canv.setFont(FM, 10)
        canv.drawCentredString(cx, PAGE_H - 3.05 * inch,
                               'P A L O M A R   O B S E R V A T O R Y   ·   C A L T E C H')
        canv.setFillColor(colors.white)
        canv.setFont(FB, 46)
        canv.drawCentredString(cx, PAGE_H - 4.5 * inch, 'FACSUM')
        canv.setFillColor(colors.HexColor('#5aafcf'))
        canv.setFont(F, 16)
        canv.drawCentredString(cx, PAGE_H - 5.05 * inch, 'Web Interface — User Manual')
        canv.setStrokeColor(colors.HexColor('#5aafcf'))
        canv.setLineWidth(1.2)
        canv.line(cx - 60, PAGE_H - 5.6 * inch, cx + 60, PAGE_H - 5.6 * inch)
        y = PAGE_H - 6.35 * inch
        for label, value in self.meta:
            canv.setFont(FB, 9)
            canv.setFillColor(colors.HexColor('#aaaacc'))
            canv.drawRightString(cx - 6, y, label)
            canv.setFont(F, 9)
            canv.setFillColor(colors.HexColor('#8888aa'))
            canv.drawString(cx + 6, y, value)
            y -= 18
        canv.restoreState()

    def draw_body(self, canv, doc):
        canv.saveState()
        canv.setStrokeColor(RULE)
        canv.setLineWidth(0.5)
        canv.line(M_L, M_B - 16, PAGE_W - M_R, M_B - 16)
        canv.setFont(F, 7.5)
        canv.setFillColor(colors.HexColor('#999999'))
        canv.drawString(M_L, M_B - 28, 'FACSUM Web Interface — User Manual')
        canv.drawRightString(PAGE_W - M_R, M_B - 28, str(canv.getPageNumber() - 1))
        canv.restoreState()

    def afterFlowable(self, flowable):
        if hasattr(flowable, '_toc_level'):
            self.notify('TOCEntry',
                        (flowable._toc_level, flowable._toc_text, self.page - 1))


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'FACSUM_Web_User_Manual.html')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'FACSUM_User_Manual_Rev1.5.pdf')

    soup = BeautifulSoup(open(src, encoding='utf-8').read(), 'html.parser')

    cover = soup.find('div', class_='cover')
    meta = []
    if cover:
        block = cover.find('div', class_='cover-meta')
        if block:
            for line in str(block).split('<br/>'):
                frag = BeautifulSoup(line, 'html.parser')
                strong = frag.find('strong')
                if not strong:
                    continue
                label = strong.get_text(strip=True)
                strong.extract()
                value = frag.get_text(' ', strip=True).replace('\xa0', ' ')
                meta.append((label, re.sub(r'\s+', ' ', value).strip()))

    story = []
    toc_sink = []

    # Table of contents (real page numbers, resolved on the second pass)
    toc = TableOfContents()
    toc.levelStyles = S_TOC
    story.append(NextPageTemplate('body'))
    story.append(PageBreak())
    story.append(Paragraph('<b>Contents</b>', S_H2))
    story.append(HRFlowable(width='100%', thickness=1.6, color=CYAN,
                            spaceBefore=3, spaceAfter=12))
    story.append(toc)

    sections = [s for s in soup.find_all('div', class_='section')
                if 'toc-page' not in (s.get('class') or [])]
    # Honour the HTML's own .page-break class instead of breaking before every
    # section. The numbered chapters all carry it, so they still each start a
    # page; the appendices after the first deliberately do not, and simply flow
    # on from whatever precedes them with a little breathing room instead.
    for i, sec in enumerate(sections):
        if i == 0 or 'page-break' in (sec.get('class') or []):
            story.append(PageBreak())
        else:
            story.append(Spacer(1, 22))
            story.append(HRFlowable(width='100%', thickness=0.6, color=RULE,
                                    spaceBefore=0, spaceAfter=14))
        render_section(sec, story, toc_sink)

    for level, text, para in toc_sink:
        para._toc_level = level
        para._toc_text = text

    doc = Manual(out, meta,
                 title='FACSUM Web Interface — User Manual',
                 author='Palomar Observatory, Caltech',
                 subject='FACSUM user documentation')
    doc.multiBuild(story)
    print(f'Wrote {out}')


if __name__ == '__main__':
    main()
