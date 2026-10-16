#!/usr/bin/env python3
"""Authoring source for the JAI conformance fixtures.

The JSON files under tests/<class>/ are the normative fixtures. This script is
how they are written: expectations are stated by hand below, and every byte
sequence, canonical JSON string and identity is computed here with Python's
standard library, independently of any JAI implementation.

Run:  python3 -I tests/src/fixtures.py      (rewrites tests/*/*.json)
"""
import base64, gzip, hashlib, json, os, struct, zlib

EDITION = "1.0-draft"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SINCE = EDITION

# ---------------------------------------------------------------- helpers

def T(s):
    """Fixture strings write each backslash as U+00A5 so the source is unambiguous."""
    return s.replace("\u00a5", chr(92))


def canon_json(doc):
    """Canonical JSON per spec: jai, prompt, then code point order; RFC 8785 strings."""
    parts = ['"jai":1']
    def enc(vals):
        v = vals[0] if len(vals) == 1 else vals
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if "prompt" in doc:
        parts.append('"prompt":' + enc(doc["prompt"]))
    for k in sorted(k for k in doc if k != "prompt"):
        parts.append(json.dumps(k) + ":" + enc(doc[k]))
    return "{" + ",".join(parts) + "}"

def identity(doc):
    return hashlib.sha256(canon_json(doc).encode("utf-8")).hexdigest()

def gz(data, level=9, mtime=0):
    return gzip.compress(data, compresslevel=level, mtime=mtime)

def b64(b):
    return base64.b64encode(b).decode("ascii")

def gz_member(content, flg_extra=0, extra=None, fname=None, fcomment=None, fhcrc=False, level=9, cm=8, os_byte=255):
    """Hand-built gzip member so header fields can be controlled."""
    flg = flg_extra
    if extra is not None: flg |= 0x04
    if fname is not None: flg |= 0x08
    if fcomment is not None: flg |= 0x10
    if fhcrc: flg |= 0x02
    hdr = bytes([0x1F, 0x8B, cm, flg]) + struct.pack("<I", 0) + bytes([0, os_byte])
    if extra is not None: hdr += struct.pack("<H", len(extra)) + extra
    if fname is not None: hdr += fname + b"\x00"
    if fcomment is not None: hdr += fcomment + b"\x00"
    if fhcrc: hdr += struct.pack("<H", zlib.crc32(hdr) & 0xFFFF)
    co = zlib.compressobj(level, zlib.DEFLATED, -15)
    body = co.compress(content) + co.flush()
    trailer = struct.pack("<II", zlib.crc32(content) & 0xFFFFFFFF, len(content) & 0xFFFFFFFF)
    return hdr + body + trailer

def write(cls, cases, note):
    os.makedirs(os.path.join(ROOT, cls), exist_ok=True)
    ids = set()
    for c in cases:
        assert c["id"] not in ids, c["id"]; ids.add(c["id"])
        c.setdefault("since", SINCE)
    path = os.path.join(ROOT, cls, cls + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"class": cls, "edition": EDITION, "note": note, "cases": cases}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    return len(cases)

ALL_IDS = set()
def case(id, rationale, **kw):
    assert id not in ALL_IDS, id
    ALL_IDS.add(id)
    d = {"id": id, "rationale": rationale}
    d.update(kw)
    return d

# ---------------------------------------------------------------- parse

P = []
def p(id, inp, doc, diags=(), rationale="", advisories=None):
    c = case(id, rationale, input=inp, document=doc, diagnostics=list(diags))
    if advisories: c["advisories"] = advisories
    P.append(c)

# bare prompts, prefix, prompt=
p("parse-bare", "A magical castle", {"prompt": ["A magical castle"]}, rationale="The simplest document is a sentence.")
p("parse-prefix", "jai:A magical castle", {"prompt": ["A magical castle"]}, rationale="Optional prefix.")
p("parse-prefix-upper", "JAI:A magical castle", {"prompt": ["A magical castle"]}, rationale="Prefix is ASCII case-insensitive.")
p("parse-prompt-eq", "prompt=A magical castle", {"prompt": ["A magical castle"]}, rationale="Explicit prompt=.")
p("parse-prefix-prompt-eq", "jai:prompt=A magical castle", {"prompt": ["A magical castle"]}, rationale="Prefix and prompt=.")
p("parse-params", "jai:A magical castle;model=flux;style=anime", {"prompt": ["A magical castle"], "model": ["flux"], "style": ["anime"]}, rationale="Brief example.")
p("parse-params-first", "model=flux;prompt=A magical castle", {"model": ["flux"], "prompt": ["A magical castle"]}, rationale="prompt= may follow parameters.")
p("parse-repeated", "jai:A castle;model=flux;model=sdxl", {"prompt": ["A castle"], "model": ["flux", "sdxl"]}, rationale="Repeated keys keep order.")
p("parse-repeated-prompt", "prompt=A castle;prompt=with a moat", {"prompt": ["A castle", "with a moat"]}, rationale="Several prompt values.")
p("parse-unknown-key", "A castle;acme.light=rim", {"prompt": ["A castle"], "acme.light": ["rim"]}, rationale="Vendor keys are kept.")
p("parse-unknown-undotted", "A castle;mood=eerie", {"prompt": ["A castle"], "mood": ["eerie"]}, rationale="Unknown undotted keys parse; validators warn.", advisories=["unknown-key"])
# semicolons in prose
p("parse-prose-semicolon", "jai:A wizard stands in a doorway; behind him, a dragon sleeps;model=flux",
  {"prompt": ["A wizard stands in a doorway; behind him, a dragon sleeps"], "model": ["flux"]}, rationale="Brief: semicolons in prose.")
