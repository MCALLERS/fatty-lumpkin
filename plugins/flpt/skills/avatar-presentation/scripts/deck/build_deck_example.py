#!/usr/bin/env python3
"""EXAMPLE deck builder from a real talk ("Why would a law firm buy GPUs?", 21 slides). Adapt it; don't reuse its content.

How to adapt (see references/3-deck-and-script.md):
  1. Keep the helpers (light/dark/title/card/p/eyebrow…), the palette block, and main().
  2. Replace BLOBS / ASSET_FILES with the asset urls returned when you upload this deck's images.
  3. Replace every S["…"] slide with the new talk's slides, then ORDER, SECTIONS and FACES.
  4. Keep content out of the bottom-right ~360x360 px (the presenter bubble sits there in the video).
  5. Run it, publish the files, then render PNGs with video/render_slides.py.

Generate the Slides-artifact deck files (project/deck.json + project/slides/*.html).

Speaker notes (<aside>) are injected from ../script.md so the deck and the video
narration never drift apart. Re-run after editing either this file or the script.
"""
import datetime, html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.join(HERE, "project")
SLIDES = os.path.join(PROJ, "slides")
SCRIPT = os.path.join(HERE, "..", "script.md")
IMG = os.path.normpath(os.path.join(HERE, "..", "..", "resources", "images"))

# ---- palette & type -------------------------------------------------------
INK, PAPER, PAPER2, CARD, RULE = "#17202B", "#F5F2EA", "#EDE7DA", "#FBF9F4", "#DDD6C8"
BODY, MUTED = "#3F4A57", "#5B6573"
OX, BLUE, AMBER = "#8E2C48", "#1F5A85", "#8A5310"          # strategy / facts / tactics
OX_SOFT, BLUE_SOFT, AMBER_SOFT = "#F3DFE5", "#DDE7F0", "#F1E3CC"
ON_DARK, ON_DARK2, OX_ON_DARK, BLUE_ON_DARK = "#F5F2EA", "#C3CAD3", "#E7A1B5", "#9FC3E0"
SERIF = "font-family:'Source Serif 4', Georgia, serif"
SANS = "font-family:'IBM Plex Sans', Arial, sans-serif"
MONO = "font-family:'IBM Plex Mono', 'Courier New', monospace"

BLOBS = {
    "russell": "/_blob/19e47932c2382501118fa27c5ec3b059",
    "pm5443": "/_blob/5015615b8cb7cb447b325aad9eed1811",
    "pm110643": "/_blob/a8372817a9f8dddcb2adfafaae876d0f",
    "pmtitle": "/_blob/d3f5d69e40dacdad70643c6892bcdd65",
}
ASSET_FILES = {
    "russell": "bertrand-russell.jpg",
    "pm5443": "principia-54-43-crop.png",
    "pm110643": "principia-110-643-one-plus-one-vol2-crop.png",
    "pmtitle": "principia-mathematica-title-page.jpg",
}

def light(sid, body, footer=None, gap=48):
    pad = "128px 128px 160px" if footer else "128px"
    foot = (f'<p style="position:absolute; left:128px; bottom:64px; width:1300px; font-size:24px; color:{MUTED}">{footer}</p>\n'
            if footer else "")
    return (f'<section id="{sid}" data-transition="fade" style="background:{PAPER}; color:{INK}; {SANS}; '
            f'padding:{pad}; display:flex; flex-direction:column; gap:{gap}px">\n{body}\n{foot}</section>\n')

def dark(sid, body, bg=INK, justify="center", gap=48):
    return (f'<section id="{sid}" data-transition="fade" style="background:{bg}; color:{ON_DARK}; {SANS}; '
            f'padding:128px; display:flex; flex-direction:column; justify-content:{justify}; gap:{gap}px">\n{body}\n</section>\n')

def eyebrow(t, c=OX):
    return f'<p style="font-size:24px; font-weight:600; letter-spacing:3px; text-transform:uppercase; color:{c}">{t}</p>'

def title(eb, t, ebc=OX):
    return (f'<div style="display:flex; flex-direction:column; gap:16px">\n{eyebrow(eb, ebc)}\n'
            f'<h2 style="{SERIF}; font-size:72px; font-weight:600; line-height:1.1; color:{INK}">{t}</h2>\n</div>')

def card(inner, bg=CARD, border=f"1px solid {RULE}", pad=36, gap=12, extra=""):
    return (f'<div style="display:flex; flex-direction:column; gap:{gap}px; background:{bg}; border:{border}; '
            f'border-radius:16px; padding:{pad}px{extra}">\n{inner}\n</div>')

def p(t, size=24, color=BODY, extra=""):
    return f'<p style="font-size:{size}px; line-height:1.4; color:{color}{extra}">{t}</p>'

S = {}  # id -> html

