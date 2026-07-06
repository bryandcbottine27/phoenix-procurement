#!/usr/bin/env python3
"""Generate docs/DATA_DICTIONARY.md from src/schema.js — single source of truth.

The schema lives in src/schema.js as declarative F(...) entries. This tool parses
those entries and renders the Markdown data dictionary so the two can never drift.

Usage:
  python tools/gen_data_dictionary.py            # same as --write
  python tools/gen_data_dictionary.py --write    # (re)write docs/DATA_DICTIONARY.md
  python tools/gen_data_dictionary.py --check     # exit 1 if the file is out of sync

build.py runs --write on every build, so a normal build keeps them in lock-step.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCHEMA = os.path.join(ROOT, 'src', 'schema.js')
OUT = os.path.join(ROOT, 'docs', 'DATA_DICTIONARY.md')

HEADER = (
    "# Phoenix Procurement — Data Dictionary\n\n"
    "> Generated from src/schema.js — DO NOT EDIT BY HAND.\n"
    "> Run `python build.py` (or `python tools/gen_data_dictionary.py --write`) to\n"
    "> regenerate. The build also runs `--check`, which fails if this file drifts\n"
    "> from the schema.\n"
)


def _split_args(s):
    """Split an F(...) argument list on top-level commas, respecting 'single quotes'."""
    args, buf, in_str, i = [], '', False, 0
    while i < len(s):
        c = s[i]
        if in_str:
            if c == "'":
                in_str = False
            buf += c
        else:
            if c == "'":
                in_str = True
                buf += c
            elif c == ',':
                args.append(buf.strip())
                buf = ''
            else:
                buf += c
        i += 1
    if buf.strip():
        args.append(buf.strip())
    return args


def _unquote(tok):
    tok = tok.strip()
    if len(tok) >= 2 and tok[0] == "'" and tok[-1] == "'":
        return tok[1:-1]
    return tok  # bare token (true / false)


def parse_schema(text):
    """Return an ordered list of (collection_name, [(field, meaning, type, owner,
    editable, required, ui), ...]) parsed from schema.js."""
    collections = []
    current = None
    fields = None
    # A collection opens with 4-space-indented `name: {`
    coll_re = re.compile(r'^    ([A-Za-z_][A-Za-z0-9_]*):\s*\{\s*$')
    # A field line: `key: F(<args>),`
    field_re = re.compile(r'^\s*([A-Za-z_][A-Za-z0-9_]*):\s*F\((.*)\),?\s*$')
    # A 4-space-indented close `},` or `}` ends the current collection
    close_re = re.compile(r'^    \},?\s*$')
    for line in text.splitlines():
        m = coll_re.match(line)
        if m:
            current = m.group(1)
            fields = []
            collections.append((current, fields))
            continue
        if current is not None and close_re.match(line):
            current = None
            fields = None
            continue
        if current is not None:
            fm = field_re.match(line)
            if fm:
                key = fm.group(1)
                args = _split_args(fm.group(2))
                if len(args) != 6:
                    raise ValueError(
                        f"Field '{current}.{key}' has {len(args)} F() args (expected 6): {fm.group(2)}")
                meaning, ftype, owner, editable, required, ui = [_unquote(a) for a in args]
                fields.append((key, meaning, ftype, owner, editable, required, ui))
    return collections


def render(collections):
    out = [HEADER]
    for name, fields in collections:
        out.append(f"\n## `{name}`\n")
        out.append("| Field | Meaning | Type | Owner | Editable | Required | UI |")
        out.append("|---|---|---|---|---|---|---|")
        for key, meaning, ftype, owner, editable, required, ui in fields:
            req = 'yes' if required == 'true' else 'no'
            esc = lambda v: v.replace('|', r'\|')
            out.append(
                f"| `{key}` | {esc(meaning)} | {ftype} | {owner} | {editable} | {req} | {esc(ui)} |")
    return "\n".join(out).rstrip() + "\n"


def build():
    with open(SCHEMA, encoding='utf-8') as f:
        text = f.read()
    return render(parse_schema(text))


def write():
    content = build()
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(content)
    n = content.count('| `')
    print(f"Wrote docs/DATA_DICTIONARY.md ({n} fields across schema).")
    return 0


def check():
    content = build()
    try:
        with open(OUT, encoding='utf-8') as f:
            existing = f.read()
    except FileNotFoundError:
        print("DATA_DICTIONARY.md missing — run --write.", file=sys.stderr)
        return 1
    if existing.rstrip() != content.rstrip():
        print("DRIFT: docs/DATA_DICTIONARY.md is out of sync with src/schema.js. "
              "Run `python tools/gen_data_dictionary.py --write`.", file=sys.stderr)
        return 1
    print("DATA_DICTIONARY.md is in sync with schema.js.")
    return 0


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else '--write'
    sys.exit(check() if mode == '--check' else write())