p("parse-prose-semicolon-spaces", "A wizard ; behind ; a dragon", {"prompt": ["A wizard ; behind ; a dragon"]}, rationale="Interior spacing around restored semicolons is preserved (trim once).")
p("parse-continuation-into-key", "A castle;style=anime;with a moat", {"prompt": ["A castle"], "style": ["anime;with a moat"]}, rationale="Prose after an assignment continues it.")
p("parse-no-prompt-after-param", "style=anime;A castle", {"style": ["anime;A castle"]}, rationale="Sharp edge: no prompt.", advisories=["no-prompt"])
p("parse-empty-continued", "k=;a", {"k": [";a"]}, rationale="An empty assignment followed by prose is continued, not dropped.")
p("parse-empty-continued-style", "jai:A castle;style=;anime", {"prompt": ["A castle"], "style": [";anime"]}, rationale="Same, inside a document.")
# equals signs
p("parse-extra-equals", "A castle;acme.formula=E=mc2", {"prompt": ["A castle"], "acme.formula": ["E=mc2"]}, rationale="Only the first = separates key and value.")
p("parse-first-segment-assignment", "E=mc2 explained", {"e": ["mc2 explained"]}, rationale="Sharp edge 1.", advisories=["first-segment-assignment", "unknown-key"])
p("parse-escaped-equals", T("E¥=mc2 explained"), {"prompt": ["E=mc2 explained"]}, rationale="An escaped = defeats assignment.")
p("parse-prompt-eq-equals", "prompt=E=mc2 explained", {"prompt": ["E=mc2 explained"]}, rationale="prompt= protects a leading word=.")
p("parse-escaped-eq-raw-test", T("a¥=b"), {"prompt": ["a=b"]}, rationale="The assignment test looks at the raw text with escapes in place.")
p("parse-ows-around-eq", "A chalkboard; e = mc2 written on it", {"prompt": ["A chalkboard"], "e": ["mc2 written on it"]}, rationale="Sharp edge 3: whitespace around = is allowed.", advisories=["unknown-key"])
p("parse-escaped-semicolon-prose", T("Draw a graph¥; y=2x"), {"prompt": ["Draw a graph; y=2x"]}, rationale="An escaped ; before something that looks like key=.")
p("parse-url-prompt", "http://example.org/?a=b", {"prompt": ["http://example.org/?a=b"]}, rationale=": and / are not key characters.")
p("parse-space-key-is-prose", "A castle; my key=value", {"prompt": ["A castle; my key=value"]}, rationale="A key cannot contain a space.")
p("parse-empty-key-is-prose", "=value", {"prompt": ["=value"]}, rationale="Empty key: prose.")
p("parse-lone-equals", "=", {"prompt": ["="]}, rationale="A lone = is prose.")
p("parse-equals-semicolon-equals", "=;=", {"prompt": ["=;="]}, rationale="Prose continuation.")
p("parse-key-leading-dot", ".a=1", {"prompt": [".a=1"]}, rationale="Key segments cannot start with a dot.")
p("parse-key-digit", "A castle;1x=y", {"prompt": ["A castle"], "1x": ["y"]}, rationale="Keys may start with a digit.", advisories=["unknown-key"])
p("parse-key-double-dot", "A castle;a..b=1", {"prompt": ["A castle; a..b=1".replace(" ", "")] if False else ["A castle;a..b=1"]}, rationale="a..b is not a key (empty segment), so the segment is prose.")
p("parse-key-trailing-dot", "A castle;acme.=1", {"prompt": ["A castle;acme.=1"]}, rationale="A trailing dot is not a key.")
p("parse-key-underscore-hyphen", "x;acme.a_b-c=1", {"prompt": ["x"], "acme.a_b-c": ["1"]}, rationale="_ and - inside segments.")
p("parse-key-unicode-is-prose", "x;É=1", {"prompt": ["x;É=1"]}, rationale="Keys are ASCII only.")
p("parse-key-kelvin-is-prose", "x;\u212aey=1", {"prompt": ["x;\u212aey=1"]}, rationale="U+212A KELVIN SIGN is not K: no Unicode case folding.")
# whitespace
p("parse-ws-around", "  A castle ; style = anime ;", {"prompt": ["A castle"], "style": ["anime"]}, rationale="Whitespace is forgiving.")
p("parse-ws-only", "   \t\n ", {}, rationale="Whitespace only: empty document.")
p("parse-empty", "", {}, rationale="Empty input.")
p("parse-prefix-only", "jai:", {}, rationale="Prefix only.")
p("parse-leading-ws-prefix", "\n  jai:A castle", {"prompt": ["A castle"]}, rationale="Leading whitespace is skipped before the prefix test.")
p("parse-prefix-ws", "jai:   A castle", {"prompt": ["A castle"]}, rationale="Whitespace after the prefix is trimmed.")
p("parse-prefix-once", "jai: jai:A castle", {"prompt": ["jai:A castle"]}, rationale="The prefix is removed once.", advisories=["prefix-in-prompt"])
p("parse-prefix-not-dotted-i", "JA\u0130:A castle", {"prompt": ["JA\u0130:A castle"]}, rationale="U+0130 is not I: ASCII case-insensitivity only.")
p("parse-prefix-space-before-colon", "JAI :A castle", {"prompt": ["JAI :A castle"]}, rationale="Not the prefix.")
p("parse-nbsp-before-key", "A castle;\u00a0style=anime", {"prompt": ["A castle"], "style": ["anime"]}, rationale="NBSP is JAI whitespace (rich-text paste).")
p("parse-ideographic-space-before-key", "魔法の城;\u3000style=anime", {"prompt": ["魔法の城"], "style": ["anime"]}, rationale="U+3000 is JAI whitespace (CJK IME).")
p("parse-nbsp-before-eq", "x;style\u00a0=anime", {"prompt": ["x"], "style": ["anime"]}, rationale="Whitespace between key and = may be any JAI whitespace.")
p("parse-trailing-nel", "A castle\u0085", {"prompt": ["A castle"]}, rationale="U+0085 is trimmed.")
p("parse-trailing-ls", "A castle\u2028", {"prompt": ["A castle"]}, rationale="U+2028 is trimmed.")
p("parse-trailing-ff", "A castle\u000c", {"prompt": ["A castle"]}, rationale="FF is trimmed.")
p("parse-trailing-us-kept", "A castle\u001f", {"prompt": ["A castle\u001f"]}, rationale="U+001F is not whitespace (JS trim and Python strip disagree here).", advisories=["control-character"])
p("parse-trailing-zwnbsp-kept", "A castle\ufeff", {"prompt": ["A castle\ufeff"]}, rationale="U+FEFF is not whitespace except at the very start.", advisories=["invisible-char"])
p("parse-leading-bom", "\ufeffjai:A castle", {"prompt": ["A castle"]}, rationale="Leading U+FEFF is removed.")
p("parse-leading-boms", "\ufeff\ufeff\n jai:A castle", {"prompt": ["A castle"]}, rationale="Every leading U+FEFF, then whitespace, then the prefix.")
p("parse-ws-segment", "A; ;b", {"prompt": ["A;b"]}, ["empty-segment"], rationale="A whitespace-only segment disappears with one delimiter.")
p("parse-crlf", "line one\r\nline two\rline three;style=x", {"prompt": ["line one\nline two\nline three"], "style": ["x"]}, rationale="CRLF and CR become LF.")
p("parse-multiline", "A castle\n\nMist below;style=x", {"prompt": ["A castle\n\nMist below"], "style": ["x"]}, rationale="Line breaks inside a value are kept.")
p("parse-newline-not-delimiter", "A castle\nstyle=anime", {"prompt": ["A castle\nstyle=anime"]}, rationale="A new line does not start a parameter.", advisories=["newline-assignment"])
# case
p("parse-key-case", "A castle;Style=anime;MODEL=flux", {"prompt": ["A castle"], "style": ["anime"], "model": ["flux"]}, rationale="Keys are ASCII case-insensitive.")
p("parse-key-case-merge", "A castle;style=a;Style=b", {"prompt": ["A castle"], "style": ["a", "b"]}, rationale="Case variants are one key.")
p("parse-value-case-kept", "A castle;style=Anime", {"prompt": ["A castle"], "style": ["Anime"]}, rationale="Values are never case-converted.")
p("parse-prompt-key-case", "PROMPT=A castle", {"prompt": ["A castle"]}, rationale="PROMPT= is prompt=.")
p("parse-preview-upper", "x;PREVIEW=y", {"prompt": ["x"], "preview": ["y"]}, rationale="Locale-independent lowercasing (Turkish I).")
# empty values, delimiters
p("parse-empty-value", "A castle;style=", {"prompt": ["A castle"]}, ["empty-value:style"], rationale="Empty values are dropped.")
p("parse-empty-value-ws", "A castle;style=   ", {"prompt": ["A castle"]}, ["empty-value:style"], rationale="Whitespace-only values are dropped.")
p("parse-trailing-semicolon", "A castle;", {"prompt": ["A castle"]}, rationale="A trailing delimiter is allowed and not diagnosed.")
p("parse-trailing-semicolons", "A castle;;", {"prompt": ["A castle"]}, ["empty-segment"], rationale="The interior empty segment is diagnosed; the final one is not.")
p("parse-double-semicolon", "A castle;;style=anime", {"prompt": ["A castle"], "style": ["anime"]}, ["empty-segment"], rationale="Doubled delimiter.")
p("parse-only-semicolons", ";;", {}, ["empty-segment", "empty-segment"], rationale="Every interior empty segment is diagnosed.")
p("parse-leading-semicolon", ";A castle", {"prompt": ["A castle"]}, ["empty-segment"], rationale="An empty first segment is ignored.")
p("parse-semicolon-ws-prefix", "jai:  ;A castle", {"prompt": ["A castle"]}, ["empty-segment"], rationale="Whitespace segment after the prefix.")
# reserved key
p("parse-reserved-jai", "jai:jai=1;prompt=x", {"prompt": ["x"]}, ["reserved-key:jai"], rationale="The key jai is reserved.")
p("parse-reserved-jai-continuation", "jai:A castle;jai=2;more", {"prompt": ["A castle"]}, ["reserved-key:jai"], rationale="Prose continuing a dropped assignment is dropped with it.")
p("parse-reserved-jai-case", "A castle;JAI=2", {"prompt": ["A castle"]}, ["reserved-key:jai"], rationale="Reserved after ASCII lowercasing.")
p("parse-jai-dot-ok", "A castle;jai.x=1", {"prompt": ["A castle"], "jai.x": ["1"]}, rationale="Only the exact key jai is reserved.")
# escaping
p("parse-backslash-literal", T("C:¥Users¥me"), {"prompt": [T("C:¥Users¥me")]}, rationale="Other backslashes are literal.")
p("parse-trailing-backslash", T("a¥"), {"prompt": [T("a¥")]}, rationale="A trailing backslash is literal.")
p("parse-double-backslash", T("a¥¥b"), {"prompt": [T("a¥b")]}, rationale="Two backslashes are one.")
p("parse-backslash-pair-then-delim", T("a¥¥;style=x"), {"prompt": [T("a¥")], "style": ["x"]}, rationale="An escaped backslash then an unescaped ;.")
p("parse-three-backslashes", T("a¥¥¥;b"), {"prompt": [T("a¥;b")]}, rationale="An escaped backslash then an escaped ;.")
p("parse-escaped-semicolon", T("a¥;style=x"), {"prompt": ["a;style=x"]}, rationale="An escaped ; is literal.")
p("parse-escaped-backslash-n", T("¥¥nas¥models"), {"prompt": [T("¥nas¥models")]}, rationale="A doubled backslash collapses even in a path.")
p("parse-escape-prose-template", T("prompt=Red mug¥; model¥=XZ-200¥; colour¥=red;style=product photo"),
  {"prompt": ["Red mug; model=XZ-200; colour=red"], "style": ["product photo"]}, rationale="escape-prose recipe.")