# 1 ─ cover
S["cover"] = dark("cover", f"""{eyebrow("Interval · Team meeting", OX_ON_DARK)}
<div style="display:flex; flex-direction:column; gap:40px">
<h1 style="{SERIF}; font-size:120px; font-weight:600; line-height:1.05; color:{ON_DARK}; width:1400px">Why would a law firm buy GPUs?</h1>
<p style="font-size:44px; line-height:1.3; color:{ON_DARK2}; width:1300px">Latham's on-prem AI move, and what it means for Interval</p>
</div>
<p style="font-size:24px; color:{ON_DARK2}">Know-how, strategy, and the data layer</p>""", justify="space-between")

# 2 ─ the news
def fact(head, sub):
    return (f'<div style="display:flex; flex-direction:column; gap:4px">\n<p style="font-size:32px; font-weight:600; color:{INK}">{head}</p>\n'
            f'{p(sub, 28)}\n</div>')
S["news"] = light("news", f"""{title("The news · September 2026", "Latham bought its own GPUs")}
<div style="display:flex; gap:64px; align-items:start">
<div style="flex:1; display:flex; flex-direction:column; gap:32px">
{fact("Multiple Nvidia H200 GPUs", "Blackwell and Vera Rubin systems under evaluation")}
{fact("A staff-only data center", "Third-party facility that only Latham employees can enter")}
{fact("Fine-tuning open-weight models", "Not training a foundation model from scratch")}
{fact("About 900 tech staff, about 100 on AI", "Spend not disclosed")}
</div>
<div style="width:520px; display:flex; flex-direction:column; gap:16px; background:{INK}; padding:48px; border-radius:16px">
<p style="{SERIF}; font-size:96px; font-weight:600; line-height:1.05; color:{OX_ON_DARK}">3 years</p>
<p style="font-size:32px; line-height:1.35; color:{ON_DARK}">since Latham decided to build its own Nvidia server infrastructure</p>
</div>
</div>""", footer="Sources: Financial Times (Sept 10, 2026); Bloomberg Law (Sept 11, 2026)", gap=56)

# 3 ─ in their own words
def quote_row(tag, tagc, q, who):
    return f"""<div style="display:flex; gap:40px; align-items:start">
<p style="width:260px; font-size:24px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:{tagc}; padding:10px 0">{tag}</p>
<div style="width:1100px; display:flex; flex-direction:column; gap:8px">
<p style="{SERIF}; font-size:44px; font-style:italic; line-height:1.25; color:{INK}">{q}</p>
{p(who, color=MUTED)}
</div>
</div>"""
S["own-words"] = light("own-words", f"""{title("How Latham explains it", "In Latham's own words")}
<div style="display:flex; flex-direction:column; gap:40px">
{quote_row("Privacy", MUTED, "“We don't want to put it to any cloud vendor.”", "Rene Mendoza, CIO, on the most sensitive client data (to the Financial Times)")}
{quote_row("The firm's way", OX, "“…because they don't have our lawyers.”", "Amber Banks, M&amp;A and private equity partner, on why no tech company can replicate what Latham builds")}
{quote_row("The data layer", BLUE, "“That is where the competitive advantage is likely to lie.”", "Daryl Lim, Penn State Dickinson Law, on making the firm's own work product more useful")}
</div>""", footer="Sources: Bloomberg Law, Sept 11, 2026 (licensed reprint on lw.com); Financial Times, Sept 10, 2026")

