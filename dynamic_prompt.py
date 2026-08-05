"""Minimal dynamic-prompt (wildcard) syntax resolver.

Supported syntax:
    {a|b|c}           -> pick one option at random
    {a|0.4::b|c}      -> weighted option (default weight = 1.0)
    {|a|b}            -> empty option is allowed
    {a|{x|y} b}       -> nesting
    \\{ \\| \\}       -> escape

Unclosed braces are tolerated: the group is closed at end of string.
"""

import re

_WEIGHT_RE = re.compile(r"^\s*([0-9]*\.?[0-9]+)\s*::")


def _parse_sequence(s, i, stop):
    """Parse until one of `stop` chars (or EOF). Returns (parts, index)."""
    parts = []
    buf = []
    while i < len(s):
        c = s[i]
        if c in stop:
            break
        if c == "\\" and i + 1 < len(s):
            buf.append(s[i + 1])
            i += 2
            continue
        if c == "{":
            if buf:
                parts.append("".join(buf))
                buf = []
            group, i = _parse_group(s, i + 1)
            parts.append(group)
            continue
        buf.append(c)
        i += 1
    if buf:
        parts.append("".join(buf))
    return parts, i


def _split_weight(parts):
    """Strip a leading `w::` from the option and return (weight, parts)."""
    if parts and isinstance(parts[0], str):
        m = _WEIGHT_RE.match(parts[0])
        if m:
            rest = parts[0][m.end():]
            parts = ([rest] if rest else []) + parts[1:]
            return float(m.group(1)), parts
    return 1.0, parts


def _parse_group(s, i):
    """Parse the inside of a `{...}` group. `i` points just after the `{`."""
    options = []
    while True:
        parts, i = _parse_sequence(s, i, "|}")
        options.append(_split_weight(parts))
        if i < len(s) and s[i] == "|":
            i += 1
            continue
        if i < len(s) and s[i] == "}":
            i += 1
        break  # EOF also closes the group (lenient)
    return ("choice", options), i


def _render(parts, rng):
    out = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
            continue
        _, options = p
        weights = [w if w > 0 else 0.0 for w, _ in options]
        if sum(weights) <= 0:
            chosen = rng.choice(options)[1]
        else:
            chosen = rng.choices([o[1] for o in options], weights=weights, k=1)[0]
        out.append(_render(chosen, rng))
    return "".join(out)


def resolve(text, rng):
    """Resolve dynamic syntax in `text` using `rng` (a random.Random)."""
    if not text or "{" not in text:
        return text or ""
    parts, _ = _parse_sequence(text, 0, "")
    return _render(parts, rng)