# data URIs
p("parse-data-uri", "source=data:image/webp;base64,UklGRkI=;style=anime", {"source": ["data:image/webp;base64,UklGRkI="], "style": ["anime"]}, rationale="base64,... is not an assignment.")
p("parse-data-uri-charset-split", "x;source=data:image/svg+xml;charset=utf-8;base64,PHN2Zz4=",
  {"prompt": ["x"], "source": ["data:image/svg+xml"], "charset": ["utf-8;base64,PHN2Zz4="]}, rationale="Media type parameters split a data URI unless escaped.", advisories=["split-data-uri"])
p("parse-data-uri-charset-escaped", T("x;source=data:image/svg+xml¥;charset=utf-8;base64,PHN2Zz4="),
  {"prompt": ["x"], "source": ["data:image/svg+xml;charset=utf-8;base64,PHN2Zz4="]}, rationale="Escaped, it survives.")
# unicode
p("parse-unicode", "jai:قلعة سحرية;style=anime", {"prompt": ["قلعة سحرية"], "style": ["anime"]}, rationale="RTL prompt.")
p("parse-emoji", "🏰 at dusk;style=pixel art", {"prompt": ["🏰 at dusk"], "style": ["pixel art"]}, rationale="Astral code points.")
p("parse-nul", "A\u0000castle", {"prompt": ["A\ufffdcastle"]}, rationale="U+0000 becomes U+FFFD.")
p("parse-fullwidth-semicolon-prose", "魔法の城；style＝anime", {"prompt": ["魔法の城；style＝anime"]}, rationale="Full-width delimiters are prose.", advisories=["confusable-delimiter"])
p("parse-nfd-distinct", "Cafe\u0301", {"prompt": ["Cafe\u0301"]}, rationale="No Unicode normalisation.")
p("parse-greek-question-mark", "Why\u037e not", {"prompt": ["Why\u037e not"]}, rationale="U+037E is not a delimiter.")
# vendor & misc
p("parse-constructor", "x;constructor=a;constructor=b", {"prompt": ["x"], "constructor": ["a", "b"]}, rationale="Implementations use real maps.", advisories=["unknown-key"])
p("parse-transform-no-prompt", "mode=transform;style=anime", {"mode": ["transform"], "style": ["anime"]}, rationale="A document without a prompt is valid; no no-prompt advisory in transform.")
p("parse-long-key", "x;" + "a" * 1200 + "=v", {"prompt": ["x"], "a" * 1200: ["v"]}, rationale="No key length limit.", advisories=["unknown-key"])
p("parse-brace-text", "{masterpiece}, a castle", {"prompt": ["{masterpiece}, a castle"]}, rationale="Braces are ordinary text in the text form.")

# ---------------------------------------------------------------- serialize

S = []
def s(id, doc, text, rationale, bare=None):
    c = case(id, rationale, document=doc, text=text, json=canon_json(doc), identity=identity(doc))
    if bare is not None: c["bare"] = bare
    S.append(c)

s("ser-simple", {"prompt": ["A magical castle"]}, "jai:A magical castle", "Minimal.", bare="A magical castle")
s("ser-order", {"style": ["anime"], "prompt": ["A castle"], "model": ["flux", "sdxl"]}, "jai:A castle;model=flux;model=sdxl;style=anime", "Prompt first, keys by code point, repeats adjacent.")
s("ser-multi-prompt", {"prompt": ["A castle", "with a moat"], "model": ["flux"]}, "jai:A castle;prompt=with a moat;model=flux", "Later prompt values use prompt=.")
s("ser-prose-semicolon", {"prompt": ["A wizard stands; behind him, a dragon"], "model": ["flux"]}, "jai:A wizard stands; behind him, a dragon;model=flux", "Ordinary prose semicolons are not escaped.")
s("ser-leading-word-eq", {"prompt": ["E=mc2 explained"]}, "jai:prompt=E=mc2 explained", "A leading word= forces prompt=.", bare="prompt=E=mc2 explained")
s("ser-leading-semicolon", {"prompt": [";-) a smiley"]}, T("jai:¥;-) a smiley"), "A leading ; is escaped.")
s("ser-trailing-backslash", {"prompt": [T("ends with backslash¥")], "style": ["x"]}, T("jai:ends with backslash¥¥;style=x"), "A trailing backslash is escaped.")
s("ser-trailing-backslash-last", {"prompt": ["x"], "style": [T("C:¥dir¥")]}, T("jai:x;style=C:¥dir¥¥"), "Also at the end of the document (later concatenation).")
s("ser-double-semicolon", {"prompt": ["a;;b"]}, T("jai:a¥;;b"), "; followed by ; is escaped.")
s("ser-semicolon-ws-semicolon", {"prompt": ["a; ;b"]}, T("jai:a¥; ;b"), "; followed by whitespace then ;.")
s("ser-semicolon-end", {"prompt": ["a;"], "style": ["x"]}, T("jai:a¥;;style=x"), "; at end of value.")
s("ser-semicolon-key-eq", {"prompt": ["A list; item=1"]}, T("jai:A list¥; item=1"), "; followed by key=.")
s("ser-semicolon-key-ws-eq", {"prompt": ["A list; Item = 1"]}, T("jai:A list¥; Item = 1"), "; followed by key OWS = (case-insensitive key).")
s("ser-semicolon-nbsp-key", {"prompt": ["a;\u00a0b=c"]}, T("jai:a¥;\u00a0b=c"), "The whitespace class in the regex is JAI whitespace.")
s("ser-windows-path", {"prompt": [T("C:¥Users¥me")]}, T("jai:C:¥Users¥me"), "Other backslashes are not escaped.")
s("ser-backslash-semicolon-value", {"prompt": [T("a¥;b")]}, T("jai:a¥¥;b"), "Backslash before ; is escaped; the ; itself is followed by b.")
s("ser-backslash-equals", {"prompt": ["x"], "acme.v": [T("a¥=b")]}, T("jai:x;acme.v=a¥¥=b"), "Backslash before = is escaped.")
s("ser-double-backslash", {"prompt": [T("a¥¥b")]}, T("jai:a¥¥¥b"), "Only a backslash followed by a significant character is escaped; the second one precedes b.")
s("ser-equals-not-escaped", {"prompt": ["x"], "acme.formula": ["E=mc2"]}, "jai:x;acme.formula=E=mc2", "= is never escaped.")
s("ser-no-prompt", {"mode": ["transform"], "style": ["anime"]}, "jai:mode=transform;style=anime", "No prompt.")
s("ser-empty", {}, "jai:", "Empty document.", bare="")
s("ser-prompt-jai-prefix", {"prompt": ["jai:x"]}, "jai:jai:x", "Prefixed form protects a jai:-initial prompt by the prefix.", bare="prompt=jai:x")
s("ser-prompt-bom", {"prompt": ["\ufeffx"]}, "jai:\ufeffx", "Bare form protects a U+FEFF-initial prompt.", bare="prompt=\ufeffx")
s("ser-prompt-brace", {"prompt": ["{x}"]}, "jai:{x}", "Bare form protects a {-initial prompt.", bare="prompt={x}")
s("ser-data-uri-charset", {"prompt": ["x"], "source": ["data:image/svg+xml;charset=utf-8,<svg/>"]}, T("jai:x;source=data:image/svg+xml¥;charset=utf-8,<svg/>"), "A media-type parameter semicolon is escaped.")
s("ser-control-chars", {"prompt": ["tab\there\u001fend\u007f\u2028é/"]}, "jai:tab\there\u001fend\u007f\u2028é/", "Canonical JSON escapes only per RFC 8785.")
s("ser-unicode", {"prompt": ["قلعة سحرية"], "style": ["anime"]}, "jai:قلعة سحرية;style=anime", "Non-ASCII literal.")
s("ser-nfc", {"prompt": ["Caf\u00e9"]}, "jai:Caf\u00e9", "NFC spelling.")
s("ser-nfd", {"prompt": ["Cafe\u0301"]}, "jai:Cafe\u0301", "NFD spelling: a different identity.")
s("ser-preview-in-identity", {"prompt": ["x"], "preview": ["data:image/webp;base64,UklGRkI="]}, "jai:x;preview=data:image/webp;base64,UklGRkI=", "preview is part of identity.")
s("ser-vendor-dc", {"prompt": ["A brass astrolabe on velvet"], "comfy.sampler": ["euler"], "dc.title": ["Astrolabe study"]}, "jai:A brass astrolabe on velvet;comfy.sampler=euler;dc.title=Astrolabe study", "Vendor keys sort by code point.")
s("ser-key-order-codepoint", {"prompt": ["x"], "b": ["1"], "a.z": ["2"], "a-b": ["3"], "a_b": ["4"], "a": ["5"]}, "jai:x;a=5;a-b=3;a.z=2;a_b=4;b=1", "Code point order: - (2D) < . (2E) < _ (5F).")
s("ser-multiline", {"prompt": ["A castle\n\nMist below"]}, "jai:A castle\n\nMist below", "Line breaks are literal in the text form.")
s("ser-semicolon-newline-key", {"prompt": ["a;\nb=c"]}, T("jai:a¥;\nb=c"), "; followed by LF then key=.")