# 4 ─ not a one-off
def stat(label, big, sub):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:16px; background:{CARD}; border:1px solid {RULE}; border-radius:16px; padding:40px">
{eyebrow(label)}
<p style="{SERIF}; font-size:64px; font-weight:600; line-height:1.05; color:{INK}">{big}</p>
{p(sub, 28)}
</div>"""
S["not-alone"] = light("not-alone", f"""{title("A leading indicator", "Latham isn't alone")}
<div style="display:flex; gap:24px; align-items:stretch">
{stat("Kirkland &amp; Ellis", "$500M", "committed to its own AI platform, with job ads for on-prem GPU clusters")}
{stat("Harvey", "$15.5B", "the legal AI leader, now urging firms to “own their intelligence”")}
{stat("Eli Lilly", "1,016", "Nvidia GPUs in a wholly owned AI factory")}
{stat("BNY", "On-prem", "open-weight models run in-house, alongside frontier APIs")}
</div>
<p style="font-size:32px; line-height:1.4; width:1300px; color:{INK}"><b>The pattern:</b> organizations whose crown jewels are know-how are starting to own the stack that touches it.</p>""",
    footer="Sources: Bloomberg Law; Artificial Lawyer; PitchBook; TechCrunch; Nvidia; Fortune (2025–26)")

# 5 ─ six reasons
def small_reason(n, head, sub):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:8px; background:{CARD}; border:1px solid {RULE}; border-radius:16px; padding:32px">
<p style="font-size:26px; font-weight:600; color:{INK}">{n} · {head}</p>
{p(sub)}
</div>"""
def big_reason(tag, head, sub, c, soft):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:8px; background:{soft}; border:2px solid {c}; border-radius:16px; padding:36px">
<p style="font-size:24px; font-weight:600; letter-spacing:2px; color:{c}">{tag}</p>
<h3 style="{SERIF}; font-size:44px; font-weight:600; line-height:1.1; color:{INK}">{head}</h3>
{p(sub, 28, BODY)}
</div>"""
S["six-reasons"] = light("six-reasons", f"""{title("Why own the stack", "Six reasons to own the stack")}
<div style="display:flex; flex-direction:column; gap:32px">
<div style="display:flex; gap:20px; align-items:stretch">
{small_reason(1, "Redundancy", "“Optionality”: no single-vendor dependence")}
{small_reason(2, "Cost risk", "Unit prices fall; concentration and repricing risk rise")}
{small_reason(3, "Privacy &amp; regulation", "ABA Op. 512: client consent for self-learning tools")}
{small_reason(4, "Leading edge", "Own the capability, not a vendor's roadmap")}
</div>
<div style="display:flex; flex-direction:column; gap:16px; width:1400px">
{eyebrow("Today's focus")}
<div style="display:flex; gap:24px; align-items:stretch">
{big_reason("5 · (E)", "Intelligence from the firm's data", "Aged, siloed data, structured so models can use it", BLUE, BLUE_SOFT)}
{big_reason("6 · (F)", "The firm's way, built into its tools", "Bespoke tools that encode how the firm actually practices", OX, OX_SOFT)}
</div>
</div>
</div>""")

# 6 ─ (e) and (f) 2×2
def quad(head, sub, verdict, vc, bg, border="none"):
    b = f"border:{border}; " if border != "none" else ""
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:8px; background:{bg}; {b}border-radius:12px; padding:28px">
<h3 style="{SERIF}; font-size:36px; font-weight:600; line-height:1.1; color:{INK}">{head}</h3>
{p(sub)}
<p style="font-size:24px; font-weight:600; color:{vc}">{verdict}</p>
</div>"""
rowlab = f'style="width:120px; align-self:center; font-size:24px; font-weight:600; color:{MUTED}"'
S["e-and-f"] = light("e-and-f", f"""{title("Reasons 5 and 6", "Two kinds of value: (e) and (f)")}
<div style="display:flex; gap:64px; align-items:start">
<div style="width:1100px; display:flex; flex-direction:column; gap:12px">
<div style="display:flex; gap:16px; align-items:stretch">
<p {rowlab}>Know-how</p>
{quad("Market practice", "Standard drafting, market-standard markups", "→ Generic AI tools", AMBER, PAPER2)}
{quad("(f) The firm's way", "Worldview, priorities, models of the counterparty", "→ Bespoke tools, owned infra", OX, OX_SOFT, f"2px solid {OX}")}
</div>
<div style="display:flex; gap:16px; align-items:stretch">
<p {rowlab}>Facts</p>
{quad("Market facts", "Statutes, case law, public market data", "→ Buy: research tools, LLMs", MUTED, "#E7E2D8")}
{quad("(e) Firm facts", "Deal history, precedents, redlines, billing data", "→ Structure the data layer", BLUE, BLUE_SOFT, f"2px solid {BLUE}")}
</div>
<div style="display:flex; gap:16px">
<p style="width:120px; font-size:24px"> </p>
<p style="flex:1; font-size:24px; text-align:center; color:{MUTED}">Market-standard</p>
<p style="flex:1; font-size:24px; text-align:center; color:{MUTED}">Firm-specific →</p>
</div>
</div>
<div style="width:480px; display:flex; flex-direction:column; gap:28px">
{p(f'<b><span style="color:{BLUE}">(e)</span></b> is intelligence you get <i>out of</i> the firm\'s data. That\'s Interval\'s core.', 28, INK)}
{p(f'<b><span style="color:{OX}">(f)</span></b> is the firm\'s way of working, built <i>into</i> its tools. That\'s the prize.', 28, INK)}
{p("<b>You can't reach (f) without going through (e).</b>", 28, INK)}
</div>
</div>
<p style="position:absolute; left:871px; top:506px; width:240px; font-size:24px; font-weight:600; text-align:center; color:{ON_DARK}; background:{OX}; border-radius:24px; padding:6px 12px">↑ on-ramp</p>""")

