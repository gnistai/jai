# JAI conformance fixtures

The JSON files in this directory are the normative conformance fixtures of
the JAI specification. Where the fixtures and the specification prose
disagree, the fixtures are correct and the prose has a bug.

| Class | File | What a case asserts |
|---|---|---|
| `parse` | `parse/parse.json` | `input` (text form) → `document` and the exact multiset of parser `diagnostics`; `advisories` are validator codes that must be present when a validator runs |
| `serialize` | `serialize/serialize.json` | `document` → canonical `text`, `bare` text, canonical `json`, `identity` |
| `roundtrip` | `roundtrip/roundtrip.json` | `document` survives text, bare text, `data:` URL, canonical JSON and file form unchanged, and serialisation is a fixed point |
| `json` | `json/json.json` | JSON `input` (with `context`) → `document`, `diagnostics`; codes in `optional` may or may not be emitted |
| `decode` | `decode/decode.json` | base64 `bytes` → `document`, `diagnostics` (`bound` gives the decompression bound to use) |
| `url` | `url/url.json` | `url` of `kind` `data`, `query` or `param` → `document`, `diagnostics`, or `discovered: false` |
| `html` | `html/html.json` | HTML fragment → `discovered` carriers (`picture`, `attribute`, `src`) in tree order (`url` entries are resolved against the page and fetched by a viewer, not decoded here) |
| `interpret` | `interpret/interpret.json` | `document` (+ optional model `catalog`, `families`, `has_original`, `governing_ratio`, `selected`) → `interpreted` fields (including `model_description`, `model_style`, `model_avoid`) and exact interpreter diagnostics |

A document is written as an object mapping each key to an array of values.
A diagnostic is written `code` (any key) or `code:key`. Parser diagnostics
are compared as an exact multiset; validator advisories only need to be
present.

Every case has an `id` (unique across the suite), a `since` edition and a
`rationale`. From the first tagged edition, fixtures are append-only: a
changed expectation is a new case with a new id.

`src/fixtures.py` is the authoring source: expectations are written there by
hand, and all bytes, canonical JSON and identities are computed with Python's
standard library, independently of any JAI implementation. Fixture strings
in that file write each backslash as `¥` to keep the source unambiguous.
`run.mjs` runs the suite against `docs/assets/js/jai.js` or, with `--impl`,
against any module exposing the same API.