# ---------------------------------------------------------------- roundtrip

R = []
def r(id, doc, rationale):
    R.append(case(id, rationale, document=doc))

r("rt-fuzz-class-a", {"prompt": [";e"]}, "Round-0 fuzzer class A: leading ;.")
r("rt-fuzz-class-b", {"km": [T("¥"), "_"]}, "Round-0 fuzzer class B: trailing backslash.")
r("rt-fuzz-class-b2", {"prompt": [T("¥"), ">"]}, "Class B in prompt values.")
r("rt-semicolons", {"prompt": [";;"], "k": ["a;;", ";", ";x;"]}, "Runs of semicolons.")
r("rt-backslashes", {"prompt": [T("¥¥¥")], "k": [T("¥;¥=¥¥")]}, "Runs of backslashes before significant characters.")
r("rt-assignment-like", {"prompt": ["x=1", "style=anime"], "k": ["a; style=anime", "b;\tmode =keep"]}, "Values that look like assignments.")
r("rt-prefix-like", {"prompt": ["jai:x", "JAI:y"]}, "jai:-initial values.")
r("rt-brace", {"prompt": ["{\"jai\":1}"]}, "A prompt that looks like JSON.")
r("rt-data-uris", {"source": ["data:image/svg+xml;charset=utf-8;base64,PHN2Zz4="], "preview": ["data:image/png;name=a.png;base64,iVBOR="]}, "Data URIs with parameters.")
r("rt-unicode-ws-inside", {"prompt": ["a\u00a0;\u3000b=c d"]}, "Unicode whitespace inside values near delimiters.")
r("rt-bom-inside", {"prompt": ["\ufeffx"], "k": ["y\ufeff"]}, "U+FEFF at value edges.")
r("rt-newlines", {"prompt": ["a\n;\nb=1\n"[:-1]]}, "Line breaks next to delimiters.")
r("rt-many-keys", {"prompt": ["p"], "aspect": ["16:9"], "avoid": ["text", "people"], "mode": ["transform"], "model": ["flux", "sdxl"], "seed": ["42"], "strength": ["0.6"], "style": ["anime", "watercolor"], "animate": ["true"]}, "Every standard key.")

# ---------------------------------------------------------------- json

JS = []
def j(id, inp, doc, diags=(), rationale="", context=True, optional=None):
    c = case(id, rationale, input=inp, context=context, document=doc, diagnostics=list(diags))
    if optional: c["optional"] = optional
    JS.append(c)

j("json-simple", '{"jai":1,"prompt":"A magical castle","style":"anime"}', {"prompt": ["A magical castle"], "style": ["anime"]}, rationale="Basic.")
j("json-array", '{"jai":1,"model":["flux","sdxl"]}', {"model": ["flux", "sdxl"]}, rationale="Arrays keep order.")
j("json-trim", '{"jai":1,"prompt":" A castle "}', {"prompt": ["A castle"]}, rationale="Value normalisation trims.")
j("json-crlf", '{"jai":1,"prompt":"a\\r\\nb\\rc"}', {"prompt": ["a\nb\nc"]}, rationale="CR normalisation applies to JSON too.")
j("json-empty-string", '{"jai":1,"prompt":"x","style":""}', {"prompt": ["x"]}, ["empty-value:style"], rationale="Empty strings dropped.")
j("json-empty-array", '{"jai":1,"prompt":"x","style":[]}', {"prompt": ["x"]}, rationale="An empty array contributes nothing.")
j("json-null", '{"jai":1,"prompt":"x","style":null}', {"prompt": ["x"]}, ["empty-value:style"], rationale="null dropped.")
j("json-mixed-array", '{"jai":1,"prompt":["a",null,"",["b"],{"x":1}," c "]}', {"prompt": ["a", "c"]}, ["empty-value", "empty-value", "unsupported-member", "unsupported-member"], rationale="Only the offending element is dropped.")
j("json-object-member", '{"jai":1,"prompt":"x","acme.cfg":{"a":1}}', {"prompt": ["x"]}, ["unsupported-member:acme.cfg"], rationale="Objects are reserved.")
for tok, out in [("1.0", "1"), ("0.60", "0.6"), ("1E2", "100"), ("1e21", "1e+21"), ("-0", "0"), ("5e-324", "5e-324"), ("9007199254740993", "9007199254740992"), ("12345678901234567890", "12345678901234567000"), ("1e-7", "1e-7"), ("123e-2", "1.23"), ("0.1", "0.1"), ("100", "100")]:
    j("json-number-" + tok.replace(".", "p").replace("-", "m").replace("+", "pl"), '{"jai":1,"strength":%s}' % tok, {"strength": [out]}, ["number-value:strength"], rationale="ECMAScript Number::toString of the binary64 value.")