# 7 ─ worldview chain
def link(head, sub, c):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:8px; background:{CARD}; border:1px solid {RULE}; border-radius:16px; padding:28px">
<h3 style="{SERIF}; font-size:36px; font-weight:600; color:{c}">{head}</h3>
{p(sub)}
</div>"""
arrow = f'<p style="width:56px; align-self:center; font-size:44px; text-align:center; color:{MUTED}">→</p>'
def practice(label, head, sub):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:8px; background:{PAPER2}; border-radius:16px; padding:28px">
{eyebrow(label, MUTED)}
<p style="font-size:32px; font-weight:600; line-height:1.3; color:{INK}">{head}</p>
{p(sub)}
</div>"""
S["worldview"] = light("worldview", f"""{title("The firm's way", "It starts with worldview")}
<div style="display:flex; align-items:stretch">
{link("Worldview", "What matters, and what's dangerous", OX)}
{arrow}
{link("Strategy", "How to win this deal, given how it could go", OX)}
{arrow}
{link("Tactics", "The moves on the page", AMBER)}
{arrow}
{link("Documents", "What the record actually shows", BLUE)}
</div>
<div style="display:flex; gap:24px; width:1300px; align-items:stretch">
{practice("Texas PE practice", "Securities-law risk comes first", "Noticeably more risk-averse on anything touching securities law")}
{practice("Kirkland", "The working-capital adjustment comes first", "Securities-law risk sits much lower on the list")}
</div>""")

# 8 ─ statement
S["strategy-is-product"] = dark("strategy-is-product", f"""{eyebrow("Why law is the purest case", "#F3C9D5")}
<h1 style="{SERIF}; font-size:96px; font-weight:600; line-height:1.1; color:#FBF3F5; width:1400px">For a law firm, strategy isn't how it competes. It's what it sells.</h1>
<p style="font-size:32px; line-height:1.4; color:#F3C9D5; width:1200px">Every business uses strategy and tactics to compete. A law firm's product <i>is</i> the strategy and tactics.</p>""",
    bg=OX, gap=40)

# 9 ─ three kinds of know-how
def kind(label, c, head, example, lives, enc):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:12px; background:{CARD}; border:1px solid {RULE}; border-radius:16px; padding:36px">
{eyebrow(label, c)}
<h3 style="{SERIF}; font-size:44px; font-weight:600; line-height:1.1; color:{INK}">{head}</h3>
<p style="font-size:32px; font-style:italic; line-height:1.35; color:{INK}">{example}</p>
{p(f"<b>Lives in:</b> {lives}", 28)}
{p(f"<b>Encoding:</b> {enc}", 28)}
</div>"""
S["three-kinds"] = light("three-kinds", f"""{title("Ryle's distinction, extended", "Three kinds of know-how")}
<div style="display:flex; gap:32px; align-items:stretch; width:1400px">
{kind("Knowing-that", BLUE, "Facts", "“The target has a working-capital peg.”", "databases and records", "easy")}
{kind("Knowing-how", AMBER, "Tactics", "“If the cap is below X, push to Y.”", "playbooks, hornbooks, skill files", "fairly easy: if-then rules, like code")}
{kind("Knowing-how", OX, "Strategy", "“Win the platform deal without losing it.”", "people and practice; it emerges", "hard: a curriculum, not a manual")}
</div>""", footer="Gilbert Ryle, “Knowing How and Knowing That” (1946); The Concept of Mind (1949)")

# 10 ─ possible worlds
def dot(cx, cy, r, fill):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>'
svg_worlds = (
    '<svg aria-label="Concentric rings: the actual world at the center, a ring of close feasible worlds around it, and remote worlds outside" '
    'width="560" height="560" viewBox="0 0 560 560" style="position:absolute; left:128px; top:320px; width:560px; height:560px">'
    '<circle cx="280" cy="280" r="270" fill="none" stroke="#B9B2A3" stroke-width="2" stroke-dasharray="6 8"/>'
    f'<circle cx="280" cy="280" r="185" fill="{OX_SOFT}" stroke="{OX}" stroke-width="2"/>'
    f'<circle cx="280" cy="280" r="62" fill="{AMBER_SOFT}" stroke="{AMBER}" stroke-width="2"/>'
    + "".join(dot(x, y, 9, OX) for x, y in [(376, 200), (218, 172), (157, 258), (172, 342), (388, 342), (302, 157)])
    + "".join(dot(x, y, 8, "#B9B2A3") for x, y in [(496, 201), (104, 132), (64, 359), (201, 496), (456, 428)])
    + '</svg>')
def wblock(head, c, text):
    return f"""<div style="display:flex; flex-direction:column; gap:8px">
