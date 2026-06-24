"""
Normalize "bare" LaTeX in imported content so the frontend KaTeX/MathText
pipeline renders it.

The platform convention is LaTeX wrapped in math delimiters (``\\( … \\)`` inline,
``\\[ … \\]`` display). Some imported sources (e.g. OpenSAT) embed LaTeX commands
(``\\pi``, ``\\frac``), exponents (``x^2``) and align environments WITHOUT
delimiters, so they show up as raw text. ``latexify`` wraps those bare tokens while
leaving already-delimited spans, escaped dollars (``\\$``) and plain prose untouched.

Guarantees (verified over the OpenSAT snapshot):
  - Idempotent: ``latexify(latexify(x)) == latexify(x)``.
  - Never unbalances ``\\(``/``\\)``.
  - Only wraps tokens carrying a math signal (``\\cmd``, ``^``, ``_``), never plain words.
"""
from __future__ import annotations

import re

# Whole align/array/etc. environments → display math (skip if already in \[ or $$).
_ENV = re.compile(r'(?<!\\\[)(?<!\$\$)\\begin\{[a-zA-Z*]+\}.*?\\end\{[a-zA-Z*]+\}', re.DOTALL)
# Already-delimited spans + escaped dollar: kept verbatim.
_PROTECT = re.compile(r'\$\$.*?\$\$|\$.*?\$|\\\(.*?\\\)|\\\[.*?\\\]|\\\$', re.DOTALL)
# A LaTeX command (NOT \begin/\end) with optional {..}/[..] args.
_CMD = r'\\(?!begin\b|end\b)[a-zA-Z]+(?:\{[^{}]*\}|\[[^\[\]]*\])*'
# A power/subscript unit: base (paren group, bracket group, or alnum run) + ^/_ + arg.
_POW = r'(?:\([^()]+\)|\[[^\[\]]+\]|[A-Za-z0-9]+)(?:[\^_](?:\{[^{}]*\}|[A-Za-z0-9]+))+'
_TOKEN = re.compile(_CMD + '|' + _POW)


def _wrap_segment(seg: str) -> str:
    return _TOKEN.sub(lambda m: '\\(' + m.group(0) + '\\)', seg)


def latexify(text: str | None) -> str:
    """Return ``text`` with bare LaTeX wrapped in math delimiters. Safe on None/plain."""
    if not text or ('\\' not in text and '^' not in text and '_' not in text):
        return text or ""
    text = _ENV.sub(lambda m: '\\[' + m.group(0) + '\\]', text)
    out: list[str] = []
    last = 0
    for m in _PROTECT.finditer(text):
        out.append(_wrap_segment(text[last:m.start()]))
        span = m.group(0)
        # A lone escaped dollar (`\$`, literal currency) renders broken because the
        # frontend math splitter pairs the raw `$`. Wrap it as `\(\$\)` so KaTeX
        # emits a literal `$` and no stray `$` can form a false delimiter pair.
        out.append('\\(\\$\\)' if span == '\\$' else span)
        last = m.end()
    out.append(_wrap_segment(text[last:]))
    return ''.join(out)