j("json-true", '{"jai":1,"animate":true}', {"animate": ["true"]}, ["number-value:animate"], rationale="Booleans become their spelling.")
j("json-false", '{"jai":1,"animate":false}', {"animate": ["false"]}, ["number-value:animate"], rationale="Booleans become their spelling.")
j("json-nan", '{"jai":1,"strength":NaN}', {}, ["invalid-json"], rationale="NaN is not JSON.")
j("json-infinity", '{"jai":1,"strength":Infinity}', {}, ["invalid-json"], rationale="Infinity is not JSON.")
j("json-trailing-comma", '{"jai":1,"prompt":"x",}', {}, ["invalid-json"], rationale="Trailing commas are not JSON.")
j("json-comment", '{"jai":1,/*c*/"prompt":"x"}', {}, ["invalid-json"], rationale="Comments are not JSON.")
j("json-not-object", '["jai",1]', {}, ["invalid-json"], rationale="Top level must be an object.")
j("json-truncated", '{"jai":1,"prompt":"x"', {}, ["invalid-json"], rationale="Truncated.")
j("json-case-merge", '{"jai":1,"prompt":"a","Prompt":"b"}', {"prompt": ["a", "b"]}, ["duplicate-key:prompt"], rationale="Names colliding after lowercasing are concatenated in member order.")
j("json-case-merge-4", '{"jai":1,"Prompt":"a","prompt":"b","PROMPT":"c"}', {"prompt": ["a", "b", "c"]}, ["duplicate-key:prompt", "duplicate-key:prompt"], rationale="Three spellings.")
j("json-exact-repeat", '{"jai":1,"prompt":"a","b.x":"x","prompt":"c"}', {"prompt": ["c"], "b.x": ["x"]}, rationale="An exact repeat replaces in place (first position).", optional=["duplicate-member"])
j("json-missing-marker-context", '{"prompt":"x"}', {"prompt": ["x"]}, ["missing-marker"], rationale="Accepted in JAI context.")
j("json-missing-marker-no-context", '{"prompt":"x"}', {}, [], rationale="Not a JAI document outside a JAI context.", context=False)
j("json-marker-1p0", '{"jai":1.0,"prompt":"x"}', {"prompt": ["x"]}, rationale="1.0 is the number 1.")
j("json-marker-string", '{"jai":"1","prompt":"x"}', {"prompt": ["x"]}, ["invalid-marker"], rationale="A string marker.")
j("json-marker-true", '{"jai":true,"prompt":"x"}', {"prompt": ["x"]}, ["invalid-marker"], rationale="A boolean marker.")
j("json-marker-2", '{"jai":2,"prompt":"x"}', {"prompt": ["x"]}, ["unsupported-version"], rationale="Other integers: parse, never auto-render.")
j("json-marker-0", '{"jai":0,"prompt":"x"}', {"prompt": ["x"]}, ["unsupported-version"], rationale="0 is an integer other than 1.")
j("json-marker-1p5", '{"jai":1.5,"prompt":"x"}', {"prompt": ["x"]}, ["invalid-marker"], rationale="Not an integer.")
j("json-jai-case-variant", '{"jai":1,"JAI":"x","prompt":"y"}', {"prompt": ["y"]}, ["duplicate-member:jai"], rationale="A case variant of jai is never a parameter.")
j("json-invalid-key", '{"jai":1,"my key":"x","prompt":"y"}', {"prompt": ["y"]}, ["invalid-key"], rationale="Invalid names are dropped.")
j("json-proto", '{"jai":1,"__proto__":"x","prompt":"y"}', {"prompt": ["y"]}, ["invalid-key"], rationale="__proto__ is not a key.")
j("json-constructor", '{"jai":1,"constructor":"x"}', {"constructor": ["x"]}, rationale="constructor is a valid key.")
j("json-uppercase-key", '{"jai":1,"Style":"anime"}', {"style": ["anime"]}, rationale="Names are lowercased.")
j("json-lone-surrogate", '{"jai":1,"prompt":"a\\ud800b"}', {"prompt": ["a\ufffdb"]}, rationale="Lone surrogates become U+FFFD.")
j("json-nul", '{"jai":1,"prompt":"a\\u0000b"}', {"prompt": ["a\ufffdb"]}, rationale="U+0000 becomes U+FFFD.")
j("json-empty-object", '{}', {}, ["missing-marker"], rationale="Empty object in context.")
j("json-ws", ' \n {"jai" : 1 , "prompt" : "x" } \n', {"prompt": ["x"]}, rationale="JSON whitespace.")

# ---------------------------------------------------------------- decode

D = []
def d(id, data, doc, diags=(), rationale="", advisories=None, bound=None, context=True):
    c = case(id, rationale, bytes=b64(data), document=doc, diagnostics=list(diags))
    if advisories: c["advisories"] = advisories
    if bound: c["bound"] = bound
    if not context: c["context"] = False
    D.append(c)

castle = {"prompt": ["A magical castle"], "style": ["anime"]}
cj = canon_json(castle).encode()
d("dec-gzip", gz(cj), castle, rationale="The file form.")
d("dec-gzip-level0", gz(cj, level=0), castle, rationale="Stored deflate blocks.")
long_doc = {"prompt": [("A magical castle on a hill at dusk, lanterns in the windows, " * 20).strip()], "style": ["storybook illustration"]}
d("dec-gzip-dynamic", gz(canon_json(long_doc).encode()), long_doc, rationale="Dynamic Huffman blocks.")
big = {"prompt": ["".join(chr(0x4e00 + (i * 7919) % 20000) for i in range(30000))]}
d("dec-gzip-multiblock", gz(canon_json(big).encode()), big, rationale="Several deflate blocks, non-ASCII.")
d("dec-gzip-header-fields", gz_member(cj, extra=b"JA\x00\x00", fname=b"castle.json", fcomment=b"hello", fhcrc=True), castle, rationale="FEXTRA, FNAME, FCOMMENT and FHCRC are skipped.")
d("dec-gzip-two-members", gz(cj) + gz(cj), {}, ["malformed-container"], rationale="Exactly one member.")
d("dec-gzip-empty-second-member", gz(cj) + gz(b""), {}, ["malformed-container"], rationale="Even an empty second member.")
d("dec-gzip-trailing-newline", gz(cj) + b"\n", {}, ["malformed-container"], rationale="Nothing after the member.")
d("dec-gzip-trailing-garbage", gz(cj) + b"\x00\x00\x00", {}, ["malformed-container"], rationale="Nothing after the member.")
d("dec-gzip-truncated", gz(cj)[:-4], {}, ["malformed-container"], rationale="Truncated trailer.")
d("dec-gzip-truncated-body", gz(cj)[:15], {}, ["malformed-container"], rationale="Truncated deflate stream.")
bad = bytearray(gz(cj)); bad[-8] ^= 0xFF
d("dec-gzip-bad-crc", bytes(bad), {}, ["malformed-container"], rationale="CRC mismatch.")
bad = bytearray(gz(cj)); bad[-1] ^= 0x01
d("dec-gzip-bad-isize", bytes(bad), {}, ["malformed-container"], rationale="ISIZE mismatch.")
d("dec-gzip-reserved-flag", gz_member(cj, flg_extra=0x20), {}, ["malformed-container"], rationale="Reserved FLG bits.")
d("dec-gzip-bad-method", gz_member(cj, cm=7), {}, ["malformed-container"], rationale="CM must be 8.")
d("dec-gzip-nested", gz(gz(cj)), {}, ["malformed-container"], rationale="A gzip member must contain JSON, not gzip.")
d("dec-gzip-text-content", gz(b"jai:A magical castle"), {}, ["malformed-container"], rationale="A gzip member must contain JSON.")
d("dec-gzip-empty-content", gz(b""), {}, ["malformed-container"], rationale="Empty content is not JSON.")
d("dec-gzip-array-content", gz(b'["jai",1]'), {}, ["malformed-container"], rationale="Content must be an object.")
d("dec-gzip-invalid-json", gz(b'{"jai":1,"prompt":}'), {}, ["invalid-json"], rationale="JSON failure inside gzip.")
d("dec-gzip-invalid-utf8", gz(b'{"jai":1,"prompt":"\xff"}'), {}, ["malformed-container"], rationale="Content of a gzip member must be well-formed UTF-8 JSON.")
d("dec-gzip-bomb", gz(b"{" + b" " * (20 * 1024 * 1024) + b"}"), {}, ["malformed-container"], rationale="Output bound enforced during inflation.", bound=16 * 1024 * 1024)
d("dec-gzip-noncanonical-json", gz(b'{ "style":"anime", "jai":1, "prompt":"A magical castle" }'), castle, rationale="Readers accept any valid JSON inside the member.")
d("dec-json", cj, castle, rationale="Uncompressed JSON is accepted.", advisories=["non-canonical-encoding"])
d("dec-json-bom", b"\xef\xbb\xbf" + cj, castle, rationale="Leading BOM.")
d("dec-json-ws", b" \n\t" + cj, castle, rationale="Leading JSON whitespace.")
d("dec-json-empty-object", b"{}", {}, ["missing-marker"], rationale="{ followed by }.")
d("dec-json-invalid", b'{"quoted"} prose', {}, ["invalid-json"], rationale="No fallback to the text form.")
d("dec-json-truncated", b'{"jai":1,"prompt":"x"', {}, ["invalid-json"], rationale="No fallback to the text form.")
d("dec-text", "jai:A magical castle;style=anime".encode(), castle, rationale="Text form.")
d("dec-text-bare", "A magical castle;style=anime".encode(), castle, rationale="Bare text form.")
d("dec-text-brace", "{masterpiece}, a castle".encode(), {"prompt": ["{masterpiece}, a castle"]}, rationale="{ not followed by \" or } is text.")
d("dec-text-brace-space", "{ masterpiece }".encode(), {"prompt": ["{ masterpiece }"]}, rationale="{ then whitespace then m: text.")
d("dec-text-nul", b"A\x00castle", {"prompt": ["A\ufffdcastle"]}, rationale="NUL is well-formed UTF-8; normalised to U+FFFD.")
d("dec-utf16", "\ufeffjai:A castle".encode("utf-16-le") if False else b"\xff\xfe" + "jai:A castle".encode("utf-16-le"), {}, ["undecodable"], rationale="No UTF-16 autodetection.")
d("dec-png", bytes.fromhex("89504e470d0a1a0a0000000d49484452"), {}, ["undecodable"], rationale="Binary is not a prompt.")
d("dec-invalid-utf8-text", b"A castle \xc3(", {}, ["undecodable"], rationale="Strict UTF-8.")
d("dec-empty", b"", {}, rationale="Empty bytes: empty text document.")