<h3 style="{SERIF}; font-size:36px; font-weight:600; color:{c}">{head}</h3>
{p(text, 28, BODY)}
</div>"""
S["possible-worlds"] = light("possible-worlds", f"""{title("Tactics vs strategy", "Strategy lives in the possible worlds")}
<div style="display:flex; gap:64px">
<div style="width:600px"></div>
<div style="width:760px; display:flex; flex-direction:column; gap:36px">
{wblock("Tactic", AMBER, "“If X, do Y.” Lives in the actual world. It never asks how things could have gone.")}
{wblock("Strategy", OX, "Reasons across the feasible set: “What would they do if we pushed on the escrow?”")}
{wblock("Closeness", BLUE, "David Lewis: closer worlds are more possible. In a deal, closeness is cost, time, leverage, and legal risk.")}
</div>
</div>
{svg_worlds}
<p style="position:absolute; left:318px; top:583px; width:180px; font-size:24px; font-weight:600; text-align:center; color:{AMBER}">Actual world</p>
<p style="position:absolute; left:278px; top:700px; width:260px; font-size:24px; font-weight:600; text-align:center; color:{OX}">Feasible worlds</p>
<p style="position:absolute; left:278px; top:352px; width:260px; font-size:24px; text-align:center; color:{MUTED}">Remote worlds</p>""")

# 11 ─ strategy under uncertainty
def pill(t):
    return f'<p style="font-size:24px; background:{PAPER2}; border-radius:24px; padding:10px 20px; color:{BODY}">{t}</p>'
def move(sym, c, head, sub):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:8px; background:{CARD}; border:1px solid {RULE}; border-radius:16px; padding:36px">
<p style="{SERIF}; font-size:64px; font-weight:600; line-height:1.1; color:{c}">{sym}</p>
<h3 style="{SERIF}; font-size:36px; font-weight:600; color:{INK}">{head}</h3>
{p(sub, 30, BODY)}
</div>"""
S["uncertainty"] = light("uncertainty", f"""{title("Harvard Business Review, 1997", "Strategists already think in possible worlds")}
<div style="display:flex; gap:40px; flex-direction:column">
<div style="display:flex; gap:16px; align-items:center">
<p style="font-size:24px; font-weight:600; color:{MUTED}">Four levels:</p>
{pill("<b>1</b> Clear-enough future")}
{pill("<b>2</b> Alternate futures")}
{pill("<b>3</b> Range of futures")}
{pill("<b>4</b> True ambiguity")}
</div>
<div style="display:flex; gap:32px; align-items:stretch; width:1400px">
{move("□", BLUE, "No-regrets move", "Pays off no matter what happens. True in every feasible world.")}
{move("◇", AMBER, "Option", "Keeps good worlds within reach, at a small cost now.")}
{move("±", OX, "Big bet", "Wins in some worlds, loses in others.")}
</div>
</div>""", footer="Courtney, Kirkland &amp; Viguerie, “Strategy Under Uncertainty,” HBR, Nov–Dec 1997. The □ / ◇ reading is ours.")

# 12 ─ Sun Tzu
S["sun-tzu"] = dark("sun-tzu", f"""{eyebrow("Sun Tzu, The Art of War (Giles translation, 1910)", OX_ON_DARK)}
<p style="{SERIF}; font-size:64px; font-style:italic; line-height:1.25; color:{ON_DARK}; width:1400px">“All men can see the tactics whereby I conquer, but what none can see is the strategy out of which victory is evolved.”</p>
<p style="font-size:32px; line-height:1.4; color:{ON_DARK2}; width:1200px">Tactics are visible in the record. Strategy has to be inferred from it.</p>""")

# 13 ─ Principia
S["principia"] = light("principia", f"""{title("Whitehead &amp; Russell, Principia Mathematica, 1910–13", "Writing know-how down is brutally expensive")}
<div style="display:flex; gap:64px; align-items:start">
<div style="width:340px; display:flex; flex-direction:column; gap:12px">
<img src="{BLOBS['russell']}" alt="Bertrand Russell, oval portrait published in 1916" style="width:340px; height:460px; object-fit:cover; border-radius:50%">
<p style="font-size:24px; text-align:center; color:{MUTED}">Bertrand Russell, 1916</p>
</div>
<div style="width:688px; display:flex; flex-direction:column; gap:8px; background:#FDFCF8; border:1px solid {RULE}; border-radius:16px; padding:24px">
<p style="font-size:24px; font-weight:600; color:{MUTED}">Vol. I (1910), p. 379</p>
<img src="{BLOBS['pm5443']}" alt="Proposition 54.43, ending: from this proposition it will follow, when arithmetical addition has been defined, that 1 + 1 = 2" style="width:640px; height:267px; object-fit:contain">
<p style="font-size:24px; font-weight:600; color:{MUTED}">Vol. II (1912), p. 86</p>
<img src="{BLOBS['pm110643']}" alt="Proposition 110.643, 1 + 1 = 2, with the remark: the above proposition is occasionally useful" style="width:640px; height:202px; object-fit:contain">
</div>
<div style="flex:1; display:flex; flex-direction:column; gap:12px">
<p style="{SERIF}; font-size:120px; font-weight:600; line-height:1; color:{OX}">379</p>
{p("pages of logic before “1 + 1 = 2” is even in reach", 28, INK)}
</div>
</div>""")

