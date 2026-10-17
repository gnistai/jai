# JAI conformance fixtures

The JSON files in this directory are the normative conformance fixtures of
the JAI specification. Where the fixtures and the specification prose
disagree, the fixtures are correct and the prose has a bug.

| Class | File | What a case asserts |
|---|---|---|
| `parse` | `parse/parse.json` | `input` (text form) → `document` and the exact multiset of parser `diagnostics`; `advisories` are validator codes that must be present when a validator runs |
| `serialize` | `serialize/serialize.json` | `document` → canonical `text`, canonical `json`, `identity`, and where given the canonical `data:` `url` |
| `roundtrip` | `roundtrip/roundtrip.json` | `document` survives the canonical text, the `data:` URL, canonical JSON and the file form unchanged, and serialisation is a fixed point |
| `json` | `json/json.json` | JSON `input` → `document`, `diagnostics` |
| `decode` | `decode/decode.json` | base64 `bytes` of a `.jai` file (the file form only) → `document`, `diagnostics` (`bound` gives the decompression bound to use) |
| `url` | `url/url.json` | `data:` `url` (the text form only) → `document`, `diagnostics`, or `discovered: false` |
| `html` | `html/html.json` | HTML fragment → `discovered` carriers (`picture`, `attribute`, `src`) in tree order (`url` entries are resolved against the page and fetched by a viewer, not decoded here); optional `advisories` / `no_advisories` |
| `interpret` | `interpret/interpret.json` | `document` (+ optional model `catalog`, `families`, `has_original`, `governing_ratio`, `selected`) → `interpreted` fields (including `model_description`, `model_style`, `model_avoid`) and exact interpreter diagnostics |

A document is written as an object mapping each key to an array of values.
A diagnostic is written `code` (any key) or `code:key`. Parser diagnostics
are compared as an exact multiset; validator advisories only need to be
present, and codes in `no_advisories` must be absent.

Every case has an `id` (unique across the suite), a `since` edition and a
`rationale`. From the first tagged edition, fixtures are append-only: a
changed expectation is a new case with a new id.

`src/fixtures.py` is the authoring source: expectations are written there by
hand, and all bytes, canonical JSON and identities are computed with Python's
standard library, independently of any JAI implementation. Fixture strings
in that file write each backslash as `¥` to keep the source unambiguous.
`src/round2.json` holds the cases authored in review round 2 (some byte
sequences there were built by hand); `fixtures.py` appends them to their
classes. Run `python3 -I tests/src/fixtures.py` to rewrite the JSON files.
`run.mjs` runs the suite against `docs/assets/js/jai.js` or, with `--impl`,
against any module exposing the same API.