# ---------------------------------------------------------------- url

U = []
def u(id, url, kind, doc=None, diags=(), rationale="", discovered=True):
    c = case(id, rationale, url=url, kind=kind)
    if discovered:
        c["document"] = doc; c["diagnostics"] = list(diags)
    else:
        c["discovered"] = False
    U.append(c)

u("url-data-text", "data:image/jai,A%20magical%20castle;style=anime", "data", castle, rationale="Canonical URL form.")
u("url-data-raw-space", "data:image/jai,A magical castle;style=anime", "data", castle, rationale="Raw spaces survive the data: URL processor in src (not in srcset).")
u("url-data-base64", "data:image/jai;base64," + b64(gz(cj)), "data", castle, rationale="Base64 file form.")
u("url-data-base64-json", "data:image/jai;base64," + b64(cj), "data", castle, rationale="Base64 JSON.")
u("url-data-percent-json", "data:image/jai," + "".join("%" + format(b, "02X") if chr(b) in ' "%#' else chr(b) for b in cj), "data", castle, rationale="Percent-encoded JSON.")
u("url-data-double-encoded", "data:image/jai,100%2520", "data", {"prompt": ["100%20"]}, rationale="Exactly one percent-decoding.")
u("url-data-bare-percent", "data:image/jai,100% cotton", "data", {"prompt": ["100% cotton"]}, rationale="A % not followed by two hex digits is left in place.")
u("url-data-bad-hex", "data:image/jai,%ab%zz", "data", {}, ["undecodable"], rationale="%ab decodes to byte AB, which is not UTF-8 on its own; %zz is left in place. Strict UTF-8 applies.")
u("url-data-hash-truncates", "data:image/jai,Castle #3;style=anime", "data", {"prompt": ["Castle"]}, rationale="An unencoded # ends the URL.")
u("url-data-hash-encoded", "data:image/jai,Castle%20%233;style=anime", "data", {"prompt": ["Castle #3"], "style": ["anime"]}, rationale="%23 keeps it.")
u("url-data-newline-encoded", "data:image/jai,line%0Atwo", "data", {"prompt": ["line\ntwo"]}, rationale="%0A carries a line break.")
u("url-data-newline-raw", "data:image/jai,line\ntwo", "data", {"prompt": ["linetwo"]}, rationale="Raw line breaks are deleted by the URL parser.")
u("url-data-escaped-semicolon-encoded", "data:image/jai,a%3Bstyle%3Dx", "data", {"prompt": ["a"], "style": ["x"]}, rationale="%3B and %3D become ; and = and parse as delimiters.")
u("url-data-charset-param", "data:image/jai;charset=utf-8,A%20castle", "data", {"prompt": ["A castle"]}, rationale="Media type parameters are ignored.")
u("url-data-other-type", "data:image/png,abc", "data", rationale="Not image/jai: not discovered.", discovered=False)
u("url-data-missing-comma", "data:image/jai;A castle", "data", rationale="No comma: not a data URL body.", discovered=False)
u("url-data-upper", "DATA:IMAGE/JAI,A%20castle", "data", {"prompt": ["A castle"]}, rationale="Scheme and essence are case-insensitive.")
u("url-jai-scheme", "jai:A magical castle", "data", rationale="jai: is not a URL scheme.", discovered=False)
u("url-query", "https://example.org/play?prompt=A%20magical%20castle;style=anime", "query", castle, rationale="Whole-query form.")
u("url-query-plus", "https://example.org/play?C++ code on a screen", "query", {"prompt": ["C++ code on a screen"]}, rationale="+ is literal in the whole-query form.")
u("url-query-amp", "https://example.org/play?salt & pepper;style=x", "query", {"prompt": ["salt & pepper"], "style": ["x"]}, rationale="& is text.")
u("url-query-hash", "https://example.org/play?A castle#frag", "query", {"prompt": ["A castle"]}, rationale="# ends the query.")
u("url-query-utm", "https://example.org/play?utm_source=x&prompt=A castle", "query", {"utm_source": ["x&prompt=A castle"]}, rationale="Other parameters become part of the document (do not mix).")
u("url-param", "https://example.org/render?w=800&jai=A+magical+castle%3Bstyle%3Danime", "param", castle, rationale="Parameter form uses form encoding.")
u("url-param-raw-semicolon", "https://example.org/render?jai=A%20castle;style=anime&w=1", "param", {"prompt": ["A castle"], "style": ["anime"]}, rationale="Form parsers do not split on ;.")
u("url-param-absent", "https://example.org/render?w=800", "param", rationale="No jai parameter.", discovered=False)

# ---------------------------------------------------------------- html

H = []
def h(id, html, discovered, rationale, advisories=None):
    c = case(id, rationale, html=html, discovered=discovered)
    if advisories: c["advisories"] = advisories
    H.append(c)

h("html-picture-data", '<picture><source type="image/jai" srcset="data:image/jai,A%20magical%20castle;style=anime"><img src="castle.png" alt="A castle"></picture>',
  [{"carrier": 1, "document": castle, "diagnostics": []}], "Carrier 1 with a data: URL.")
h("html-picture-url", '<picture><source type="image/jai" srcset="castle.jai"><img src="castle.png" alt="A castle"></picture>',
  [{"carrier": 1, "url": "castle.jai"}], "Carrier 1 with a resource URL (fetched by the viewer).")
h("html-picture-type-essence", '<picture><source type="IMAGE/JAI; charset=utf-8" srcset="data:image/jai,x"><img src="a.png" alt="a"></picture>',
  [{"carrier": 1, "document": {"prompt": ["x"]}, "diagnostics": []}], "type matched by essence, case-insensitively.")
h("html-picture-descriptor", '<picture><source type="image/jai" srcset="data:image/jai,x 2x"><img src="a.png" alt="a"></picture>',
  [{"carrier": 1, "document": {"prompt": ["x"]}, "diagnostics": []}], "Descriptors are ignored.")
h("html-picture-first-jai-source", '<picture><source type="image/webp" srcset="a.webp"><source type="image/jai" srcset="data:image/jai,first"><source type="image/jai" srcset="data:image/jai,second"><img src="a.png" alt="a"></picture>',
  [{"carrier": 1, "document": {"prompt": ["first"]}, "diagnostics": []}], "First JAI source in tree order.")
h("html-picture-source-after-img", '<picture><img src="a.png" alt="a"><source type="image/jai" srcset="data:image/jai,x"></picture>',
  [], "A source after the img is ignored.")
h("html-picture-no-type", '<picture><source srcset="data:image/jai,x"><img src="a.png" alt="a"></picture>',
  [], "A source without type is not a JAI carrier.")
h("html-picture-unencoded-space", '<picture><source type="image/jai" srcset="data:image/jai,A castle"><img src="a.png" alt="a" data-jai="fallback"></picture>',
  [{"carrier": 1, "document": {"prompt": ["A"]}, "diagnostics": []}], "An unencoded space ends the srcset URL; the rest is a descriptor.")
h("html-data-jai", '<img src="castle.png" alt="A castle" data-jai="A magical castle;style=anime">',
  [{"carrier": 2, "document": castle, "diagnostics": []}], "Carrier 2.")