# 14 ─ the hard part
def step(h, bg, head, formula, maps, mapc):
    return f"""<div style="flex:1; height:{h}px; display:flex; flex-direction:column; gap:10px; background:{bg}; border-radius:16px; padding:24px">
<h3 style="{SERIF}; font-size:32px; font-weight:600; color:{INK}">{head}</h3>
<p style="{MONO}; font-size:24px; line-height:1.35; color:{INK}">{formula}</p>
<p style="font-size:24px; font-weight:600; color:{mapc}">{maps}</p>
</div>"""
S["hard-part"] = light("hard-part", f"""{title("Why strategy resists encoding", "The hard part is ranking the worlds")}
<div style="display:flex; gap:64px; align-items:start">
<div style="width:820px; display:flex; gap:20px; align-items:end">
{step(250, BLUE_SOFT, "Facts", "HasPeg(Target)", "Knowing-that", BLUE)}
{step(340, AMBER_SOFT, "Rules", "∀x SellerMAC(x) → CarveOut(x)", "Tactics: first-order logic, code", AMBER)}
{step(430, OX_SOFT, "Possible worlds", "□ ◇ A □→ C", "Strategy: modal logic", OX)}
</div>
<div style="width:540px; display:flex; flex-direction:column; gap:24px">
<h3 style="{SERIF}; font-size:44px; font-weight:600; line-height:1.1; color:{INK}">The notation isn't the hard part.</h3>
{p("Modal logic can be rewritten as ordinary logic over worlds. The hard part is knowing <b>which worlds count, and how to rank them</b>. That judgment is tacit.", 28, BODY)}
<div style="display:flex; flex-direction:column; gap:8px; background:{PAPER2}; border-radius:16px; padding:24px">
<p style="{SERIF}; font-size:36px; font-style:italic; line-height:1.25; color:{INK}">“We can know more than we can tell.”</p>
{p("Michael Polanyi, 1966. David Autor (2014): machines can learn the unwritten rules from examples.", 24, MUTED)}
</div>
</div>
</div>""")

# 15 ─ Deep Blue vs AlphaGo
def game(label, c, name, a, b, verdict):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:12px; background:{CARD}; border:1px solid {RULE}; border-radius:16px; padding:36px">
{eyebrow(label, c)}
<h3 style="{SERIF}; font-size:44px; font-weight:600; color:{INK}">{name}</h3>
{p(a, 30, BODY)}
{p(b, 30, BODY)}
<p style="font-size:30px; font-weight:600; line-height:1.4; color:{c}">{verdict}</p>
</div>"""
S["chess-go"] = light("chess-go", f"""{title("Chess vs Go", "Deep Blue was told; AlphaGo learned")}
<div style="display:flex; gap:32px; align-items:stretch; width:1400px">
{game("1997 · Chess · beat Kasparov", BLUE, "Deep Blue", "About 35 moves per turn; roughly 200M positions searched a second", "8,000+ hand-written features, plus a grandmaster opening book", "Judgment written down by people.")}
{game("2016 · Go · beat Lee Sedol 4–1", OX, "AlphaGo", "About 250 moves per turn; far too many positions to brute-force", "Learned from ~30M positions of strong players' games, then self-play", "Judgment learned from records of play.")}
</div>""", footer="Silver et al., Nature 529 (2016); IBM; Tromp (2016). AlphaGo searched thousands of times fewer positions than Deep Blue.")

# 16 ─ two instincts
def ibox(head, sub, bg, italic=False):
    st = "; font-style:italic" if italic else ""
    return f"""<div style="width:620px; display:flex; flex-direction:column; gap:8px; background:{bg}; border-radius:16px; padding:28px">