h("html-data-jai-entities", '<img src="c.png" alt="c" data-jai="Salt &amp; pepper;style=&quot;ink&quot;">',
  [{"carrier": 2, "document": {"prompt": ["Salt & pepper"], "style": ["\"ink\""]}, "diagnostics": []}], "HTML entities are decoded by the HTML parser, not by JAI.")
h("html-data-jai-newline", '<img src="c.png" alt="c" data-jai="A castle&#10;Mist below">',
  [{"carrier": 2, "document": {"prompt": ["A castle\nMist below"]}, "diagnostics": []}], "&#10; is a line break.")
h("html-data-jai-percent-not-decoded", '<img src="c.png" alt="c" data-jai="100%20 cotton">',
  [{"carrier": 2, "document": {"prompt": ["100%20 cotton"]}, "diagnostics": []}], "Attributes are not percent-decoded.", advisories=["percent-encoded-text"])
h("html-src-data", '<img src="data:image/jai,A%20magical%20castle;style=anime" alt="A magical castle" width="800" height="600">',
  [{"carrier": 3, "document": castle, "diagnostics": []}], "Carrier 3.")
h("html-src-jai-scheme", '<img src="jai:A castle" alt="A castle">',
  [], "jai: in src is not a carrier.")
h("html-alt", '<img src="castle.png" alt="jai:A magical castle;style=anime">',
  [{"carrier": 4, "document": castle, "diagnostics": []}], "Carrier 4 (deprecated).", advisories=["alt-carrier"])
h("html-alt-leading-ws", '<img src="castle.png" alt="  jai:A castle">',
  [{"carrier": 4, "document": {"prompt": ["A castle"]}, "diagnostics": []}], "Leading whitespace before the prefix.")
h("html-alt-plain", '<img src="castle.png" alt="A magical castle">',
  [], "An ordinary alt is never JAI.")
h("html-alt-jai-word", '<img src="castle.png" alt="Jaipur at night">',
  [], "Only the exact prefix counts.")
h("html-order-picture-wins", '<picture><source type="image/jai" srcset="data:image/jai,one"><img src="a.png" alt="jai:four" data-jai="two"></picture>',
  [{"carrier": 1, "document": {"prompt": ["one"]}, "diagnostics": []}], "Carrier 1 before 2 and 4.")
h("html-order-data-jai-before-alt", '<img src="a.png" alt="jai:four" data-jai="two">',
  [{"carrier": 2, "document": {"prompt": ["two"]}, "diagnostics": []}], "Carrier 2 before 4.")
h("html-order-src-before-alt", '<img src="data:image/jai,three" alt="jai:four">',
  [{"carrier": 3, "document": {"prompt": ["three"]}, "diagnostics": []}], "Carrier 3 before 4.")
h("html-multiple", '<p><img src="a.png" alt="a"><img src="b.png" alt="b" data-jai="bee"><img src="c.png" alt="jai:sea"></p>',
  [{"carrier": 2, "document": {"prompt": ["bee"]}, "diagnostics": []}, {"carrier": 4, "document": {"prompt": ["sea"]}, "diagnostics": []}], "Tree order.")
h("html-data-jai-empty", '<img src="a.png" alt="a" data-jai="">',
  [{"carrier": 2, "document": {}, "diagnostics": []}], "An empty data-jai is an empty document (carrier present).")

# ---------------------------------------------------------------- interpret

I = []
CATALOG = [
    {"id": "black-forest-labs/flux-schnell", "aliases": ["flux-schnell"], "family": "flux", "image_input": False, "default": True},
    {"id": "black-forest-labs/flux-kontext-pro", "aliases": ["flux-kontext"], "family": "flux", "image_input": True},
    {"id": "stability-ai/sdxl", "aliases": [], "family": "sdxl", "image_input": True},
]
FAMILIES = {"flux": ["flux", "kontext"], "sdxl": ["sdxl", "stable diffusion xl"]}
def i(id, doc, interpreted, diags=(), rationale="", catalog=False, has_original=False):
    c = case(id, rationale, document=doc, interpreted=interpreted, diagnostics=list(diags))
    if catalog: c["catalog"] = CATALOG; c["families"] = FAMILIES
    if has_original: c["has_original"] = True
    I.append(c)

i("int-description", {"prompt": ["A castle", "Mist below"]}, {"description": "A castle\nMist below"}, rationale="Prompt values joined with LF.")
i("int-no-prompt", {"style": ["anime"]}, {"description": ""}, rationale="Empty description.")
for n_, (v, ratio) in enumerate([("16:9", 16/9), ("16x9", 16/9), ("16X9", 16/9), ("16\u00d79", 16/9), ("16/9", 16/9), ("1920x1080", 16/9), ("16 : 9", 16/9), ("2.39:1", 2.39), ("1.5", 1.5), ("square", 1.0), ("Square", 1.0), ('"16:9"', 16/9), ("16:9.", 16/9)]):
    i("int-aspect-%02d" % n_, {"aspect": [v]}, {"aspect": ratio}, rationale="Accepted aspect spellings.")
i("int-aspect-landscape", {"aspect": ["landscape"]}, {"aspect": "landscape"}, rationale="Keyword without a number.")
i("int-aspect-portrait", {"aspect": ["Portrait"]}, {"aspect": "portrait"}, rationale="Keyword without a number.")
for n_, v in enumerate(["wide", "16,9", "0:1", "1:0", "200:1", "１６：９", "16:9:1", "-1:1", "16;9"]):
    i("int-aspect-invalid-%02d" % n_, {"aspect": [v]}, {"aspect": None}, ["invalid-value:aspect"], rationale="Invalid aspect spellings.")
i("int-aspect-last-wins", {"aspect": ["1:1", "16:9"]}, {"aspect": 16/9}, ["repeated-single:aspect"], rationale="Last value wins.")
i("int-aspect-continued", {"aspect": ["1:1", "16:9;foo"]}, {"aspect": None}, ["repeated-single:aspect", "invalid-value:aspect"], rationale="The winning value is what the author wrote.")
for n_, (v, n) in enumerate([("0.6", 0.6), ("60%", 0.6), ("60 %", 0.6), (".5", 0.5), ("1", 1.0), ("0", 0.0)]):
    i("int-strength-%02d" % n_, {"mode": ["transform"], "strength": [v]}, {"strength": n}, rationale="strength spellings.")
i("int-strength-clamp", {"mode": ["transform"], "strength": ["1.5"]}, {"strength": 1.0}, ["adjusted-value:strength"], rationale="Clamped.")
i("int-strength-clamp-pct", {"mode": ["transform"], "strength": ["150%"]}, {"strength": 1.0}, ["adjusted-value:strength"], rationale="Clamped.")
for n_, v in enumerate(["0,6", "-0.5", "high", "six"]):
    i("int-strength-invalid-%02d" % n_, {"mode": ["transform"], "strength": [v]}, {"strength": None}, ["invalid-value:strength"], rationale="Invalid strength (no decimal comma, no sign).")
for n_, (v, m) in enumerate([("generate", "generate"), ("Transform", "transform"), ("KEEP", "keep"), ("keep.", "keep")]):
    i("int-mode-%02d" % n_, {"mode": [v]}, {"mode": m}, rationale="mode keywords.")
i("int-mode-invalid", {"mode": ["original"]}, {"mode": "generate"}, ["invalid-value:mode"], rationale="Invalid mode: generate.")
i("int-mode-default", {"prompt": ["x"]}, {"mode": "generate"}, rationale="Default.")
for n_, (v, b) in enumerate([("true", True), ("yes", True), ("1", True), ("ON", True), ("false", False), ("no", False), ("0", False), ("off", False)]):
    i("int-animate-%02d" % n_, {"animate": [v]}, {"animate": b}, rationale="animate spellings.")
i("int-animate-invalid", {"animate": ["maybe"]}, {"animate": False}, ["invalid-value:animate"], rationale="Invalid.")
i("int-seed", {"seed": ["42"]}, {"seed": "42"}, rationale="seed.")
i("int-seed-20", {"seed": ["12345678901234567890"]}, {"seed": "12345678901234567890"}, rationale="Twenty digits.")
for n_, v in enumerate(["random", "1e400", "-1", "123456789012345678901", "４２"]):
    i("int-seed-invalid-%02d" % n_, {"seed": [v]}, {"seed": None}, ["invalid-value:seed"], rationale="Invalid seed.")