<h3 style="{SERIF}; font-size:32px; font-weight:600; color:{INK}">{head}</h3>
{p(sub, 26, BODY, st)}
</div>"""
arr2 = f'<p style="width:96px; align-self:center; font-size:44px; text-align:center; color:{MUTED}">→</p>'
S["two-instincts"] = light("two-instincts", f"""{title("What AlphaGo teaches us", "A partner's two instincts, learned")}
<div style="display:flex; flex-direction:column; gap:20px">
<div style="display:flex">
<div style="width:620px">{eyebrow("AlphaGo learned", BLUE)}</div>
<div style="width:96px"></div>
<div style="width:620px">{eyebrow("A senior partner knows", OX)}</div>
</div>
<div style="display:flex; align-items:stretch">
{ibox("Policy network", "Which moves are even worth considering?", PAPER2)}
{arr2}
{ibox("The feasibility filter", "“They'll never agree to that. But they will push here.”", OX_SOFT, True)}
</div>
<div style="display:flex; align-items:stretch">
{ibox("Value network", "How good is this position, without playing it out?", PAPER2)}
{arr2}
{ibox("Judgment", "A feel for whether the deal is in good shape", OX_SOFT)}
</div>
<p style="font-size:32px; font-weight:600; line-height:1.4; width:1300px; color:{INK}">Neither was written down. Both were learned from records of play.</p>
</div>""")

# 17 ─ notation (dark)
def ncol(label, c, text):
    return f"""<div style="flex:1; display:flex; flex-direction:column; gap:8px; border-left:4px solid {c}; padding:4px 0 4px 24px">
{eyebrow(label, c)}
<p style="font-size:28px; line-height:1.4; color:{ON_DARK2}">{text}</p>
</div>"""
S["notation"] = dark("notation", f"""<h1 style="{SERIF}; font-size:96px; font-weight:600; line-height:1.1; color:{ON_DARK}; width:1400px">Go has a notation. Law firms don't.</h1>
<div style="display:flex; gap:48px; width:1300px">
{ncol("Go", BLUE_ON_DARK, "Every professional game recorded move by move, in one standard format.")}
{ncol("A law firm", OX_ON_DARK, "Decades of redlines, issue lists, emails, closing sets and outcomes, scattered across systems.")}
</div>
<p style="{SERIF}; font-size:56px; font-weight:600; color:{OX_ON_DARK}">Interval builds the notation.</p>""")

# 18 ─ why now (cost curve)
svg_cost = (
    '<svg aria-label="Chart: the value of going bespoke rises with the complexity of the knowledge; AI lowered the cost line, so a new band of knowledge became worth building bespoke tools for" '
    'width="900" height="520" viewBox="0 0 900 520" style="position:absolute; left:128px; top:310px; width:900px; height:520px">'
    f'<rect x="440" y="20" width="278" height="450" fill="{OX_SOFT}"/>'
    f'<line x1="60" y1="470" x2="880" y2="470" stroke="{INK}" stroke-width="2"/>'
    f'<line x1="60" y1="470" x2="60" y2="20" stroke="{INK}" stroke-width="2"/>'
    f'<line x1="60" y1="200" x2="880" y2="200" stroke="{MUTED}" stroke-width="2.5" stroke-dasharray="10 8"/>'
    f'<line x1="60" y1="380" x2="880" y2="380" stroke="{BLUE}" stroke-width="3"/>'
    f'<path d="M 60 470 Q 470 470 880 50" fill="none" stroke="{OX}" stroke-width="4"/>'
    f'<circle cx="440" cy="380" r="7" fill="{BLUE}"/><circle cx="718" cy="200" r="7" fill="{MUTED}"/>'
    f'<line x1="240" y1="214" x2="240" y2="356" stroke="{BLUE}" stroke-width="2.5"/>'
    f'<polygon points="231,352 249,352 240,370" fill="{BLUE}"/>'
    '</svg>')
def lab(x, y, w, t, c, bold=True, center=False):
    return (f'<p style="position:absolute; left:{128 + x}px; top:{310 + y}px; width:{w}px; font-size:24px; '
            f'{"font-weight:600; " if bold else ""}{"text-align:center; " if center else ""}line-height:1.4; color:{c}">{t}</p>')
S["why-now"] = light("why-now", f"""{title("Build when Δvalue &gt; Δcost", "Why now: bespoke got cheap")}
<div style="display:flex; gap:64px">
<div style="width:900px"></div>
<div style="width:460px; display:flex; flex-direction:column; gap:20px">
<h3 style="{SERIF}; font-size:36px; font-weight:600; line-height:1.2; color:{INK}">Build bespoke when the extra value beats the extra cost.</h3>
<div style="display:flex; flex-direction:column; gap:8px; background:{PAPER2}; border-radius:16px; padding:24px">
{p("My doc-compare tool, “Fatty Lupkin”: generic tools had too many options. I use the same settings every time, so I built my own.", 24, BODY)}
</div>
<p style="{SERIF}; font-size:32px; font-weight:600; line-height:1.3; color:{OX}">Generic tools sell options. Bespoke tools sell defaults.</p>
</div>
</div>
{svg_cost}
{lab(480, 36, 320, "Value of going bespoke", OX)}
{lab(70, 158, 330, "Cost to build, before AI", MUTED)}
{lab(70, 338, 160, "After AI", BLUE)}
{lab(255, 268, 200, "AI lowers the bar", BLUE, bold=False)}
{lab(450, 392, 262, "Newly worth building", OX, center=True)}
{lab(80, 482, 160, "Facts", MUTED, bold=False, center=True)}
{lab(400, 482, 160, "Tactics", MUTED, bold=False, center=True)}
{lab(700, 482, 160, "Strategy", MUTED, bold=False, center=True)}""")

# 19 ─ every organization has a way
def tr(cells, bg):
    return f'<tr style="background:{bg}">' + "".join(cells) + "</tr>"
td = lambda t, extra="": f'<td style="{extra}">{t}</td>'
S["every-org"] = light("every-org", f"""{title("It generalizes", "Every organization has a way")}
<table style="width:1300px; font-size:28px; color:{INK}">
<tr style="background:{PAPER}"><th style="width:22%"></th><th style="width:39%; color:{OX}">Law firm</th><th style="width:39%; color:{BLUE}">Industrial company</th></tr>
{tr([td("<b>The way</b>"), td("How partners read a counterparty and structure a deal"), td("How the best plant managers run a turnaround; how bid teams price a job")], CARD)}
{tr([td("<b>Records of play</b>"), td("Redlines, issue lists, emails, closing sets, outcomes"), td("Work orders, maintenance logs, bids, change orders, incident reports")], PAPER2)}
{tr([td("<b>What's missing</b>"), td("A notation: it's scattered across DMS, inboxes, billing"), td("A notation: it's scattered across ERP, maintenance systems, spreadsheets")], CARD)}
</table>""")

# 20 ─ for Interval
def imp(n, head, sub):
    return f"""<div style="display:flex; gap:24px; align-items:start">