i("int-source-generate", {"source": ["https://example.org/a.jpg"]}, {"source": "https://example.org/a.jpg"}, ["ignored-value:source"], rationale="source outside transform has no effect.")
i("int-source-jai", {"mode": ["transform"], "source": ["data:image/jai,A castle"]}, {"source": None}, ["invalid-image:source"], rationale="A document never contains another document as input.")
i("int-source-svg", {"mode": ["transform"], "source": ["data:image/svg+xml,<svg/>"]}, {"source": None}, ["invalid-image:source"], rationale="Raster types only.")
i("int-preview-ok", {"preview": ["data:image/webp;base64,UklGRkI="]}, {"preview": "data:image/webp;base64,UklGRkI="}, rationale="Raster data: URL.")
i("int-preview-url", {"preview": ["https://example.org/p.png"]}, {"preview": None}, ["unsupported-preview:preview"], rationale="Never fetched from a network.")
i("int-preview-svg", {"preview": ["data:image/svg+xml,<svg/>"]}, {"preview": None}, ["unsupported-preview:preview"], rationale="No markup previews.")
i("int-quoted-model-unaffected", {"model": ['"flux"']}, {}, rationale="Text keys are not interpreted further.")
# model matching
i("int-model-exact", {"model": ["stability-ai/sdxl"]}, {"model": "stability-ai/sdxl"}, rationale="Exact id.", catalog=True)
i("int-model-alias", {"model": ["FLUX-SCHNELL"]}, {"model": "black-forest-labs/flux-schnell"}, rationale="Alias, ASCII case-insensitive.", catalog=True)
i("int-model-family", {"model": ["black-forest-labs/FLUX.1-dev"]}, {"model": "black-forest-labs/flux-schnell"}, ["substituted-model:model"], rationale="Family by words of the last segment.", catalog=True)
i("int-model-family-words", {"model": ["stable-diffusion-xl-base-1.0"]}, {"model": "stability-ai/sdxl"}, ["substituted-model:model"], rationale="Multi-word family spelling.", catalog=True)
i("int-model-order", {"model": ["flux", "sdxl"]}, {"model": "black-forest-labs/flux-schnell"}, ["substituted-model:model"], rationale="Document order: the first value that matches anything wins.", catalog=True)
i("int-model-skip-unknown", {"model": ["midjourney", "sdxl"]}, {"model": "stability-ai/sdxl"}, ["substituted-model:model"], rationale="Unmatched values are skipped.", catalog=True)
i("int-model-none", {"model": ["midjourney"]}, {"model": "black-forest-labs/flux-schnell"}, ["no-matching-model:model"], rationale="Default with a diagnostic.", catalog=True)
i("int-model-absent", {"prompt": ["x"]}, {"model": "black-forest-labs/flux-schnell"}, ["no-matching-model:model"], rationale="No model values: default.", catalog=True)
i("int-model-version", {"model": ["stability-ai/sdxl:7762fd07"]}, {"model": "stability-ai/sdxl"}, ["version-ignored:model"], rationale="Version suffix ignored when not pinning.", catalog=True)
i("int-model-url", {"model": ["https://example.org/flux-schnell"]}, {"model": "black-forest-labs/flux-schnell"}, ["substituted-model:model"], rationale="A URL is a string matched by words, never fetched; an alias must match the whole value.", catalog=True)
i("int-model-transform-image", {"mode": ["transform"], "model": ["flux"]}, {"model": "black-forest-labs/flux-kontext-pro"}, ["substituted-model:model"], rationale="transform with an input considers only image-capable models.", catalog=True, has_original=True)
i("int-model-transform-no-original", {"mode": ["transform"], "model": ["flux"]}, {"model": "black-forest-labs/flux-schnell"}, ["substituted-model:model"], rationale="Without an input image the restriction does not apply.", catalog=True)

# ---------------------------------------------------------------- review round 2
# Cases authored in review round 2 (bytes, canonical JSON and identities computed
# with the Python standard library and cross-checked against an independent
# implementation written from the spec alone). Each is added, or replaces the case
# with the same id; while the suite is untagged, replacing is allowed.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "round2.json"), encoding="utf-8") as fh:
    ROUND2 = json.load(fh)
REMOVED = {"int-quoted-model-unaffected"}  # asserted nothing (review round 2, R2-5)
_lists = {"parse": P, "serialize": S, "roundtrip": R, "json": JS, "decode": D, "url": U, "html": H, "interpret": I}
for _cls, _cases in ROUND2.items():
    target = _lists[_cls]
    for _c in _cases:
        _c = {k: v for k, v in _c.items() if not k.startswith("_")}
        _i = next((n for n, x in enumerate(target) if x["id"] == _c["id"]), None)
        if _i is not None:
            target[_i] = _c
        else:
            assert _c["id"] not in ALL_IDS, _c["id"]
            ALL_IDS.add(_c["id"])
            target.append(_c)
for _lst in _lists.values():
    _lst[:] = [c for c in _lst if c["id"] not in REMOVED]

# ---------------------------------------------------------------- governing ratio (aspect vs layout box)
def ir(id, doc, gr, ratio, diags=(), rationale=""):
    c = case(id, rationale, document=doc, interpreted={"ratio": ratio}, diagnostics=list(diags))
    if gr is not None: c["governing_ratio"] = gr
    I.append(c)

ir("int-ratio-aspect-only", {"aspect": ["16:9"]}, None, 16/9, rationale="No governing ratio: aspect decides.")
ir("int-ratio-none", {"prompt": ["x"]}, None, None, rationale="No aspect and no governing ratio: the renderer's default (or the preview) decides.")
ir("int-ratio-governing-no-aspect", {"prompt": ["x"]}, 1.5, 1.5, rationale="The element's shape governs.")
ir("int-ratio-governing-overrides", {"aspect": ["16:9"]}, 4/3, 4/3, ["ignored-value:aspect"], rationale="A sized box or original governs over a different aspect.")
ir("int-ratio-governing-agrees", {"aspect": ["16:9"]}, 1920/1080, 1920/1080, rationale="Equal ratios: no diagnostic.")
ir("int-ratio-governing-within-1pct", {"aspect": ["16:9"]}, 1.77, 1.77, rationale="Ratios within 1% do not differ.")
ir("int-ratio-governing-beyond-1pct", {"aspect": ["16:9"]}, 1.75, 1.75, ["ignored-value:aspect"], rationale="Ratios more than 1% apart differ.")
ir("int-ratio-landscape-agrees", {"aspect": ["landscape"]}, 1.5, 1.5, rationale="landscape agrees with any wider-than-tall shape.")
ir("int-ratio-landscape-differs", {"aspect": ["landscape"]}, 0.75, 0.75, ["ignored-value:aspect"], rationale="landscape differs from a tall shape.")
ir("int-ratio-portrait-square", {"aspect": ["portrait"]}, 1.0, 1.0, ["ignored-value:aspect"], rationale="portrait differs from a square shape.")
ir("int-ratio-invalid-aspect", {"aspect": ["wide"]}, 1.5, 1.5, ["invalid-value:aspect"], rationale="An invalid aspect is absent; nothing to ignore.")

counts = {}
counts["parse"] = write("parse", P, "input -> document + exact parser diagnostics; advisories are validator codes that must be present when a validator runs.")
counts["serialize"] = write("serialize", S, "document -> canonical text, bare text, canonical JSON, identity.")
counts["roundtrip"] = write("roundtrip", R, "parse(serialize(doc)) == doc, serialize is a fixed point; same for canonical JSON.")
counts["json"] = write("json", JS, "JSON text -> document + exact parser diagnostics; 'optional' codes may or may not be emitted.")
counts["decode"] = write("decode", D, "base64 bytes -> document + exact parser diagnostics.")
counts["url"] = write("url", U, "kind data: a data: URL string; query: whole-query form; param: the jai parameter.")
counts["html"] = write("html", H, "HTML fragment -> discovered carriers in tree order. url entries are resolved by the viewer, not decoded here.")
counts["interpret"] = write("interpret", I, "document -> interpreted parameters (only listed fields compared; aspect as a ratio number or keyword; null means absent) + exact interpreter diagnostics.")
print(counts, "total", sum(counts.values()))