<p style="width:64px; {SERIF}; font-size:44px; font-weight:600; line-height:1; color:{OX}">{n}</p>
<div style="flex:1; display:flex; flex-direction:column; gap:4px">
<p style="font-size:32px; font-weight:600; color:{INK}">{head}</p>
{p(sub, 28)}
</div>
</div>"""
S["for-interval"] = light("for-interval", f"""{title("Five things to discuss", "What this means for Interval")}
<div style="display:flex; flex-direction:column; gap:28px; width:1300px">
{imp(1, "Positioning", "We turn your archive into a record of play your own models can learn from.")}
{imp(2, "Product", "Structure decisions, not just data: positions, concessions, first draft vs. signed, outcomes.")}
{imp(3, "Deployment", "On-prem and air-gapped. Going local is the customer's whole point.")}
{imp(4, "Governance as a feature", "Matter-level permissions, ethical walls, provenance, consent flags (ABA Op. 512).")}
{imp(5, "Market", "Law as a lighthouse vertical, or at least our clearest story for industrial customers.")}
</div>""")

# 21 ─ close
S["close"] = dark("close", f"""{eyebrow("Why would a law firm buy GPUs?", OX_ON_DARK)}
<div style="display:flex; flex-direction:column; gap:32px">
<h1 style="{SERIF}; font-size:96px; font-weight:600; line-height:1.1; color:{ON_DARK}; width:1400px">Latham didn't buy chips. It bought a way to learn from itself.</h1>
<p style="font-size:36px; line-height:1.4; color:{ON_DARK2}; width:1200px">The GPUs are the easy part. The notation is the hard part. That's our job.</p>
</div>
<p style="font-size:32px; font-weight:600; color:{OX_ON_DARK}">Questions?</p>""", justify="space-between")

ORDER = ["cover", "news", "own-words", "not-alone", "six-reasons", "e-and-f", "worldview",
         "strategy-is-product", "three-kinds", "possible-worlds", "uncertainty", "sun-tzu",
         "principia", "hard-part", "chess-go", "two-instincts", "notation", "why-now",
         "every-org", "for-interval", "close"]
SECTIONS = {
    "s1": {"description": "The Latham news and what it signals", "start": "cover"},
    "s2": {"description": "Six reasons to own the stack, focusing on (e) and (f)", "start": "six-reasons"},
    "s3": {"description": "The firm's way: worldview, strategy, tactics", "start": "worldview"},
    "s4": {"description": "Why strategy resists being written down", "start": "three-kinds"},
    "s5": {"description": "Learning judgment from records of play", "start": "chess-go"},
    "s6": {"description": "Why now, and what it means for Interval", "start": "why-now"},
}
FACES = {
    "source-serif-4": {"family": "Source Serif 4", "href": "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap"},
    "ibm-plex-sans": {"family": "IBM Plex Sans", "href": "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap"},
    "ibm-plex-mono": {"family": "IBM Plex Mono", "href": "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap"},
}

def script_notes():
    text = open(SCRIPT, encoding="utf-8").read()
    parts = re.split(r"^## SLIDE (\d+) — .*$", text, flags=re.M)
    notes = {}
    for i in range(1, len(parts), 2):
        body = [l for l in parts[i + 1].splitlines() if not l.startswith(">")]
        para = re.sub(r"\n{2,}", "\n\n", "\n".join(body)).strip()
        notes[int(parts[i])] = para
    return notes

def main():
    os.makedirs(SLIDES, exist_ok=True)
    notes = script_notes()
    assert len(notes) == len(ORDER), f"script has {len(notes)} slides, deck has {len(ORDER)}"
    for n, sid in enumerate(ORDER, 1):
        note = notes[n][:3990]
        body = S[sid].rstrip()
        assert body.endswith("</section>")
        body = body[: -len("</section>")] + f"<aside>{html.escape(note, quote=False)}</aside>\n</section>\n"
        with open(os.path.join(SLIDES, f"{sid}.html"), "w", encoding="utf-8") as f:
            f.write(body)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    deck = {"v": 4, "createdOnFiles": {"v": 1, "at": now}, "title": "Why Would a Law Firm Buy GPUs?",
            "cover": "cover", "order": ORDER, "sections": SECTIONS, "faces": FACES, "designSystems": []}
    with open(os.path.join(PROJ, "deck.json"), "w", encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False, indent=1)
    amap = {BLOBS[k]: os.path.join(IMG, v) for k, v in ASSET_FILES.items()}
    with open(os.path.join(HERE, "asset_map.json"), "w", encoding="utf-8") as f:
        json.dump(amap, f, indent=1)
    print(f"wrote {len(ORDER)} slides, deck.json, asset_map.json")

if __name__ == "__main__":
    main()
